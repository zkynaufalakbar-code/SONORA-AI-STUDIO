use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::paths::{DistributionMode, RuntimePaths};

const SERVICE_NAME: &str = "SONORA_AI_STUDIO";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PortableVault {
    salt_b64: String,
    entries: HashMap<String, EncryptedSecret>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EncryptedSecret {
    nonce_b64: String,
    cipher_b64: String,
}

fn derive_portable_key(salt: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"SONORA_PORTABLE_VAULT_V1:");
    hasher.update(salt);
    let out = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&out);
    key
}

fn vault_path(paths: &RuntimePaths) -> std::path::PathBuf {
    paths.config_dir.join("credentials.vault")
}

fn load_vault(path: &Path) -> AppResult<PortableVault> {
    if !path.is_file() {
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        return Ok(PortableVault {
            salt_b64: B64.encode(salt),
            entries: HashMap::new(),
        });
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_api_key(paths: &RuntimePaths, provider_id: &str, api_key: &str) -> AppResult<()> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return delete_api_key(paths, provider_id);
    }

    match paths.mode {
        DistributionMode::Installer => {
            let entry = keyring::Entry::new(SERVICE_NAME, provider_id)
                .map_err(|e| AppError::Ai(format!("Keyring init failed: {e}")))?;
            entry
                .set_password(trimmed)
                .map_err(|e| AppError::Ai(format!("Failed to store API key in OS Credential Manager: {e}")))?;
            Ok(())
        }
        DistributionMode::Portable => {
            let vp = vault_path(paths);
            let mut vault = load_vault(&vp)?;
            let salt = B64
                .decode(&vault.salt_b64)
                .map_err(|e| AppError::Ai(format!("Corrupt vault salt: {e}")))?;
            let key = derive_portable_key(&salt);
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|e| AppError::Ai(format!("Cipher init error: {e}")))?;

            let mut nonce_bytes = [0u8; 12];
            rand::thread_rng().fill_bytes(&mut nonce_bytes);
            let nonce = Nonce::from_slice(&nonce_bytes);

            let encrypted = cipher
                .encrypt(nonce, trimmed.as_bytes())
                .map_err(|e| AppError::Ai(format!("Encryption error: {e}")))?;

            vault.entries.insert(
                provider_id.to_string(),
                EncryptedSecret {
                    nonce_b64: B64.encode(nonce_bytes),
                    cipher_b64: B64.encode(encrypted),
                },
            );
            fs::write(&vp, serde_json::to_string_pretty(&vault)?)?;
            Ok(())
        }
    }
}

pub fn get_api_key(paths: &RuntimePaths, provider_id: &str) -> AppResult<Option<String>> {
    match paths.mode {
        DistributionMode::Installer => {
            let entry = keyring::Entry::new(SERVICE_NAME, provider_id)
                .map_err(|e| AppError::Ai(format!("Keyring error: {e}")))?;
            match entry.get_password() {
                Ok(val) => Ok(Some(val)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(AppError::Ai(format!("Keyring read error: {e}"))),
            }
        }
        DistributionMode::Portable => {
            let vp = vault_path(paths);
            if !vp.is_file() {
                return Ok(None);
            }
            let vault = load_vault(&vp)?;
            let Some(item) = vault.entries.get(provider_id) else {
                return Ok(None);
            };
            let salt = B64
                .decode(&vault.salt_b64)
                .map_err(|e| AppError::Ai(format!("Corrupt vault salt: {e}")))?;
            let key = derive_portable_key(&salt);
            let cipher = Aes256Gcm::new_from_slice(&key)
                .map_err(|e| AppError::Ai(format!("Cipher error: {e}")))?;
            let nonce_bytes = B64
                .decode(&item.nonce_b64)
                .map_err(|e| AppError::Ai(format!("Invalid nonce: {e}")))?;
            let cipher_bytes = B64
                .decode(&item.cipher_b64)
                .map_err(|e| AppError::Ai(format!("Invalid ciphertext: {e}")))?;
            let plain = cipher
                .decrypt(Nonce::from_slice(&nonce_bytes), cipher_bytes.as_slice())
                .map_err(|e| AppError::Ai(format!("Vault decrypt error: {e}")))?;
            let text = String::from_utf8(plain)
                .map_err(|e| AppError::Ai(format!("UTF-8 error: {e}")))?;
            Ok(Some(text))
        }
    }
}

pub fn delete_api_key(paths: &RuntimePaths, provider_id: &str) -> AppResult<()> {
    match paths.mode {
        DistributionMode::Installer => {
            if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, provider_id) {
                let _ = entry.delete_credential();
            }
            Ok(())
        }
        DistributionMode::Portable => {
            let vp = vault_path(paths);
            if !vp.is_file() {
                return Ok(());
            }
            let mut vault = load_vault(&vp)?;
            vault.entries.remove(provider_id);
            fs::write(&vp, serde_json::to_string_pretty(&vault)?)?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_vault_encrypts_and_roundtrips_api_key() {
        let dir = std::env::temp_dir().join(format!("sonora_vault_{}", uuid::Uuid::new_v4()));
        let paths = RuntimePaths {
            mode: DistributionMode::Portable,
            exe_dir: dir.clone(),
            config_dir: dir.join("config"),
            projects_dir: dir.join("projects"),
            cache_dir: dir.join("cache"),
            presets_dir: dir.join("presets"),
            plugins_dir: dir.join("plugins"),
            models_dir: dir.join("models"),
            exports_dir: dir.join("exports"),
            logs_dir: dir.join("logs"),
            db_path: dir.join("config").join("sonora.db"),
            is_writable: true,
            write_error: None,
        };
        fs::create_dir_all(&paths.config_dir).unwrap();

        let raw_secret = "sonora-test-portable-vault-value-987654";
        save_api_key(&paths, "openai", raw_secret).unwrap();

        let disk_raw = fs::read_to_string(paths.config_dir.join("credentials.vault")).unwrap();
        assert!(!disk_raw.contains(raw_secret), "Secret must not appear in plaintext on disk");

        let read_back = get_api_key(&paths, "openai").unwrap();
        assert_eq!(read_back.as_deref(), Some(raw_secret));

        delete_api_key(&paths, "openai").unwrap();
        assert_eq!(get_api_key(&paths, "openai").unwrap(), None);

        let _ = fs::remove_dir_all(dir);
    }
}
