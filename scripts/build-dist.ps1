param(
    [ValidateSet("all", "installer", "portable")]
    [string]$Target = "all",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ReleaseDir = Join-Path $Root "release"
$SrcTauri = Join-Path $Root "src-tauri"
$PortableLauncherDir = Join-Path $SrcTauri "portable-launcher"

# Ensure Rust toolchain on E: is prioritized without baking absolute paths into output binaries
$env:RUSTUP_HOME = if ($env:RUSTUP_HOME) { $env:RUSTUP_HOME } else { "E:\.rustup" }
$env:CARGO_HOME = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { "E:\.cargo" }
$CargoBin = Join-Path $env:CARGO_HOME "bin"
if (Test-Path $CargoBin) {
    $env:PATH = "$CargoBin;$env:PATH"
}

function Find-SystemBinary {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) {
        $src = $cmd.Source
        $item = Get-Item $src -ErrorAction SilentlyContinue
        if ($item -and $item.LinkType -and $item.Target) {
            return $item.Target[0]
        }
        # WinGet links may be reparse/exe shims; check winget packages folder if tiny shim
        if ((Get-Item $src).Length -lt 1048576) {
            $wgPkg = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Recurse -Filter "$Name.exe" -ErrorAction SilentlyContinue |
                Sort-Object Length -Descending | Select-Object -First 1
            if ($wgPkg) { return $wgPkg.FullName }
        }
        return $src
    }
    throw "Required dependency '$Name.exe' not found in PATH or WinGet packages."
}

function Find-Iscc {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    $inPath = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }
    throw "Inno Setup 6 (ISCC.exe) not found."
}

New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null

$FfmpegExe = Find-SystemBinary -Name "ffmpeg"
$FfprobeExe = Find-SystemBinary -Name "ffprobe"
Write-Host "Using FFmpeg:  $FfmpegExe"
Write-Host "Using FFprobe: $FfprobeExe"

if (-not $SkipBuild) {
    Push-Location $Root
    try {
        Write-Host "`n[1/4] Building Frontend (Vite + TypeScript)..."
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

        Write-Host "`n[2/4] Building Main Tauri Binary (SONORA-AI-Studio.exe)..."
        npx tauri build --no-bundle
        if ($LASTEXITCODE -ne 0) { throw "Tauri release binary build failed" }

        Write-Host "`n[3/4] Building Portable Launcher (SONORA-AI-Studio-Portable.exe)..."
        cargo build --release --manifest-path (Join-Path $PortableLauncherDir "Cargo.toml")
        if ($LASTEXITCODE -ne 0) { throw "Portable launcher build failed" }
    }
    finally {
        Pop-Location
    }
}

$MainExe = Join-Path $SrcTauri "target\release\SONORA-AI-Studio.exe"
if (-not (Test-Path $MainExe)) {
    throw "Main binary missing at $MainExe"
}

$LauncherExe = Join-Path $PortableLauncherDir "target\release\SONORA-AI-Studio-Portable.exe"
if (-not (Test-Path $LauncherExe)) {
    throw "Portable launcher binary missing at $LauncherExe"
}

