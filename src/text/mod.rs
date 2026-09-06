//! Pure text tools: diffing, regex matching and counting. No I/O, no policy.
//!
//! Relocated here from text-mcp, which is superseded by this server.

use async_trait::async_trait;
use regex::Regex;
use serde_json::{Value, json};
use similar::{ChangeTag, TextDiff};

use crate::policy::Policy;
use mcp_toolkit::args;
use mcp_toolkit::{ToolDef, ToolFailure, ToolGroup, ToolOutput, ToolResult};

pub struct TextTools {
    policy: Policy,
}

impl TextTools {
    pub fn new(policy: Policy) -> Self {
        Self { policy }
    }
}

/// Guards against a pathological pattern turning a tool call into a hang.
const MAX_REGEX_SIZE: usize = 1 << 20;
/// Caps how many matches are returned so a broad pattern cannot blow up the
/// model's context window.
const DEFAULT_MATCH_LIMIT: u64 = 1_000;

#[async_trait]
impl ToolGroup for TextTools {
    fn tools(&self) -> Vec<ToolDef> {
        vec![
            ToolDef::new(
                "diff_text",
                "Computes a unified diff between two strings. Returns the changed hunks with \
                 line numbers, not the whole file.",
                json!({
                "type": "object",
                "properties": {
                    "old_text": { "type": "string", "description": "Original text" },
                    "new_text": { "type": "string", "description": "Modified text" },
                    "old_path": {
                        "type": "string",
                        "description": "Read the original side from this file instead"
                    },
                    "new_path": {
                        "type": "string",
                        "description": "Read the modified side from this file instead"
                    },
                    "context_lines": {
                        "type": "integer",
                        "description": "Unchanged lines to keep around each hunk (default 3)"
                    }
                },
                }),
            ),
            ToolDef::new(
                "diff_json",
                "Compares two JSON values structurally and returns a unified diff of their \
                 canonical pretty-printed forms. Accepts objects or JSON strings.",
                json!({
                    "type": "object",
                    "properties": {
                        "old_json": { "description": "Original JSON value or a JSON string" },
                        "new_json": { "description": "Modified JSON value or a JSON string" },
                        "context_lines": {
                            "type": "integer",
                            "description": "Unchanged lines to keep around each hunk (default 3)"
                        }
                    },
                    "required": ["old_json", "new_json"]
                }),
            ),
            ToolDef::new(
                "regex_match",
                "Finds all matches of a Rust-syntax regular expression in a string, returning \
                 each match with its byte offset and capture groups.",
                json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Regular expression" },
                        "text": { "type": "string", "description": "Text to search" },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum matches to return (default 1000)"
                        }
                    },
                    "required": ["pattern", "text"]
                }),
            ),
            ToolDef::new(
                "count_stats",
                "Counts lines, words, Unicode characters and bytes in a string.",
                json!({
                    "type": "object",
                    "properties": {
                        "text": { "type": "string", "description": "Text to measure" }
                    },
                    "required": ["text"]
                }),
            ),
        ]
    }

    async fn call(&self, name: &str, args: Value) -> ToolResult<ToolOutput> {
        match name {
            "diff_text" => diff_text(&args, &self.policy),
            "diff_json" => diff_json(&args),
            "regex_match" => regex_match(&args),
            "count_stats" => count_stats(&args, &self.policy),
            other => Err(ToolFailure::NotFound(other.to_string())),
        }
    }
}

fn diff_text(arguments: &Value, policy: &Policy) -> ToolResult<ToolOutput> {
    let old = side(arguments, "old_text", "old_path", policy)?;
    let new = side(arguments, "new_text", "new_path", policy)?;
    let context = usize::try_from(args::u64_or(arguments, "context_lines", 3)?).unwrap_or(3);
    Ok(render_diff(&old, &new, context))
}

