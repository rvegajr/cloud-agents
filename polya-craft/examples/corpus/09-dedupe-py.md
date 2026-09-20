# Request: find duplicate files under a folder, in Python

<!-- kind: build, Python CLI, pytest in the bar, no third-party packages. A different toolchain on purpose. -->

## Why
My photo folder has the same file five times under five names. Solved feels like: one
command that lists the groups of identical files, biggest first, and touches nothing.

## I will judge it by
- `dedupe ~/Photos` prints one group per block: the size, then each path on its own line, groups ordered by size descending.
- Two files are identical only when their bytes are, not when their names or sizes match.
- A folder with ten thousand files is scanned in seconds because files with a unique size are never hashed.
- Nothing is deleted, moved or written; `--delete` does not exist.

## Wrong looks like
- Following a symlink out of the folder, or into a loop.
- A file that cannot be read stops the whole scan instead of being reported and skipped.

## Must not change
- <nothing: the repo is empty>

## Not this
- No image similarity, no GUI, no packages outside the standard library.

## Where it lives, who uses it
Python 3.12 or newer, macOS and Linux, run by a stranger from a fresh clone; tests with `pytest`.

## The one walk-through
I run `python3 -m dedupe tests/fixtures/sample` and see two groups, the larger first, each listing its identical files.
