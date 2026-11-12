import { fetchPcmChunk } from '@/lib/tauri';
import { dbToLinear, linearToDb } from '@/lib/utils';
import type { EffectInstance, ParametricBand } from '@/types/effects';
import type { AudioClip, AudioTrack, ChannelRoutingMode, MediaAsset } from '@/types/project';

const CHUNK_DURATION_MS = 10_000; // 10-second sliding PCM chunks for low RAM usage
const MAX_CACHED_CHUNKS = 24; // ~240s max active window in RAM

interface ActiveVoice {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
}

export interface LiveMeterSnapshot {
  peakLeftDb: number;
  peakRightDb: number;
  rmsLeftDb: number;
  rmsRightDb: number;
  lufsApprox: number;
  clipping: boolean;
  spectrum: Uint8Array;
}

class SonoraAudioEngine {
  private ctx: AudioContext | null = null;
  private workletReady = false;
  private masterGain: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private splitter: ChannelSplitterNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;

  private chunkCache = new Map<string, AudioBuffer>();
  private pendingChunks = new Map<string, Promise<AudioBuffer>>();
  private activeVoices: ActiveVoice[] = [];
  private activeAuxNodes: AudioNode[] = [];

  private isPlaying = false;
  private playStartCtxTime = 0;
  private playStartProjectMs = 0;
  private currentTimeMs = 0;
  private lastScheduledChunkEndMs = 0;
  private schedulerTimer: number | null = null;
  private reverbIrCache = new Map<string, AudioBuffer>();

  private spectrumData = new Uint8Array(128);
  private timeBufL = new Float32Array(512);
  private timeBufR = new Float32Array(512);

  private currentTracks: AudioTrack[] = [];
  private currentClips: AudioClip[] = [];
  private currentAssets: Record<string, MediaAsset> = {};
  private loopEnabled = false;
  private loopStartMs = 0;
  private loopEndMs = 0;
  private onEndedCallback: (() => void) | null = null;

  public async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.masterGain = this.ctx.createGain();
      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -1.0;
      this.masterLimiter.knee.value = 0;
      this.masterLimiter.ratio.value = 20;
      this.masterLimiter.attack.value = 0.002;
      this.masterLimiter.release.value = 0.06;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;

      this.splitter = this.ctx.createChannelSplitter(2);
      this.analyserL = this.ctx.createAnalyser();
      this.analyserL.fftSize = 512;
      this.analyserR = this.ctx.createAnalyser();
      this.analyserR.fftSize = 512;

      this.masterGain.connect(this.masterLimiter);
      this.masterLimiter.connect(this.analyser);
      this.analyser.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
      this.analyser.connect(this.ctx.destination);

      this.spectrumData = new Uint8Array(this.analyser.frequencyBinCount);

      try {
        await this.ctx.audioWorklet.addModule('/worklets/streaming-processor.js');
        this.workletReady = true;
      } catch {
        this.workletReady = false;
      }
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  public async setOutputDevice(sinkId: string): Promise<void> {
    const ctx = await this.ensureContext();
    const anyCtx = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (typeof anyCtx.setSinkId === 'function') {
      await anyCtx.setSinkId(sinkId);
    }
  }

