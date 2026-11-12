use serde::Serialize;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::Stdio;

use crate::error::{AppError, AppResult};
use crate::ffmpeg::locator::new_hidden_command;

const MAGIC: &[u8; 4] = b"SNPK";
const VERSION: u32 = 1;
const LEVEL_FACTORS: [u32; 4] = [64, 256, 1024, 4096];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeakStats {
    pub peak_dbfs: f64,
    pub rms_dbfs: f64,
    pub total_frames: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformWindow {
    pub bins: usize,
    pub channels: u32,
    /// Flat array per bin: [minL, maxL, rmsL, minR, maxR, rmsR] normalized in [-1..1]
    pub data: Vec<f32>,
}

struct LevelAccum {
    block_size: u32,
    channels: usize,
    cur_count: u32,
    min_vals: [f32; 2],
    max_vals: [f32; 2],
    sq_sum: [f64; 2],
    bins: Vec<i16>,
}

impl LevelAccum {
    fn new(block_size: u32, channels: usize) -> Self {
        Self {
            block_size,
            channels,
            cur_count: 0,
            min_vals: [1.0, 1.0],
            max_vals: [-1.0, -1.0],
            sq_sum: [0.0, 0.0],
            bins: Vec::new(),
        }
    }

    #[inline]
    fn push_frame(&mut self, l: f32, r: f32) {
        if l < self.min_vals[0] {
            self.min_vals[0] = l;
        }
        if l > self.max_vals[0] {
            self.max_vals[0] = l;
        }
        self.sq_sum[0] += (l as f64) * (l as f64);

        if self.channels > 1 {
            if r < self.min_vals[1] {
                self.min_vals[1] = r;
            }
            if r > self.max_vals[1] {
                self.max_vals[1] = r;
            }
            self.sq_sum[1] += (r as f64) * (r as f64);
        }

        self.cur_count += 1;
        if self.cur_count >= self.block_size {
            self.flush_bin();
        }
    }

    fn flush_bin(&mut self) {
        if self.cur_count == 0 {
            return;
        }
        let n = self.cur_count as f64;
        for ch in 0..self.channels {
            let mn = (self.min_vals[ch].clamp(-1.0, 1.0) * 32767.0).round() as i16;
            let mx = (self.max_vals[ch].clamp(-1.0, 1.0) * 32767.0).round() as i16;
            let rms = ((self.sq_sum[ch] / n).sqrt().clamp(0.0, 1.0) * 32767.0).round() as i16;
            self.bins.push(mn);
            self.bins.push(mx);
            self.bins.push(rms);
        }
        self.cur_count = 0;
        self.min_vals = [1.0, 1.0];
        self.max_vals = [-1.0, -1.0];
        self.sq_sum = [0.0, 0.0];
    }

    fn bin_count(&self) -> u64 {
        (self.bins.len() / (self.channels * 3)) as u64
    }
}

/// Streams decoded f32le PCM chunks from FFmpeg in 256 KB blocks (constant RAM footprint)
/// and writes a 4-level binary `.peaks` pyramid file.
pub fn generate_peak_pyramid(
    ffmpeg_path: &Path,
    audio_path: &Path,
    peak_out_path: &Path,
    sample_rate: u32,
    channels: u32,
) -> AppResult<PeakStats> {
    let ch = channels.clamp(1, 2) as usize;
    let sr = sample_rate.clamp(8000, 192000);

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
            &ch.to_string(),
            "-ar",
            &sr.to_string(),
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Ffmpeg(format!("Failed to spawn ffmpeg peak decoder: {e}")))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Ffmpeg("Missing ffmpeg stdout".into()))?;

    let mut levels = [
        LevelAccum::new(LEVEL_FACTORS[0], ch),
        LevelAccum::new(LEVEL_FACTORS[1], ch),
        LevelAccum::new(LEVEL_FACTORS[2], ch),
        LevelAccum::new(LEVEL_FACTORS[3], ch),
    ];

    let mut global_peak: f32 = 0.0;
    let mut global_sq: f64 = 0.0;
    let mut total_frames: u64 = 0;

    let frame_bytes = ch * 4;
    let mut read_buf = vec![0u8; 262_144]; // 256 KB streaming chunk
    let mut carry: Vec<u8> = Vec::with_capacity(frame_bytes);

    loop {
        let n = stdout.read(&mut read_buf)?;
        if n == 0 {
            break;
        }

        let slice = &read_buf[..n];
        let mut combined_owned = Vec::new();
        let data: &[u8] = if carry.is_empty() {
            slice
        } else {
            combined_owned.extend_from_slice(&carry);
            combined_owned.extend_from_slice(slice);
            carry.clear();
            &combined_owned
        };

        let aligned_len = (data.len() / frame_bytes) * frame_bytes;
        if aligned_len < data.len() {
            carry.extend_from_slice(&data[aligned_len..]);
        }

        for frame in data[..aligned_len].chunks_exact(frame_bytes) {
            let l = f32::from_le_bytes([frame[0], frame[1], frame[2], frame[3]]);
            let r = if ch > 1 {
                f32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]])
            } else {
                l
            };

            let abs_l = l.abs();
            let abs_r = r.abs();
            let p = abs_l.max(abs_r);
            if p > global_peak {
                global_peak = p;
            }
            global_sq += (l as f64) * (l as f64);
            if ch > 1 {
                global_sq += (r as f64) * (r as f64);
            }
            total_frames += 1;

            for lvl in &mut levels {
                lvl.push_frame(l, r);
            }
        }
    }

    let status = child.wait()?;
    if !status.success() && total_frames == 0 {
        let mut err_s = String::new();
        if let Some(mut se) = child.stderr {
            let _ = se.read_to_string(&mut err_s);
        }
        return Err(AppError::Ffmpeg(format!("FFmpeg peak decode failed: {err_s}")));
    }

    for lvl in &mut levels {
        lvl.flush_bin();
    }

    if let Some(parent) = peak_out_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Header layout:
    // 4B magic + 4B version + 4B sr + 4B ch + 8B total_frames + 4B num_levels (28 bytes)
    // + 4 * (4B block_size + 8B bin_count + 8B byte_offset) (80 bytes) => 108 bytes header
    let header_size: u64 = 28 + (levels.len() as u64) * 20;
    let mut offsets = [0u64; 4];
    let mut cur_offset = header_size;
    for (i, lvl) in levels.iter().enumerate() {
        offsets[i] = cur_offset;
        cur_offset += (lvl.bins.len() as u64) * 2;
    }

    let tmp_path = peak_out_path.with_extension("peaks.tmp");
    {
        let file = File::create(&tmp_path)?;
        let mut w = BufWriter::new(file);
        w.write_all(MAGIC)?;
        w.write_all(&VERSION.to_le_bytes())?;
        w.write_all(&sr.to_le_bytes())?;
        w.write_all(&(ch as u32).to_le_bytes())?;
        w.write_all(&total_frames.to_le_bytes())?;
        w.write_all(&(levels.len() as u32).to_le_bytes())?;

        for (i, lvl) in levels.iter().enumerate() {
            w.write_all(&lvl.block_size.to_le_bytes())?;
            w.write_all(&lvl.bin_count().to_le_bytes())?;
            w.write_all(&offsets[i].to_le_bytes())?;
        }

        for lvl in &levels {
            for &val in &lvl.bins {
                w.write_all(&val.to_le_bytes())?;
            }
        }
        w.flush()?;
    }
    fs::rename(&tmp_path, peak_out_path)?;

    let total_samples = (total_frames * ch as u64).max(1) as f64;
    let rms = (global_sq / total_samples).sqrt();
    let peak_dbfs = if global_peak > 1e-6 {
        20.0 * (global_peak as f64).log10()
    } else {
        -120.0
    };
    let rms_dbfs = if rms > 1e-6 {
        20.0 * rms.log10()
    } else {
        -120.0
    };

    Ok(PeakStats {
        peak_dbfs,
        rms_dbfs,
        total_frames,
    })
}

