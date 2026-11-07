# Fab Megascans Free Claimer

A browser-console script that automatically adds every **free** asset from the **Quixel Megascans** publisher on [Fab](https://www.fab.com) to your library.

Quixel Bridge has been replaced by Fab, so older scripts targeting `quixel.com` no longer work. This one uses Fab's current API.

> ⚠️ Since 2025, most Megascans are no longer free. The script only claims the ones currently marked **free**.

## Usage

1. Log in on [fab.com](https://www.fab.com).
2. Manually claim **one** free asset first (this accepts the terms; otherwise you get a `401` error).
3. Open the [free Quixel Megascans listing](https://www.fab.com/search?is_free=1&sellers=o-cbf5bbfdb340d6a839b5520cb31328).
4. Press `F12` and open the **Console** tab.
5. Copy the whole content of [`fab-megascans-free-claim.js`](fab-megascans-free-claim.js), paste it, and press `Enter`.

If Chrome blocks pasting, type `allow pasting`, press `Enter`, then paste again.

## Options

At the top of the file:

| Constant | Default | Description |
|---|---|---|
| `DRY_RUN` | `false` | `true` = only list assets, claim nothing |
| `SELLER_ID` | `"o-cbf5…"` | Fab publisher ID (Quixel Megascans) |
| `SORT_ORDERS` | newest, then oldest | Sort orders to walk through (Fab's pagination can stop early, so a second pass catches missed assets) |
| `WAIT_BETWEEN_PAGES` | `3000` | Pause between pages (ms) |
| `WAIT_BETWEEN_CLAIMS` | `400` | Pause between assets (ms) |
| `MAX_ERRORS_IN_ROW` | `8` | Stop after N consecutive errors |


## Stopping the script

- **Clean stop:** type this in the same console and press `Enter`. The script finishes the asset in progress, then prints a summary:

  ```js
  window.__stopClaim = true
  ```

- **Instant stop:** reload the page (`F5`) or close the tab.

Nothing is lost when you stop: run the script again later and assets already in your library are skipped. IDs of assets that failed are kept in `window.__failed`.

## How it works

- `GET /i/listings/search?is_free=1&sellers=<publisher id>` walks through the results (cursor pagination).
- `GET /i/listings/{uid}` finds the free offer of each asset.
- `POST /i/listings/{uid}/add-to-library` adds it, using your `fab_csrftoken` cookie.
- Already-owned or non-free assets are skipped. The script stops on a `401`, a rate limit (`429`/`403`) or repeated errors. Run it again later: assets you already have are ignored.

## Limitations

- No guarantee: Fab may change its API at any time.
- The script runs in your browser with your own session and sends nothing anywhere else.
- Respect the [Fab terms of use](https://www.fab.com/eula). Use at your own risk.

## License

MIT
