# Quality standard

<!-- Written by the architect in stage 0, before design. The crew builds to it, the
     gate enforces the machine block, the reviewer scores against the rubric. In an
     existing repo the quality bar is discovered from what already runs, never
     invented. See PATTERN.md section 2.2. -->

## Quality bar

Commands that must exit 0 before any task is done. Fixed for the project.

| Purpose | Command |
| --- | --- |
| install | `<npm ci / uv sync / go mod download / dotnet restore>` |
| lint | `<…>` |
| typecheck | `<…>` (omit if the stack has none) |
| test | `<…>` |
| build | `<…>` (omit if none) |
| start | `<…>` — answers `GET /` with 200 within 30 s, or `--help` exits 0 for a CLI |

## Code rules

- Interfaces are segregated per consumer (ISP): a module depends on the smallest
  port it needs, never a fat interface.
- Dependencies are injected. No import-time side effects: no file, database, or
  network access at module scope.
- One JSON error envelope on every API route; unknown `/api/*` is a JSON 404.
- User data is escaped at every render and copy boundary.
- Nothing needed to run from a clean clone is undocumented.
- <rules the job demands>

## Test rules

- Every acceptance criterion has at least one test tagged with its id.
- Tests are written before the code they test and confirmed to fail first.
- Tests import the real modules; a test that would pass with the source deleted
  is not a test.
- The crew never edits a test or a tooling config. It reports the need.

## Rubric (targets)

| Criterion | Target |
| --- | --- |
| Correctness against requirements | ≥ 4 |
| Security (injection, escaping, limits) | ≥ 4 |
| Validation and error handling | ≥ 4 |
| Test quality (what is asserted) | ≥ 4 |
| Structure and idiom (DI, ISP, hygiene) | ≥ 4 |
| UX faithfulness to the flows | ≥ 4 |
| README accuracy from a clean clone | ≥ 4 |

```json quality
{ "bar": { "install": "", "lint": "", "typecheck": "", "test": "", "build": "" },
  "start": { "command": "", "probe": { "http": "/", "expect": 200, "timeout_s": 30 } },
  "hygiene_never_tracked": ["node_modules/", "dist/", "build/", "coverage/", "*.db", ".env",
                            ".qwen/", ".aider*", ".cursor/worktrees/"],
  "rubric_targets": { "correctness": 4, "security": 4, "validation": 4, "tests": 4,
                      "structure": 4, "ux": 4, "readme": 4 } }
```