  public setMasterVolumeDb(db: number): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(dbToLinear(db), this.ctx.currentTime, 0.015);
    }
  }

  public updateProjectSnapshot(
    tracks: AudioTrack[],
    clips: AudioClip[],
    assets: Record<string, MediaAsset>,
    masterVolumeDb: number,
  ): void {
    this.currentTracks = tracks;
    this.currentClips = clips;
    this.currentAssets = assets;
    this.setMasterVolumeDb(masterVolumeDb);
  }

  public setLoop(enabled: boolean, startMs: number, endMs: number): void {
    this.loopEnabled = enabled;
    this.loopStartMs = startMs;
    this.loopEndMs = endMs;
  }

  private async getChunkAudioBuffer(
    asset: MediaAsset,
    chunkIndex: number,
  ): Promise<AudioBuffer> {
    const ctx = await this.ensureContext();
    const sr = ctx.sampleRate;
    const ch = Math.min(2, Math.max(1, asset.channels || 2));
    const startMs = chunkIndex * CHUNK_DURATION_MS;
    const remainingMs = Math.max(50, asset.durationMs - startMs);
    const durMs = Math.min(CHUNK_DURATION_MS, remainingMs);
    const key = `${asset.resolvedPath}|${chunkIndex}|${sr}|${ch}`;

    const cached = this.chunkCache.get(key);
    if (cached) {
      // Refresh LRU order
      this.chunkCache.delete(key);
      this.chunkCache.set(key, cached);
      return cached;
    }

    const pending = this.pendingChunks.get(key);
    if (pending) return pending;

    const promise = (async () => {
      const f32 = await fetchPcmChunk(asset.resolvedPath, startMs, durMs, sr, ch);
      const frames = Math.max(1, Math.floor(f32.length / ch));
      const buffer = ctx.createBuffer(ch, frames, sr);
      if (ch === 1) {
        buffer.copyToChannel(new Float32Array(f32.subarray(0, frames)), 0);
      } else {
        const left = new Float32Array(frames);
        const right = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          left[i] = f32[i * 2] ?? 0;
          right[i] = f32[i * 2 + 1] ?? left[i];
        }
        buffer.copyToChannel(left, 0);
        buffer.copyToChannel(right, 1);
      }

      if (this.chunkCache.size >= MAX_CACHED_CHUNKS) {
        const oldestKey = this.chunkCache.keys().next().value;
        if (oldestKey) this.chunkCache.delete(oldestKey);
      }
      this.chunkCache.set(key, buffer);
      this.pendingChunks.delete(key);
      return buffer;
    })();

    this.pendingChunks.set(key, promise);
    return promise;
  }

  private getReverbImpulse(ctx: AudioContext, roomSize: number, decay: number): AudioBuffer {
    const key = `${ctx.sampleRate}_${roomSize.toFixed(2)}_${decay.toFixed(2)}`;
    const existing = this.reverbIrCache.get(key);
    if (existing) return existing;

    const len = Math.max(1024, Math.floor(ctx.sampleRate * Math.min(3.5, Math.max(0.2, decay * (0.5 + roomSize)))));
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2);
      }
    }
    this.reverbIrCache.set(key, ir);
    return ir;
  }

  private buildEffectChain(
    ctx: AudioContext,
    effects: EffectInstance[],
    inputNode: AudioNode,
  ): AudioNode {
    let tail: AudioNode = inputNode;

    for (const fx of effects) {
      if (fx.bypassed) continue;
      const p = fx.params;

      switch (fx.type) {
        case 'compressor': {
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = Number(p.threshold ?? -18);
          comp.ratio.value = Math.min(20, Math.max(1, Number(p.ratio ?? 4)));
          comp.attack.value = Math.max(0.001, Number(p.attack ?? 12) / 1000);
          comp.release.value = Math.max(0.01, Number(p.release ?? 150) / 1000);
          comp.knee.value = Number(p.knee ?? 4);
          const makeup = ctx.createGain();
          makeup.gain.value = dbToLinear(Number(p.makeup ?? 0));
          tail.connect(comp);
          comp.connect(makeup);
          tail = makeup;
          this.activeAuxNodes.push(comp, makeup);
          break;
        }
        case 'limiter': {
          const lim = ctx.createDynamicsCompressor();
          lim.threshold.value = Number(p.ceiling ?? -1.0);
          lim.knee.value = 0;
          lim.ratio.value = 20;
          lim.attack.value = Math.max(0.0005, Number(p.attack ?? 2) / 1000);
          lim.release.value = Math.max(0.01, Number(p.release ?? 80) / 1000);
          tail.connect(lim);
          tail = lim;
          this.activeAuxNodes.push(lim);
          break;
        }
        case 'noise_gate':
        case 'expander': {
          if (this.workletReady) {
            const node = new AudioWorkletNode(ctx, 'sonora-dsp-processor');
            node.parameters.get('gateEnabled')?.setValueAtTime(1, ctx.currentTime);
            node.parameters.get('gateThresholdDb')?.setValueAtTime(Number(p.threshold ?? -45), ctx.currentTime);
            node.parameters.get('gateRangeDb')?.setValueAtTime(Number(p.range ?? -30), ctx.currentTime);
            node.parameters.get('limiterEnabled')?.setValueAtTime(0, ctx.currentTime);
            tail.connect(node);
            tail = node;
            this.activeAuxNodes.push(node);
          }
          break;
        }
        case 'high_pass': {
          const f = ctx.createBiquadFilter();
          f.type = 'highpass';
          f.frequency.value = Number(p.freq ?? 80);
          f.Q.value = Number(p.q ?? 0.707);
          tail.connect(f);
          tail = f;
          this.activeAuxNodes.push(f);
          break;
        }
        case 'low_pass': {
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = Number(p.freq ?? 12000);
          f.Q.value = Number(p.q ?? 0.707);
          tail.connect(f);
          tail = f;
          this.activeAuxNodes.push(f);
          break;
        }
        case 'low_shelf': {
          const f = ctx.createBiquadFilter();
          f.type = 'lowshelf';
          f.frequency.value = Number(p.freq ?? 120);
          f.gain.value = Number(p.gain ?? 0);
          tail.connect(f);
          tail = f;
          this.activeAuxNodes.push(f);
          break;
        }
        case 'high_shelf': {
          const f = ctx.createBiquadFilter();
          f.type = 'highshelf';
          f.frequency.value = Number(p.freq ?? 6500);
          f.gain.value = Number(p.gain ?? 0);
          tail.connect(f);
          tail = f;
          this.activeAuxNodes.push(f);
          break;
        }
        case 'eq_3band': {
          const specs: Array<[BiquadFilterType, number, number]> = [
            ['lowshelf', 120, Number(p.low ?? 0)],
            ['peaking', 1000, Number(p.mid ?? 0)],
            ['highshelf', 5000, Number(p.high ?? 0)],
          ];
          for (const [type, freq, gain] of specs) {
            const f = ctx.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            f.gain.value = gain;
            f.Q.value = 1.0;
            tail.connect(f);
            tail = f;
            this.activeAuxNodes.push(f);
          }
          break;
        }
        case 'eq_5band': {
          const bands: Array<[number, string]> = [
            [60, 'b60'], [250, 'b250'], [1000, 'b1k'], [4000, 'b4k'], [12000, 'b12k'],
          ];
          for (const [freq, key] of bands) {
            const f = ctx.createBiquadFilter();
            f.type = 'peaking';
            f.frequency.value = freq;
            f.Q.value = 1.2;
            f.gain.value = Number(p[key] ?? 0);
            tail.connect(f);
            tail = f;
            this.activeAuxNodes.push(f);
          }
          break;
        }
        case 'eq_10band': {
          const bands: Array<[number, string]> = [
            [31, 'b31'], [62, 'b62'], [125, 'b125'], [250, 'b250'], [500, 'b500'],
            [1000, 'b1k'], [2000, 'b2k'], [4000, 'b4k'], [8000, 'b8k'], [16000, 'b16k'],
          ];
          for (const [freq, key] of bands) {
            const f = ctx.createBiquadFilter();
            f.type = 'peaking';
            f.frequency.value = freq;
            f.Q.value = 1.4;
            f.gain.value = Number(p[key] ?? 0);
            tail.connect(f);
            tail = f;
            this.activeAuxNodes.push(f);
          }
          break;
        }
        case 'parametric_eq': {
          const bands = (p.bands as ParametricBand[]) ?? [];
          for (const b of bands) {
            if (!b.enabled) continue;
            const f = ctx.createBiquadFilter();
            f.type = b.type;
            f.frequency.value = b.freq;
            f.gain.value = b.gain;
            f.Q.value = b.q;
            tail.connect(f);
            tail = f;
            this.activeAuxNodes.push(f);
          }
          break;
        }
        case 'reverb': {
          const mix = Math.min(1, Math.max(0, Number(p.mix ?? 0.22)));
          const dry = ctx.createGain();
          dry.gain.value = 1 - mix * 0.4;
          const wet = ctx.createGain();
          wet.gain.value = mix;
          const conv = ctx.createConvolver();
          conv.buffer = this.getReverbImpulse(ctx, Number(p.roomSize ?? 0.4), Number(p.decay ?? 0.9));
          const sum = ctx.createGain();
          tail.connect(dry);
          tail.connect(conv);
          conv.connect(wet);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          this.activeAuxNodes.push(dry, wet, conv, sum);
          break;
        }
        case 'delay':
        case 'echo': {
          const delaySec = Math.min(2.0, Math.max(0.01, Number(p.timeMs ?? 280) / 1000));
          const feedback = Math.min(0.85, Math.max(0, Number(p.feedback ?? 0.35)));
          const mix = Math.min(1, Math.max(0, Number(p.mix ?? 0.28)));
          const delayNode = ctx.createDelay(2.5);
          delayNode.delayTime.value = delaySec;
          const fbGain = ctx.createGain();
          fbGain.gain.value = feedback;
          const wet = ctx.createGain();
          wet.gain.value = mix;
          const dry = ctx.createGain();
          dry.gain.value = 1.0;
          const sum = ctx.createGain();
          tail.connect(dry);
          tail.connect(delayNode);
          delayNode.connect(fbGain);
          fbGain.connect(delayNode);
          delayNode.connect(wet);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          this.activeAuxNodes.push(delayNode, fbGain, wet, dry, sum);
          break;
        }
        case 'chorus':
        case 'flanger': {
          const baseDelay = fx.type === 'chorus' ? 0.025 : Number(p.delay ?? 4) / 1000;
          const depth = Number(p.depth ?? 2.2) / 1000;
          const rate = Number(p.rate ?? 0.6);
          const mix = Math.min(1, Math.max(0, Number(p.mix ?? 0.4)));
          const delay = ctx.createDelay(0.1);
          delay.delayTime.value = baseDelay;
          const lfo = ctx.createOscillator();
          lfo.frequency.value = rate;
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = depth;
          lfo.connect(lfoGain);
          lfoGain.connect(delay.delayTime);
          lfo.start();
          const wet = ctx.createGain();
          wet.gain.value = mix;
          const dry = ctx.createGain();
          dry.gain.value = 1 - mix * 0.35;
          const sum = ctx.createGain();
          tail.connect(dry);
          tail.connect(delay);
          delay.connect(wet);
          dry.connect(sum);
          wet.connect(sum);
          tail = sum;
          this.activeAuxNodes.push(delay, lfo, lfoGain, wet, dry, sum);
          break;
        }
        case 'phaser': {
          const allpass = ctx.createBiquadFilter();
          allpass.type = 'allpass';
          allpass.frequency.value = 900;
          allpass.Q.value = 2.0;
          const lfo = ctx.createOscillator();
          lfo.frequency.value = Number(p.rate ?? 0.5);
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = 600;
          lfo.connect(lfoGain);
          lfoGain.connect(allpass.frequency);
          lfo.start();
          tail.connect(allpass);
          tail = allpass;
          this.activeAuxNodes.push(allpass, lfo, lfoGain);
          break;
        }
        case 'stereo_widener': {
          if (this.workletReady) {
            const node = new AudioWorkletNode(ctx, 'sonora-dsp-processor');
            node.parameters.get('widenerEnabled')?.setValueAtTime(1, ctx.currentTime);
            node.parameters
              .get('widenerWidth')
              ?.setValueAtTime(Number(p.width ?? 130) / 100, ctx.currentTime);
            node.parameters.get('limiterEnabled')?.setValueAtTime(0, ctx.currentTime);
            tail.connect(node);
            tail = node;
            this.activeAuxNodes.push(node);
          }
          break;
        }
        case 'de_hum': {
          const base = p.freq60 ? 60 : 50;
          const depth = Number(p.reduction ?? -28);
          for (let h = 1; h <= 4; h++) {
            const f = ctx.createBiquadFilter();
            f.type = 'peaking';
            f.frequency.value = base * h;
            f.Q.value = 16;
            f.gain.value = depth * (1 / Math.sqrt(h));
            tail.connect(f);
            tail = f;
            this.activeAuxNodes.push(f);
          }
          break;
        }
        case 'de_esser': {
          const f = ctx.createBiquadFilter();
          f.type = 'peaking';
          f.frequency.value = Number(p.freq ?? 6500);
          f.Q.value = 2.2;
          f.gain.value = -Math.min(10, Number(p.intensity ?? 0.45) * 12);
          tail.connect(f);
          tail = f;
          this.activeAuxNodes.push(f);
          break;
        }
        case 'noise_reduction':
        case 'remove_background_noise': {
          const hpf = ctx.createBiquadFilter();
          hpf.type = 'highpass';
          hpf.frequency.value = 85;
          tail.connect(hpf);
          tail = hpf;
          this.activeAuxNodes.push(hpf);
          break;
        }
      }
    }
    return tail;
  }

  private createChannelRoutingNode(
    ctx: AudioContext,
    mode: ChannelRoutingMode,
    input: AudioNode,
  ): AudioNode {
    if (mode === 'stereo') return input;
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    input.connect(splitter);
    if (mode === 'left_only') {
      splitter.connect(merger, 0, 0);
      splitter.connect(merger, 0, 1);
    } else if (mode === 'right_only') {
      splitter.connect(merger, 1, 0);
      splitter.connect(merger, 1, 1);
    } else {
      // mono_mix
      const gL = ctx.createGain();
      const gR = ctx.createGain();
      gL.gain.value = 0.5;
      gR.gain.value = 0.5;
      splitter.connect(gL, 0);
      splitter.connect(gR, 1);
      gL.connect(merger, 0, 0);
      gR.connect(merger, 0, 0);
      gL.connect(merger, 0, 1);
      gR.connect(merger, 0, 1);
      this.activeAuxNodes.push(gL, gR);
    }
    this.activeAuxNodes.push(splitter, merger);
    return merger;
  }

  public async play(fromMs: number, onEnded?: () => void): Promise<void> {
    const ctx = await this.ensureContext();
    this.stopVoicesOnly();
    this.isPlaying = true;
    this.playStartCtxTime = ctx.currentTime;
    this.playStartProjectMs = Math.max(0, fromMs);
    this.currentTimeMs = this.playStartProjectMs;
    this.lastScheduledChunkEndMs = this.playStartProjectMs;
    this.onEndedCallback = onEnded ?? null;

    await this.scheduleAhead(this.playStartProjectMs, 14_000);

    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
    }
    this.schedulerTimer = window.setInterval(() => {
      if (!this.isPlaying || !this.ctx) return;
      const nowMs = this.getCurrentTimeMs();
      if (this.loopEnabled && this.loopEndMs > this.loopStartMs && nowMs >= this.loopEndMs) {
        void this.play(this.loopStartMs, this.onEndedCallback ?? undefined);
        return;
      }
      const projectEnd = this.getProjectDurationMs();
      if (!this.loopEnabled && projectEnd > 0 && nowMs >= projectEnd) {
        this.stop();
        this.onEndedCallback?.();
        return;
      }
      if (nowMs + 8000 > this.lastScheduledChunkEndMs) {
        void this.scheduleAhead(this.lastScheduledChunkEndMs, 12_000);
      }
    }, 250);
  }

  private getProjectDurationMs(): number {
    let maxEnd = 0;
    for (const c of this.currentClips) {
      maxEnd = Math.max(maxEnd, c.timelineStartMs + c.durationMs);
    }
    return maxEnd;
  }

  private async scheduleAhead(windowStartMs: number, spanMs: number): Promise<void> {
    if (!this.ctx || !this.masterGain || !this.isPlaying) return;
    const ctx = this.ctx;
    const windowEndMs = windowStartMs + spanMs;
    this.lastScheduledChunkEndMs = Math.max(this.lastScheduledChunkEndMs, windowEndMs);

    const anySolo = this.currentTracks.some((t) => t.solo);

    for (const track of this.currentTracks) {
      if (track.muted || (anySolo && !track.solo)) continue;
      const trackClips = this.currentClips.filter((c) => c.trackId === track.id && !c.muted);
      if (trackClips.length === 0) continue;

      // Build track DSP bus once per schedule pass
      const trackInput = ctx.createGain();
      let node: AudioNode = this.createChannelRoutingNode(ctx, track.channelMode, trackInput);
      node = this.buildEffectChain(ctx, track.effects, node);
      const trackVol = ctx.createGain();
      trackVol.gain.value = dbToLinear(track.volumeDb);
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.min(1, Math.max(-1, track.pan));

      node.connect(trackVol);
      trackVol.connect(panner);
      panner.connect(this.masterGain);
      this.activeAuxNodes.push(trackInput, trackVol, panner);

      for (const clip of trackClips) {
        const clipStart = clip.timelineStartMs;
        const clipEnd = clipStart + clip.durationMs;
        if (clipEnd <= windowStartMs || clipStart >= windowEndMs) continue;

        const asset = this.currentAssets[clip.renderAssetId ?? clip.assetId];
        if (!asset) continue;

        const overlapStart = Math.max(clipStart, windowStartMs);
        const overlapEnd = Math.min(clipEnd, windowEndMs);

        const rate = Math.max(0.25, Math.min(4, clip.playbackRate || 1));
        const srcStartMs = clip.sourceOffsetMs + (overlapStart - clipStart) * rate;
        const srcEndMs = clip.sourceOffsetMs + (overlapEnd - clipStart) * rate;

        const firstChunk = Math.floor(srcStartMs / CHUNK_DURATION_MS);
        const lastChunk = Math.floor(Math.max(srcStartMs, srcEndMs - 1) / CHUNK_DURATION_MS);

        for (let chIdx = firstChunk; chIdx <= lastChunk; chIdx++) {
          const chunkStartInAssetMs = chIdx * CHUNK_DURATION_MS;
          if (chunkStartInAssetMs >= asset.durationMs) break;
          const buf = await this.getChunkAudioBuffer(asset, chIdx);
          if (!this.isPlaying) return;

          const segSrcStartMs = Math.max(srcStartMs, chunkStartInAssetMs);
          const segSrcEndMs = Math.min(srcEndMs, chunkStartInAssetMs + CHUNK_DURATION_MS, asset.durationMs);
          if (segSrcEndMs <= segSrcStartMs) continue;

          const segTlStartMs = clipStart + (segSrcStartMs - clip.sourceOffsetMs) / rate;
          const segTlDurMs = (segSrcEndMs - segSrcStartMs) / rate;

          const ctxWhen =
            this.playStartCtxTime + Math.max(0, (segTlStartMs - this.playStartProjectMs) / 1000);
          const bufOffsetSec = Math.max(0, (segSrcStartMs - chunkStartInAssetMs) / 1000);
          const bufDurSec = Math.max(0.005, (segSrcEndMs - segSrcStartMs) / 1000);

          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.playbackRate.value = rate;
          if (clip.pitchSemitones) {
            src.detune.value = clip.pitchSemitones * 100;
          }

          const clipGain = ctx.createGain();
          const baseLin = dbToLinear(clip.gainDb);
          clipGain.gain.setValueAtTime(baseLin, ctxWhen);

          // Apply Fade In envelope
          if (clip.fadeInMs > 0 && segTlStartMs < clipStart + clip.fadeInMs) {
            const fadeEndTime =
              this.playStartCtxTime + (clipStart + clip.fadeInMs - this.playStartProjectMs) / 1000;
            const fadeStartTime =
              this.playStartCtxTime + (clipStart - this.playStartProjectMs) / 1000;
            const progress = Math.max(0, (segTlStartMs - clipStart) / clip.fadeInMs);
            clipGain.gain.setValueAtTime(Math.max(0.0001, baseLin * progress), ctxWhen);
            clipGain.gain.linearRampToValueAtTime(
              baseLin,
              Math.max(ctxWhen + 0.005, fadeEndTime),
            );
            void fadeStartTime;
          }

          // Apply Fade Out envelope
          if (clip.fadeOutMs > 0 && segTlStartMs + segTlDurMs > clipEnd - clip.fadeOutMs) {
            const fadeStartTl = clipEnd - clip.fadeOutMs;
            const fadeStartCtx =
              this.playStartCtxTime + Math.max(0, (fadeStartTl - this.playStartProjectMs) / 1000);
            const fadeEndCtx =
              this.playStartCtxTime + Math.max(0.01, (clipEnd - this.playStartProjectMs) / 1000);
            if (fadeStartCtx > ctxWhen) {
              clipGain.gain.setValueAtTime(baseLin, fadeStartCtx);
            }
            clipGain.gain.linearRampToValueAtTime(0.0001, Math.max(ctxWhen + 0.01, fadeEndCtx));
          }

          let clipChain: AudioNode = this.createChannelRoutingNode(ctx, clip.channelMode, src);
          clipChain = this.buildEffectChain(ctx, clip.effects, clipChain);
          clipChain.connect(clipGain);
          clipGain.connect(trackInput);

          src.start(ctxWhen, bufOffsetSec, bufDurSec);
          this.activeVoices.push({ source: src, gainNode: clipGain });
        }
      }
    }
  }

  private stopVoicesOnly(): void {
    if (this.schedulerTimer !== null) {
      window.clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    for (const v of this.activeVoices) {
      try {
        v.source.stop();
        v.source.disconnect();
        v.gainNode.disconnect();
      } catch {
        // already stopped
      }
    }
    this.activeVoices = [];
    for (const n of this.activeAuxNodes) {
      try {
        n.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeAuxNodes = [];
  }

  public pause(): number {
    if (this.isPlaying) {
      this.currentTimeMs = this.getCurrentTimeMs();
    }
    this.isPlaying = false;
    this.stopVoicesOnly();
    return this.currentTimeMs;
  }

  public stop(): void {
    this.isPlaying = false;
    this.currentTimeMs = 0;
    this.stopVoicesOnly();
  }

  public getCurrentTimeMs(): number {
    if (!this.isPlaying || !this.ctx) {
      return this.currentTimeMs;
    }
    const elapsedSec = Math.max(0, this.ctx.currentTime - this.playStartCtxTime);
    return this.playStartProjectMs + elapsedSec * 1000;
  }

  public getLiveMeters(): LiveMeterSnapshot {
    if (!this.analyser || !this.analyserL || !this.analyserR || !this.isPlaying) {
      this.spectrumData.fill(0);
      return {
        peakLeftDb: -96,
        peakRightDb: -96,
        rmsLeftDb: -96,
        rmsRightDb: -96,
        lufsApprox: -70,
        clipping: false,
        spectrum: this.spectrumData,
      };
    }

    this.analyser.getByteFrequencyData(this.spectrumData);
    this.analyserL.getFloatTimeDomainData(this.timeBufL);
    this.analyserR.getFloatTimeDomainData(this.timeBufR);

    let pkL = 0;
    let pkR = 0;
    let sqL = 0;
    let sqR = 0;
    for (let i = 0; i < this.timeBufL.length; i++) {
      const l = this.timeBufL[i];
      const r = this.timeBufR[i];
      pkL = Math.max(pkL, Math.abs(l));
      pkR = Math.max(pkR, Math.abs(r));
      sqL += l * l;
      sqR += r * r;
    }

    const rmsL = Math.sqrt(sqL / this.timeBufL.length);
    const rmsR = Math.sqrt(sqR / this.timeBufR.length);
    const rmsMean = (rmsL + rmsR) * 0.5;
    const rmsDb = linearToDb(rmsMean);

    return {
      peakLeftDb: linearToDb(pkL),
      peakRightDb: linearToDb(pkR),
      rmsLeftDb: linearToDb(rmsL),
      rmsRightDb: linearToDb(rmsR),
      lufsApprox: Math.max(-70, rmsDb - 0.7),
      clipping: pkL >= 0.99 || pkR >= 0.99,
      spectrum: this.spectrumData,
    };
  }
}

export const audioEngine = new SonoraAudioEngine();
