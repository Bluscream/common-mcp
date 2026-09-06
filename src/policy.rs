//! One policy for every tool in this server.
//!
//! The individual servers each carried their own copy of the path-resolution
//! and capability logic. Three copies of a security boundary is three chances
//! for them to drift — and they had already begun to: only one of them checked
//! the file size cap. Here there is one.

use std::path::{Component, Path, PathBuf};

use mcp_toolkit::{ToolFailure, ToolResult};

#[derive(Debug, Clone)]
pub struct Policy {
    allow_write: bool,
    allow_execution: bool,
    roots: Vec<PathBuf>,
    allowed_languages: Vec<String>,
    max_file_bytes: u64,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            allow_write: false,
            allow_execution: false,
            roots: Vec::new(),
            allowed_languages: Vec::new(),
            max_file_bytes: 64 * 1024 * 1024,
        }
    }
}

impl Policy {
    pub fn new(
        allow_write: bool,
        allow_execution: bool,
        roots: &[PathBuf],
        allowed_languages: &[String],
        max_file_bytes: u64,
    ) -> Self {
        // Canonicalise once so a symlinked root still matches paths resolved
        // through it.
        let roots = roots.iter().map(|r| r.canonicalize().unwrap_or_else(|_| r.clone())).collect();
        Self {
            allow_write,
            allow_execution,
            roots,
            allowed_languages: allowed_languages.iter().map(|l| l.to_lowercase()).collect(),
            max_file_bytes,
        }
    }

    pub fn max_file_bytes(&self) -> u64 {
        self.max_file_bytes
    }

    /// Fails unless file modification was enabled.
    pub fn require_write(&self) -> ToolResult<()> {
        if self.allow_write {
            return Ok(());
        }
        Err(ToolFailure::Denied(
            "this tool modifies files, which is disabled; start the server with --allow-write"
                .into(),
        ))
    }

    /// Fails unless running code was enabled.
    ///
    /// Deliberately separate from `require_write`: editing a file and executing
    /// arbitrary code are different sizes of capability.
    pub fn require_execution(&self) -> ToolResult<()> {
        if self.allow_execution {
            return Ok(());
        }
        Err(ToolFailure::Denied(
            "code execution is disabled; start the server with --allow-execution".into(),
        ))
    }

    /// Fails if the operator restricted which languages may run.
    pub fn require_language(&self, language: &str) -> ToolResult<()> {
        if self.allowed_languages.is_empty()
            || self.allowed_languages.iter().any(|l| l == &language.to_lowercase())
        {
            return Ok(());
        }
        Err(ToolFailure::Denied(format!(
            "language {language:?} is not in this server's --language allowlist ({})",
            self.allowed_languages.join(", ")
        )))
    }

    /// Resolves a caller-supplied path, rejecting anything outside the roots.
    pub fn resolve(&self, raw: &str) -> ToolResult<PathBuf> {
        if raw.trim().is_empty() {
            return Err(ToolFailure::InvalidArguments("path must not be empty".into()));
        }
        let requested = Path::new(raw);
        if requested.is_relative() {
            return Err(ToolFailure::InvalidArguments(format!(
                "path {raw:?} must be absolute; the server has no meaningful working directory"
            )));
        }

        // Canonicalise when the path exists so symlinks cannot escape a root;
        // otherwise normalise lexically so creating a new file still works.
        let resolved = requested.canonicalize().unwrap_or_else(|_| normalize(requested));

        if self.roots.is_empty() || self.roots.iter().any(|root| resolved.starts_with(root)) {
            return Ok(resolved);
        }
        Err(ToolFailure::Denied(format!("path {raw:?} is outside the configured --root set")))
    }

