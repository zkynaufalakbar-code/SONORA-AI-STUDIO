use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Portable storage is read-only or not writable at '{0}': {1}. Refusing to fall back to AppData.")]
    PortableReadOnly(String, String),

    #[error("FFmpeg error: {0}")]
    Ffmpeg(String),

    #[error("Audio device error: {0}")]
    Audio(String),

    #[error("AI provider error: {0}")]
    Ai(String),

    #[error("Model manager error: {0}")]
    Model(String),

    #[error("Invalid operation: {0}")]
    Invalid(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
