# Fab Megascans Free Claimer

A browser-console script that automatically adds every **free** asset from the "megascans" search on [Fab](https://www.fab.com) to your library.

Quixel Bridge has been replaced by Fab, so older scripts targeting `quixel.com` no longer work. This one uses Fab's current API.

> ⚠️ Since 2025, most Megascans are no longer free. The script only claims the ones currently marked **free**.

## Usage

1. Log in on [fab.com](https://www.fab.com).
2. Manually claim **one** free asset first (this accepts the terms; otherwise you get a `401` error).
3. Open the [free Megascans search](https://www.fab.com/search?is_free=1&q=megascans).
4. Press `F12` and open the **Console** tab.
5. Copy the whole content of [`fab-megascans-free-claim.js`](fab-megascans-free-claim.js), paste it, and press `Enter`.

If Chrome blocks pasting, type `allow pasting`, press `Enter`, then paste again.

## Options

At the top of the file:

| Constant | Default | Description |
|---|---|---|
| `DRY_RUN` | `false` | `true` = only list assets, claim nothing |
| `QUERY` | `"megascans"` | Search keyword |
| `WAIT_BETWEEN_PAGES` | `3000` | Pause between pages (ms) |
| `WAIT_BETWEEN_CLAIMS` | `400` | Pause between assets (ms) |
| `MAX_ERRORS_IN_ROW` | `8` | Stop after N consecutive errors |

To stop mid-run: `window.__stopClaim = true`.

## How it works

- `GET /i/listings/search?is_free=1&q=megascans` walks through the results (cursor pagination).
- `GET /i/listings/{uid}` finds the free offer of each asset.
- `POST /i/listings/{uid}/add-to-library` adds it, using your `fab_csrftoken` cookie.
- Already-owned or non-free assets are skipped. The script stops on a `401`, a rate limit (`429`/`403`) or repeated errors. Run it again later: assets you already have are ignored.

## Limitations

- No guarantee: Fab may change its API at any time.
- The script runs in your browser with your own session and sends nothing anywhere else.
- Respect the [Fab terms of use](https://www.fab.com/eula). Use at your own risk.

## License

MIT
