<div align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="SONORA AI STUDIO Logo" width="84" height="84" />
  <h1>SONORA AI STUDIO</h1>
  <p><strong>Lightweight, Offline-First Professional Audio Editor & Modular AI Studio for Windows</strong></p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-3B82F6.svg?style=flat-square" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/Tauri-2.x-22D3EE?style=flat-square" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/React-19%20%2B%20TypeScript-3B82F6?style=flat-square" alt="React 19" />
    <img src="https://img.shields.io/badge/Rust%20%2B%20FFmpeg-9.x-8B5CF6?style=flat-square" alt="Rust + FFmpeg" />
    <img src="https://img.shields.io/badge/Distribution-Installer%20%26%20Portable-10B981?style=flat-square" alt="Installer & Portable" />
  </p>
</div>

---

## What Is SONORA AI STUDIO?

**SONORA AI STUDIO** is a fast, native desktop Digital Audio Workstation (DAW) built on **Tauri 2, Rust, React 19, Web Audio API, and FFmpeg**. Instead of bundling a heavy Chromium runtime like Electron (~200+ MB baseline), SONORA pairs a compact **12.9 MB** native Rust binary with Windows WebView2 and streaming disk-to-AudioWorklet playback so multi-hour audio files open cleanly without bloating RAM.

Every button executes real DSP or FFmpeg processing — combining classic multi-track timeline precision, 25 studio effects, STFT spectral repair, WASAPI recording, podcast production workflows, and an optional, on-demand AI toolchain into a clean dark-graphite interface.

---

## Key Features

### Multi-Track Timeline & Core Editing
- **Non-Destructive Timeline**: Unlimited multi-track lanes, multi-resolution Canvas waveforms (`4`-level binary `SNPK` peak pyramid), ruler scrubbers, snap-to-grid, loop regions, and full undo/redo history.
- **Clip Operations**: Cut, Copy, Paste, Delete / Ripple Delete, Split (razor tool / `S`), Trim, Crop, Duplicate, Silence insertion, Fade In / Fade Out handles, Reverse, Normalize, Amplify, Pitch Shift, and Time Stretch (`0.25x–4.0x`).
- **Routing & Alignment**: Stereo / Mono Sum / Left-Only / Right-Only channel control, crossfade overlaps (`s_curve`), per-clip & per-track gain/pan, and **FFT cross-correlation clip alignment**.

### 25 Studio Effects & Real-Time Live Meters
Every effect runs live in **Web Audio API** during playback and renders losslessly through **FFmpeg filtergraphs** on export:
- **Dynamics**: Compressor, Lookahead Limiter, Expander, Noise Gate
- **Equalizer**: 3-Band EQ, 5-Band EQ, 10-Band Graphic EQ, interactive Parametric EQ (`Highpass`, `Lowpass`, `Peaking`, `Low Shelf`, `High Shelf`)
- **Modulation & Spatial**: Convolution Reverb, Delay, Echo, Chorus, Flanger, Phaser, Mid/Side Stereo Widener
- **Restoration**: Adaptive FFT Noise Reduction, De-Click, De-Clip, 50/60 Hz De-Hum, De-Esser, Background Noise Remover
- **Metering**: Left/Right dBFS peak/RMS meters, integrated loudness estimate (`LUFS`), clipping indicator, and live FFT spectrum analyzer.

### STFT Spectral View & Dedicated Workspaces
- **Spectral Frequency Editor**: Log-scale `20 Hz–20 kHz` 2048-point Hann STFT heatmap with drag-box selection to attenuate or notch localized clicks, buzz, or mic bumps (`-18 dB` / `-36 dB`).
- **WASAPI Studio Recording Booth**: Low-latency native Rust microphone and USB interface capture (`cpal` + `hound` 16/24/32-bit WAV) with live oscilloscope & direct monitoring.
- **Podcast Production Mode**: One-click Host/Guest/Music lanes, broadcast vocal chain, dead-air pause scanner, transcript sync editor, and `-16 LUFS` mastering presets.

### Modular AI Audio Suite (Offline-First)
AI weights are separated from the base binary and managed through the **AI Model Manager** (`Download`, `Pause/Resume`, `SHA-256 Verify`, `Update`, `Remove`, `Custom Directory`):
- **AI Noise Removal**: Offline FFmpeg `afftdn` + optional **RNNoise (`arnndn`)** neural model for fan, AC, traffic, and room noise.
- **AI Voice Enhancement & Isolation**: Mud attenuation, presence shaping, de-essing, loudness normalization, and speaker gate isolation.
- **AI Vocal / Stem Separation**: Runs locally via optional `Demucs` runtime (`htdemucs`) separating vocals, instrumental, bass, and drums.
- **AI Silence Removal**: Configurable dBFS threshold + minimum pause duration scanner & batch removal.
- **AI Audio Transcription**: Local `whisper-cli` / `faster-whisper` or cloud OpenAI Whisper with timestamps and **`.srt` / `.txt` export**.
- **AI Audio Assistant**: Chat assistant that inspects real audio telemetry (`peak`, `RMS`, `noise floor`, `clipping`, `silence ratio`, `low/high energy`) and proposes executable editing/FX action plans.

---

## Dual Distribution Architecture (Single Codebase)

SONORA builds **two official Windows editions** from the exact same source code and feature set:

