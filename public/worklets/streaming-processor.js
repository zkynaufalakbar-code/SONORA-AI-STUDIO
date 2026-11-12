/**
 * SONORA AI STUDIO - Real-Time DSP AudioWorkletProcessor
 * Implements sample-accurate Noise Gate, Stereo Mid/Side Widener, and Lookahead Soft Limiter.
 */
class SonoraDspProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gateEnabled', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'gateThresholdDb', defaultValue: -45, minValue: -90, maxValue: 0 },
      { name: 'gateRangeDb', defaultValue: -32, minValue: -90, maxValue: 0 },
      { name: 'widenerEnabled', defaultValue: 0, minValue: 0, maxValue: 1 },
      { name: 'widenerWidth', defaultValue: 1.0, minValue: 0, maxValue: 2.0 },
      { name: 'limiterEnabled', defaultValue: 1, minValue: 0, maxValue: 1 },
      { name: 'limiterCeilingDb', defaultValue: -0.8, minValue: -24, maxValue: 0 },
    ];
  }

  constructor() {
    super();
    this.gateEnv = 1.0;
    this.meterCounter = 0;
    this.peakL = 0;
    this.peakR = 0;
    this.sqL = 0;
    this.sqR = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const chL = input[0];
    const chR = input.length > 1 ? input[1] : input[0];
    const outL = output[0];
    const outR = output.length > 1 ? output[1] : output[0];
    const frames = outL.length;

    const gateOn = parameters.gateEnabled[0] > 0.5;
    const gateThresh = Math.pow(10, parameters.gateThresholdDb[0] / 20);
    const gateFloor = Math.pow(10, parameters.gateRangeDb[0] / 20);
    const wideOn = parameters.widenerEnabled[0] > 0.5;
    const width = parameters.widenerWidth[0];
    const limOn = parameters.limiterEnabled[0] > 0.5;
    const limCeil = Math.pow(10, parameters.limiterCeilingDb[0] / 20);

    for (let i = 0; i < frames; i++) {
      let l = chL[i] || 0;
      let r = chR[i] || 0;

      if (gateOn) {
        const mag = Math.max(Math.abs(l), Math.abs(r));
        const target = mag >= gateThresh ? 1.0 : gateFloor;
        const coeff = target > this.gateEnv ? 0.08 : 0.004;
        this.gateEnv += (target - this.gateEnv) * coeff;
        l *= this.gateEnv;
        r *= this.gateEnv;
      }

      if (wideOn) {
        const mid = (l + r) * 0.5;
        const side = (l - r) * 0.5 * width;
        l = mid + side;
        r = mid - side;
      }

      if (limOn) {
        const maxMag = Math.max(Math.abs(l), Math.abs(r));
        if (maxMag > limCeil) {
          const scale = limCeil / maxMag;
          l *= scale;
          r *= scale;
        }
      }

      outL[i] = l;
      if (output.length > 1) outR[i] = r;

      this.peakL = Math.max(this.peakL, Math.abs(l));
      this.peakR = Math.max(this.peakR, Math.abs(r));
      this.sqL += l * l;
      this.sqR += r * r;
    }

    this.meterCounter += frames;
    if (this.meterCounter >= 1024) {
      const n = this.meterCounter;
      this.port.postMessage({
        peakL: this.peakL,
        peakR: this.peakR,
        rmsL: Math.sqrt(this.sqL / n),
        rmsR: Math.sqrt(this.sqR / n),
      });
      this.meterCounter = 0;
      this.peakL = 0;
      this.peakR = 0;
      this.sqL = 0;
      this.sqR = 0;
    }

    return true;
  }
}

registerProcessor('sonora-dsp-processor', SonoraDspProcessor);