/// One side of a diff: either an inline string or the contents of a file.
fn side(arguments: &Value, text_key: &str, path_key: &str, policy: &Policy) -> ToolResult<String> {
    if let Some(text) = args::opt_string(arguments, text_key)? {
        return Ok(text.to_string());
    }
    let Some(raw) = args::opt_string(arguments, path_key)? else {
        return Err(ToolFailure::InvalidArguments(format!(
            "supply either {text_key:?} or {path_key:?}"
        )));
    };
    let path = policy.resolve(raw)?;
    policy.check_size(&path)?;
    std::fs::read_to_string(&path)
        .map_err(|e| ToolFailure::Failed(format!("could not read {}: {e}", path.display())))
}

fn diff_json(arguments: &Value) -> ToolResult<ToolOutput> {
    let old = canonical_json(arguments, "old_json")?;
    let new = canonical_json(arguments, "new_json")?;
    let context = usize::try_from(args::u64_or(arguments, "context_lines", 3)?).unwrap_or(3);
    Ok(render_diff(&old, &new, context))
}

/// Accepts either an inline JSON value or a JSON-encoded string, so callers
/// that pass file contents verbatim get a structural diff rather than a
/// character-by-character one.
fn canonical_json(arguments: &Value, field: &str) -> ToolResult<String> {
    let value = arguments.get(field).ok_or_else(|| args::missing(field))?;
    let parsed = match value {
        Value::String(text) => serde_json::from_str::<Value>(text.as_str()).map_err(|e| {
            ToolFailure::InvalidArguments(format!("{field:?} is a string but not valid JSON: {e}"))
        })?,
        other => other.clone(),
    };
    serde_json::to_string_pretty(&parsed)
        .map_err(|e| ToolFailure::Failed(format!("could not render {field:?}: {e}")))
}

/// Produces a unified diff. The previous implementation emitted every line of
/// both inputs including unchanged ones, which for a large file meant the
/// entire file came back twice.
fn render_diff(old: &str, new: &str, context: usize) -> ToolOutput {
    use std::fmt::Write as _;

    let diff = TextDiff::from_lines(old, new);
    let mut output = String::new();
    let mut hunks = 0usize;

    for group in diff.grouped_ops(context.min(32)) {
        hunks += 1;
        if let (Some(first), Some(last)) = (group.first(), group.last()) {
            let old_range = first.old_range().start..last.old_range().end;
            let new_range = first.new_range().start..last.new_range().end;
            let _ = writeln!(
                output,
                "@@ -{},{} +{},{} @@",
                old_range.start + 1,
                old_range.len(),
                new_range.start + 1,
                new_range.len()
            );
        }
        for op in group {
            for change in diff.iter_changes(&op) {
                let sign = match change.tag() {
                    ChangeTag::Delete => '-',
                    ChangeTag::Insert => '+',
                    ChangeTag::Equal => ' ',
                };
                output.push(sign);
                output.push_str(change.value());
                if !change.value().ends_with('\n') {
                    output.push('\n');
                }
            }
        }
    }

    if hunks == 0 {
        return ToolOutput::text("(inputs are identical)");
    }
    ToolOutput::text(output)
}

fn regex_match(arguments: &Value) -> ToolResult<ToolOutput> {
    let pattern = args::string(arguments, "pattern")?;
    let text = args::string(arguments, "text")?;
    let limit = args::u64_or(arguments, "limit", DEFAULT_MATCH_LIMIT)?;

    let regex = compile(pattern)?;
    let mut matches = Vec::new();
    let mut total = 0u64;

    for capture in regex.captures_iter(text) {
        total += 1;
        if matches.len() as u64 >= limit {
            continue;
        }
        let whole = capture.get(0).map_or("", |m| m.as_str());
        let start = capture.get(0).map_or(0, |m| m.start());
        let groups: Vec<Value> = capture
            .iter()
            .skip(1)
            .map(|group| group.map_or(Value::Null, |g| json!(g.as_str())))
            .collect();
        matches.push(json!({ "text": whole, "offset": start, "groups": groups }));
    }

    Ok(ToolOutput::structured(json!({
        "count": total,
        "truncated": total > matches.len() as u64,
        "matches": matches
    })))
}