    /// Refuses a file larger than the cap.
    ///
    /// Several tools read a whole file into memory to rewrite it, so without
    /// this a large target exhausts RAM.
    pub fn check_size(&self, path: &Path) -> ToolResult<u64> {
        let length = std::fs::metadata(path)
            .map_err(|e| ToolFailure::Failed(format!("could not stat {}: {e}", path.display())))?
            .len();
        if length > self.max_file_bytes {
            return Err(ToolFailure::Denied(format!(
                "{} is {length} bytes, over the {} byte limit; raise --max-file-bytes to proceed",
                path.display(),
                self.max_file_bytes
            )));
        }
        Ok(length)
    }
}

/// Collapses `.` and `..` without touching the filesystem.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn permissive(roots: &[PathBuf]) -> Policy {
        Policy::new(true, true, roots, &[], 64 * 1024 * 1024)
    }

    #[test]
    fn every_capability_is_denied_by_default() {
        let policy = Policy::default();
        assert!(matches!(policy.require_write(), Err(ToolFailure::Denied(_))));
        assert!(matches!(policy.require_execution(), Err(ToolFailure::Denied(_))));
    }

    #[test]
    fn write_and_execution_are_independent() {
        // Editing a file and running arbitrary code are different sizes of
        // capability, so one must not imply the other.
        let write_only = Policy::new(true, false, &[], &[], 1 << 20);
        assert!(write_only.require_write().is_ok());
        assert!(write_only.require_execution().is_err());

        let exec_only = Policy::new(false, true, &[], &[], 1 << 20);
        assert!(exec_only.require_write().is_err());
        assert!(exec_only.require_execution().is_ok());
    }

    #[test]
    fn an_empty_language_allowlist_permits_everything() {
        let policy = permissive(&[]);
        assert!(policy.require_language("python").is_ok());
        assert!(policy.require_language("bash").is_ok());
    }

    #[test]
    fn a_language_allowlist_matches_case_insensitively() {
        let policy = Policy::new(true, true, &[], &["python".into(), "NODE".into()], 1 << 20);
        assert!(policy.require_language("Python").is_ok());
        assert!(policy.require_language("node").is_ok());
        assert!(policy.require_language("bash").is_err());
    }

    #[test]
    fn without_roots_any_absolute_path_resolves() {
        assert!(permissive(&[]).resolve("/etc/hostname").is_ok());
    }

    #[test]
    fn relative_and_empty_paths_are_rejected() {
        let policy = permissive(&[]);
        assert!(policy.resolve("relative/file").is_err());
        assert!(policy.resolve("   ").is_err());
    }

    #[test]
    fn paths_are_confined_to_the_roots() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("f"), b"x").unwrap();

        let policy = permissive(std::slice::from_ref(&root));
        assert!(policy.resolve(root.join("f").to_str().unwrap()).is_ok());
        assert!(matches!(policy.resolve("/etc/passwd"), Err(ToolFailure::Denied(_))));
    }

    #[test]
    fn dot_dot_cannot_escape_a_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let policy = permissive(std::slice::from_ref(&root));

        let escape = format!("{}/../../../../etc/passwd", root.display());
        assert!(matches!(policy.resolve(&escape), Err(ToolFailure::Denied(_))));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_pointing_outside_a_root_is_denied() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let link = root.join("escape");
        std::os::unix::fs::symlink("/etc/passwd", &link).unwrap();

        let policy = permissive(std::slice::from_ref(&root));
        assert!(matches!(policy.resolve(link.to_str().unwrap()), Err(ToolFailure::Denied(_))));
    }

    #[test]
    fn the_size_cap_applies_uniformly() {
        // The individual servers disagreed on this: only one of them checked.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let path = root.join("big");
        std::fs::write(&path, vec![0u8; 4096]).unwrap();

        let tight = Policy::new(true, true, std::slice::from_ref(&root), &[], 1024);
        assert!(matches!(tight.check_size(&path), Err(ToolFailure::Denied(_))));
        assert_eq!(permissive(std::slice::from_ref(&root)).check_size(&path).unwrap(), 4096);
    }

    #[test]
    fn normalisation_collapses_dot_segments() {
        assert_eq!(normalize(Path::new("/a/b/../c/./d")), PathBuf::from("/a/c/d"));
    }
}
