#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs::OpenOptions;
use std::path::Path;
use std::process::Command;

fn show_error(msg: &str) {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "user32")]
        extern "system" {
            fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, utype: u32) -> i32;
        }
        let text: Vec<u16> = OsStr::new(msg).encode_wide().chain(std::iter::once(0)).collect();
        let cap: Vec<u16> = OsStr::new("SONORA AI STUDIO - Portable Error")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            MessageBoxW(0, text.as_ptr(), cap.as_ptr(), 0x10);
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("{msg}");
    }
}

fn main() {
    let exe_path = match env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            show_error(&format!("Failed to locate launcher path: {e}"));
            std::process::exit(1);
        }
    };

    let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));
    let flag_path = exe_dir.join("portable.flag");

    // Verify writable portable directory strictly before launch (never silently fall back to AppData)
    let probe_path = exe_dir.join(".sonora_launcher_probe");
    if let Err(e) = OpenOptions::new().create(true).write(true).truncate(true).open(&probe_path) {
        show_error(&format!(
            "Portable folder is not writable ({}):\n{e}\n\nMove SONORA Portable to a writable drive or folder.",
            exe_dir.display()
        ));
        std::process::exit(1);
    }
    let _ = std::fs::remove_file(&probe_path);

    if !flag_path.exists() {
        let _ = std::fs::write(&flag_path, "mode=portable\n");
    }

    let main_exe = exe_dir.join("SONORA-AI-Studio.exe");
    let staged_exe = exe_dir.join("SONORA-AI-Studio.exe.new");
    let backup_exe = exe_dir.join("SONORA-AI-Studio.exe.old");
    if staged_exe.is_file() {
        let _ = std::fs::remove_file(&backup_exe);
        if main_exe.is_file() {
            let _ = std::fs::rename(&main_exe, &backup_exe);
        }
        if std::fs::rename(&staged_exe, &main_exe).is_ok() {
            let _ = std::fs::remove_file(&backup_exe);
        } else if backup_exe.is_file() && !main_exe.is_file() {
            let _ = std::fs::rename(&backup_exe, &main_exe);
        }
    }

    if !main_exe.exists() {
        show_error(&format!(
            "Missing main executable: {}\nPlease extract the complete SONORA-AI-Studio-Portable archive.",
            main_exe.display()
        ));
        std::process::exit(1);
    }

    let mut cmd = Command::new(&main_exe);
    cmd.current_dir(exe_dir);
    cmd.env("SONORA_PORTABLE", "1");
    for arg in env::args_os().skip(1) {
        cmd.arg(arg);
    }

    if let Err(e) = cmd.spawn() {
        show_error(&format!("Failed to launch SONORA-AI-Studio.exe: {e}"));
        std::process::exit(1);
    }
}
