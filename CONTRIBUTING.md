# Contributing to SONORA AI STUDIO

Thank you for your interest in contributing to **SONORA AI STUDIO**!

---

## Development Prerequisites (Windows)

1. **Node.js 20+** and **npm**
2. **Rust Toolchain** (`stable-x86_64-pc-windows-msvc` via [rustup](https://rustup.rs/)) + MSVC Build Tools & Windows SDK (with **Microsoft Edge WebView2**, pre-installed on Windows 10/11)
3. **FFmpeg & FFprobe** (v6+ / 9.x) available in `PATH` or placed under `src-tauri/bin/` during dev
4. *(Optional, for packaging setup EXEs)* **Inno Setup 6** (`ISCC.exe`)

---

## Local Development Setup

```powershell
# 1. Install frontend dependencies
npm install

# 2. Start full Tauri desktop app in dev mode (Vite HMR + Rust backend)
npm run tauri dev
```

---

## Running Checks & Tests

Before opening a pull request, ensure all frontend, Rust, and integration checks pass:

```powershell
# Frontend TypeScript check + Vite build + Vitest store unit tests
npm run build
npm test

# Rust unit + live FFmpeg filtergraph, peak pyramid, SQLite & crypto vault tests
cd src-tauri
cargo test --no-fail-fast

# Verify Portable Launcher builds cleanly
cargo check --manifest-path portable-launcher/Cargo.toml
```

### Building Distribution Artifacts

```powershell
# Builds SONORA-AI-Studio-Setup.exe (Installer) & SONORA-AI-Studio-Portable.zip (Portable)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-dist.ps1 -Target all
```

---

## Coding & Architecture Guidelines

- **Offline-First & Parity**: Every editing/FX feature must implement both live Web Audio playback ([audioEngine.ts](src/audio/audioEngine.ts)) and lossless FFmpeg export mapping ([filtergraph.rs](src-tauri/src/ffmpeg/filtergraph.rs)).
- **Portable Strictness**: Never bypass [`RuntimePaths`](src-tauri/src/paths.rs) or hardcode `AppData` paths. In Portable Mode (`portable.flag` present), unwritable folders must fail explicitly rather than falling back silently.
- **No Unapproved Assets**: Never commit `node_modules/`, `dist/`, `target/`, `release/`, local `.db` databases, or `.env`/secret files.

---

## Pull Request Process

1. Fork the repository and create a branch from `main` (e.g. `feat/spectral-repair` or `fix/waveform-zoom`).
2. Keep commits focused with clear messages.
3. Fill out the PR template checklist including manual verification notes.
