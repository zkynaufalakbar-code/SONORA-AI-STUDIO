use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{SampleFormat, WavSpec, WavWriter};
use serde::Serialize;
use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub kind: String, // "input" | "output"
    pub is_default: bool,
    pub max_channels: u16,
    pub default_sample_rate: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingTelemetry {
    pub peak_l: f32,
    pub peak_r: f32,
    pub rms_l: f32,
    pub rms_r: f32,
    pub clipping: bool,
    pub elapsed_ms: u64,
    pub waveform_samples: Vec<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFinishedInfo {
    pub output_path: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub bit_depth: u16,
}

struct ActiveSession {
    stop_flag: Arc<AtomicBool>,
    paused_flag: Arc<AtomicBool>,
    gain_bits: Arc<AtomicU32>,
    output_path: PathBuf,
    sample_rate: u32,
    channels: u16,
    bit_depth: u16,
    samples_written: Arc<std::sync::atomic::AtomicU64>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

pub struct RecorderManager {
    session: Mutex<Option<ActiveSession>>,
}

impl RecorderManager {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }

    pub fn list_devices(&self) -> AppResult<Vec<AudioDeviceInfo>> {
        let host = cpal::default_host();
        let default_in = host.default_input_device().and_then(|d| d.name().ok());
        let default_out = host.default_output_device().and_then(|d| d.name().ok());

        let mut list = Vec::new();
        if let Ok(inputs) = host.input_devices() {
            for (idx, dev) in inputs.enumerate() {
                let name = dev.name().unwrap_or_else(|_| format!("Input Device {idx}"));
                let cfg = dev.default_input_config().ok();
                list.push(AudioDeviceInfo {
                    id: format!("in:{name}"),
                    is_default: default_in.as_deref() == Some(name.as_str()),
                    name,
                    kind: "input".into(),
                    max_channels: cfg.as_ref().map(|c| c.channels()).unwrap_or(2),
                    default_sample_rate: cfg.as_ref().map(|c| c.sample_rate().0).unwrap_or(48000),
                });
            }
        }
        if let Ok(outputs) = host.output_devices() {
            for (idx, dev) in outputs.enumerate() {
                let name = dev.name().unwrap_or_else(|_| format!("Output Device {idx}"));
                let cfg = dev.default_output_config().ok();
                list.push(AudioDeviceInfo {
                    id: format!("out:{name}"),
                    is_default: default_out.as_deref() == Some(name.as_str()),
                    name,
                    kind: "output".into(),
                    max_channels: cfg.as_ref().map(|c| c.channels()).unwrap_or(2),
                    default_sample_rate: cfg.as_ref().map(|c| c.sample_rate().0).unwrap_or(48000),
                });
            }
        }
        Ok(list)
    }

    pub fn start_recording(
        &self,
        device_name: Option<String>,
        channels: u16,
        sample_rate: u32,
        bit_depth: u16,
        input_gain_db: f32,
        monitor_enabled: bool,
        output_path: PathBuf,
        on_telemetry: Channel<RecordingTelemetry>,
    ) -> AppResult<()> {
        let mut guard = self.session.lock().expect("recorder lock poisoned");
        if guard.is_some() {
            return Err(AppError::Audio("Recording session already active".into()));
        }

        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        let paused_flag = Arc::new(AtomicBool::new(false));
        let gain_linear = 10f32.powf(input_gain_db / 20.0);
        let gain_bits = Arc::new(AtomicU32::new(gain_linear.to_bits()));
        let samples_written = Arc::new(std::sync::atomic::AtomicU64::new(0));

        let stop_c = stop_flag.clone();
        let pause_c = paused_flag.clone();
        let gain_c = gain_bits.clone();
        let written_c = samples_written.clone();
        let out_c = output_path.clone();

        let requested_ch = channels.clamp(1, 2);
        let requested_sr = sample_rate.clamp(16000, 96000);
        let requested_bd = match bit_depth {
            24 => 24,
            32 => 32,
            _ => 16,
        };

        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        let handle = std::thread::spawn(move || {
            let res = run_capture_loop(
                device_name,
                requested_ch,
                requested_sr,
                requested_bd,
                monitor_enabled,
                &out_c,
                stop_c,
                pause_c,
                gain_c,
                written_c,
                on_telemetry,
                ready_tx,
            );
            if let Err(e) = res {
                eprintln!("Recording thread error: {e}");
            }
        });

        match ready_rx.recv() {
            Ok(Ok(())) => {
                *guard = Some(ActiveSession {
                    stop_flag,
                    paused_flag,
                    gain_bits,
                    output_path,
                    sample_rate: requested_sr,
                    channels: requested_ch,
                    bit_depth: requested_bd,
                    samples_written,
                    thread_handle: Some(handle),
                });
                Ok(())
            }
            Ok(Err(err)) => {
                let _ = handle.join();
                Err(AppError::Audio(err))
            }
            Err(_) => {
                let _ = handle.join();
                Err(AppError::Audio("Recorder initialization aborted".into()))
            }
        }
    }

    pub fn set_paused(&self, paused: bool) -> AppResult<()> {
        let guard = self.session.lock().expect("recorder lock");
        let sess = guard
            .as_ref()
            .ok_or_else(|| AppError::Audio("No active recording".into()))?;
        sess.paused_flag.store(paused, Ordering::Relaxed);
        Ok(())
    }

    pub fn set_input_gain(&self, gain_db: f32) -> AppResult<()> {
        let guard = self.session.lock().expect("recorder lock");
        if let Some(sess) = guard.as_ref() {
            let lin = 10f32.powf(gain_db / 20.0);
            sess.gain_bits.store(lin.to_bits(), Ordering::Relaxed);
        }
        Ok(())
    }

    pub fn stop_recording(&self) -> AppResult<RecordingFinishedInfo> {
        let mut guard = self.session.lock().expect("recorder lock");
        let mut sess = guard
            .take()
            .ok_or_else(|| AppError::Audio("No active recording".into()))?;
        sess.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = sess.thread_handle.take() {
            let _ = handle.join();
        }
        let frames = sess.samples_written.load(Ordering::Relaxed) / (sess.channels as u64).max(1);
        let duration_ms = ((frames as f64 / sess.sample_rate as f64) * 1000.0).round() as u64;
        Ok(RecordingFinishedInfo {
            output_path: sess.output_path.display().to_string(),
            duration_ms,
            sample_rate: sess.sample_rate,
            channels: sess.channels,
            bit_depth: sess.bit_depth,
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn run_capture_loop(
    device_name: Option<String>,
    out_channels: u16,
    out_sr: u32,
    bit_depth: u16,
    monitor_enabled: bool,
    output_path: &Path,
    stop_flag: Arc<AtomicBool>,
    paused_flag: Arc<AtomicBool>,
    gain_bits: Arc<AtomicU32>,
    samples_written: Arc<std::sync::atomic::AtomicU64>,
    on_telemetry: Channel<RecordingTelemetry>,
    ready_tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let host = cpal::default_host();
    let input_device = if let Some(ref wanted) = device_name {
        let clean = wanted.strip_prefix("in:").unwrap_or(wanted);
        host.input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().ok().as_deref() == Some(clean))
            .or_else(|| host.default_input_device())
    } else {
        host.default_input_device()
    }
    .ok_or_else(|| "No audio input device available".to_string())?;

    let default_cfg = input_device
        .default_input_config()
        .map_err(|e| e.to_string())?;
    let dev_channels = default_cfg.channels();
    let dev_sr = default_cfg.sample_rate().0;

    // Try matching requested sample rate if supported, else use device default and resample linearly
    let chosen_sr = if input_device
        .supported_input_configs()
        .map(|cfgs| {
            cfgs.into_iter().any(|c| {
                c.min_sample_rate().0 <= out_sr && c.max_sample_rate().0 >= out_sr
            })
        })
        .unwrap_or(false)
    {
        out_sr
    } else {
        dev_sr
    };

    let config = cpal::StreamConfig {
        channels: dev_channels,
        sample_rate: cpal::SampleRate(chosen_sr),
        buffer_size: cpal::BufferSize::Default,
    };

    let spec = WavSpec {
        channels: out_channels,
        sample_rate: out_sr,
        bits_per_sample: bit_depth,
        sample_format: if bit_depth == 32 {
            SampleFormat::Float
        } else {
            SampleFormat::Int
        },
    };
    let writer = WavWriter::new(
        BufWriter::new(File::create(output_path).map_err(|e| e.to_string())?),
        spec,
    )
    .map_err(|e| e.to_string())?;
    let writer_arc = Arc::new(Mutex::new(Some(writer)));

    // Optional live monitoring ring queue
    let (mon_tx, mon_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(32);
    let _monitor_stream = if monitor_enabled {
        host.default_output_device().and_then(|out_dev| {
            let ocfg = out_dev.default_output_config().ok()?;
            let och = ocfg.channels() as usize;
            let o_stream_cfg: cpal::StreamConfig = ocfg.into();
            let rx = Arc::new(Mutex::new(mon_rx));
            let stream = out_dev
                .build_output_stream(
                    &o_stream_cfg,
                    move |data: &mut [f32], _| {
                        let mut buf = Vec::new();
                        if let Ok(guard) = rx.try_lock() {
                            while let Ok(chunk) = guard.try_recv() {
                                buf.extend(chunk);
                            }
                        }
                        for (i, sample) in data.iter_mut().enumerate() {
                            let src_idx = (i / och) * (out_channels as usize) + (i % (out_channels as usize));
                            *sample = buf.get(src_idx).copied().unwrap_or(0.0) * 0.85;
                        }
                    },
                    |_| {},
                    None,
                )
                .ok()?;
            stream.play().ok()?;
            Some(stream)
        })
    } else {
        None
    };

    let w_clone = writer_arc.clone();
    let ratio = chosen_sr as f64 / out_sr as f64;

    let stream = input_device
        .build_input_stream(
            &config,
            move |data: &[f32], _| {
                if paused_flag.load(Ordering::Relaxed) {
                    return;
                }
                let gain = f32::from_bits(gain_bits.load(Ordering::Relaxed));
                let in_ch = dev_channels as usize;
                let total_in_frames = data.len() / in_ch;

                let mut peak_l = 0.0f32;
                let mut peak_r = 0.0f32;
                let mut sq_l = 0.0f64;
                let mut sq_r = 0.0f64;
                let mut clipping = false;
                let mut waveform = Vec::with_capacity(64);
                let mut mon_chunk = Vec::new();

                let mut guard = match w_clone.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                let Some(writer) = guard.as_mut() else {
                    return;
                };

                let out_frames = if (ratio - 1.0).abs() < 1e-4 {
                    total_in_frames
                } else {
                    ((total_in_frames as f64) / ratio).round() as usize
                };

                let step_wave = (out_frames / 32).max(1);

                for i in 0..out_frames {
                    let src_idx = if (ratio - 1.0).abs() < 1e-4 {
                        i
                    } else {
                        ((i as f64) * ratio).floor() as usize
                    }
                    .min(total_in_frames.saturating_sub(1));

                    let base = src_idx * in_ch;
                    let raw_l = data[base] * gain;
                    let raw_r = if in_ch > 1 {
                        data[base + 1] * gain
                    } else {
                        raw_l
                    };

                    if raw_l.abs() >= 0.99 || raw_r.abs() >= 0.99 {
                        clipping = true;
                    }
                    let l = raw_l.clamp(-1.0, 1.0);
                    let r = raw_r.clamp(-1.0, 1.0);

                    peak_l = peak_l.max(l.abs());
                    peak_r = peak_r.max(r.abs());
                    sq_l += (l as f64) * (l as f64);
                    sq_r += (r as f64) * (r as f64);

                    if i % step_wave == 0 && waveform.len() < 64 {
                        waveform.push(if out_channels == 1 { (l + r) * 0.5 } else { l });
                    }

                    if out_channels == 1 {
                        let mono = ((l + r) * 0.5).clamp(-1.0, 1.0);
                        write_sample(writer, mono, bit_depth);
                        if monitor_enabled {
                            mon_chunk.push(mono);
                        }
                        samples_written.fetch_add(1, Ordering::Relaxed);
                    } else {
                        write_sample(writer, l, bit_depth);
                        write_sample(writer, r, bit_depth);
                        if monitor_enabled {
                            mon_chunk.push(l);
                            mon_chunk.push(r);
                        }
                        samples_written.fetch_add(2, Ordering::Relaxed);
                    }
                }

                if monitor_enabled && !mon_chunk.is_empty() {
                    let _ = mon_tx.try_send(mon_chunk);
                }

                let n = out_frames.max(1) as f64;
                let total_f = samples_written.load(Ordering::Relaxed) / (out_channels as u64).max(1);
                let elapsed_ms = ((total_f as f64 / out_sr as f64) * 1000.0).round() as u64;

                let _ = on_telemetry.send(RecordingTelemetry {
                    peak_l,
                    peak_r: if out_channels == 1 { peak_l } else { peak_r },
                    rms_l: (sq_l / n).sqrt() as f32,
                    rms_r: if out_channels == 1 {
                        (sq_l / n).sqrt() as f32
                    } else {
                        (sq_r / n).sqrt() as f32
                    },
                    clipping,
                    elapsed_ms,
                    waveform_samples: waveform,
                });
            },
            |err| eprintln!("cpal input stream error: {err}"),
            None,
        )
        .map_err(|e| format!("Failed to open input stream: {e}"))?;

    stream.play().map_err(|e| format!("Failed to start input stream: {e}"))?;
    let _ = ready_tx.send(Ok(()));

    while !stop_flag.load(Ordering::Relaxed) {
        std::thread::sleep(std::time::Duration::from_millis(25));
    }

    drop(stream);
    if let Ok(mut guard) = writer_arc.lock() {
        if let Some(writer) = guard.take() {
            let _ = writer.finalize();
        }
    }
    Ok(())
}

#[inline]
fn write_sample(writer: &mut WavWriter<BufWriter<File>>, val: f32, bit_depth: u16) {
    match bit_depth {
        16 => {
            let s = (val * i16::MAX as f32).round() as i16;
            let _ = writer.write_sample(s);
        }
        24 => {
            let s = (val * 8_388_607.0).round() as i32;
            let _ = writer.write_sample(s);
        }
        _ => {
            let _ = writer.write_sample(val);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wasapi_device_enumeration_succeeds() {
        let mgr = RecorderManager::new();
        let devs = mgr.list_devices().expect("WASAPI host enumeration should succeed");
        // Verify entries have valid metadata if devices exist on host
        for d in &devs {
            assert!(!d.name.is_empty());
            assert!(d.kind == "input" || d.kind == "output");
            assert!(d.default_sample_rate >= 8000);
        }
    }
}
