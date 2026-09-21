# Request: a CLI that turns a title into a URL slug

<!-- kind: build, CLI, Node. From ideas/ready/farm-slugify.md with the judgments written in. -->

## Why
Renaming blog posts by hand produces `My Title.md` forever. Solved feels like: paste a
title, get `my-title`, every time, with no surprises on odd input.

## I will judge it by
- `slugify "Hello, World!"` prints `hello-world` and nothing else on stdout.
- `echo "  Two   spaces -- and dashes " | slugify` prints `two-spaces-and-dashes`.
- `slugify ""` and `slugify "!!!"` exit non-zero with one line on stderr, not an empty line on stdout.
- `slugify --suffix 2026-09 "Hello"` prints `hello-2026-09`.

## Wrong looks like
- Output that keeps a leading or trailing dash, or two dashes in a row.
- Any non-ASCII byte on stdout, whatever the input.
- `slugify --sufix x "a"` (a typo) silently treated as a title.

## Must not change
- The command name `slugify`, as the package `bin` and the `npm run` script name.

## Not this
- No transliteration of non-ASCII letters (they are dropped), no clipboard, no config.

## Where it lives, who uses it
Node 22 or newer, no dependencies, macOS and Linux, run by a stranger from a fresh clone after `npm ci`.

## The one walk-through
I run `npm ci`, then `npx slugify "Hello, World!"` and see `hello-world`; then `npx slugify --suffix 2026-09 "Hello"` and see `hello-2026-09`.