pub fn read_waveform_window(
    peak_path: &Path,
    start_ms: u64,
    end_ms: u64,
    target_bins: usize,
) -> AppResult<WaveformWindow> {
    let target_bins = target_bins.clamp(16, 4096);
    let mut f = File::open(peak_path)?;

    let mut hdr = [0u8; 28];
    f.read_exact(&mut hdr)?;
    if &hdr[0..4] != MAGIC {
        return Err(AppError::Invalid("Corrupt .peaks file magic".into()));
    }
    let sr = u32::from_le_bytes(hdr[8..12].try_into().unwrap());
    let ch = u32::from_le_bytes(hdr[12..16].try_into().unwrap()).clamp(1, 2);
    let total_frames = u64::from_le_bytes(hdr[16..24].try_into().unwrap());
    let num_levels = u32::from_le_bytes(hdr[24..28].try_into().unwrap()) as usize;

    let mut meta = Vec::with_capacity(num_levels);
    for _ in 0..num_levels {
        let mut buf = [0u8; 20];
        f.read_exact(&mut buf)?;
        let block_size = u32::from_le_bytes(buf[0..4].try_into().unwrap());
        let bin_count = u64::from_le_bytes(buf[4..12].try_into().unwrap());
        let offset = u64::from_le_bytes(buf[12..20].try_into().unwrap());
        meta.push((block_size, bin_count, offset));
    }

    let start_frame = ((start_ms as f64 / 1000.0) * sr as f64)
        .round()
        .clamp(0.0, total_frames as f64) as u64;
    let end_frame = ((end_ms as f64 / 1000.0) * sr as f64)
        .round()
        .clamp(start_frame as f64, total_frames as f64) as u64;
    let span_frames = end_frame.saturating_sub(start_frame).max(1);

    // Choose the coarsest mipmap that still gives >= 2x target_bins resolution
    let mut chosen = meta[0];
    for &entry in meta.iter().rev() {
        let bins_in_span = span_frames / (entry.0 as u64).max(1);
        if bins_in_span >= (target_bins as u64) * 2 || entry.0 == LEVEL_FACTORS[0] {
            chosen = entry;
            break;
        }
    }

    let (block_size, bin_count, offset) = chosen;
    if bin_count == 0 {
        return Ok(WaveformWindow {
            bins: 0,
            channels: ch,
            data: Vec::new(),
        });
    }

    let first_bin = (start_frame / block_size as u64).min(bin_count.saturating_sub(1));
    let last_bin = ((end_frame + block_size as u64 - 1) / block_size as u64).min(bin_count);
    let read_bins = last_bin.saturating_sub(first_bin).max(1) as usize;

    let vals_per_bin = (ch as usize) * 3;
    let byte_start = offset + (first_bin * (vals_per_bin as u64) * 2);
    f.seek(SeekFrom::Start(byte_start))?;

    let mut raw = vec![0u8; read_bins * vals_per_bin * 2];
    f.read_exact(&mut raw)?;

    let mut out = vec![0f32; target_bins * vals_per_bin];
    for out_idx in 0..target_bins {
        let b0 = (out_idx * read_bins) / target_bins;
        let b1 = (((out_idx + 1) * read_bins) / target_bins).max(b0 + 1).min(read_bins);

        for c in 0..(ch as usize) {
            let mut mn = 1.0f32;
            let mut mx = -1.0f32;
            let mut rms_max = 0.0f32;
            for b in b0..b1 {
                let idx = (b * vals_per_bin + c * 3) * 2;
                let v_mn = i16::from_le_bytes([raw[idx], raw[idx + 1]]) as f32 / 32767.0;
                let v_mx = i16::from_le_bytes([raw[idx + 2], raw[idx + 3]]) as f32 / 32767.0;
                let v_rms = i16::from_le_bytes([raw[idx + 4], raw[idx + 5]]) as f32 / 32767.0;
                if v_mn < mn {
                    mn = v_mn;
                }
                if v_mx > mx {
                    mx = v_mx;
                }
                if v_rms > rms_max {
                    rms_max = v_rms;
                }
            }
            let base = out_idx * vals_per_bin + c * 3;
            out[base] = mn;
            out[base + 1] = mx;
            out[base + 2] = rms_max;
        }
    }

    Ok(WaveformWindow {
        bins: target_bins,
        channels: ch,
        data: out,
    })
}

