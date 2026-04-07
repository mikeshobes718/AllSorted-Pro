const path = require('path');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let METRO_COORDS = [];
try {
  METRO_COORDS = require(path.join(__dirname, '../metro-coords.json'));
} catch (e) {
  METRO_COORDS = [];
}

function findCoords(city, state, bodyLat, bodyLng) {
  if (
    typeof bodyLat === 'number' &&
    typeof bodyLng === 'number' &&
    !Number.isNaN(bodyLat) &&
    !Number.isNaN(bodyLng)
  ) {
    return [bodyLat, bodyLng];
  }
  const c = String(city || '').trim();
  const s = String(state || '').trim().toUpperCase();
  const m = METRO_COORDS.find(
    (x) => x.city === c && String(x.state).toUpperCase() === s,
  );
  if (m && typeof m.lat === 'number' && typeof m.lng === 'number') {
    return [m.lat, m.lng];
  }
  return null;
}

function normalizePhoneNANP(raw) {
  if (raw == null || String(raw).trim() === '') return '';
  const s = String(raw).trim();
  let d = s.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return s;
}

function phoneDedupeKey(phoneStr) {
  let d = String(phoneStr || '')
    .replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? d : d.length >= 7 ? d : '';
}

function parseScrapingDogResults(data, city, state, nicheLabel) {
  const rows = [];
  let rawPlacesCount = 0;
  if (!data) return { rows, rawPlacesCount };

  let places =
    data.search_results ||
    data.local_results ||
    data.places ||
    data.results ||
    [];
  if (typeof places === 'object' && !Array.isArray(places)) {
    places = Object.values(places);
  }
  rawPlacesCount = Array.isArray(places) ? places.length : 0;

  for (const place of places) {
    if (!place || typeof place !== 'object') continue;
    const name = place.title || place.name || '';
    if (!name) continue;
    const phone =
      place.phone || place.phone_number || place.formatted_phone_number || '';
    if (!phone) continue;

    let rawAddr =
      place.address ||
      place.formatted_address ||
      place.vicinity ||
      place.full_address ||
      place.google_address ||
      place.street_address ||
      place.snippet ||
      '';
    if (rawAddr && typeof rawAddr === 'object') {
      rawAddr = rawAddr.full || rawAddr.address || rawAddr.formatted || '';
    }

    let website = place.website || place.domain || '';
    if (website && !String(website).startsWith('http')) website = 'https://' + website;

    const rating = place.rating ?? place.stars ?? '';
    const reviews = place.reviews ?? place.reviews_count ?? place.user_ratings_total ?? '';
    let googleMapsRating = '';
    const rStr = rating !== '' && rating != null ? String(rating) : '';
    const rvStr = reviews !== '' && reviews != null ? String(reviews) : '';
    if (rStr && rvStr) {
      const n = Number(rvStr);
      googleMapsRating = `${rStr}★ (${rvStr} ${!Number.isNaN(n) && n === 1 ? 'review' : 'reviews'})`;
    } else if (rStr) {
      googleMapsRating = `${rStr}★`;
    }

    rows.push({
      company: name.trim(),
      owner: '',
      phone: normalizePhoneNANP(phone.trim()) || phone.trim(),
      address: rawAddr ? String(rawAddr).trim() : '',
      email: '',
      category: nicheLabel,
      city,
      state,
      country: 'US',
      website: website ? String(website).trim() : '',
      googleMapsRating,
      notes: '',
      source: 'ScrapingDog / Google Maps',
    });
  }
  return { rows, rawPlacesCount };
}

function parseApifyResults(items, city, state, nicheLabel) {
  const rows = [];
  if (!Array.isArray(items)) return rows;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const name = item.title || item.name || item.searchPageUrl || '';
    if (!name) continue;
    const phone = item.phone || item.phoneUnformatted || '';
    if (!phone) continue;

    let website = item.website || item.url || '';
    if (website && !String(website).startsWith('http')) website = 'https://' + website;

    const rating = item.totalScore ?? item.rating ?? '';
    const reviews = item.reviewsCount ?? item.reviews ?? '';
    let googleMapsRating = '';
    const rStr = rating !== '' && rating != null ? String(rating) : '';
    const rvStr = reviews !== '' && reviews != null ? String(reviews) : '';
    if (rStr && rvStr) {
      googleMapsRating = `${rStr}★ (${rvStr} reviews)`;
    } else if (rStr) {
      googleMapsRating = `${rStr}★`;
    }

    rows.push({
      company: String(name).trim(),
      owner: '',
      phone: normalizePhoneNANP(String(phone).trim()) || String(phone).trim(),
      address: item.address || item.street || '',
      email: '',
      category: nicheLabel,
      city,
      state,
      country: 'US',
      website: website ? String(website).trim() : '',
      googleMapsRating,
      notes: '',
      source: 'Apify / Google Maps',
    });
  }
  return rows;
}

