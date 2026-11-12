use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::ffmpeg::locator::new_hidden_command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioProbeInfo {
    pub file_hash: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub channels: u32,
    pub bit_depth: u32,
    pub codec: String,
    pub bitrate: u64,
    pub file_size_bytes: u64,
}

#[derive(Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    size: Option<String>,
    bit_rate: Option<String>,
}

#[derive(Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    sample_rate: Option<String>,
    channels: Option<u32>,
    bits_per_raw_sample: Option<String>,
    bits_per_sample: Option<u32>,
    bit_rate: Option<String>,
}

/// Computes a fast content fingerprint from file size + head/tail 64 KB blocks
/// so multi-GB WAV files are hashed in < 2 ms without reading the full file.
pub fn fast_file_fingerprint(path: &Path) -> AppResult<(String, u64)> {
    let mut f = File::open(path)?;
    let meta = f.metadata()?;
    let len = meta.len();

    let mut hasher = Sha256::new();
    hasher.update(len.to_le_bytes());

    let mut buf = vec![0u8; 65536];
    let n = f.read(&mut buf)?;
    hasher.update(&buf[..n]);

    if len > 131072 {
        use std::io::{Seek, SeekFrom};
        f.seek(SeekFrom::End(-65536))?;
        let n2 = f.read(&mut buf)?;
        hasher.update(&buf[..n2]);
    }

    Ok((hex::encode(hasher.finalize()), len))
}

pub fn probe_audio_file(ffprobe_path: &Path, audio_path: &Path) -> AppResult<AudioProbeInfo> {
    if !audio_path.is_file() {
        return Err(AppError::Invalid(format!(
            "Audio file not found: {}",
            audio_path.display()
        )));
    }

    let (file_hash, file_size_bytes) = fast_file_fingerprint(audio_path)?;

    let out = new_hidden_command(ffprobe_path)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(audio_path)
        .output()
        .map_err(|e| AppError::Ffmpeg(format!("Failed to execute ffprobe: {e}")))?;

    if !out.status.success() {
        return Err(AppError::Ffmpeg(format!(
            "ffprobe failed on {}: {}",
            audio_path.display(),
            String::from_utf8_lossy(&out.stderr)
        )));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&out.stdout)?;
    let audio_stream = parsed
        .streams
        .unwrap_or_default()
        .into_iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"))
        .ok_or_else(|| AppError::Invalid("File contains no audio stream".to_string()))?;

    let duration_sec: f64 = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|d| d.parse().ok())
        .unwrap_or(0.0);

    let sample_rate: u32 = audio_stream
        .sample_rate
        .as_deref()
        .and_then(|s| s.parse().ok())
        .unwrap_or(44100);

    let channels: u32 = audio_stream.channels.unwrap_or(2).clamp(1, 8);

    let bit_depth: u32 = audio_stream
        .bits_per_raw_sample
        .as_deref()
        .and_then(|s| s.parse().ok())
        .or(audio_stream.bits_per_sample)
        .filter(|&b| b > 0)
        .unwrap_or(16);

    let bitrate: u64 = audio_stream
        .bit_rate
        .as_deref()
        .and_then(|s| s.parse().ok())
        .or_else(|| {
            parsed
                .format
                .as_ref()
                .and_then(|f| f.bit_rate.as_deref())
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0);

    let size_from_probe = parsed
        .format
        .as_ref()
        .and_then(|f| f.size.as_deref())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(file_size_bytes);

    Ok(AudioProbeInfo {
        file_hash,
        duration_ms: (duration_sec * 1000.0).round() as u64,
        sample_rate,
        channels,
        bit_depth,
        codec: audio_stream.codec_name.unwrap_or_else(|| "unknown".into()),
        bitrate,
        file_size_bytes: size_from_probe,
    })
}
