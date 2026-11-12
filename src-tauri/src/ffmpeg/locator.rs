use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegCapabilities {
    pub available: bool,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
    pub has_rubberband: bool,
    pub has_afftdn: bool,
    pub has_arnndn: bool,
    pub has_loudnorm: bool,
    pub has_deesser: bool,
    pub has_adeclick: bool,
    pub has_adeclip: bool,
}

pub fn new_hidden_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn locate_binary(exe_dir: &Path, custom_path: Option<&str>, name: &str) -> Option<PathBuf> {
    let file_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    // 1. User configured path
    if let Some(custom) = custom_path.filter(|s| !s.trim().is_empty()) {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Some(p);
        }
        if p.is_dir() && p.join(&file_name).is_file() {
            return Some(p.join(&file_name));
        }
    }

    // 2. Relative bundled bin/ alongside exe (Portable & Installer sidecar)
    let bin_candidate = exe_dir.join("bin").join(&file_name);
    if bin_candidate.is_file() {
        return Some(bin_candidate);
    }

    // 3. Tauri resources/bin/
    let res_candidate = exe_dir.join("resources").join("bin").join(&file_name);
    if res_candidate.is_file() {
        return Some(res_candidate);
    }

    // 4. Directly beside exe
    let same_dir = exe_dir.join(&file_name);
    if same_dir.is_file() {
        return Some(same_dir);
    }

    // 5. System PATH
    find_in_path(&file_name)
}

fn find_in_path(binary_name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn probe_ffmpeg(exe_dir: &Path, custom_ffmpeg_dir_or_exe: Option<&str>) -> FfmpegCapabilities {
    let ffmpeg = locate_binary(exe_dir, custom_ffmpeg_dir_or_exe, "ffmpeg");
    let ffprobe = locate_binary(
        exe_dir,
        custom_ffmpeg_dir_or_exe.and_then(|s| {
            let p = Path::new(s);
            if p.is_file() {
                p.parent().map(|d| d.to_str().unwrap_or_default())
            } else {
                Some(s)
            }
        }),
        "ffprobe",
    );

    let Some(ffmpeg_bin) = ffmpeg else {
        return FfmpegCapabilities {
            available: false,
            ffmpeg_path: None,
            ffprobe_path: ffprobe.map(|p| p.display().to_string()),
            version: None,
            has_rubberband: false,
            has_afftdn: false,
            has_arnndn: false,
            has_loudnorm: false,
            has_deesser: false,
            has_adeclick: false,
            has_adeclip: false,
        };
    };

    let version = new_hidden_command(&ffmpeg_bin)
        .arg("-version")
        .output()
        .ok()
        .and_then(|out| {
            let text = String::from_utf8_lossy(&out.stdout);
            text.lines().next().map(|l| l.trim().to_string())
        });

    let filters_text = new_hidden_command(&ffmpeg_bin)
        .args(["-hide_banner", "-filters"])
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
        .unwrap_or_default();

    FfmpegCapabilities {
        available: version.is_some(),
        ffmpeg_path: Some(ffmpeg_bin.display().to_string()),
        ffprobe_path: ffprobe.map(|p| p.display().to_string()),
        version,
        has_rubberband: filters_text.contains(" rubberband "),
        has_afftdn: filters_text.contains(" afftdn "),
        has_arnndn: filters_text.contains(" arnndn "),
        has_loudnorm: filters_text.contains(" loudnorm "),
        has_deesser: filters_text.contains(" deesser "),
        has_adeclick: filters_text.contains(" adeclick "),
        has_adeclip: filters_text.contains(" adeclip "),
    }
}
