export type EffectCategory = 'dynamics' | 'equalizer' | 'modulation_spatial' | 'restoration';

export type EffectType =
  // Dynamics
  | 'compressor'
  | 'limiter'
  | 'expander'
  | 'noise_gate'
  // Equalizer
  | 'eq_3band'
  | 'eq_5band'
  | 'eq_10band'
  | 'parametric_eq'
  | 'high_pass'
  | 'low_pass'
  | 'low_shelf'
  | 'high_shelf'
  // Modulation & Spatial
  | 'reverb'
  | 'delay'
  | 'echo'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'stereo_widener'
  // Restoration
  | 'noise_reduction'
  | 'de_click'
  | 'de_clip'
  | 'de_hum'
  | 'de_esser'
  | 'remove_background_noise';

export interface ParametricBand {
  id: string;
  enabled: boolean;
  type: 'peaking' | 'lowshelf' | 'highshelf' | 'highpass' | 'lowpass' | 'notch';
  freq: number;
  gain: number;
  q: number;
}

export interface EffectParams {
  [key: string]: number | string | boolean | ParametricBand[];
}

export interface EffectInstance {
  id: string;
  type: EffectType;
  name: string;
  category: EffectCategory;
  bypassed: boolean;
  presetName?: string;
  params: EffectParams;
}

export interface EffectPreset {
  id: string;
  effectType: EffectType | 'chain';
  name: string;
  category: string;
  params: EffectParams | EffectInstance[];
  isFactory: boolean;
}

export interface EffectDefinition {
  type: EffectType;
  name: string;
  category: EffectCategory;
  description: string;
  defaultParams: EffectParams;
  presets: Array<{ name: string; params: EffectParams }>;
}
