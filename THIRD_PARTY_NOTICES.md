# Third-Party Notices & Attributions

**SONORA AI STUDIO** source code (`src/`, `src-tauri/`, `scripts/`, `installer/`) is licensed under the **MIT License** ([LICENSE](LICENSE)).

Prebuilt binary distributions and optional runtime dependencies incorporate or invoke the following third-party software:

---

## 1. External CLI Engines (Bundled in Prebuilt Windows Releases)

### FFmpeg & FFprobe
- **Project**: https://ffmpeg.org/
- **Windows Builds**: https://www.gyan.dev/ffmpeg/builds/ (`ffmpeg-release-essentials`)
- **Integration**: Invoked exclusively as external subprocesses (`ffmpeg.exe`, `ffprobe.exe`) located in `bin/`, never statically linked into the Rust binary.
- **License**: **GPLv3 / LGPL** (depends on build flags; `gyan.dev` Essentials builds are distributed under **GPLv3**). When redistributing prebuilt Windows installers or portable ZIP archives that bundle `ffmpeg.exe` / `ffprobe.exe`, the FFmpeg GPLv3 terms apply to those bundled binaries.

### Inno Setup (Installer Packaging Only)
- **Project**: https://jrsoftware.org/isinfo.php
- **Usage**: Compiles `installer/sonora-setup.iss` into `SONORA-AI-Studio-Setup.exe`.

---

## 2. Core Application Libraries

### Rust Backend Crates (`src-tauri/Cargo.toml`)
- `tauri` / `tauri-plugin-dialog` / `tauri-plugin-fs` / `tauri-plugin-shell` (Apache-2.0 / MIT)
- `rusqlite` (`bundled` SQLite, MIT)
- `cpal` (Apache-2.0) — native WASAPI audio capture
- `hound` (Apache-2.0) — streaming WAV reading/writing
- `rustfft` (MIT / Apache-2.0) — STFT spectrogram & cross-correlation FFT
- `aes-gcm`, `keyring`, `sha2`, `rand`, `hex`, `base64` (MIT / Apache-2.0)
- `reqwest`, `tokio`, `serde`, `serde_json`, `chrono`, `uuid`, `zip`, `walkdir`, `dirs`, `raw-cpuid` (MIT / Apache-2.0)

### Frontend Dependencies (`package.json`)
- `React` & `React DOM` (MIT)
- `Vite`, `TypeScript`, `Tailwind CSS` (MIT / Apache-2.0)
- `Zustand`, `Immer`, `clsx`, `tailwind-merge` (MIT)
- `Radix UI` primitives & `Lucide Icons` (MIT / ISC)

---

## 3. Optional On-Demand AI Models & Runtimes

Models are **not** bundled in the repository or installers; users download only what they choose via the in-app **AI Model Manager**:

- **RNNoise (`sh.rnnn`)**: https://github.com/GregorR/rnnoise-models (BSD-3-Clause)
- **whisper.cpp GGML Models (`ggml-tiny.bin`, `ggml-base.bin`)**: https://github.com/ggerganov/whisper.cpp (MIT)
- **Demucs (`htdemucs`)**: https://github.com/facebookresearch/demucs (MIT)
- **DeepFilterNet3**: https://github.com/Rikorose/DeepFilterNet (MIT / Apache-2.0)
- **YAMNet (`YamNet.onnx`)**: Apache-2.0
