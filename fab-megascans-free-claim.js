/*
 * Fab.com - adds every FREE asset from the "megascans" search to your library.
 *
 * Usage:
 *   1. Log in on https://www.fab.com
 *   2. Manually claim ONE free asset first (accepts the terms, otherwise you get a 401)
 *   3. Open https://www.fab.com/search?is_free=1&q=megascans  (F12 -> Console)
 *   4. Paste this whole file + Enter.
 *
 * Set DRY_RUN = true to only list assets without claiming anything.
 * To stop: type  window.__stopClaim = true
 */
(async () => {
  const DRY_RUN = false;
  const QUERY = "megascans";
  const WAIT_BETWEEN_PAGES = 3000;   // ms
  const WAIT_BETWEEN_CLAIMS = 400;   // ms (sequential = safer against rate limits)
  const MAX_ERRORS_IN_ROW = 8;

  const BASE = "https://www.fab.com/i/listings";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const csrf = () => (document.cookie.match(/(?:^|;\s*)fab_csrftoken=([^;]+)/) || [])[1];
  const headers = () => ({
    accept: "application/json, text/plain, */*",
    "x-csrftoken": csrf(),
    "x-requested-with": "XMLHttpRequest",
  });

  if (!csrf()) return console.error("No fab_csrftoken cookie: log in on fab.com first.");
  window.__stopClaim = false;

  const stats = { seen: 0, added: 0, owned: 0, failed: 0, skipped: 0 };
  const failedIds = [];
  const seenCursors = new Set();
  const seenUids = new Set();
  let errorsInRow = 0;

  async function getJson(url, opts = {}) {
    const res = await fetch(url, { credentials: "include", headers: headers(), ...opts });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    return { res, body };
  }

  // Finds a listing's free offer (price 0); returns null if none.
  function pickFreeOffer(listing) {
    const lic = (listing.licenses || []).slice();
    if (!lic.length) return null;
    const price = (l) => Number(l.priceTier?.price ?? l.price ?? 0);
    lic.sort((a, b) => price(a) - price(b));
    const best = lic[0];
    return price(best) === 0 ? best.offerId : null;
  }

  async function claim(item) {
    const uid = item.uid;
    const title = item.title || uid;

    // Fetch details to get licenses / offerId
    const d = await getJson(`${BASE}/${uid}`);
    if (!d.res.ok) throw new Error(`detail HTTP ${d.res.status}`);
    if (d.body?.isOwned || d.body?.acquired) { stats.owned++; return "owned"; }

    const offerId = pickFreeOffer(d.body || {});
    if (!offerId) { stats.skipped++; console.log(`⏭  not free : ${title}`); return "skipped"; }

    if (DRY_RUN) { console.log(`[dry] ${title}`); return "dry"; }

    const fd = new FormData();
    fd.append("offer_id", offerId);
    const r = await getJson(`${BASE}/${uid}/add-to-library`, { method: "POST", body: fd });
    if (r.res.ok) { stats.added++; console.log(`✅ ${title}`); return "added"; }

    const msg = JSON.stringify(r.body || {}).slice(0, 160);
    if (/already/i.test(msg)) { stats.owned++; return "owned"; }
    if (r.res.status === 401) throw new Error("401: accept the terms by claiming 1 asset manually, then rerun.");
    if (r.res.status === 429 || r.res.status === 403) throw new Error(`rate limit (${r.res.status}): wait 15-20 min.`);
    throw new Error(`HTTP ${r.res.status} ${msg}`);
  }

  let cursor = null;
  let page = 0;
  while (!window.__stopClaim) {
    const qs = new URLSearchParams({ is_free: "1", q: QUERY, sort_by: "-firstPublishedAt" });
    if (cursor) qs.set("cursor", cursor);
    const { res, body } = await getJson(`${BASE}/search?${qs}`);
    if (!res.ok) { console.error("Search failed", res.status, body); break; }

    const items = body.results || [];
    page++;
    console.log(`📄 page ${page}: ${items.length} results`);

    for (const it of items) {
      if (window.__stopClaim) break;
      if (seenUids.has(it.uid)) continue;
      seenUids.add(it.uid);
      stats.seen++;
      try {
        await claim(it);
        errorsInRow = 0;
      } catch (e) {
        stats.failed++; failedIds.push(it.uid); errorsInRow++;
        console.warn(`❌ ${it.title || it.uid} : ${e.message}`);
        if (/401|rate limit/.test(e.message) || errorsInRow >= MAX_ERRORS_IN_ROW) {
          console.error("Stopped (too many errors / rate limit). Rerun later: already-owned assets are skipped.");
          console.table(stats); window.__failed = failedIds; return;
        }
      }
      await sleep(WAIT_BETWEEN_CLAIMS);
    }

    cursor = body.cursors?.next;
    if (!cursor) break;
    if (seenCursors.has(cursor)) { console.warn("Repeated cursor, stopping."); break; }
    seenCursors.add(cursor);
    await sleep(WAIT_BETWEEN_PAGES);
  }

  console.log("Done.");
  console.table(stats);
  window.__failed = failedIds;
})();
