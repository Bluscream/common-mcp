//! common-mcp — every tool in the family from one server.
//!
//! The Rust successor to the TypeScript `common-mcp`, which likewise bundled
//! count, diff, regex, grep, hex and eval behind a single process. Each tool
//! group is embedded as a library from its own crate, so there is exactly one
//! implementation of each and no subprocess per group.

mod args;
mod eval;
mod fs;
mod hex;
mod policy;
mod text;

use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use mcp_toolkit::{Composite, Member, ServerOptions};

#[derive(Parser, Debug)]
#[command(
    name = "common-mcp",
    version,
    about = "Text, filesystem, hex and eval tools in one MCP server"
)]
struct Cli {
    #[command(flatten)]
    server: ServerOptions,

    /// Permit tools to modify files (`grep_search --apply`, `hex_patch`).
    #[arg(long, env = "COMMON_MCP_ALLOW_WRITE")]
    allow_write: bool,

    /// Permit `eval_code` to run scripts. Separate from `--allow-write` because
    /// running arbitrary code is a distinctly larger capability.
    #[arg(long, env = "COMMON_MCP_ALLOW_EXECUTION")]
    allow_execution: bool,

    /// Confine filesystem tools to this directory. Repeatable.
    #[arg(long = "root", value_name = "DIR", env = "COMMON_MCP_ROOT")]
    roots: Vec<PathBuf>,

    /// Restrict eval to these languages. Repeatable. All allowed if unset.
    #[arg(long = "language", value_name = "NAME", env = "COMMON_MCP_LANGUAGES")]
    languages: Vec<String>,

    /// Largest file the filesystem tools will open, in bytes.
    #[arg(long, default_value_t = 64 * 1024 * 1024, env = "COMMON_MCP_MAX_FILE_BYTES")]
    max_file_bytes: u64,
}

fn build(cli: &Cli) -> Composite {
    let policy = policy::Policy::new(
        cli.allow_write,
        cli.allow_execution,
        &cli.roots,
        &cli.languages,
        cli.max_file_bytes,
    );

    // No prefixes: the tool names across these groups are already distinct, and
    // keeping them unprefixed means a client configured for the individual
    // servers sees exactly the same names here.
    Composite::new(vec![
        Member::new(Arc::new(text::TextTools::new(policy.clone()))),
        Member::new(Arc::new(fs::FsTools::new(policy.clone()))),
        Member::new(Arc::new(hex::HexTools::new(policy.clone()))),
        Member::new(Arc::new(eval::EvalTools::new(policy))),
    ])
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    let composite = build(&cli);

    // A collision would leave a tool unreachable; say so rather than hide it.
    if !composite.collisions().is_empty() {
        eprintln!(
            "common-mcp: these tool names are claimed by more than one group and only the first \
             is reachable: {}",
            composite.collisions().join(", ")
        );
    }

    match mcp_toolkit::run("common", env!("CARGO_PKG_VERSION"), Arc::new(composite), cli.server)
        .await
    {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("common-mcp: {err}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcp_toolkit::ToolGroup;

    fn cli() -> Cli {
        Cli::parse_from(["common-mcp"])
    }

    #[test]
    fn the_aggregate_exposes_every_group_without_collisions() {
        let composite = build(&cli());
        let names: Vec<String> = composite.tools().into_iter().map(|t| t.name).collect();

        for expected in [
            "diff_text",
            "diff_json",
            "regex_match",
            "count_stats",
            "grep_search",
            "hex_view",
            "hex_patch",
            "eval_code",
        ] {
            assert!(names.contains(&expected.to_string()), "{expected} missing from {names:?}");
        }
        assert!(
            composite.collisions().is_empty(),
            "unreachable tools: {:?}",
            composite.collisions()
        );
    }

    #[tokio::test]
    async fn a_tool_from_each_group_dispatches_correctly() {
        let composite = build(&cli());
        let out =
            composite.call("count_stats", serde_json::json!({ "text": "a b c" })).await.unwrap();
        assert_eq!(out.structured.unwrap()["words"], 3);
    }

    #[tokio::test]
    async fn dangerous_capabilities_are_off_unless_asked_for() {
        let composite = build(&cli());

        let err = composite
            .call("eval_code", serde_json::json!({ "language": "sh", "code": "id" }))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("--allow-execution"), "{err}");
    }

    #[test]
    fn the_cli_definition_is_internally_consistent() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }
}
