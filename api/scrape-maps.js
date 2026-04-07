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
  if (typeof bodyLat === 'number' && typeof bodyLng === 'number' && !Number.isNaN(bodyLat) && !Number.isNaN(bodyLng)) {
    return [bodyLat, bodyLng];
  }
  const c = String(city || '').trim();
  const s = String(state || '').trim().toUpperCase();
  const m = METRO_COORDS.find((x) => x.city === c && String(x.state).toUpperCase() === s);
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

function parseResults(data, city, state, nicheLabel) {
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
      place.phone ||
      place.phone_number ||
      place.formatted_phone_number ||
      '';

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
      rawAddr =
        rawAddr.full ||
        rawAddr.address ||
        rawAddr.formatted ||
        '';
    }
    const address = rawAddr ? String(rawAddr).trim() : '';

    let website = place.website || place.domain || '';
    if (website && !String(website).startsWith('http')) {
      website = 'https://' + website;
    }

    const rating = place.rating ?? place.stars ?? '';
    const reviews =
      place.reviews ??
      place.reviews_count ??
      place.user_ratings_total ??
      '';

    let googleMapsRating = '';
    const rStr = rating !== '' && rating != null ? String(rating) : '';
    const rvStr = reviews !== '' && reviews != null ? String(reviews) : '';
    if (rStr && rvStr) {
      const n = Number(rvStr);
      const revWord =
        !Number.isNaN(n) && n === 1 ? 'review' : 'reviews';
      googleMapsRating = `${rStr}★ (${rvStr} ${revWord})`;
    } else if (rStr) {
      googleMapsRating = `${rStr}★`;
    }

    rows.push({
      company: name.trim(),
      owner: '',
      phone: normalizePhoneNANP(phone.trim()) || phone.trim(),
      address,
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.SCRAPINGDOG_API_KEY;
  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') body = {};

  if (!apiKey) {
    return res.status(500).json({
      error:
        'Add SCRAPINGDOG_API_KEY in Vercel → Project → Settings → Environment Variables.',
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

  const query = `${niche} in ${city} ${state}`;

  let maxLeads = 20;
  const rawR = body.results;
  if (typeof rawR === 'number' && !Number.isNaN(rawR)) {
    maxLeads = Math.min(2000, Math.max(1, Math.round(rawR)));
  } else if (rawR != null && rawR !== '') {
    const n = parseInt(String(rawR), 10);
    if (!Number.isNaN(n)) maxLeads = Math.min(2000, Math.max(1, n));
  }

  const coords = findCoords(city, state, body.lat, body.lng);

  const PAGE_STEP = 20;
  const leads = [];
  const seenPhoneDigits = new Set();
  let pagesFetched = 0;
  let emptyPagesInRow = 0;
  let stopReason = 'max_leads';

  function phoneDedupeKey(phoneStr) {
    let d = String(phoneStr || '').replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    return d.length === 10 ? d : d.length >= 7 ? d : '';
  }

  if (Array.isArray(body.existingPhones)) {
    for (const p of body.existingPhones) {
      const k = phoneDedupeKey(p);
      if (k) seenPhoneDigits.add(k);
    }
  }

  for (let pageOffset = 0; leads.length < maxLeads && pageOffset <= 980; pageOffset += PAGE_STEP) {
    if (!coords && pageOffset > 0) {
      stopReason = 'no_coords_pagination';
      break;
    }

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
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 55000);
        resp = await fetch(url.toString(), { signal: ctrl.signal });
        clearTimeout(t);
        if (resp.status === 429) {
          await sleep(12000);
          continue;
        }
        if (resp.status === 400 || resp.status === 403) {
          let errText = '';
          try {
            const j = await resp.clone().json();
            errText = j.message || j.error || JSON.stringify(j).slice(0, 200);
          } catch {
            errText = await resp.clone().text().catch(() => '');
          }
          if (attempt < 3) {
            await sleep(2000 + attempt * 2500);
            continue;
          }
          return res.status(502).json({
            error: `ScrapingDog returned ${resp.status}`,
            detail: errText || undefined,
          });
        }
        if (resp.ok) break;
        if (resp.status >= 500 && attempt < 3) {
          await sleep(2000 + attempt * 1500);
          continue;
        }
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await sleep(4000 + attempt * 2000);
      }
    }

    if (!resp) {
      return res.status(502).json({
        error: lastErr?.message || 'Upstream request failed',
      });
    }

    let data;
    try {
      data = await resp.json();
    } catch {
      return res.status(502).json({ error: 'Invalid JSON from ScrapingDog' });
    }

    if (!resp.ok) {
      const msg =
        data && (data.message || data.error)
          ? String(data.message || data.error)
          : '';
      return res.status(502).json({
        error: `ScrapingDog returned ${resp.status}`,
        detail: msg || undefined,
      });
    }

    const { rows: batch, rawPlacesCount } = parseResults(data, city, state, nicheLabel);
    pagesFetched++;

    if (rawPlacesCount === 0) {
      emptyPagesInRow++;
      if (emptyPagesInRow >= 2 || pagesFetched === 1) {
        stopReason = 'google_maps_exhausted';
        break;
      }
      await sleep(400);
      continue;
    }
    emptyPagesInRow = 0;

    for (const row of batch) {
      const k = phoneDedupeKey(row.phone);
      if (k) {
        if (seenPhoneDigits.has(k)) continue;
        seenPhoneDigits.add(k);
      }
      leads.push(row);
      if (leads.length >= maxLeads) break;
    }

    if (rawPlacesCount < PAGE_STEP) {
      stopReason = 'google_maps_exhausted';
      break;
    }
    await sleep(coords ? 280 : 400);
  }

  if (leads.length >= maxLeads) stopReason = 'max_leads';
  else if (stopReason === 'max_leads') stopReason = 'page_limit';

  return res.status(200).json({
    ok: true,
    leads,
    coordsUsed: !!coords,
    pagesFetched,
    stopReason,
  });
};
