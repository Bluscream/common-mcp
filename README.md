# common-mcp

Every tool in the family from one server: text, filesystem, hex and eval.

> **Rust rewrite.** This branch replaces the earlier TypeScript implementation,
> which remains on `main`. It also supersedes
> [`text-mcp`](https://github.com/Bluscream/text-mcp), whose tools now live
> here.

```bash
common-mcp                                        # read-only, stdio
common-mcp --root /work --allow-write             # file editing enabled
common-mcp --root /work --allow-execution         # scripts too
common-mcp --single-tool                          # one tool instead of eight
common-mcp --transport http --auth-token "$TOK"   # over HTTP
```

## Tools

| Tool | From | Does |
| --- | --- | --- |
| `diff_text`, `diff_json` | text | Unified and structural diffs. |
| `regex_match`, `count_stats` | text | Matching with offsets and captures; line/word/char/byte counts. |
| `grep_search` | fs | Gitignore-aware search, with byte-exact optional replace. |
| `hex_view`, `hex_patch` | hex | Hex dump and byte patching with backups. |
| `eval_code` | eval | Runs scripts in 30+ languages. |

All accept an optional `timeout` (seconds), clamped to `--max-timeout`.

## Relationship to the individual servers

Each group is embedded as a library from its own crate
([hex-mcp](https://github.com/Bluscream/hex-mcp),
[fs-mcp](https://github.com/Bluscream/fs-mcp),
[eval-mcp](https://github.com/Bluscream/eval-mcp)), so there is exactly one
implementation of each tool and no subprocess per group. Tool names are
identical to the standalone servers', so a client configured against those sees
the same names here.

Run the individual servers when you want one capability with its own policy;
run this when you want the lot behind a single process.

## Safety

Off by default, matching the individual servers:

- `--allow-write` for `grep_search --apply` and `hex_patch`.
- `--allow-execution` for `eval_code`, kept separate because running arbitrary
  code is a distinctly larger capability than editing a file.
- `--root` confines the filesystem tools; `--language` restricts eval.
- `--max-file-bytes` caps what is opened.
- HTTP requires a bearer token unless `--allow-unauthenticated`.

## Development

```bash
./scripts/build.sh --release
```

## License

[Unlicense](LICENSE) (public domain).
