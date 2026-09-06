//! One policy for every tool in this server.
//!
//! The individual servers each carried their own copy of the path-resolution
//! and capability logic. Three copies of a security boundary is three chances
//! for them to drift — and they had already begun to: only one of them checked
//! the file size cap. Here there is one.

use std::path::{Path, PathBuf};

use mcp_toolkit::{Sandbox, ToolFailure, ToolResult};

/// Capability switches plus the shared filesystem sandbox.
///
/// The path handling lives in mcp-toolkit so every server in the family agrees
/// on it — including the cross-platform rules that three separate copies had
/// each got wrong.
#[derive(Debug, Clone, Default)]
pub struct Policy {
    allow_write: bool,
    allow_execution: bool,
    allowed_languages: Vec<String>,
    sandbox: Sandbox,
}

impl Policy {
    pub fn new(
        allow_write: bool,
        allow_execution: bool,
        roots: &[PathBuf],
        allowed_languages: &[String],
        max_file_bytes: u64,
    ) -> Self {
        Self {
            allow_write,
            allow_execution,
            allowed_languages: allowed_languages.iter().map(|l| l.to_lowercase()).collect(),
            sandbox: Sandbox::new(roots, max_file_bytes),
        }
    }

    pub fn max_file_bytes(&self) -> u64 {
        self.sandbox.max_file_bytes()
    }

    /// Resolves a caller-supplied path within the permitted roots.
    pub fn resolve(&self, raw: &str) -> ToolResult<PathBuf> {
        self.sandbox.resolve(raw)
    }

    /// Refuses a file larger than the configured ceiling.
    pub fn check_size(&self, path: &Path) -> ToolResult<u64> {
        self.sandbox.check_size(path)
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
    fn dot_dot_cannot_escape_a_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let policy = permissive(std::slice::from_ref(&root));

        let escape = format!("{}/../../../../etc/passwd", root.display());
        assert!(matches!(policy.resolve(&escape), Err(ToolFailure::Denied(_))));
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
}
