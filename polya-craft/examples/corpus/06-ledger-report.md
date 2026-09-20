# Request: a monthly report from a large CSV of transactions

<!-- kind: build, data pipeline CLI, streaming, Node. -->

## Why
The bank export is a 300 MB CSV and every spreadsheet chokes on it. Solved feels like: one
command, a table of months with totals in and out, and it runs on the laptop in seconds.

## I will judge it by
- `ledger-report bank.csv` prints one line per month: `2026-03  in 4210.50  out 3877.12  net 333.38`, months in order.
- A 300 MB file is processed without reading it all into memory, and finishes in under a minute.
- A row with a malformed amount or date is reported on stderr with its line number and skipped; the exit code is 1 if any row was skipped, 0 otherwise.
- Amounts are exact to the cent: `0.10 + 0.20` sums to `0.30`, never `0.30000000000000004`.

## Wrong looks like
- Quoted fields with commas inside (`"Coffee, large"`) split into two columns.
- A header row counted as a transaction.

## Must not change
- The CSV columns are `date,description,amount` with the ISO date and a signed amount; the report never asks for a different layout.

## Not this
- No charts, no currency conversion, no dependencies.

## Where it lives, who uses it
Node 22 or newer, macOS and Linux, a stranger from a fresh clone after `npm ci`.

## The one walk-through
I run `npm ci`, generate a large file with the script the repo provides, then `npx ledger-report big.csv` and see the monthly table in well under a minute.
