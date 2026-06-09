use std::fs;
use std::path::{Path, PathBuf};

pub const GLOBAL_ROOT_ENV: &str = "FUC_HOME";
pub const GLOBAL_ROOT_DIR_NAME: &str = ".freeultracode";
pub const PROJECT_ROOT_DIR_NAME: &str = ".freeultracode";
pub const GLOBAL_TMP_DIR_NAME: &str = "tmp";

pub fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn ensure_dir(path: &Path, label: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("创建 {label} 失败: {e}"))
}

pub fn global_root() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var(GLOBAL_ROOT_ENV) {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    Ok(user_home_dir()
        .ok_or("无法定位用户目录")?
        .join(GLOBAL_ROOT_DIR_NAME))
}

pub fn ensure_global_root_with_dirs(dirs: &[&str]) -> Result<PathBuf, String> {
    let root = global_root()?;
    ensure_dir(&root, "全局根目录")?;
    for dir in dirs {
        ensure_dir(&root.join(dir), &format!("全局目录 {dir}"))?;
    }
    Ok(root)
}

fn workspace_root(cwd: Option<&str>) -> Option<PathBuf> {
    let cwd = cwd.unwrap_or_default().trim();
    if cwd.is_empty() {
        return None;
    }

    let root = PathBuf::from(cwd);
    root.is_dir().then_some(root)
}

pub fn project_artifact_dir(cwd: Option<&str>, name: &str) -> Option<PathBuf> {
    workspace_root(cwd).map(|root| root.join(PROJECT_ROOT_DIR_NAME).join(name))
}

pub fn global_tmp_artifact_dir(name: &str) -> Result<PathBuf, String> {
    let root = ensure_global_root_with_dirs(&[GLOBAL_TMP_DIR_NAME])?;
    let dir = root.join(GLOBAL_TMP_DIR_NAME).join(name);
    ensure_dir(&dir, &format!("全局临时目录 {name}"))?;
    Ok(dir)
}

pub fn managed_artifact_dir(cwd: Option<&str>, name: &str) -> PathBuf {
    let dir = project_artifact_dir(cwd, name)
        .or_else(|| global_tmp_artifact_dir(name).ok())
        .unwrap_or_else(|| std::env::temp_dir().join("freeultracode").join(name));
    let _ = fs::create_dir_all(&dir);
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_artifact_dir_uses_freeultracode_under_workspace() {
        let root = std::env::temp_dir().join(format!(
            "freeultracode-storage-paths-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();

        let dir = project_artifact_dir(root.to_str(), "previews").unwrap();
        assert_eq!(dir, root.join(PROJECT_ROOT_DIR_NAME).join("previews"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_artifact_dir_ignores_missing_workspace() {
        let missing = std::env::temp_dir().join(format!(
            "freeultracode-storage-missing-{}",
            std::process::id()
        ));

        assert!(project_artifact_dir(missing.to_str(), "previews").is_none());
    }
}
