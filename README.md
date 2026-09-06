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
| `diff_text`, `diff_json` | text | Unified and structural diffs. `diff_text` reads either side from a string **or a file**. |
| `regex_match` | text | Matching with offsets and capture groups. |
| `count_stats` | text | Lines, words, chars and bytes in a string, **or across a file or directory** — where it also counts files and subdirectories. |
| `grep_search` | fs | Gitignore-aware search, with byte-exact optional replace. |
| `hex_view`, `hex_patch` | hex | Hex dump and byte patching with backups. |
| `eval_code` | eval | Runs scripts in 30+ languages. |

All accept an optional `timeout` (seconds), clamped to `--max-timeout`.

## Relationship to the individual servers

This crate is **self-contained** — it does not depend on
[hex-mcp](https://github.com/Bluscream/hex-mcp),
[fs-mcp](https://github.com/Bluscream/fs-mcp) or
[eval-mcp](https://github.com/Bluscream/eval-mcp), only on the shared
[mcp-toolkit](https://github.com/Bluscream/mcp-toolkit). Tool names match the
standalone servers, so a client configured against those sees the same names
here.

Run an individual server when you want one capability on its own; run this when
you want the lot behind a single process.

### What this does that they do not

- **`count_stats` and `diff_text` accept paths**, not just strings — the
  behaviour the TypeScript `common-mcp` had and the individual Rust servers
  dropped. Counting a directory reports files, subdirectories and totals, and
  skips binaries rather than counting garbage in them.
- **One policy governs every tool.** The individual servers each carried their
  own copy of the path-resolution and capability logic, and had already begun to
  drift — only one of them enforced the file size cap. Here the sandbox is
  defined once, so `count_stats` on a directory is confined by `--root` exactly
  as `grep_search` is.

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
