use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;

use crate::audio::peaks::read_pcm_chunk;
use crate::error::{AppError, AppResult};
use crate::ffmpeg::locator::new_hidden_command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpectrogramTile {
    pub width: usize,
    pub height: usize,
    pub min_hz: f32,
    pub max_hz: f32,
    /// Row-major (height rows bottom-to-top or top-to-bottom: row 0 = high freq, row height-1 = low freq), normalized 0..255
    pub intensities: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceInterval {
    pub start_ms: u64,
    pub end_ms: u64,
    pub duration_ms: u64,
    pub avg_db: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTelemetry {
    pub duration_ms: u64,
    pub peak_dbfs: f64,
    pub rms_dbfs: f64,
    pub estimated_noise_floor_dbfs: f64,
    pub clipping_samples: u64,
    pub silence_ratio: f64,
    pub low_energy_ratio: f64,
    pub high_energy_ratio: f64,
}

pub fn compute_spectrogram_tile(
    ffmpeg_path: &Path,
    audio_path: &Path,
    start_ms: u64,
    duration_ms: u64,
    width: usize,
    height: usize,
) -> AppResult<SpectrogramTile> {
    let sr = 44100u32;
    let fft_size = 2048usize;
    let width = width.clamp(64, 1024);
    let height = height.clamp(64, 512);

    let raw = read_pcm_chunk(ffmpeg_path, audio_path, start_ms, duration_ms.max(50), sr, 1)?;
    let samples: Vec<f32> = raw
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();

    if samples.len() < 64 {
        return Ok(SpectrogramTile {
            width,
            height,
            min_hz: 20.0,
            max_hz: 20000.0,
            intensities: vec![0; width * height],
        });
    }

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let hann: Vec<f32> = (0..fft_size)
        .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / (fft_size - 1) as f32).cos()))
        .collect();

    let min_hz = 20.0f32;
    let max_hz = 20000.0f32;
    let nyquist = sr as f32 / 2.0;
    let max_bin = (fft_size / 2) - 1;

    let mut intensities = vec![0u8; width * height];
    let mut buffer = vec![Complex::new(0.0f32, 0.0f32); fft_size];

    for col in 0..width {
        let center_idx = if width > 1 {
            (col * samples.len().saturating_sub(1)) / (width - 1)
        } else {
            0
        };
        let start_idx = center_idx.saturating_sub(fft_size / 2);

        for i in 0..fft_size {
            let s = samples.get(start_idx + i).copied().unwrap_or(0.0);
            buffer[i] = Complex::new(s * hann[i], 0.0);
        }
        fft.process(&mut buffer);

        for row in 0..height {
            // Top row (row = 0) = max_hz, Bottom row (row = height - 1) = min_hz (log scale)
            let frac_from_bottom = 1.0 - (row as f32 / (height - 1).max(1) as f32);
            let freq = min_hz * (max_hz / min_hz).powf(frac_from_bottom);
            let bin = ((freq / nyquist) * max_bin as f32).round() as usize;
            let bin = bin.clamp(1, max_bin);

            let mag = buffer[bin].norm() / (fft_size as f32 * 0.25);
            let db = if mag > 1e-6 { 20.0 * mag.log10() } else { -100.0 };
            let norm = ((db + 96.0) / 96.0).clamp(0.0, 1.0);
            intensities[row * width + col] = (norm * 255.0).round() as u8;
        }
    }

    Ok(SpectrogramTile {
        width,
        height,
        min_hz,
        max_hz,
        intensities,
    })
}

/// Computes exact offset in milliseconds to align target audio to reference audio
/// using FFT cross-correlation at 16 kHz mono.
pub fn align_clips_cross_corr(
    ffmpeg_path: &Path,
    ref_path: &Path,
    ref_start_ms: u64,
    target_path: &Path,
    target_start_ms: u64,
    window_ms: u64,
) -> AppResult<i64> {
    let sr = 16000u32;
    let win = window_ms.clamp(500, 15000);

    let ref_bytes = read_pcm_chunk(ffmpeg_path, ref_path, ref_start_ms, win, sr, 1)?;
    let tgt_bytes = read_pcm_chunk(ffmpeg_path, target_path, target_start_ms, win, sr, 1)?;

    let a: Vec<f32> = ref_bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let b: Vec<f32> = tgt_bytes
        .chunks_exact(4)
        .map(|x| f32::from_le_bytes([x[0], x[1], x[2], x[3]]))
        .collect();

    if a.is_empty() || b.is_empty() {
        return Ok(0);
    }

    Ok(cross_correlation_offset_ms(&a, &b, sr))
}