/// Compiles a pattern with a size bound, converting the failure into an
/// argument error rather than propagating an opaque regex panic path.
pub fn compile(pattern: &str) -> ToolResult<Regex> {
    regex::RegexBuilder::new(pattern)
        .size_limit(MAX_REGEX_SIZE)
        .build()
        .map_err(|e| ToolFailure::InvalidArguments(format!("invalid regular expression: {e}")))
}

fn count_stats(arguments: &Value, policy: &Policy) -> ToolResult<ToolOutput> {
    if let Some(text) = args::opt_string(arguments, "text")? {
        return Ok(ToolOutput::structured(measure(text)));
    }

    let Some(raw) = args::opt_string(arguments, "path")? else {
        return Err(ToolFailure::InvalidArguments("supply either \"text\" or \"path\"".into()));
    };
    let path = policy.resolve(raw)?;
    let recursive = args::bool_or(arguments, "recursive", true)?;

    if path.is_file() {
        policy.check_size(&path)?;
        let content = std::fs::read_to_string(&path)
            .map_err(|e| ToolFailure::Failed(format!("could not read {}: {e}", path.display())))?;
        let mut stats = measure(&content);
        stats["files"] = json!(1);
        return Ok(ToolOutput::structured(stats));
    }

    let (lines, words, chars, bytes, files, directories, skipped) =
        walk_counts(&path, recursive, policy);
    Ok(ToolOutput::structured(json!({
        "path": path.display().to_string(),
        "recursive": recursive,
        "files": files,
        "directories": directories,
        "items": files + directories,
        "lines": lines,
        "words": words,
        "chars": chars,
        "bytes": bytes,
        "unreadable_or_binary_files_skipped": skipped
    })))
}

fn measure(text: &str) -> Value {
    json!({
        "lines": text.lines().count(),
        "words": text.split_whitespace().count(),
        "chars": text.chars().count(),
        "bytes": text.len()
    })
}

