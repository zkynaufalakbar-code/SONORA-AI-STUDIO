# Security Policy

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `1.0.x` | Yes |

---

## Security & Privacy Architecture

**SONORA AI STUDIO** prioritizes local-first processing:

1. **Zero Telemetry**: Audio files, waveform caches, STFT tiles, and SQLite project databases remain strictly on your device unless you explicitly opt into a cloud AI feature.
2. **API Key Storage**:
   - **Installer Edition**: Cloud API keys (OpenAI / Gemini) are stored in the OS **Windows Credential Manager** via Rust [`keyring`](src-tauri/src/ai/secrets.rs).
   - **Portable Edition**: Cloud API keys are encrypted locally inside `config/credentials.vault` using **AES-256-GCM** with hardware/portable key derivation so zero secrets touch the Windows registry or `AppData`.
3. **Portable Isolation**: When `portable.flag` is detected beside `SONORA-AI-Studio.exe`, WebView2 cache (`cache/webview2/`), SQLite config, projects, models, and logs remain strictly within the portable folder. Unwritable roots abort cleanly without silent fallback.
4. **Checksum Verification**: Optional AI models downloaded through the Model Manager verify SHA-256 checksums when digests are supplied.

---

## Reporting a Vulnerability

If you discover a security issue (for example path traversal, zip-slip in portable updates, credential exposure, or arbitrary command execution via FFmpeg filtergraphs or filenames):

1. **Do not** disclose exploit details in a public GitHub Issue before a fix is available.
2. Open a **Private Security Advisory** on GitHub (**Security → Advisories → Report a vulnerability**) or contact the maintainer (`kurcaci.zaky778@gmail.com`) with reproduction steps and affected versions.
3. Include minimal reproduction details (input filename/filter/steps, distribution mode: Installer vs Portable).

We aim to acknowledge reports within **72 hours** and ship coordinated patches cleanly.