pub fn cross_correlation_offset_ms(a: &[f32], b: &[f32], sample_rate: u32) -> i64 {
    let n = (a.len() + b.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let ifft = planner.plan_fft_inverse(n);

    let mut fa: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); n];
    let mut fb: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); n];

    for (i, &v) in a.iter().enumerate() {
        fa[i] = Complex::new(v, 0.0);
    }
    for (i, &v) in b.iter().enumerate() {
        fb[i] = Complex::new(v, 0.0);
    }

    fft.process(&mut fa);
    fft.process(&mut fb);

    let mut prod: Vec<Complex<f32>> = fa
        .iter()
        .zip(fb.iter())
        .map(|(x, y)| *x * y.conj())
        .collect();

    ifft.process(&mut prod);

    let max_shift_samples = ((sample_rate as usize) * 3).min(n / 2);
    let mut best_idx = 0usize;
    let mut best_val = f32::NEG_INFINITY;

    for idx in 0..max_shift_samples {
        let v = prod[idx].re;
        if v > best_val {
            best_val = v;
            best_idx = idx;
        }
    }
    for idx in (n - max_shift_samples)..n {
        let v = prod[idx].re;
        if v > best_val {
            best_val = v;
            best_idx = idx;
        }
    }

    let signed_lag = if best_idx <= n / 2 {
        best_idx as i64
    } else {
        best_idx as i64 - n as i64
    };

    ((signed_lag as f64 / sample_rate as f64) * 1000.0).round() as i64
}

