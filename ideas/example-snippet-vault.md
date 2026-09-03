# Snippet Vault

## One sentence
A local-first web app where a developer saves, tags, and instantly searches code
snippets, running entirely on their own machine.

## The problem
Useful snippets end up scattered across gists, Slack messages, and shell history.
Finding "that jq one-liner from March" takes longer than rewriting it. Solved
feels like: one place, one search box, results as I type, copy with one click.

## Must have (v1)
- Create, edit, delete a snippet: title, language, body, tags.
- Full-text search across title, body, and tags, updating as the user types.
- Copy-to-clipboard button on every snippet.
- Data persists locally between restarts (SQLite file in the project directory).
- Runs with one command after install; no accounts, no network required.

## Nice to have (later)
- Syntax highlighting.
- Import from GitHub gists.
- Keyboard-only navigation.
- Export/import as JSON.

## Shape
- Single-user web app served from a local Node process; browser UI.
- JSON HTTP API under `/api/snippets` so the UI and tests share one contract.
- Keep the frontend dependency-light; server-rendered or a small vanilla/JSX
  bundle is fine. No auth.

## Example
I run `npm run dev`, open localhost, paste a `jq` command, title it "Extract ids
from array", tag it `jq shell`, save. Tomorrow I type "ids" in the search box; it
appears as the first result while I'm still typing. I click Copy, paste into my
terminal, done.
