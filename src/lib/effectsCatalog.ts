import type { EffectDefinition, EffectType } from '@/types/effects';

export const EFFECTS_CATALOG: EffectDefinition[] = [
  // DYNAMICS
  {
    type: 'compressor',
    name: 'Compressor',
    category: 'dynamics',
    description: 'Dynamic range control with threshold, ratio, attack, release, knee, and makeup gain.',
    defaultParams: { threshold: -18, ratio: 4, attack: 12, release: 150, makeup: 2, knee: 4 },
    presets: [
      { name: 'Broadcast Vocal', params: { threshold: -18, ratio: 4, attack: 12, release: 140, makeup: 3, knee: 4 } },
      { name: 'Podcast Leveler', params: { threshold: -20, ratio: 3.5, attack: 10, release: 180, makeup: 4, knee: 6 } },
      { name: 'Gentle Glue', params: { threshold: -14, ratio: 2, attack: 25, release: 220, makeup: 1.5, knee: 6 } },
    ],
  },
  {
    type: 'limiter',
    name: 'Limiter',
    category: 'dynamics',
    description: 'Brickwall lookahead peak ceiling protection preventing digital clipping.',
    defaultParams: { ceiling: -1.0, attack: 2, release: 80 },
    presets: [
      { name: 'Broadcast -1 dBFS', params: { ceiling: -1.0, attack: 2, release: 80 } },
      { name: 'Streaming -1.5 dBFS', params: { ceiling: -1.5, attack: 3, release: 100 } },
      { name: 'Maximum Loudness', params: { ceiling: -0.3, attack: 1, release: 50 } },
    ],
  },
  {
    type: 'expander',
    name: 'Expander',
    category: 'dynamics',
    description: 'Downward dynamic expander reducing low-level room tone between phrases.',
    defaultParams: { threshold: -36, ratio: 2.2, attack: 10, release: 160 },
    presets: [
      { name: 'Subtle Room Cleanup', params: { threshold: -38, ratio: 1.8, attack: 12, release: 180 } },
      { name: 'Tight Dialogue', params: { threshold: -30, ratio: 3.0, attack: 6, release: 120 } },
    ],
  },
  {
    type: 'noise_gate',
    name: 'Noise Gate',
    category: 'dynamics',
    description: 'Silences background noise when audio falls below threshold.',
    defaultParams: { threshold: -45, range: -32, attack: 5, hold: 40, release: 120 },
    presets: [
      { name: 'Room Floor Gate', params: { threshold: -45, range: -32, attack: 5, hold: 40, release: 120 } },
      { name: 'Aggressive Mic Gate', params: { threshold: -36, range: -45, attack: 3, hold: 30, release: 90 } },
    ],
  },

  // EQUALIZER
  {
    type: 'eq_3band',
    name: '3-Band EQ',
    category: 'equalizer',
    description: 'Fast musical Low, Mid, and High tonal shaping.',
    defaultParams: { low: 0, mid: 0, high: 0 },
    presets: [
      { name: 'Voice Presence', params: { low: -2.5, mid: 2.0, high: 3.0 } },
      { name: 'Warm Broadcast', params: { low: 2.0, mid: -1.0, high: 1.5 } },
      { name: 'Telephone', params: { low: -18, mid: 6, high: -18 } },
    ],
  },
  {
    type: 'eq_5band',
    name: '5-Band EQ',
    category: 'equalizer',
    description: 'Five fixed studio bands at 60 Hz, 250 Hz, 1 kHz, 4 kHz, and 12 kHz.',
    defaultParams: { b60: 0, b250: 0, b1k: 0, b4k: 0, b12k: 0 },
    presets: [
      { name: 'Podcast Clarity', params: { b60: -4, b250: -2.5, b1k: 1, b4k: 3.5, b12k: 2.5 } },
      { name: 'Smile Curve', params: { b60: 3, b250: -1.5, b1k: -1, b4k: 2.5, b12k: 4 } },
    ],
  },
  {
    type: 'eq_10band',
    name: '10-Band Graphic EQ',
    category: 'equalizer',
    description: 'Octave graphic equalizer from 31 Hz sub-bass to 16 kHz air.',
    defaultParams: {
      b31: 0, b62: 0, b125: 0, b250: 0, b500: 0, b1k: 0, b2k: 0, b4k: 0, b8k: 0, b16k: 0,
    },
    presets: [
      {
        name: 'Vocal Polish',
        params: { b31: -6, b62: -4, b125: -1.5, b250: -2.5, b500: 0, b1k: 1, b2k: 2, b4k: 3, b8k: 2.5, b16k: 1.5 },
      },
      {
        name: 'De-Muddy Room',
        params: { b31: -8, b62: -5, b125: -3, b250: -4, b500: -1.5, b1k: 0.5, b2k: 2, b4k: 2, b8k: 1, b16k: 0 },
      },
    ],
  },
  {
    type: 'parametric_eq',
    name: 'Parametric EQ',
    category: 'equalizer',
    description: 'Interactive multi-band frequency curve with adjustable frequency, gain, Q, and filter type.',
    defaultParams: {
      bands: [
        { id: 'b1', enabled: true, type: 'highpass', freq: 80, gain: 0, q: 0.71 },
        { id: 'b2', enabled: true, type: 'peaking', freq: 240, gain: -2.0, q: 1.2 },
        { id: 'b3', enabled: true, type: 'peaking', freq: 3200, gain: 2.5, q: 1.0 },
        { id: 'b4', enabled: true, type: 'highshelf', freq: 9000, gain: 1.5, q: 0.8 },
      ],
    },
    presets: [
      {
        name: 'Crisp Narration',
        params: {
          bands: [
            { id: 'b1', enabled: true, type: 'highpass', freq: 85, gain: 0, q: 0.71 },
            { id: 'b2', enabled: true, type: 'peaking', freq: 250, gain: -3.0, q: 1.3 },
            { id: 'b3', enabled: true, type: 'peaking', freq: 3600, gain: 3.5, q: 1.1 },
            { id: 'b4', enabled: true, type: 'highshelf', freq: 10000, gain: 2.0, q: 0.8 },
          ],
        },
      },
      {
        name: 'Flat Reference',
        params: {
          bands: [
            { id: 'b1', enabled: true, type: 'lowshelf', freq: 100, gain: 0, q: 0.71 },
            { id: 'b2', enabled: true, type: 'peaking', freq: 400, gain: 0, q: 1.0 },
            { id: 'b3', enabled: true, type: 'peaking', freq: 2500, gain: 0, q: 1.0 },
            { id: 'b4', enabled: true, type: 'highshelf', freq: 8000, gain: 0, q: 0.71 },
          ],
        },
      },
    ],
  },
  {
    type: 'high_pass',
    name: 'High Pass Filter',
    category: 'equalizer',
    description: 'Removes sub-bass rumble, plosives, and handling thumps below cutoff.',
    defaultParams: { freq: 80, q: 0.707 },
    presets: [
      { name: '80 Hz Vocal Cut', params: { freq: 80, q: 0.707 } },
      { name: '120 Hz Aggressive Cut', params: { freq: 120, q: 0.9 } },
    ],
  },
  {
    type: 'low_pass',
    name: 'Low Pass Filter',
    category: 'equalizer',
    description: 'Rolls off harsh upper hiss or creates warm lo-fi filtering.',
    defaultParams: { freq: 12000, q: 0.707 },
    presets: [
      { name: 'Gentle Air Roll-off', params: { freq: 14000, q: 0.707 } },
      { name: 'Lo-Fi Warmth', params: { freq: 3500, q: 0.85 } },
    ],
  },
  {
    type: 'low_shelf',
    name: 'Low Shelf',
    category: 'equalizer',
    description: 'Boosts or attenuates all frequencies below the corner frequency.',
    defaultParams: { freq: 120, gain: 0 },
    presets: [
      { name: 'Trim Bass Mud (-4 dB)', params: { freq: 140, gain: -4 } },
      { name: 'Warm Chest Boost (+3 dB)', params: { freq: 130, gain: 3 } },
    ],
  },
  {
    type: 'high_shelf',
    name: 'High Shelf',
    category: 'equalizer',
    description: 'Adds brightness/air or tames harshness above the corner frequency.',
    defaultParams: { freq: 6500, gain: 0 },
    presets: [
      { name: 'Studio Air (+3 dB)', params: { freq: 8000, gain: 3 } },
      { name: 'Tame Harshness (-3 dB)', params: { freq: 6000, gain: -3 } },
    ],
  },

  // MODULATION & SPATIAL
  {
    type: 'reverb',
    name: 'Reverb',
    category: 'modulation_spatial',
    description: 'Studio acoustic room simulation with room size, decay, damping, and wet mix.',
    defaultParams: { roomSize: 0.4, decay: 0.9, damping: 0.5, mix: 0.22 },
    presets: [
      { name: 'Small Studio Room', params: { roomSize: 0.3, decay: 0.6, damping: 0.55, mix: 0.14 } },
      { name: 'Warm Hall', params: { roomSize: 0.75, decay: 1.8, damping: 0.4, mix: 0.28 } },
    ],
  },
  {
    type: 'delay',
    name: 'Delay',
    category: 'modulation_spatial',
    description: 'Precision time-based delay with feedback and wet/dry mix.',
    defaultParams: { timeMs: 280, feedback: 0.32, mix: 0.28 },
    presets: [
      { name: 'Slapback Vocal', params: { timeMs: 110, feedback: 0.15, mix: 0.22 } },
      { name: 'Quarter Note Trail', params: { timeMs: 380, feedback: 0.42, mix: 0.30 } },
    ],
  },
  {
    type: 'echo',
    name: 'Echo',
    category: 'modulation_spatial',
    description: 'Classic multi-repeat ambient echo.',
    defaultParams: { timeMs: 420, feedback: 0.48, mix: 0.35 },
    presets: [
      { name: 'Canyon Repeat', params: { timeMs: 520, feedback: 0.55, mix: 0.38 } },
      { name: 'Subtle Tail', params: { timeMs: 260, feedback: 0.28, mix: 0.2 } },
    ],
  },
  {
    type: 'chorus',
    name: 'Chorus',
    category: 'modulation_spatial',
    description: 'Rich stereo ensemble thickening using modulated short delays.',
    defaultParams: { rate: 0.6, depth: 2.2, mix: 0.38 },
    presets: [
      { name: 'Warm Double', params: { rate: 0.45, depth: 1.8, mix: 0.3 } },
      { name: 'Wide Ensemble', params: { rate: 1.1, depth: 3.5, mix: 0.5 } },
    ],
  },
  {
    type: 'flanger',
    name: 'Flanger',
    category: 'modulation_spatial',
    description: 'Sweeping comb-filter modulation effect.',
    defaultParams: { delay: 4.0, depth: 2.5, rate: 0.5, feedback: 25 },
    presets: [
      { name: 'Classic Jet', params: { delay: 3.5, depth: 3.0, rate: 0.4, feedback: 45 } },
      { name: 'Subtle Shimmer', params: { delay: 5.0, depth: 1.5, rate: 0.8, feedback: 15 } },
    ],
  },
  {
    type: 'phaser',
    name: 'Phaser',
    category: 'modulation_spatial',
    description: 'Sweeping all-pass notch phasing modulation.',
    defaultParams: { rate: 0.5, feedback: 0.45, mix: 0.5 },
    presets: [
      { name: 'Slow Space Sweep', params: { rate: 0.35, feedback: 0.55, mix: 0.5 } },
      { name: 'Liquid Movement', params: { rate: 1.2, feedback: 0.35, mix: 0.45 } },
    ],
  },
  {
    type: 'stereo_widener',
    name: 'Stereo Widener',
    category: 'modulation_spatial',
    description: 'Mid/Side stereo width adjustment from mono collapse (0%) to ultra-wide (200%).',
    defaultParams: { width: 130 },
    presets: [
      { name: 'Subtle Spread (125%)', params: { width: 125 } },
      { name: 'Wide Master (160%)', params: { width: 160 } },
      { name: 'Mono Check (0%)', params: { width: 0 } },
    ],
  },

  // RESTORATION
  {
    type: 'noise_reduction',
    name: 'Noise Reduction',
    category: 'restoration',
    description: 'Adaptive FFT noise floor attenuation for steady hiss, fan, or AC hum.',
    defaultParams: { noiseFloor: -28, reduction: 14, sensitivity: 0.5 },
    presets: [
      { name: 'Gentle Hiss Cleanup', params: { noiseFloor: -32, reduction: 10, sensitivity: 0.4 } },
      { name: 'Fan & AC Suppress', params: { noiseFloor: -26, reduction: 18, sensitivity: 0.6 } },
    ],
  },
  {
    type: 'de_click',
    name: 'De-Click',
    category: 'restoration',
    description: 'Detects and repairs mouth clicks, vinyl crackles, and transient pops.',
    defaultParams: { threshold: 2.2 },
    presets: [
      { name: 'Mouth Click Repair', params: { threshold: 2.0 } },
      { name: 'Heavy Crackle', params: { threshold: 4.0 } },
    ],
  },
  {
    type: 'de_clip',
    name: 'De-Clip',
    category: 'restoration',
    description: 'Reconstructs flattened clipped waveform peaks.',
    defaultParams: { threshold: 8.0 },
    presets: [
      { name: 'Mild Peak Recovery', params: { threshold: 8.0 } },
      { name: 'Aggressive De-Clip', params: { threshold: 4.5 } },
    ],
  },
  {
    type: 'de_hum',
    name: 'De-Hum (50/60 Hz)',
    category: 'restoration',
    description: 'Precision harmonic notch bank targeting 50 Hz or 60 Hz electrical ground hum.',
    defaultParams: { freq60: false, reduction: -28 },
    presets: [
      { name: '50 Hz Power Hum (ID/EU)', params: { freq60: false, reduction: -30 } },
      { name: '60 Hz Power Hum (US)', params: { freq60: true, reduction: -30 } },
    ],
  },
  {
    type: 'de_esser',
    name: 'De-Esser',
    category: 'restoration',
    description: 'Tames harsh "S" and "T" vocal sibilance cleanly.',
    defaultParams: { freq: 6500, threshold: -22, intensity: 0.45 },
    presets: [
      { name: 'Natural Sibilance Control', params: { freq: 6500, threshold: -22, intensity: 0.42 } },
      { name: 'Bright Mic Tamer', params: { freq: 7500, threshold: -25, intensity: 0.65 } },
    ],
  },
  {
    type: 'remove_background_noise',
    name: 'Remove Background Noise',
    category: 'restoration',
    description: 'Combined high-pass filter + adaptive spectral noise suppressor.',
    defaultParams: { reduction: 18 },
    presets: [
      { name: 'Voice Room Clean', params: { reduction: 16 } },
      { name: 'Street / Heavy Room', params: { reduction: 26 } },
    ],
  },
];

export function getEffectDefinition(type: EffectType): EffectDefinition {
  return (
    EFFECTS_CATALOG.find((e) => e.type === type) ?? EFFECTS_CATALOG[0]
  );
}