function buildQueryVariations(niche, city, state) {
  const base = niche.trim();
  const words = base.split(/\s+/);
  const variations = [];
  variations.push(`${base} in ${city}, ${state}`);
  variations.push(`${base} near ${city}, ${state}`);
  if (words.length >= 2) {
    variations.push(`${words[0]} services in ${city}, ${state}`);
    variations.push(`${words[0]} near ${city}, ${state}`);
  }
  variations.push(`${base} ${city} ${state}`);
  return variations;
}

async function fetchScrapingDogPage(apiKey, query, pageOffset, coords) {
  const PAGE_STEP = 20;
  const url = new URL('https://api.scrapingdog.com/google_maps');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);
  url.searchParams.set('results', String(PAGE_STEP));
  url.searchParams.set('page', String(pageOffset));
  url.searchParams.set('country', 'us');
  if (coords) {
    url.searchParams.set('ll', `@${coords[0]},${coords[1]},12z`);
  }

  let resp;
  let lastErr;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      resp = await fetch(url.toString(), { signal: ctrl.signal });
      clearTimeout(t);
      if (resp.status === 429) { await sleep(8000); continue; }
      if (resp.status === 400 || resp.status === 403) {
        if (attempt < 2) { await sleep(2000 + attempt * 2000); continue; }
        return { ok: false, error: `ScrapingDog ${resp.status}` };
      }
      if (resp.ok) break;
      if (resp.status >= 500 && attempt < 2) { await sleep(2000); continue; }
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(3000);
    }
  }
  if (!resp) return { ok: false, error: lastErr?.message || 'request failed' };

  let data;
  try { data = await resp.json(); } catch { return { ok: false, error: 'bad JSON' }; }
  if (!resp.ok) return { ok: false, error: data?.error || `HTTP ${resp.status}` };
  return { ok: true, data };
}

async function scrapeWithScrapingDog(apiKey, niche, city, state, nicheLabel, maxLeads, seenPhones, coords, startTime) {
  const PAGE_STEP = 20;
  const leads = [];
  let pagesFetched = 0;
  let stopReason = 'target_reached';
  const variations = buildQueryVariations(niche, city, state);
  const zoomLevels = coords ? ['12z', '10z', '14z'] : [null];

  for (const zoomSuffix of zoomLevels) {
    if (leads.length >= maxLeads) break;
    if (Date.now() - startTime > 240000) { stopReason = 'timeout'; break; }

    const effectiveCoords = coords && zoomSuffix
      ? { lat: coords[0], lng: coords[1], zoom: zoomSuffix }
      : coords
        ? { lat: coords[0], lng: coords[1], zoom: '12z' }
        : null;

    for (const query of variations) {
      if (leads.length >= maxLeads) break;
      if (Date.now() - startTime > 240000) { stopReason = 'timeout'; break; }

      let emptyRawPages = 0;
      for (let pageOffset = 0; pageOffset <= 1960; pageOffset += PAGE_STEP) {
        if (leads.length >= maxLeads) break;
        if (Date.now() - startTime > 240000) { stopReason = 'timeout'; break; }

        if (!coords && pageOffset > 0) break;

        const urlObj = new URL('https://api.scrapingdog.com/google_maps');
        urlObj.searchParams.set('api_key', apiKey);
        urlObj.searchParams.set('query', query);
        urlObj.searchParams.set('results', String(PAGE_STEP));
        urlObj.searchParams.set('page', String(pageOffset));
        urlObj.searchParams.set('country', 'us');
        if (effectiveCoords) {
          urlObj.searchParams.set(
            'll',
            `@${effectiveCoords.lat},${effectiveCoords.lng},${effectiveCoords.zoom}`,
          );
        }

        let resp;
        let lastErr;
        for (let attempt = 0; attempt <= 2; attempt++) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 45000);
            resp = await fetch(urlObj.toString(), { signal: ctrl.signal });
            clearTimeout(t);
            if (resp.status === 429) { await sleep(8000); continue; }
            if ((resp.status === 400 || resp.status === 403) && attempt < 2) {
              await sleep(2000 + attempt * 2000);
              continue;
            }
            if (resp.ok) break;
            if (resp.status >= 500 && attempt < 2) { await sleep(2000); continue; }
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < 2) await sleep(3000);
          }
        }
        if (!resp || !resp.ok) break;

        let data;
        try { data = await resp.json(); } catch { break; }

        const { rows: batch, rawPlacesCount } = parseScrapingDogResults(
          data, city, state, nicheLabel,
        );
        pagesFetched++;

        if (rawPlacesCount === 0) {
          emptyRawPages++;
          if (emptyRawPages >= 2) break;
          await sleep(400);
          continue;
        }
        emptyRawPages = 0;

        for (const row of batch) {
          const k = phoneDedupeKey(row.phone);
          if (k && seenPhones.has(k)) continue;
          if (k) seenPhones.add(k);
          leads.push(row);
          if (leads.length >= maxLeads) break;
        }

        if (rawPlacesCount < PAGE_STEP) break;
        await sleep(300);
      }
    }

    if (zoomSuffix === '12z' && leads.length >= maxLeads * 0.8) break;
  }

  if (leads.length >= maxLeads) stopReason = 'target_reached';
  else if (stopReason !== 'timeout') stopReason = 'google_maps_exhausted';

  return { leads, pagesFetched, stopReason };
}

