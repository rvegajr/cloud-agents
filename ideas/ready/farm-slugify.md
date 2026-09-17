# Slugify CLI

## One sentence
A CLI that turns a title into a URL slug.

## The problem
Renaming blog posts by hand produces `My Title.md` forever. Solved feels like: paste a title, get `my-title`.

## Must have (v1)
- Read the string from argv or stdin.
- Lowercase, strip punctuation, collapse whitespace/dashes, ASCII-only output.
- `--suffix` appends a short extra segment (e.g. date) after the slug.

## Nice to have (later)
- Transliteration for non-ASCII.
- Clipboard copy.

## Shape
- Local Node CLI, no network.
- Tests for spaces, punctuation, empty input, and `--suffix`.

## Example
`slugify "Hello, World!"` prints `hello-world`.