/// Streams PCM in chunks and detects silence intervals + audio telemetry (LUFS/RMS/noise floor/spectral tilt).
pub fn analyze_audio_and_silence(
    ffmpeg_path: &Path,
    audio_path: &Path,
    threshold_db: f64,
    min_silence_ms: u64,
) -> AppResult<(Vec<SilenceInterval>, AudioTelemetry)> {
    let sr = 16000u32;
    let frame_ms = 20u64;
    let samples_per_frame = (sr as u64 * frame_ms / 1000) as usize; // 320 samples

    let mut child = new_hidden_command(ffmpeg_path)
        .args(["-v", "error", "-i"])
        .arg(audio_path)
        .args([
            "-vn",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            "1",
            "-ar",
            &sr.to_string(),
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Ffmpeg(format!("Silence/telemetry spawn error: {e}")))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Ffmpeg("Missing stdout".into()))?;

    let mut buf = vec![0u8; 65536];
    let mut carry = Vec::new();
    let mut frame_samples = Vec::with_capacity(samples_per_frame);
    let mut frame_dbs: Vec<f64> = Vec::new();

    let mut peak: f32 = 0.0;
    let mut total_sq: f64 = 0.0;
    let mut total_samples: u64 = 0;
    let mut clipping_samples: u64 = 0;

    // Simple 1-pole lowpass (~300Hz) & highpass (~4kHz) energy trackers for spectral tilt
    let mut lp_state = 0.0f32;
    let mut prev_x = 0.0f32;
    let mut hp_state = 0.0f32;
    let mut low_sq = 0.0f64;
    let mut high_sq = 0.0f64;
    let alpha_lp = 0.11f32;
    let alpha_hp = 0.39f32;

    loop {
        let n = stdout.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let mut combined = Vec::new();
        let bytes: &[u8] = if carry.is_empty() {
            &buf[..n]
        } else {
            combined.extend_from_slice(&carry);
            combined.extend_from_slice(&buf[..n]);
            carry.clear();
            &combined
        };

        let aligned = (bytes.len() / 4) * 4;
        if aligned < bytes.len() {
            carry.extend_from_slice(&bytes[aligned..]);
        }

        for ch_bytes in bytes[..aligned].chunks_exact(4) {
            let s = f32::from_le_bytes([ch_bytes[0], ch_bytes[1], ch_bytes[2], ch_bytes[3]]);
            let a = s.abs();
            if a > peak {
                peak = a;
            }
            if a >= 0.995 {
                clipping_samples += 1;
            }
            total_sq += (s as f64) * (s as f64);
            total_samples += 1;

            lp_state += alpha_lp * (s - lp_state);
            hp_state = alpha_hp * (hp_state + s - prev_x);
            prev_x = s;
            low_sq += (lp_state as f64) * (lp_state as f64);
            high_sq += (hp_state as f64) * (hp_state as f64);

            frame_samples.push(s);
            if frame_samples.len() >= samples_per_frame {
                let sq: f64 = frame_samples.iter().map(|&v| (v as f64) * (v as f64)).sum();
                let rms = (sq / samples_per_frame as f64).sqrt();
                let db = if rms > 1e-6 { 20.0 * rms.log10() } else { -120.0 };
                frame_dbs.push(db);
                frame_samples.clear();
            }
        }
    }

    let _ = child.wait();

    let mut intervals = Vec::new();
    let mut in_silence = false;
    let mut sil_start_frame = 0usize;
    let mut sil_db_sum = 0.0f64;

    for (idx, &db) in frame_dbs.iter().enumerate() {
        if db <= threshold_db {
            if !in_silence {
                in_silence = true;
                sil_start_frame = idx;
                sil_db_sum = db;
            } else {
                sil_db_sum += db;
            }
        } else if in_silence {
            let dur_ms = (idx - sil_start_frame) as u64 * frame_ms;
            if dur_ms >= min_silence_ms {
                intervals.push(SilenceInterval {
                    start_ms: sil_start_frame as u64 * frame_ms,
                    end_ms: idx as u64 * frame_ms,
                    duration_ms: dur_ms,
                    avg_db: sil_db_sum / (idx - sil_start_frame) as f64,
                });
            }
            in_silence = false;
        }
    }
    if in_silence {
        let idx = frame_dbs.len();
        let dur_ms = (idx - sil_start_frame) as u64 * frame_ms;
        if dur_ms >= min_silence_ms {
            intervals.push(SilenceInterval {
                start_ms: sil_start_frame as u64 * frame_ms,
                end_ms: idx as u64 * frame_ms,
                duration_ms: dur_ms,
                avg_db: sil_db_sum / (idx - sil_start_frame).max(1) as f64,
            });
        }
    }

    let duration_ms = ((total_samples as f64 / sr as f64) * 1000.0).round() as u64;
    let peak_dbfs = if peak > 1e-6 { 20.0 * (peak as f64).log10() } else { -120.0 };
    let rms = (total_sq / total_samples.max(1) as f64).sqrt();
    let rms_dbfs = if rms > 1e-6 { 20.0 * rms.log10() } else { -120.0 };

    // Estimate noise floor from 10th percentile of active frames
    let mut sorted_dbs = frame_dbs.clone();
    sorted_dbs.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    let noise_floor = if sorted_dbs.is_empty() {
        -90.0
    } else {
        sorted_dbs[sorted_dbs.len() / 10]
    };

    let sil_ms_total: u64 = intervals.iter().map(|i| i.duration_ms).sum();
    let silence_ratio = if duration_ms > 0 {
        (sil_ms_total as f64 / duration_ms as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let tot_e = total_sq.max(1e-12);
    let telemetry = AudioTelemetry {
        duration_ms,
        peak_dbfs,
        rms_dbfs,
        estimated_noise_floor_dbfs: noise_floor,
        clipping_samples,
        silence_ratio,
        low_energy_ratio: (low_sq / tot_e).clamp(0.0, 1.0),
        high_energy_ratio: (high_sq / tot_e).clamp(0.0, 1.0),
    };

    Ok((intervals, telemetry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cross_correlation_detects_exact_lag() {
        let sr = 16000u32;
        let mut a = vec![0.0f32; 8000];
        let mut b = vec![0.0f32; 8000];
        // Impulse burst at sample 1600 (100 ms) in A and sample 2400 (150 ms) in B
        for i in 0..200 {
            let v = (i as f32 * 0.2).sin();
            a[1600 + i] = v;
            b[2400 + i] = v;
        }
        let lag = cross_correlation_offset_ms(&a, &b, sr);
        assert!((lag - (-50)).abs() <= 2, "Expected ~ -50ms, got {lag}ms");
    }
}
