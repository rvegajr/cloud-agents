# Request: a packing-list page I can use with the keyboard only

<!-- kind: build, UI-heavy, browser done-checks. The page is the product. -->

## Why
Every trip I rebuild the same list in a notes app and lose the checked state. Solved feels
like: one page, items I can add, check, reorder and delete without touching the mouse, and
the list is still there when I come back.

## I will judge it by
- I type an item and press Enter; it appears at the bottom with focus back in the input.
- Arrow keys move between items, Space toggles checked, Delete removes, and Alt+Up/Down reorders.
- I reload the page and every item, its order and its checked state are as I left them.
- A checked item is visibly struck through and counted in a "3 of 7 packed" line.

## Wrong looks like
- An empty item can be added.
- Reordering with the keyboard loses focus, so the next key press goes nowhere.
- The page is unusable with the browser at 375 px wide.

## Must not change
- <nothing: the repo is empty>

## Not this
- No accounts, no server-side storage, no framework, no build step; a static page and one script.

## Where it lives, who uses it
A single `index.html` plus `app.js` served by `npm start` on port 3000, opened in a desktop browser and a phone browser by someone who has never seen it.

## The one walk-through
I run `npm ci && npm start`, open `localhost:3000`, type "passport", Enter, "charger", Enter, press Up, Space, and see "1 of 2 packed" with "charger" struck through; I reload and it is still so.