# --- PORTABLE EDITION ---
if ($Target -eq "all" -or $Target -eq "portable") {
    Write-Host "`n[4a] Packaging SONORA AI STUDIO Portable Edition..."
    $PortableRoot = Join-Path $ReleaseDir "SONORA-AI-Studio-Portable"
    if (Test-Path $PortableRoot) { Remove-Item -Recurse -Force $PortableRoot }

    $Dirs = @("bin", "config", "projects", "cache", "presets", "plugins", "models", "exports", "logs")
    New-Item -ItemType Directory -Force -Path $PortableRoot | Out-Null
    foreach ($d in $Dirs) {
        New-Item -ItemType Directory -Force -Path (Join-Path $PortableRoot $d) | Out-Null
    }

    Copy-Item $MainExe (Join-Path $PortableRoot "SONORA-AI-Studio.exe") -Force
    Copy-Item $LauncherExe (Join-Path $PortableRoot "SONORA-AI-Studio-Portable.exe") -Force
    Copy-Item $FfmpegExe (Join-Path $PortableRoot "bin\ffmpeg.exe") -Force
    Copy-Item $FfprobeExe (Join-Path $PortableRoot "bin\ffprobe.exe") -Force

    Set-Content -Path (Join-Path $PortableRoot "portable.flag") -Value @"
# SONORA AI STUDIO - PORTABLE MODE FLAG
# Keep this file beside SONORA-AI-Studio.exe to run in zero-install Portable Mode.
# All settings, SQLite database, cache, projects, AI models, exports, and logs stay inside this folder.
mode=portable
"@

    Set-Content -Path (Join-Path $PortableRoot "README.txt") -Value @"
====================================================================
SONORA AI STUDIO v1.0.0 - PORTABLE EDITION
Lightweight Professional Audio Editor with Modular AI
====================================================================

HOW TO RUN:
- Double-click SONORA-AI-Studio-Portable.exe (or SONORA-AI-Studio.exe).
- Can run directly from USB flash drives, external SSDs, hard disks,
  or synced folders with ZERO installation and ZERO admin rights.

PORTABLE FOLDER STRUCTURE:
- SONORA-AI-Studio-Portable.exe : Launcher
- SONORA-AI-Studio.exe          : Main Application
- portable.flag                 : Activates self-contained Portable Mode
- bin\                          : Bundled FFmpeg & FFprobe engine
- config\                       : Settings, SQLite DB, & encrypted API vault
- projects\                     : Default project files (.sonora)
- cache\                        : Peaks, renders, & WebView2 local cache
- presets\                      : Custom audio FX chains & presets
- plugins\                      : External plugins directory
- models\                       : Downloaded offline AI models
- exports\                      : Default audio exports folder
- logs\                         : Application diagnostic logs

NOTES:
1. Drive letters can change freely across PCs; SONORA stores paths
   relative to `${PORTABLE_ROOT}`.
2. If this folder is read-only, SONORA halts cleanly with an error
   and never silently saves data into AppData.
3. AI Models are NOT bundled to keep the portable package lightweight;
   download only what you need from AI Models inside the app.
"@

    $PortableZip = Join-Path $ReleaseDir "SONORA-AI-Studio-Portable.zip"
    if (Test-Path $PortableZip) { Remove-Item -Force $PortableZip }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($PortableRoot, $PortableZip, [System.IO.Compression.CompressionLevel]::Optimal, $true)
    Write-Host "Created Portable ZIP: $PortableZip ($([math]::Round((Get-Item $PortableZip).Length / 1MB, 2)) MB)"
}

# --- INSTALLER EDITION ---
if ($Target -eq "all" -or $Target -eq "installer") {
    Write-Host "`n[4b] Packaging SONORA AI STUDIO Windows Installer Edition..."
    $StagingDir = Join-Path $ReleaseDir ".staging-installer"
    if (Test-Path $StagingDir) { Remove-Item -Recurse -Force $StagingDir }
    New-Item -ItemType Directory -Force -Path (Join-Path $StagingDir "bin") | Out-Null

    Copy-Item $MainExe (Join-Path $StagingDir "SONORA-AI-Studio.exe") -Force
    Copy-Item $FfmpegExe (Join-Path $StagingDir "bin\ffmpeg.exe") -Force
    Copy-Item $FfprobeExe (Join-Path $StagingDir "bin\ffprobe.exe") -Force

    $Iscc = Find-Iscc
    $IssFile = Join-Path $Root "installer\sonora-setup.iss"
    & $Iscc $IssFile
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed" }

    $SetupExe = Join-Path $ReleaseDir "SONORA-AI-Studio-Setup.exe"
    Write-Host "Created Installer EXE: $SetupExe ($([math]::Round((Get-Item $SetupExe).Length / 1MB, 2)) MB)"

    # Optional MSI if WiX is present
    $hasWix = (Get-Command wix.exe -ErrorAction SilentlyContinue) -or (Get-Command candle.exe -ErrorAction SilentlyContinue)
    if ($hasWix) {
        Write-Host "WiX Toolset detected -> building optional .msi installer..."
        Push-Location $Root
        try {
            npx tauri build --bundles msi
            Get-ChildItem (Join-Path $SrcTauri "target\release\bundle\msi\*.msi") -ErrorAction SilentlyContinue |
                ForEach-Object { Copy-Item $_.FullName (Join-Path $ReleaseDir "SONORA-AI-Studio.msi") -Force }
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "Optional .msi skipped (WiX Toolset not installed; Setup .exe created cleanly via Inno Setup 6)."
    }

    Remove-Item -Recurse -Force $StagingDir -ErrorAction SilentlyContinue
}

Write-Host "`nDual Distribution Build Complete! Artifacts in $ReleaseDir"
Get-ChildItem $ReleaseDir | Select-Object Name, @{N="SizeMB";E={[math]::Round($_.Length / 1MB, 2)}}
