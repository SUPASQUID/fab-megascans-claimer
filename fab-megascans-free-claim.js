/*
 * Fab.com - adds every FREE asset from the "Quixel Megascans" publisher to your library.
 *
 * Usage:
 *   1. Log in on https://www.fab.com
 *   2. Manually claim ONE free asset first (accepts the terms, otherwise you get a 401)
 *   3. Open https://www.fab.com/search?is_free=1&sellers=o-cbf5bbfdb340d6a839b5520cb31328  (F12 -> Console)
 *   4. Paste this whole file + Enter.
 *
 * Set DRY_RUN = true to only list assets without claiming anything.
 * To stop: type  window.__stopClaim = true
 */
(async () => {
  const DRY_RUN = false;
  const SELLER_ID = "o-cbf5bbfdb340d6a839b5520cb31328"; // publisher "Quixel Megascans"
  const SORT_ORDERS = ["-firstPublishedAt", "firstPublishedAt"]; // newest first, then oldest first
  const CONCURRENCY = 8;             // assets claimed at the same time (1 = one by one)
  const WAIT_BETWEEN_PAGES = 500;    // ms
  const WAIT_BETWEEN_CLAIMS = 0;     // ms, per worker
  const RATE_LIMIT_PAUSE = 60000;    // ms to wait when Fab answers 429/403
  const MAX_RATE_LIMIT_PAUSES = 5;   // stop after this many pauses in a row
  const MAX_ERRORS_IN_ROW = 15;

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
  let rateLimitPauses = 0;
  let pausedUntil = 0;
  let fatal = null;

  class RateLimit extends Error {}
  class Fatal extends Error {}

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

  async function claimOnce(item) {
    const uid = item.uid;
    const title = item.title || uid;

    // Fetch details to get licenses / offerId
    const d = await getJson(`${BASE}/${uid}`);
    if (d.res.status === 429 || d.res.status === 403) throw new RateLimit(`HTTP ${d.res.status}`);
    if (!d.res.ok) throw new Error(`detail HTTP ${d.res.status}`);
    if (d.body?.isOwned || d.body?.acquired) { stats.owned++; return "owned"; }

    const offerId = pickFreeOffer(d.body || {});
    if (!offerId) { stats.skipped++; console.log(`⏭  not free: ${title}`); return "skipped"; }

    if (DRY_RUN) { console.log(`[dry] ${title}`); return "dry"; }

    const fd = new FormData();
    fd.append("offer_id", offerId);
    const r = await getJson(`${BASE}/${uid}/add-to-library`, { method: "POST", body: fd });
    if (r.res.ok) { stats.added++; console.log(`✅ ${title}`); return "added"; }

    const msg = JSON.stringify(r.body || {}).slice(0, 160);
    if (/already/i.test(msg)) { stats.owned++; return "owned"; }
    if (r.res.status === 401) throw new Fatal("401: accept the terms by claiming 1 asset manually, then rerun.");
    if (r.res.status === 429 || r.res.status === 403) throw new RateLimit(`HTTP ${r.res.status}`);
    throw new Error(`HTTP ${r.res.status} ${msg}`);
  }

  // Retries after a pause when rate-limited (all workers wait together).
  async function claim(item) {
    for (;;) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) await sleep(wait);
      if (window.__stopClaim || fatal) return "stopped";
      try {
        const out = await claimOnce(item);
        rateLimitPauses = 0;
        return out;
      } catch (e) {
        if (!(e instanceof RateLimit)) throw e;
        if (Date.now() < pausedUntil) continue; // another worker already triggered the pause
        rateLimitPauses++;
        if (rateLimitPauses > MAX_RATE_LIMIT_PAUSES) throw new Fatal("Rate limited too many times. Wait 15-20 min and rerun.");
        pausedUntil = Date.now() + RATE_LIMIT_PAUSE;
        console.warn(`⏸  Rate limited (${e.message}). Pausing ${RATE_LIMIT_PAUSE / 1000}s (${rateLimitPauses}/${MAX_RATE_LIMIT_PAUSES})...`);
      }
    }
  }

  // Asks Fab which of these listings are already in your library (one request per page).
  // Response shape can vary, so we accept an array or an object keyed by uid.
  let statesLogged = false;
  async function fetchOwned(items) {
    const owned = new Set();
    try {
      const qs = new URLSearchParams();
      items.forEach((it) => qs.append("listing_ids", it.uid));
      const { res, body } = await getJson(`https://www.fab.com/i/users/me/listings-states?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!statesLogged) { statesLogged = true; console.log("ℹ️ ownership check sample:", JSON.stringify(body).slice(0, 300)); }
      const list = Array.isArray(body) ? body : Object.entries(body || {}).map(([uid, v]) => ({ uid, ...v }));
      for (const st of list) if (st.acquired || st.isAcquired || st.owned) owned.add(st.uid || st.listingUid);
    } catch (e) {
      if (!statesLogged) { statesLogged = true; console.warn(`Ownership check unavailable (${e.message}), falling back to per-asset check.`); }
    }
    return owned;
  }

  // Claims a page of items with CONCURRENCY workers.
  async function processItems(items) {
    const fresh = items.filter((it) => !seenUids.has(it.uid));
    fresh.forEach((it) => { seenUids.add(it.uid); stats.seen++; });
    const ownedNow = await fetchOwned(fresh);
    stats.owned += fresh.filter((it) => ownedNow.has(it.uid)).length;
    const queue = fresh.filter((it) => !ownedNow.has(it.uid)); // already in library: skip silently
    let i = 0;
    const worker = async () => {
      while (!window.__stopClaim && !fatal) {
        const it = queue[i++];
        if (!it) return;
        try {
          const outcome = await claim(it);
          errorsInRow = 0;
          if (outcome !== "added") continue; // no pause needed for owned/skipped assets
        } catch (e) {
          if (e instanceof Fatal) { fatal = e; return; }
          stats.failed++; failedIds.push(it.uid); errorsInRow++;
          console.warn(`❌ ${it.title || it.uid}: ${e.message}`);
          if (errorsInRow >= MAX_ERRORS_IN_ROW) { fatal = new Fatal("Too many errors in a row."); return; }
        }
        if (WAIT_BETWEEN_CLAIMS) await sleep(WAIT_BETWEEN_CLAIMS);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }

  // Fab's pagination can stop early, so we walk the list in several sort orders.
  // Assets seen in a previous pass are skipped, so extra passes only cost a few requests.
  for (const sort of SORT_ORDERS) {
    if (window.__stopClaim || fatal) break;
    console.log(`🔀 pass with sort_by=${sort}`);
    let cursor = null;
    let page = 0;
    seenCursors.clear();
    while (!window.__stopClaim && !fatal) {
      const qs = new URLSearchParams({ is_free: "1", sellers: SELLER_ID, sort_by: sort });
      if (cursor) qs.set("cursor", cursor);
      const { res, body } = await getJson(`${BASE}/search?${qs}`);
      if (!res.ok) { console.error("Search failed", res.status, body); break; }

      const items = body.results || [];
      page++;
      console.log(`📄 page ${page}: ${items.length} results`);
      await processItems(items);

      cursor = body.cursors?.next;
      if (!cursor) break;
      if (seenCursors.has(cursor)) { console.warn("Repeated cursor, stopping."); break; }
      seenCursors.add(cursor);
      await sleep(WAIT_BETWEEN_PAGES);
    }
  }

  if (fatal) console.error(`Stopped: ${fatal.message} Rerun later: already-owned assets are skipped.`);
  else console.log("Done.");
  console.table(stats);
  window.__failed = failedIds;
})();