| Edition | Trigger | Storage & Behavior |
| :--- | :--- | :--- |
| **Installer Edition** (`SONORA-AI-Studio-Setup.exe`) | No `portable.flag` | Installs binaries to `{app}` via Inno Setup 6 with Desktop/Start Menu shortcuts, `.sonora` file association, WebView2 check, uninstaller, and upgrades that preserve user data in `%APPDATA%\SONORA AI STUDIO`, `%LOCALAPPDATA%\SONORA AI STUDIO`, and `Documents`. |
| **Portable Edition** (`SONORA-AI-Studio-Portable.zip`) | `portable.flag` beside `.exe` | Zero installation, zero registry writes, zero `AppData` writes. Uses `SONORA-AI-Studio-Portable.exe` launcher for atomic `.exe.new` updates, self-contained `config/`, `cache/webview2/`, `projects/`, `models/`, `exports/`, and `logs/`, drive-letter-independent `${PORTABLE_ROOT}` paths, and **strict read-only error abort** (never silently falls back to `AppData`). |

```text
SONORA-AI-Studio-Portable/
├── SONORA-AI-Studio-Portable.exe   # Launcher (writable probe + atomic .exe.new swap)
├── SONORA-AI-Studio.exe            # Main Tauri application binary
├── portable.flag                   # Activates strict Portable Mode
├── bin/                            # Bundled FFmpeg & FFprobe engine
├── config/                         # SQLite DB (sonora.db), settings, AES-256-GCM vault
├── projects/                       # Default .sonora project storage
├── cache/                          # Multi-res .peaks, intermediate renders, WebView2 cache
├── presets/                        # User & factory FX chains
├── plugins/                        # Optional external plugins directory
├── models/                         # On-demand AI model storage
├── exports/                        # Default audio export output folder
└── logs/                           # Runtime diagnostic logs (sonora.log)
```

---

## Verified 60-Minute Large-File Benchmark

Measured in release mode on a real **60-minute (659.18 MB, 48 kHz stereo PCM)** WAV file:

| Stage | Result |
| :--- | :--- |
| `probe_audio_file` (`ffprobe` + head/tail 64 KB SHA-256) | **943.08 ms** |
| `generate_peak_pyramid` (4-level `SNPK`, `41.04 MB` `.peaks` output) | **5,869.21 ms** |
| `read_waveform_window` (full 60-min overview, 1,200 bins) | **15.23 ms** |
| `read_waveform_window` (5-sec deep zoom at `45:00`, 1,200 bins) | **0.41 ms** |
| `read_pcm_chunk` (seek 2s stereo slice at `45:00` for AudioWorklet) | **175.51 ms** |

---

## Installation & Usage

### Option A: Prebuilt Windows Releases (Recommended)
1. Download **`SONORA-AI-Studio-Setup.exe`** (Installer) or **`SONORA-AI-Studio-Portable.zip`** (Portable) from [**GitHub Releases**](https://github.com/zkynaufalakbar-code/SONORA-AI-STUDIO/releases).
2. For Portable Edition: extract to any writable USB drive, SSD, or folder and launch **`SONORA-AI-Studio-Portable.exe`**.
3. Open **AI Models** inside the app to download only the optional models you need (`rnnoise-std`, `whisper-tiny`/`base`, `demucs-htdemucs`, etc.).

### Option B: Build from Source

**Prerequisites (Windows 10/11 x64):**
- Node.js 20+ & npm
- Rust (`stable-x86_64-pc-windows-msvc`) + Visual Studio Build Tools
- FFmpeg & FFprobe (`ffmpeg.exe`, `ffprobe.exe` in `PATH`)
- Inno Setup 6 *(optional, for compiling `SONORA-AI-Studio-Setup.exe`)*

```powershell
# Clone the repository
git clone https://github.com/zkynaufalakbar-code/SONORA-AI-STUDIO.git
cd SONORA-AI-STUDIO

# Install frontend packages & launch dev desktop window
npm install
npm run tauri dev

# Run frontend & Rust test suites
npm run build
npm test
cd src-tauri && cargo test --no-fail-fast && cd ..

# Package both Windows Installer & Portable ZIP into ./release
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-dist.ps1 -Target all
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause |
| `Home` | Jump playhead to start |
| `V` / `R` / `C` / `T` | Tools: Select / Range / Razor / Time Stretch |
| `S` | Split clip at playhead |
| `L` | Toggle Loop playback |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / Cut / Paste at playhead |
| `Delete` / `Shift+Delete` | Delete clip / Ripple Delete |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` / `Ctrl+N` | Save Project / New Project |

---

## Technology Stack

- **Desktop & Backend**: Tauri 2, Rust (`rusqlite` SQLite WAL, `cpal` WASAPI, `hound`, `rustfft`, `aes-gcm`, `keyring`, `reqwest`, `zip`)
- **Audio Processing**: Web Audio API (`AudioWorklet`, Biquad, Dynamics, Delay, StereoPanner, Convolver) + FFmpeg / FFprobe
- **Frontend UI**: React 19, TypeScript 5.7, Vite 7, Tailwind CSS v4, Zustand + Immer, Radix UI, Lucide Icons, HTML5 Canvas

---

## Repository Layout

```text
SONORA-AI-STUDIO/
├── .github/                  # CI & automated Windows Release workflows + issue templates
├── installer/                # Inno Setup 6 script (sonora-setup.iss)
├── public/worklets/          # AudioWorklet streaming processor
├── scripts/                  # Dual-distribution packager (build-dist.ps1)
├── src/                      # React + TypeScript DAW workspace UI, Canvas & Web Audio engine
└── src-tauri/                # Rust Tauri backend, SQLite, AI providers/models, WASAPI & portable launcher
```

---

## Contributing, Security & Licensing

- Contributions welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Report security issues privately per [SECURITY.md](SECURITY.md).
- Source code is licensed under the **MIT License** ([LICENSE](LICENSE)). Prebuilt binary releases include third-party sidecars documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