/// Decodes an exact time slice into raw interleaved `f32le` bytes using FFmpeg fast seeking
/// so the Web Audio AudioWorklet can stream multi-hour files with tiny sliding buffers.
pub fn read_pcm_chunk(
    ffmpeg_path: &Path,
    audio_path: &Path,
    start_ms: u64,
    duration_ms: u64,
    target_sample_rate: u32,
    channels: u32,
) -> AppResult<Vec<u8>> {
    let start_sec = format!("{:.6}", start_ms as f64 / 1000.0);
    let dur_sec = format!("{:.6}", (duration_ms.max(10)) as f64 / 1000.0);
    let ch = channels.clamp(1, 2);
    let sr = target_sample_rate.clamp(8000, 192000);

    let out = new_hidden_command(ffmpeg_path)
        .args(["-v", "error", "-ss", &start_sec, "-t", &dur_sec, "-i"])
        .arg(audio_path)
        .args([
            "-vn",
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            &ch.to_string(),
            "-ar",
            &sr.to_string(),
            "pipe:1",
        ])
        .output()
        .map_err(|e| AppError::Ffmpeg(format!("PCM chunk decode failed: {e}")))?;

    if !out.status.success() {
        return Err(AppError::Ffmpeg(format!(
            "PCM chunk decode error: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    Ok(out.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_accum_min_max_rms() {
        let mut acc = LevelAccum::new(4, 1);
        acc.push_frame(0.5, 0.5);
        acc.push_frame(-0.5, -0.5);
        acc.push_frame(0.5, 0.5);
        acc.push_frame(-0.5, -0.5);
        assert_eq!(acc.bin_count(), 1);
        let mn = acc.bins[0] as f32 / 32767.0;
        let mx = acc.bins[1] as f32 / 32767.0;
        let rms = acc.bins[2] as f32 / 32767.0;
        assert!((mn - (-0.5)).abs() < 0.01);
        assert!((mx - 0.5).abs() < 0.01);
        assert!((rms - 0.5).abs() < 0.01);
    }
}