/// Totals across a directory. Binary and unreadable files are skipped and
/// reported rather than counted as garbage.
fn walk_counts(
    root: &std::path::Path,
    recursive: bool,
    policy: &Policy,
) -> (u64, u64, u64, u64, u64, u64, u64) {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .max_depth(if recursive { None } else { Some(1) })
        .standard_filters(true)
        .follow_links(false)
        .max_filesize(Some(policy.max_file_bytes()));

    let (mut lines, mut words, mut chars, mut bytes) = (0, 0, 0, 0);
    let (mut files, mut directories, mut skipped) = (0, 0, 0);

    for entry in builder.build().filter_map(Result::ok) {
        if entry.path() == root {
            continue;
        }
        match entry.file_type() {
            Some(t) if t.is_dir() => directories += 1,
            Some(t) if t.is_file() => {
                files += 1;
                // A NUL byte in the first 8 KiB is the standard binary
                // heuristic; counting "words" in a binary is meaningless.
                let text = std::fs::read(entry.path())
                    .ok()
                    .filter(|raw| memchr::memchr(0, &raw[..raw.len().min(8192)]).is_none());
                match text.and_then(|raw| String::from_utf8(raw).ok()) {
                    Some(text) => {
                        lines += text.lines().count() as u64;
                        words += text.split_whitespace().count() as u64;
                        chars += text.chars().count() as u64;
                        bytes += text.len() as u64;
                    }
                    None => skipped += 1,
                }
            }
            _ => {}
        }
    }
    (lines, words, chars, bytes, files, directories, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn call(name: &str, arguments: Value) -> ToolResult<String> {
        let result = TextTools::new(Policy::default()).call(name, arguments).await?;
        Ok(result.text)
    }

    #[tokio::test]
    async fn diff_reports_only_changed_hunks() {
        use std::fmt::Write as _;

        let mut old = String::new();
        for i in 1..=100 {
            let _ = writeln!(old, "line {i}");
        }
        let new = old.replace("line 50\n", "CHANGED\n");

        let text = call("diff_text", json!({ "old_text": old, "new_text": new })).await.unwrap();
        assert!(text.contains("-line 50"));
        assert!(text.contains("+CHANGED"));
        // The old implementation echoed all 100 unchanged lines twice.
        assert!(!text.contains("line 10\n"), "unrelated context leaked into the diff");
        assert!(text.starts_with("@@"));
    }

    #[tokio::test]
    async fn identical_inputs_say_so_instead_of_returning_the_whole_file() {
        let text =
            call("diff_text", json!({ "old_text": "a\nb\n", "new_text": "a\nb\n" })).await.unwrap();
        assert_eq!(text, "(inputs are identical)");
    }

    #[tokio::test]
    async fn json_diff_ignores_key_order_and_formatting() {
        let text = call(
            "diff_json",
            json!({ "old_json": { "a": 1, "b": 2 }, "new_json": { "a": 1, "b": 2 } }),
        )
        .await
        .unwrap();
        assert_eq!(text, "(inputs are identical)");
    }

    #[tokio::test]
    async fn json_diff_accepts_encoded_strings() {
        let text = call("diff_json", json!({ "old_json": "{\"a\":1}", "new_json": "{\"a\":2}" }))
            .await
            .unwrap();
        assert!(text.contains("-  \"a\": 1"));
        assert!(text.contains("+  \"a\": 2"));
    }

    #[tokio::test]
    async fn json_diff_rejects_a_string_that_is_not_json() {
        let err = call("diff_json", json!({ "old_json": "not json", "new_json": "{}" }))
            .await
            .unwrap_err();
        assert!(matches!(err, ToolFailure::InvalidArguments(_)));
    }

    #[tokio::test]
    async fn regex_match_returns_offsets_and_capture_groups() {
        let text = call("regex_match", json!({ "pattern": r"(\w+)@(\w+)", "text": "a@b and c@d" }))
            .await
            .unwrap();
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["count"], 2);
        assert_eq!(parsed["matches"][0]["groups"], json!(["a", "b"]));
        assert_eq!(parsed["matches"][1]["offset"], json!(8));
    }

    #[tokio::test]
    async fn regex_match_truncates_and_reports_that_it_did() {
        let haystack = "x".repeat(50);
        let text = call("regex_match", json!({ "pattern": "x", "text": haystack, "limit": 5 }))
            .await
            .unwrap();
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["count"], 50);
        assert_eq!(parsed["truncated"], json!(true));
        assert_eq!(parsed["matches"].as_array().unwrap().len(), 5);
    }

    #[tokio::test]
    async fn an_invalid_pattern_is_an_argument_error() {
        let err =
            call("regex_match", json!({ "pattern": "(unclosed", "text": "x" })).await.unwrap_err();
        assert!(matches!(err, ToolFailure::InvalidArguments(_)));
    }

    #[tokio::test]
    async fn missing_arguments_are_reported_rather_than_defaulted_to_empty() {
        // The old code searched for "" when `pattern` was omitted.
        let err = call("regex_match", json!({ "text": "x" })).await.unwrap_err();
        assert!(err.to_string().contains("\"pattern\""));
    }

    #[tokio::test]
    async fn count_stats_counts_unicode_characters_not_bytes() {
        let text =
            call("count_stats", json!({ "text": "héllo wörld\nsecond line" })).await.unwrap();
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["lines"], 2);
        assert_eq!(parsed["words"], 4);
        assert_eq!(parsed["chars"], 23);
        assert_eq!(parsed["bytes"], 25);
    }

    /// The TypeScript common-mcp could count and diff *paths*, not just
    /// strings. These cover the behaviour restored here.
    fn sandbox() -> (tempfile::TempDir, Policy) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let policy = Policy::new(false, false, std::slice::from_ref(&root), &[], 64 * 1024 * 1024);
        (dir, policy)
    }

    async fn call_with(policy: &Policy, name: &str, arguments: Value) -> ToolResult<Value> {
        let result = TextTools::new(policy.clone()).call(name, arguments).await?;
        Ok(result.structured.unwrap_or_else(|| json!(result.text)))
    }

    #[tokio::test]
    async fn count_stats_measures_a_file() {
        let (dir, policy) = sandbox();
        let path = dir.path().canonicalize().unwrap().join("a.txt");
        std::fs::write(&path, "one two\nthree\n").unwrap();

        let out = call_with(&policy, "count_stats", json!({ "path": path.to_str().unwrap() }))
            .await
            .unwrap();
        assert_eq!(out["lines"], 2);
        assert_eq!(out["words"], 3);
        assert_eq!(out["files"], 1);
    }

    #[tokio::test]
    async fn count_stats_totals_a_directory_and_counts_its_entries() {
        let (dir, policy) = sandbox();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/b.txt"), "two three\n").unwrap();

        let out = call_with(&policy, "count_stats", json!({ "path": root.to_str().unwrap() }))
            .await
            .unwrap();
        assert_eq!(out["files"], 2);
        assert_eq!(out["directories"], 1);
        assert_eq!(out["items"], 3);
        assert_eq!(out["words"], 3);
    }

    #[tokio::test]
    async fn count_stats_can_stay_shallow() {
        let (dir, policy) = sandbox();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("a.txt"), "x\n").unwrap();
        std::fs::create_dir(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/b.txt"), "y\n").unwrap();

        let out = call_with(
            &policy,
            "count_stats",
            json!({ "path": root.to_str().unwrap(), "recursive": false }),
        )
        .await
        .unwrap();
        assert_eq!(out["files"], 1, "only the top level should be counted");
    }

    #[tokio::test]
    async fn count_stats_skips_binaries_rather_than_counting_garbage() {
        let (dir, policy) = sandbox();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("blob.bin"), [0u8, 1, 2, 0]).unwrap();

        let out = call_with(&policy, "count_stats", json!({ "path": root.to_str().unwrap() }))
            .await
            .unwrap();
        assert_eq!(out["unreadable_or_binary_files_skipped"], 1);
        assert_eq!(out["words"], 0);
    }

    #[tokio::test]
    async fn count_stats_still_measures_inline_text() {
        let (_dir, policy) = sandbox();
        let out = call_with(&policy, "count_stats", json!({ "text": "a b c" })).await.unwrap();
        assert_eq!(out["words"], 3);
    }

    #[tokio::test]
    async fn count_stats_requires_one_of_text_or_path() {
        let (_dir, policy) = sandbox();
        let err = call_with(&policy, "count_stats", json!({})).await.unwrap_err();
        assert!(err.to_string().contains("path"), "{err}");
    }

    #[tokio::test]
    async fn diff_text_can_read_either_side_from_a_file() {
        let (dir, policy) = sandbox();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("old.txt"), "alpha\nbeta\n").unwrap();
        std::fs::write(root.join("new.txt"), "alpha\nGAMMA\n").unwrap();

        let out = call_with(
            &policy,
            "diff_text",
            json!({
                "old_path": root.join("old.txt").to_str().unwrap(),
                "new_path": root.join("new.txt").to_str().unwrap()
            }),
        )
        .await
        .unwrap();

        let text = out.as_str().unwrap();
        assert!(text.contains("-beta"), "{text}");
        assert!(text.contains("+GAMMA"), "{text}");
    }

    #[tokio::test]
    async fn diff_text_can_mix_a_string_and_a_file() {
        let (dir, policy) = sandbox();
        let root = dir.path().canonicalize().unwrap();
        std::fs::write(root.join("new.txt"), "changed\n").unwrap();

        let out = call_with(
            &policy,
            "diff_text",
            json!({
                "old_text": "original\n",
                "new_path": root.join("new.txt").to_str().unwrap()
            }),
        )
        .await
        .unwrap();
        assert!(out.as_str().unwrap().contains("+changed"));
    }

    #[tokio::test]
    async fn a_path_outside_the_roots_is_denied_for_text_tools_too() {
        let (_dir, policy) = sandbox();
        let err = call_with(&policy, "count_stats", json!({ "path": "/etc" })).await.unwrap_err();
        assert!(matches!(err, ToolFailure::Denied(_)), "got {err:?}");
    }

    #[tokio::test]
    async fn an_unrouted_name_is_a_not_found_error() {
        assert!(matches!(call("nope", json!({})).await, Err(ToolFailure::NotFound(_))));
    }
}