async function scrapeWithApify(apifyToken, niche, city, state, nicheLabel, maxLeads, seenPhones, startTime) {
  const leads = [];
  const actorId = 'compass~crawler-google-places';
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apifyToken}`;

  const remaining = maxLeads - leads.length;
  if (remaining <= 0) return { leads, stopReason: 'not_needed' };

  const input = {
    searchStringsArray: [`${niche}`],
    locationQuery: `${city}, ${state}, USA`,
    maxCrawledPlaces: Math.min(remaining + 20, 200),
    language: 'en',
    maxReviews: 0,
    maxImages: 0,
  };

  try {
    const timeLeft = 260000 - (Date.now() - startTime);
    if (timeLeft < 30000) return { leads, stopReason: 'timeout' };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.min(timeLeft, 120000));
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!resp.ok) {
      return { leads, stopReason: 'apify_error' };
    }

    const items = await resp.json();
    const parsed = parseApifyResults(items, city, state, nicheLabel);

    for (const row of parsed) {
      const k = phoneDedupeKey(row.phone);
      if (k && seenPhones.has(k)) continue;
      if (k) seenPhones.add(k);
      leads.push(row);
      if (leads.length >= maxLeads) break;
    }

    return {
      leads,
      stopReason: leads.length >= maxLeads ? 'target_reached' : 'apify_done',
    };
  } catch (e) {
    return { leads, stopReason: 'apify_timeout' };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SCRAPINGDOG_API_KEY;
  const apifyToken = process.env.APIFY_API_TOKEN || '';
  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  const startTime = Date.now();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') body = {};

  if (!apiKey && !apifyToken) {
    return res.status(500).json({
      error: 'Add SCRAPINGDOG_API_KEY or APIFY_API_TOKEN in Vercel → Settings → Environment Variables.',
    });
  }
  if (body.secret !== scraperSecret) {
    return res.status(401).json({ error: 'Wrong scraper password' });
  }

  const { niche, city, state } = body;
  if (!niche || !city || !state) {
    return res.status(400).json({ error: 'Missing niche, city, or state' });
  }

  const nicheLabel = niche
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  let maxLeads = 20;
  const rawR = body.results;
  if (typeof rawR === 'number' && !Number.isNaN(rawR)) {
    maxLeads = Math.min(2000, Math.max(1, Math.round(rawR)));
  } else if (rawR != null && rawR !== '') {
    const n = parseInt(String(rawR), 10);
    if (!Number.isNaN(n)) maxLeads = Math.min(2000, Math.max(1, n));
  }

  const coords = findCoords(city, state, body.lat, body.lng);
  const seenPhones = new Set();

  if (Array.isArray(body.existingPhones)) {
    for (const p of body.existingPhones) {
      const k = phoneDedupeKey(p);
      if (k) seenPhones.add(k);
    }
  }

  let allLeads = [];
  let totalPagesFetched = 0;
  let stopReason = 'unknown';
  let providers = [];

  if (apiKey) {
    const sdResult = await scrapeWithScrapingDog(
      apiKey, niche, city, state, nicheLabel, maxLeads, seenPhones, coords, startTime,
    );
    allLeads.push(...sdResult.leads);
    totalPagesFetched += sdResult.pagesFetched;
    stopReason = sdResult.stopReason;
    providers.push('scrapingdog');
  }

  if (allLeads.length < maxLeads && apifyToken && Date.now() - startTime < 230000) {
    const apifyResult = await scrapeWithApify(
      apifyToken, niche, city, state, nicheLabel,
      maxLeads - allLeads.length, seenPhones, startTime,
    );
    allLeads.push(...apifyResult.leads);
    providers.push('apify');
    if (apifyResult.leads.length > 0) {
      stopReason = apifyResult.stopReason;
    }
  }

  if (allLeads.length >= maxLeads) stopReason = 'target_reached';

  return res.status(200).json({
    ok: true,
    leads: allLeads.slice(0, maxLeads),
    coordsUsed: !!coords,
    pagesFetched: totalPagesFetched,
    stopReason,
    providers,
  });
};
