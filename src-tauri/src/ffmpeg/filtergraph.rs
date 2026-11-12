use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::ffmpeg::locator::new_hidden_command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectInput {
    pub id: String,
    #[serde(rename = "type")]
    pub effect_type: String,
    pub bypassed: bool,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRenderSpec {
    pub source_path: String,
    pub source_offset_ms: u64,
    pub duration_ms: u64,
    pub timeline_start_ms: u64,
    pub gain_db: f64,
    pub fade_in_ms: u64,
    pub fade_out_ms: u64,
    pub fade_in_curve: String,
    pub fade_out_curve: String,
    pub playback_rate: f64,
    pub pitch_semitones: f64,
    pub channel_mode: String,
    pub effects: Vec<EffectInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMixSpec {
    pub id: String,
    pub name: String,
    pub volume_db: f64,
    pub pan: f64,
    pub muted: bool,
    pub solo: bool,
    pub channel_mode: String,
    pub effects: Vec<EffectInput>,
    pub clips: Vec<ClipRenderSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub output_path: String,
    pub format: String, // wav | mp3 | flac | ogg | aac | m4a
    pub sample_rate: u32,
    pub bitrate_kbps: u32,
    pub bit_depth: u16,
    pub channels: u16, // 1 | 2
    pub loudness_lufs: Option<f64>,
    pub peak_normalize_db: Option<f64>,
    pub selection_start_ms: Option<u64>,
    pub selection_end_ms: Option<u64>,
    pub master_volume_db: f64,
    pub tracks: Vec<TrackMixSpec>,
    pub export_stems: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgressEvent {
    pub percent: f64,
    pub stage: String,
    pub current_file: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ClipTransformOp {
    Reverse,
    Silence {
        #[serde(default)]
        start_ms: Option<u64>,
        #[serde(default)]
        end_ms: Option<u64>,
    },
    NormalizePeak { target_db: f64 },
    NormalizeLufs { target_lufs: f64 },
    Amplify { gain_db: f64 },
    ChangeSpeed { speed: f64, preserve_pitch: bool },
    TimeStretch { tempo: f64 },
    ChangePitch { semitones: f64 },
    ExtractChannel { channel: String }, // left | right | mono
    CropRange { start_ms: u64, end_ms: u64 },
    FadeBake { fade_in_ms: u64, fade_out_ms: u64 },
    SpectralAttenuate {
        start_ms: u64,
        end_ms: u64,
        low_hz: f64,
        high_hz: f64,
        attenuation_db: f64,
    },
    ApplyEffects { effects: Vec<EffectInput> },
    NoiseRemoval {
        strength_db: f64,
        #[serde(default)]
        rnnoise_model: Option<String>,
    },
    VoiceEnhancement { clarity: f64 },
    VoiceIsolation { aggressiveness: f64 },
}

fn p_num(params: &Value, key: &str, default: f64) -> f64 {
    params
        .get(key)
        .and_then(|v| v.as_f64())
        .unwrap_or(default)
}

fn p_bool(params: &Value, key: &str, default: bool) -> bool {
    params
        .get(key)
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

pub fn effect_to_ffmpeg_filter(effect: &EffectInput, has_rubberband: bool) -> Option<String> {
    if effect.bypassed {
        return None;
    }
    let p = &effect.params;
    match effect.effect_type.as_str() {
        "compressor" => {
            let thresh_db = p_num(p, "threshold", -18.0).clamp(-60.0, 0.0);
            let thresh_lin = 10f64.powf(thresh_db / 20.0).clamp(0.000976563, 1.0);
            let ratio = p_num(p, "ratio", 4.0).clamp(1.0, 20.0);
            let attack = p_num(p, "attack", 15.0).clamp(0.01, 2000.0);
            let release = p_num(p, "release", 150.0).clamp(0.01, 9000.0);
            let makeup_db = p_num(p, "makeup", 0.0).clamp(-24.0, 24.0);
            let makeup_lin = 10f64.powf(makeup_db / 20.0).clamp(1.0, 64.0);
            let knee = p_num(p, "knee", 3.0).clamp(1.0, 8.0);
            Some(format!(
                "acompressor=threshold={thresh_lin:.6}:ratio={ratio:.2}:attack={attack:.2}:release={release:.2}:makeup={makeup_lin:.4}:knee={knee:.2}"
            ))
        }
        "limiter" => {
            let ceil_db = p_num(p, "ceiling", -1.0).clamp(-24.0, 0.0);
            let limit_lin = 10f64.powf(ceil_db / 20.0).clamp(0.0625, 1.0);
            let attack = p_num(p, "attack", 2.0).clamp(0.1, 80.0);
            let release = p_num(p, "release", 80.0).clamp(1.0, 8000.0);
            Some(format!(
                "alimiter=limit={limit_lin:.6}:attack={attack:.2}:release={release:.2}:level=disabled"
            ))
        }
        "expander" => {
            let thresh = p_num(p, "threshold", -35.0).clamp(-60.0, -5.0);
            let ratio = p_num(p, "ratio", 2.0).clamp(1.1, 6.0);
            let attack = (p_num(p, "attack", 10.0) / 1000.0).clamp(0.001, 0.5);
            let release = (p_num(p, "release", 150.0) / 1000.0).clamp(0.01, 2.0);
            let low_out = (thresh - (thresh + 70.0) * (1.0 - 1.0 / ratio)).clamp(-90.0, thresh);
            Some(format!(
                "compand=attacks={attack:.3}:decays={release:.3}:points=-70/{low_out:.1}|{thresh:.1}/{thresh:.1}|0/0"
            ))
        }
        "noise_gate" => {
            let thresh_db = p_num(p, "threshold", -45.0).clamp(-80.0, 0.0);
            let thresh_lin = 10f64.powf(thresh_db / 20.0).clamp(0.00001, 1.0);
            let range_db = p_num(p, "range", -32.0).clamp(-90.0, 0.0);
            let range_lin = 10f64.powf(range_db / 20.0).clamp(0.00001, 1.0);
            let attack = p_num(p, "attack", 5.0).clamp(0.01, 9000.0);
            let release = p_num(p, "release", 120.0).clamp(0.01, 9000.0);
            Some(format!(
                "agate=threshold={thresh_lin:.6}:range={range_lin:.6}:attack={attack:.2}:release={release:.2}"
            ))
        }
        "eq_3band" => {
            let low = p_num(p, "low", 0.0).clamp(-24.0, 24.0);
            let mid = p_num(p, "mid", 0.0).clamp(-24.0, 24.0);
            let high = p_num(p, "high", 0.0).clamp(-24.0, 24.0);
            Some(format!(
                "lowshelf=f=120:g={low:.2},equalizer=f=1000:t=q:w=1.0:g={mid:.2},highshelf=f=5000:g={high:.2}"
            ))
        }
        "eq_5band" => {
            let freqs = [60, 250, 1000, 4000, 12000];
            let keys = ["b60", "b250", "b1k", "b4k", "b12k"];
            let parts: Vec<String> = freqs
                .iter()
                .zip(keys.iter())
                .map(|(f, k)| {
                    let g = p_num(p, k, 0.0).clamp(-24.0, 24.0);
                    format!("equalizer=f={f}:t=q:w=1.2:g={g:.2}")
                })
                .collect();
            Some(parts.join(","))
        }
        "eq_10band" => {
            let freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
            let keys = ["b31", "b62", "b125", "b250", "b500", "b1k", "b2k", "b4k", "b8k", "b16k"];
            let parts: Vec<String> = freqs
                .iter()
                .zip(keys.iter())
                .map(|(f, k)| {
                    let g = p_num(p, k, 0.0).clamp(-24.0, 24.0);
                    format!("equalizer=f={f}:t=q:w=1.4:g={g:.2}")
                })
                .collect();
            Some(parts.join(","))
        }
        "parametric_eq" => {
            let bands = p.get("bands").and_then(|v| v.as_array())?;
            let mut filters = Vec::new();
            for b in bands {
                if !b.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true) {
                    continue;
                }
                let ftype = b.get("type").and_then(|v| v.as_str()).unwrap_or("peaking");
                let freq = b.get("freq").and_then(|v| v.as_f64()).unwrap_or(1000.0).clamp(20.0, 20000.0);
                let gain = b.get("gain").and_then(|v| v.as_f64()).unwrap_or(0.0).clamp(-24.0, 24.0);
                let q = b.get("q").and_then(|v| v.as_f64()).unwrap_or(1.0).clamp(0.1, 20.0);
                let expr = match ftype {
                    "highpass" => format!("highpass=f={freq:.1}:w={q:.2}"),
                    "lowpass" => format!("lowpass=f={freq:.1}:w={q:.2}"),
                    "lowshelf" => format!("lowshelf=f={freq:.1}:g={gain:.2}:w={q:.2}"),
                    "highshelf" => format!("highshelf=f={freq:.1}:g={gain:.2}:w={q:.2}"),
                    "notch" => format!("bandreject=f={freq:.1}:t=q:w={q:.2}"),
                    _ => format!("equalizer=f={freq:.1}:t=q:w={q:.2}:g={gain:.2}"),
                };
                filters.push(expr);
            }
            if filters.is_empty() {
                None
            } else {
                Some(filters.join(","))
            }
        }
        "high_pass" => {
            let freq = p_num(p, "freq", 80.0).clamp(20.0, 8000.0);
            let q = p_num(p, "q", 0.707).clamp(0.1, 10.0);
            Some(format!("highpass=f={freq:.1}:w={q:.3}"))
        }
        "low_pass" => {
            let freq = p_num(p, "freq", 12000.0).clamp(100.0, 20000.0);
            let q = p_num(p, "q", 0.707).clamp(0.1, 10.0);
            Some(format!("lowpass=f={freq:.1}:w={q:.3}"))
        }
        "low_shelf" => {
            let freq = p_num(p, "freq", 120.0).clamp(20.0, 1000.0);
            let gain = p_num(p, "gain", 0.0).clamp(-24.0, 24.0);
            Some(format!("lowshelf=f={freq:.1}:g={gain:.2}"))
        }
        "high_shelf" => {
            let freq = p_num(p, "freq", 6000.0).clamp(1000.0, 18000.0);
            let gain = p_num(p, "gain", 0.0).clamp(-24.0, 24.0);
            Some(format!("highshelf=f={freq:.1}:g={gain:.2}"))
        }
        "reverb" => {
            let room = p_num(p, "roomSize", 0.4).clamp(0.05, 1.0);
            let decay = p_num(p, "decay", 0.8).clamp(0.1, 3.0);
            let mix = p_num(p, "mix", 0.22).clamp(0.0, 1.0);
            let d1 = (23.0 * room + 11.0).round();
            let d2 = (47.0 * room + 29.0).round();
            let d3 = (83.0 * room + 43.0).round();
            let d4 = (131.0 * room + 67.0).round();
            let g1 = (mix * (0.45 * decay).min(0.75)).clamp(0.01, 0.85);
            let g2 = (g1 * 0.72).clamp(0.01, 0.75);
            let g3 = (g1 * 0.52).clamp(0.01, 0.65);
            let g4 = (g1 * 0.35).clamp(0.01, 0.55);
            let dry = (1.0 - mix * 0.35).clamp(0.4, 1.0);
            Some(format!(
                "aecho={dry:.2}:0.88:{d1}|{d2}|{d3}|{d4}:{g1:.2}|{g2:.2}|{g3:.2}|{g4:.2}"
            ))
        }
        "delay" | "echo" => {
            let time_ms = p_num(p, "timeMs", 280.0).clamp(10.0, 2000.0);
            let feedback = p_num(p, "feedback", 0.35).clamp(0.0, 0.85);
            let mix = p_num(p, "mix", 0.3).clamp(0.0, 1.0);
            let t2 = (time_ms * 2.0).min(4000.0);
            let g1 = (mix * 0.8).clamp(0.01, 0.9);
            let g2 = (g1 * feedback).clamp(0.01, 0.8);
            Some(format!("aecho=0.9:0.88:{time_ms:.0}|{t2:.0}:{g1:.2}|{g2:.2}"))
        }
        "chorus" => {
            let depth = p_num(p, "depth", 2.0).clamp(0.2, 8.0);
            let rate = p_num(p, "rate", 0.6).clamp(0.1, 5.0);
            let mix = p_num(p, "mix", 0.4).clamp(0.05, 1.0);
            Some(format!(
                "chorus=0.7:{mix:.2}:40|45:{depth:.2}|{depth:.2}:{rate:.2}|{rate:.2}:2|2.3"
            ))
        }
        "flanger" => {
            let delay = p_num(p, "delay", 4.0).clamp(0.0, 30.0);
            let depth = p_num(p, "depth", 2.5).clamp(0.0, 10.0);
            let speed = p_num(p, "rate", 0.5).clamp(0.1, 10.0);
            let fb = p_num(p, "feedback", 20.0).clamp(-95.0, 95.0);
            Some(format!(
                "flanger=delay={delay:.1}:depth={depth:.1}:regen={fb:.1}:speed={speed:.2}"
            ))
        }
        "phaser" => {
            let speed = p_num(p, "rate", 0.5).clamp(0.1, 2.0);
            let decay = p_num(p, "feedback", 0.4).clamp(0.1, 0.9);
            let mix = p_num(p, "mix", 0.5).clamp(0.1, 1.0);
            Some(format!(
                "aphaser=in_gain=0.8:out_gain={mix:.2}:delay=3.0:decay={decay:.2}:speed={speed:.2}"
            ))
        }
        "stereo_widener" => {
            let width_pct = p_num(p, "width", 130.0).clamp(0.0, 200.0);
            let slev = (width_pct / 100.0).clamp(0.0, 2.0);
            Some(format!("stereotools=mlev=1.0:slev={slev:.2}"))
        }
        "noise_reduction" => {
            let nf = p_num(p, "noiseFloor", -28.0).clamp(-80.0, -10.0);
            let nr = p_num(p, "reduction", 14.0).clamp(1.0, 40.0);
            Some(format!("afftdn=nr={nr:.1}:nf={nf:.1}:tn=1"))
        }
        "de_click" => {
            let thresh = p_num(p, "threshold", 2.0).clamp(1.0, 100.0);
            Some(format!("adeclick=t={thresh:.1}"))
        }
        "de_clip" => {
            let thresh = p_num(p, "threshold", 8.0).clamp(1.0, 100.0);
            Some(format!("adeclip=t={thresh:.1}"))
        }
        "de_hum" => {
            let base = if p_bool(p, "freq60", false) { 60.0 } else { 50.0 };
            let depth = p_num(p, "reduction", -28.0).clamp(-45.0, -3.0);
            let h2 = base * 2.0;
            let h3 = base * 3.0;
            let h4 = base * 4.0;
            Some(format!(
                "equalizer=f={base}:t=q:w=18:g={depth:.1},equalizer=f={h2}:t=q:w=18:g={depth:.1},equalizer=f={h3}:t=q:w=18:g={:.1},equalizer=f={h4}:t=q:w=18:g={:.1}",
                depth * 0.75,
                depth * 0.5
            ))
        }
        "de_esser" => {
            let freq = p_num(p, "freq", 6500.0).clamp(3000.0, 12000.0);
            let intensity = p_num(p, "intensity", 0.45).clamp(0.0, 1.0);
            let f_norm = ((freq - 3000.0) / 9000.0).clamp(0.0, 1.0);
            Some(format!("deesser=i={intensity:.2}:m=0.5:f={f_norm:.2}:s=o"))
        }
        "remove_background_noise" => {
            let nr = p_num(p, "reduction", 18.0).clamp(3.0, 40.0);
            Some(format!("highpass=f=85,afftdn=nr={nr:.1}:nf=-30:tn=1"))
        }
        _ => {
            let _ = has_rubberband;
            None
        }
    }
}

fn fade_curve_code(curve: &str) -> &'static str {
    match curve {
        "logarithmic" => "log",
        "exponential" => "exp",
        "s_curve" => "qsin",
        _ => "tri",
    }
}

fn build_channel_filter(mode: &str) -> Option<String> {
    match mode {
        "mono_mix" => Some("pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1".into()),
        "left_only" => Some("pan=stereo|c0=c0|c1=c0".into()),
        "right_only" => Some("pan=stereo|c0=c1|c1=c1".into()),
        _ => None,
    }
}

pub fn process_clip_transform(
    ffmpeg_path: &Path,
    has_rubberband: bool,
    source_path: &Path,
    output_path: &Path,
    op: ClipTransformOp,
) -> AppResult<()> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let filter = match op {
        ClipTransformOp::Reverse => "areverse".to_string(),
        ClipTransformOp::Silence { start_ms, end_ms } => {
            if let (Some(s), Some(e)) = (start_ms, end_ms) {
                let ts = s as f64 / 1000.0;
                let te = e as f64 / 1000.0;
                format!("volume=0:enable='between(t,{ts:.4},{te:.4})'")
            } else {
                "volume=0".to_string()
            }
        }
        ClipTransformOp::Amplify { gain_db } => {
            format!("volume={:.3}dB", gain_db.clamp(-60.0, 36.0))
        }
        ClipTransformOp::NormalizeLufs { target_lufs } => {
            format!(
                "loudnorm=I={:.1}:TP=-1.0:LRA=11",
                target_lufs.clamp(-30.0, -5.0)
            )
        }
        ClipTransformOp::NormalizePeak { target_db } => {
            // Measure max_volume first using volumedetect
            let out = new_hidden_command(ffmpeg_path)
                .args(["-v", "info", "-i"])
                .arg(source_path)
                .args(["-af", "volumedetect", "-f", "null", "-"])
                .output()
                .map_err(|e| AppError::Ffmpeg(format!("volumedetect failed: {e}")))?;
            let stderr = String::from_utf8_lossy(&out.stderr);
            let max_vol = stderr
                .lines()
                .find_map(|l| {
                    let idx = l.find("max_volume:")?;
                    let rest = l[idx + 11..].trim();
                    rest.split_whitespace().next()?.parse::<f64>().ok()
                })
                .unwrap_or(-1.0);
            let delta = (target_db.clamp(-24.0, 0.0) - max_vol).clamp(-48.0, 48.0);
            format!("volume={delta:.3}dB")
        }
        ClipTransformOp::ChangeSpeed { speed, preserve_pitch } => {
            let s = speed.clamp(0.25, 4.0);
            if preserve_pitch {
                if has_rubberband {
                    format!("rubberband=tempo={s:.4}")
                } else {
                    chain_atempo(s)
                }
            } else {
                format!("asetrate=44100*{s:.4},aresample=44100")
            }
        }
        ClipTransformOp::TimeStretch { tempo } => {
            let t = tempo.clamp(0.25, 4.0);
            if has_rubberband {
                format!("rubberband=tempo={t:.4}")
            } else {
                chain_atempo(t)
            }
        }
        ClipTransformOp::ChangePitch { semitones } => {
            let semi = semitones.clamp(-24.0, 24.0);
            let factor = 2f64.powf(semi / 12.0);
            if has_rubberband {
                format!("rubberband=pitch={factor:.6}")
            } else {
                format!("asetrate=44100*{factor:.6},aresample=44100,{}", chain_atempo(1.0 / factor))
            }
        }
        ClipTransformOp::ExtractChannel { channel } => match channel.as_str() {
            "left" => "pan=mono|c0=c0".to_string(),
            "right" => "pan=mono|c0=c1".to_string(),
            _ => "pan=mono|c0=0.5*c0+0.5*c1".to_string(),
        },
        ClipTransformOp::CropRange { start_ms, end_ms } => {
            let ts = start_ms as f64 / 1000.0;
            let te = (end_ms.max(start_ms + 20)) as f64 / 1000.0;
            format!("atrim=start={ts:.4}:end={te:.4},asetpts=PTS-STARTPTS")
        }
        ClipTransformOp::FadeBake { fade_in_ms, fade_out_ms } => {
            let mut parts = Vec::new();
            if fade_in_ms > 0 {
                parts.push(format!("afade=t=in:st=0:d={:.4}", fade_in_ms as f64 / 1000.0));
            }
            if fade_out_ms > 0 {
                // Use areverse trick so duration isn't required ahead of time
                parts.push(format!(
                    "areverse,afade=t=in:st=0:d={:.4},areverse",
                    fade_out_ms as f64 / 1000.0
                ));
            }
            if parts.is_empty() {
                "anull".to_string()
            } else {
                parts.join(",")
            }
        }
        ClipTransformOp::SpectralAttenuate {
            start_ms,
            end_ms,
            low_hz,
            high_hz,
            attenuation_db,
        } => {
            let ts = start_ms as f64 / 1000.0;
            let te = (end_ms.max(start_ms + 10)) as f64 / 1000.0;
            let f_lo = low_hz.clamp(20.0, 19500.0);
            let f_hi = high_hz.max(f_lo + 10.0).clamp(30.0, 20000.0);
            let center = (f_lo * f_hi).sqrt();
            let bw = (f_hi - f_lo).max(20.0);
            let q = (center / bw).clamp(0.25, 18.0);
            let gain = attenuation_db.clamp(-48.0, 12.0);
            format!(
                "equalizer=f={center:.1}:t=q:w={q:.2}:g={gain:.1}:enable='between(t,{ts:.4},{te:.4})'"
            )
        }
        ClipTransformOp::ApplyEffects { effects } => {
            let list: Vec<String> = effects
                .iter()
                .filter_map(|e| effect_to_ffmpeg_filter(e, has_rubberband))
                .collect();
            if list.is_empty() {
                "anull".to_string()
            } else {
                list.join(",")
            }
        }
        ClipTransformOp::NoiseRemoval {
            strength_db,
            rnnoise_model,
        } => {
            let nr = strength_db.clamp(3.0, 40.0);
            if let Some(model_path) = rnnoise_model.filter(|m| Path::new(m).is_file()) {
                let escaped = model_path.replace('\\', "/").replace(':', "\\:");
                format!("highpass=f=65,arnndn=m='{escaped}',afftdn=nr={nr:.1}:nf=-32")
            } else {
                format!("highpass=f=75,afftdn=nr={nr:.1}:nf=-28:tn=1")
            }
        }
        ClipTransformOp::VoiceEnhancement { clarity } => {
            let boost = (clarity.clamp(0.0, 1.0) * 4.5).clamp(0.5, 5.0);
            let mud_cut = -(clarity.clamp(0.0, 1.0) * 3.0);
            format!(
                "highpass=f=85,equalizer=f=240:t=q:w=1.2:g={mud_cut:.1},equalizer=f=3400:t=q:w=1.1:g={boost:.1},highshelf=f=8500:g={:.1},acompressor=threshold=0.125:ratio=3.2:attack=10:release=140:makeup=1.5,deesser=i=0.38:m=0.5:f=0.5:s=o,loudnorm=I=-16:TP=-1.0:LRA=11",
                boost * 0.65
            )
        }
        ClipTransformOp::VoiceIsolation { aggressiveness } => {
            let agg = aggressiveness.clamp(0.1, 1.0);
            let nr = 12.0 + agg * 22.0;
            let gate_thresh = 10f64.powf((-48.0 + agg * 14.0) / 20.0);
            format!(
                "highpass=f=100,lowpass=f=12000,afftdn=nr={nr:.1}:nf=-26:tn=1,agate=threshold={gate_thresh:.6}:range=0.05:attack=5:release=110"
            )
        }
    };

    let out = new_hidden_command(ffmpeg_path)
        .args(["-y", "-v", "error", "-i"])
        .arg(source_path)
        .args(["-af", &filter, "-c:a", "pcm_f32le"])
        .arg(output_path)
        .output()
        .map_err(|e| AppError::Ffmpeg(format!("FFmpeg clip transform failed: {e}")))?;

    if !out.status.success() {
        return Err(AppError::Ffmpeg(format!(
            "FFmpeg transform error: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    Ok(())
}

fn chain_atempo(mut tempo: f64) -> String {
    let mut parts = Vec::new();
    while tempo > 2.0 {
        parts.push("atempo=2.0".to_string());
        tempo /= 2.0;
    }
    while tempo < 0.5 {
        parts.push("atempo=0.5".to_string());
        tempo /= 0.5;
    }
    parts.push(format!("atempo={tempo:.5}"));
    parts.join(",")
}

pub fn export_project_mixdown(
    ffmpeg_path: &Path,
    has_rubberband: bool,
    temp_dir: &Path,
    req: &ExportRequest,
    on_progress: &Channel<ExportProgressEvent>,
) -> AppResult<Vec<String>> {
    if let Some(out_parent) = Path::new(&req.output_path).parent() {
        fs::create_dir_all(out_parent)?;
    }

    let any_solo = req.tracks.iter().any(|t| t.solo);
    let active_tracks: Vec<&TrackMixSpec> = req
        .tracks
        .iter()
        .filter(|t| !t.muted && (!any_solo || t.solo) && !t.clips.is_empty())
        .collect();

    if active_tracks.is_empty() {
        return Err(AppError::Invalid(
            "No audible tracks or clips to export".into(),
        ));
    }

    if req.export_stems {
        let base_path = PathBuf::from(&req.output_path);
        let stem_dir = base_path.parent().unwrap_or_else(|| Path::new("."));
        let base_stem = base_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("export");
        let ext = base_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or(&req.format);

        let mut outputs = Vec::new();
        let total = active_tracks.len();
        for (idx, track) in active_tracks.iter().enumerate() {
            let safe_name: String = track
                .name
                .chars()
                .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                .collect();
            let stem_out = stem_dir.join(format!("{base_stem}__{safe_name}.{ext}"));
            let mut single_req = req.clone();
            single_req.tracks = vec![(*track).clone()];
            single_req.output_path = stem_out.display().to_string();
            single_req.export_stems = false;

            let _ = on_progress.send(ExportProgressEvent {
                percent: (idx as f64 / total as f64) * 100.0,
                stage: format!("Exporting stem {}/{total}", idx + 1),
                current_file: stem_out.display().to_string(),
            });

            render_single_mixdown(ffmpeg_path, has_rubberband, temp_dir, &single_req, None)?;
            outputs.push(stem_out.display().to_string());
        }

        let _ = on_progress.send(ExportProgressEvent {
            percent: 100.0,
            stage: "Completed stem export".into(),
            current_file: outputs.last().cloned().unwrap_or_default(),
        });
        return Ok(outputs);
    }

    render_single_mixdown(ffmpeg_path, has_rubberband, temp_dir, req, Some(on_progress))?;
    Ok(vec![req.output_path.clone()])
}

fn render_single_mixdown(
    ffmpeg_path: &Path,
    has_rubberband: bool,
    temp_dir: &Path,
    req: &ExportRequest,
    on_progress: Option<&Channel<ExportProgressEvent>>,
) -> AppResult<()> {
    let mut input_paths: Vec<String> = Vec::new();
    let mut path_to_idx: HashMap<String, usize> = HashMap::new();

    for track in &req.tracks {
        for clip in &track.clips {
            if !path_to_idx.contains_key(&clip.source_path) {
                let idx = input_paths.len();
                input_paths.push(clip.source_path.clone());
                path_to_idx.insert(clip.source_path.clone(), idx);
            }
        }
    }

    let mut filter_lines: Vec<String> = Vec::new();
    let mut track_labels: Vec<String> = Vec::new();
    let mut max_end_ms: u64 = 0;

    for (t_idx, track) in req.tracks.iter().enumerate() {
        if track.clips.is_empty() {
            continue;
        }
        let mut clip_labels = Vec::new();
        for (c_idx, clip) in track.clips.iter().enumerate() {
            let in_idx = path_to_idx[&clip.source_path];
            let out_label = format!("t{t_idx}_c{c_idx}");
            let mut chain = Vec::new();

            let start_s = clip.source_offset_ms as f64 / 1000.0;
            let raw_dur_s = (clip.duration_ms.max(10) as f64 / 1000.0) * clip.playback_rate.max(0.25);
            chain.push(format!(
                "atrim=start={start_s:.4}:duration={raw_dur_s:.4},asetpts=PTS-STARTPTS"
            ));
            chain.push(format!(
                "aresample={}:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo",
                req.sample_rate
            ));

            if (clip.playback_rate - 1.0).abs() > 0.001 {
                if has_rubberband {
                    chain.push(format!("rubberband=tempo={:.4}", clip.playback_rate.clamp(0.25, 4.0)));
                } else {
                    chain.push(chain_atempo(clip.playback_rate.clamp(0.25, 4.0)));
                }
            }
            if clip.pitch_semitones.abs() > 0.01 {
                let pf = 2f64.powf(clip.pitch_semitones / 12.0);
                if has_rubberband {
                    chain.push(format!("rubberband=pitch={pf:.6}"));
                } else {
                    chain.push(format!(
                        "asetrate=44100*{pf:.6},aresample=44100,{}",
                        chain_atempo(1.0 / pf)
                    ));
                }
            }
            if let Some(ch_f) = build_channel_filter(&clip.channel_mode) {
                chain.push(ch_f);
            }
            for fx in &clip.effects {
                if let Some(f) = effect_to_ffmpeg_filter(fx, has_rubberband) {
                    chain.push(f);
                }
            }
            if (clip.gain_db).abs() > 0.01 {
                chain.push(format!("volume={:.3}dB", clip.gain_db));
            }
            if clip.fade_in_ms > 0 {
                let fd = clip.fade_in_ms as f64 / 1000.0;
                let curve = fade_curve_code(&clip.fade_in_curve);
                chain.push(format!("afade=t=in:st=0:d={fd:.4}:curve={curve}"));
            }
            if clip.fade_out_ms > 0 {
                let clip_dur_s = clip.duration_ms as f64 / 1000.0;
                let fd = (clip.fade_out_ms as f64 / 1000.0).min(clip_dur_s);
                let st = (clip_dur_s - fd).max(0.0);
                let curve = fade_curve_code(&clip.fade_out_curve);
                chain.push(format!("afade=t=out:st={st:.4}:d={fd:.4}:curve={curve}"));
            }
            if clip.timeline_start_ms > 0 {
                let d = clip.timeline_start_ms;
                chain.push(format!("adelay={d}|{d}"));
            }

            max_end_ms = max_end_ms.max(clip.timeline_start_ms + clip.duration_ms);
            filter_lines.push(format!("[{in_idx}:a]{}[{out_label}]", chain.join(",")));
            clip_labels.push(format!("[{out_label}]"));
        }

        let track_mix = format!("track_{t_idx}_mix");
        let track_out = format!("track_{t_idx}");
        if clip_labels.len() == 1 {
            filter_lines.push(format!("{}anull[{track_mix}]", clip_labels[0]));
        } else {
            filter_lines.push(format!(
                "{}amix=inputs={}:duration=longest:normalize=0[{track_mix}]",
                clip_labels.join(""),
                clip_labels.len()
            ));
        }

        let mut t_chain = Vec::new();
        if let Some(ch_f) = build_channel_filter(&track.channel_mode) {
            t_chain.push(ch_f);
        }
        for fx in &track.effects {
            if let Some(f) = effect_to_ffmpeg_filter(fx, has_rubberband) {
                t_chain.push(f);
            }
        }
        if track.volume_db.abs() > 0.01 {
            t_chain.push(format!("volume={:.3}dB", track.volume_db));
        }
        if track.pan.abs() > 0.01 {
            let p = track.pan.clamp(-1.0, 1.0);
            let l_gain = ((1.0 - p) * 0.5).sqrt() * std::f64::consts::SQRT_2;
            let r_gain = ((1.0 + p) * 0.5).sqrt() * std::f64::consts::SQRT_2;
            t_chain.push(format!("pan=stereo|c0={l_gain:.4}*c0|c1={r_gain:.4}*c1"));
        }
        if t_chain.is_empty() {
            t_chain.push("anull".into());
        }
        filter_lines.push(format!("[{track_mix}]{}[{track_out}]", t_chain.join(",")));
        track_labels.push(format!("[{track_out}]"));
    }

    let mut master_chain = Vec::new();
    if let (Some(sel_s), Some(sel_e)) = (req.selection_start_ms, req.selection_end_ms) {
        if sel_e > sel_s {
            let ts = sel_s as f64 / 1000.0;
            let te = sel_e as f64 / 1000.0;
            master_chain.push(format!("atrim=start={ts:.4}:end={te:.4},asetpts=PTS-STARTPTS"));
            max_end_ms = sel_e - sel_s;
        }
    }
    if req.master_volume_db.abs() > 0.01 {
        master_chain.push(format!("volume={:.3}dB", req.master_volume_db));
    }
    if let Some(lufs) = req.loudness_lufs {
        master_chain.push(format!("loudnorm=I={:.1}:TP=-1.0:LRA=11", lufs.clamp(-30.0, -5.0)));
    }
    if req.channels == 1 {
        master_chain.push("pan=mono|c0=0.5*c0+0.5*c1".into());
    }
    master_chain.push(format!("aresample={}", req.sample_rate));

    if track_labels.len() == 1 {
        filter_lines.push(format!(
            "{}{}[master_out]",
            track_labels[0],
            master_chain.join(",")
        ));
    } else {
        filter_lines.push(format!(
            "{}amix=inputs={}:duration=longest:normalize=0,{}[master_out]",
            track_labels.join(""),
            track_labels.len(),
            master_chain.join(",")
        ));
    }

    let fc_script = filter_lines.join(";\n");
    let script_path = if fc_script.len() >= 20_000 {
        fs::create_dir_all(temp_dir)?;
        let p = temp_dir.join(format!("export_fc_{}.txt", uuid::Uuid::new_v4()));
        fs::write(&p, &fc_script)?;
        Some(p)
    } else {
        None
    };

    let mut cmd = new_hidden_command(ffmpeg_path);
    cmd.arg("-y");
    for inp in &input_paths {
        cmd.args(["-i", inp]);
    }
    if let Some(ref sp) = script_path {
        cmd.arg("-/filter_complex").arg(sp);
    } else {
        cmd.arg("-filter_complex").arg(&fc_script);
    }
    cmd.args(["-map", "[master_out]", "-ar", &req.sample_rate.to_string(), "-ac", &req.channels.to_string()]);

    let br = format!("{}k", req.bitrate_kbps.clamp(64, 320));
    match req.format.to_lowercase().as_str() {
        "wav" => {
            let codec = match req.bit_depth {
                24 => "pcm_s24le",
                32 => "pcm_f32le",
                _ => "pcm_s16le",
            };
            cmd.args(["-c:a", codec]);
        }
        "flac" => {
            let sfmt = if req.bit_depth >= 24 { "s32" } else { "s16" };
            cmd.args(["-c:a", "flac", "-sample_fmt", sfmt]);
        }
        "mp3" => {
            cmd.args(["-c:a", "libmp3lame", "-b:a", &br]);
        }
        "ogg" => {
            cmd.args(["-c:a", "libvorbis", "-b:a", &br]);
        }
        "aac" | "m4a" => {
            cmd.args(["-c:a", "aac", "-b:a", &br]);
        }
        _ => {
            cmd.args(["-c:a", "pcm_s16le"]);
        }
    }

    cmd.args(["-progress", "pipe:1", "-nostats", "-v", "error"])
        .arg(&req.output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Ffmpeg(format!("Failed to start export ffmpeg: {e}")))?;

    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        let total_us = (max_end_ms.max(100) as f64) * 1000.0;
        for line in reader.lines().map_while(Result::ok) {
            if let Some(us_str) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = us_str.trim().parse::<f64>() {
                    let pct = ((us / total_us) * 100.0).clamp(0.0, 99.0);
                    if let Some(cb) = on_progress {
                        let _ = cb.send(ExportProgressEvent {
                            percent: pct,
                            stage: "Encoding mixdown...".into(),
                            current_file: req.output_path.clone(),
                        });
                    }
                }
            }
        }
    }

    let out = child.wait_with_output()?;
    if let Some(sp) = script_path {
        let _ = fs::remove_file(sp);
    }

    if !out.status.success() {
        return Err(AppError::Ffmpeg(format!(
            "Export failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }

    if let Some(cb) = on_progress {
        let _ = cb.send(ExportProgressEvent {
            percent: 100.0,
            stage: "Export completed".into(),
            current_file: req.output_path.clone(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_all_effects_to_valid_filters() {
        let comp = EffectInput {
            id: "1".into(),
            effect_type: "compressor".into(),
            bypassed: false,
            params: json!({"threshold": -18, "ratio": 4}),
        };
        assert!(effect_to_ffmpeg_filter(&comp, true).unwrap().starts_with("acompressor="));

        let dehum = EffectInput {
            id: "2".into(),
            effect_type: "de_hum".into(),
            bypassed: false,
            params: json!({"freq60": true, "reduction": -24}),
        };
        assert!(effect_to_ffmpeg_filter(&dehum, true).unwrap().contains("f=60"));

        let bypassed = EffectInput {
            id: "3".into(),
            effect_type: "reverb".into(),
            bypassed: true,
            params: json!({}),
        };
        assert!(effect_to_ffmpeg_filter(&bypassed, true).is_none());
    }

    #[test]
    fn real_ffmpeg_transforms_peaks_spectrogram_and_six_format_exports() {
        use crate::audio::peaks::{generate_peak_pyramid, read_waveform_window};
        use crate::audio::probe::probe_audio_file;
        use crate::audio::spectral::{analyze_audio_and_silence, compute_spectrogram_tile};
        use crate::ffmpeg::locator::{new_hidden_command, probe_ffmpeg};

        let caps = probe_ffmpeg(Path::new("."), None);
        assert!(caps.available, "FFmpeg must be present for real audio integration test");
        let ff = PathBuf::from(caps.ffmpeg_path.unwrap());
        let fp = PathBuf::from(caps.ffprobe_path.unwrap());

        let work = std::env::temp_dir().join(format!("sonora_e2e_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&work).unwrap();
        let src_wav = work.join("test_tone.wav");

        // Synthesize 2s 48kHz stereo tone with silent middle section for silence detector
        let gen = new_hidden_command(&ff)
            .args([
                "-y", "-v", "error",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.7",
                "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=0.6",
                "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=0.7",
                "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1,pan=stereo|c0=c0|c1=c0[out]",
                "-map", "[out]", "-c:a", "pcm_s24le",
            ])
            .arg(&src_wav)
            .output()
            .unwrap();
        assert!(gen.status.success(), "FFmpeg synth failed: {}", String::from_utf8_lossy(&gen.stderr));

        // 1. Probe, Peak Pyramid, Windowed Read, Spectrogram, Silence & Telemetry
        let info = probe_audio_file(&fp, &src_wav).unwrap();
        assert_eq!(info.sample_rate, 48000);
        assert_eq!(info.channels, 2);
        assert!(info.duration_ms >= 1900);

        let pk_file = work.join("tone.peaks");
        let stats = generate_peak_pyramid(&ff, &src_wav, &pk_file, info.sample_rate, info.channels).unwrap();
        // FFmpeg `sine` source outputs default 0.125 amplitude (-18.06 dBFS)
        assert!(stats.peak_dbfs > -22.0 && stats.peak_dbfs < -14.0, "Unexpected peak: {}", stats.peak_dbfs);
        let win = read_waveform_window(&pk_file, 0, info.duration_ms, 200).unwrap();
        assert!(win.bins > 0 && !win.data.is_empty());

        let spec = compute_spectrogram_tile(&ff, &src_wav, 0, 2000, 128, 64).unwrap();
        assert_eq!(spec.width, 128);
        assert_eq!(spec.height, 64);

        let (silences, tel) = analyze_audio_and_silence(&ff, &src_wav, -40.0, 250).unwrap();
        assert!(!silences.is_empty(), "Expected middle 600ms silence interval to be detected");
        assert!(tel.duration_ms >= 1900);

        // 2. Real Clip Transforms (verify NormalizePeak lands accurately at -3.0 dBFS)
        let norm_wav = work.join("norm.wav");
        process_clip_transform(&ff, caps.has_rubberband, &src_wav, &norm_wav, ClipTransformOp::NormalizePeak { target_db: -3.0 }).unwrap();
        let norm_info = probe_audio_file(&fp, &norm_wav).unwrap();
        assert!(norm_info.duration_ms >= 1900);
        let norm_stats = generate_peak_pyramid(&ff, &norm_wav, &work.join("norm.peaks"), norm_info.sample_rate, norm_info.channels).unwrap();
        assert!((norm_stats.peak_dbfs - (-3.0)).abs() < 0.8, "Expected normalized peak near -3.0 dBFS, got {}", norm_stats.peak_dbfs);

        let nr_wav = work.join("nr.wav");
        process_clip_transform(&ff, caps.has_rubberband, &src_wav, &nr_wav, ClipTransformOp::NoiseRemoval { strength_db: 14.0, rnnoise_model: None }).unwrap();
        assert!(probe_audio_file(&fp, &nr_wav).is_ok());

        let ve_wav = work.join("ve.wav");
        process_clip_transform(&ff, caps.has_rubberband, &src_wav, &ve_wav, ClipTransformOp::VoiceEnhancement { clarity: 0.7 }).unwrap();
        assert!(probe_audio_file(&fp, &ve_wav).is_ok());

        let att_wav = work.join("att.wav");
        process_clip_transform(&ff, caps.has_rubberband, &src_wav, &att_wav, ClipTransformOp::SpectralAttenuate {
            start_ms: 0,
            end_ms: 500,
            low_hz: 300.0,
            high_hz: 600.0,
            attenuation_db: -18.0,
        }).unwrap();
        assert!(probe_audio_file(&fp, &att_wav).is_ok());

        // 3. Multi-track Mixdown Export across all 6 formats
        for fmt in ["wav", "mp3", "flac", "ogg", "aac", "m4a"] {
            let out_file = work.join(format!("mixdown.{fmt}"));
            let req = ExportRequest {
                output_path: out_file.display().to_string(),
                format: fmt.into(),
                sample_rate: 44100,
                bitrate_kbps: 192,
                bit_depth: 16,
                channels: 2,
                loudness_lufs: if fmt == "mp3" { Some(-16.0) } else { None },
                peak_normalize_db: None,
                selection_start_ms: None,
                selection_end_ms: None,
                master_volume_db: -1.0,
                export_stems: false,
                tracks: vec![TrackMixSpec {
                    id: "t1".into(),
                    name: "Voice".into(),
                    volume_db: 0.0,
                    pan: 0.0,
                    muted: false,
                    solo: false,
                    channel_mode: "stereo".into(),
                    effects: vec![EffectInput {
                        id: "e1".into(),
                        effect_type: "high_pass".into(),
                        bypassed: false,
                        params: json!({ "freq": 80, "q": 0.707 }),
                    }],
                    clips: vec![ClipRenderSpec {
                        source_path: src_wav.display().to_string(),
                        source_offset_ms: 0,
                        duration_ms: 1500,
                        timeline_start_ms: 0,
                        gain_db: 0.0,
                        fade_in_ms: 50,
                        fade_out_ms: 50,
                        fade_in_curve: "linear".into(),
                        fade_out_curve: "s_curve".into(),
                        playback_rate: 1.0,
                        pitch_semitones: 0.0,
                        channel_mode: "stereo".into(),
                        effects: vec![],
                    }],
                }],
            };

            let dummy_tmp = work.join("tmp");
            render_single_mixdown(&ff, caps.has_rubberband, &dummy_tmp, &req, None)
                .unwrap_or_else(|e| panic!("Format '{fmt}' mixdown failed: {e}"));
            let probed = probe_audio_file(&fp, &out_file)
                .unwrap_or_else(|e| panic!("ffprobe failed for '{fmt}': {e}"));
            assert!(probed.duration_ms >= 1300, "Format '{fmt}' output too short");
        }

        let _ = fs::remove_dir_all(work);
    }
}
