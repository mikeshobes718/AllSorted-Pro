'use strict';

/**
 * AllSorted Pro — lead pipeline v2.
 *
 * Sources (verified against live APIs):
 *   Google Maps via ScrapingDog — primary source; returns search_results[] with phone field.
 *   Apollo                      — secondary; people with org names and occasional direct phones.
 *
 * FMCSA:  dropped — physicalState param does not exist; no phone field in carrier records.
 * Yelp:   dropped — ScrapingDog lite plan returns 400; phone not in response even on paid plan.
 *
 * Env (Vercel):
 *   SCRAPER_SECRET        — portal password (required)
 *   SCRAPINGDOG_API_KEY   — Google Maps queries
 *   APOLLO_API_KEY        — optional; Apollo skipped if unset
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const MAPS_CATEGORIES = [
  'landscaping company',
  'lawn care service',
  'tree service',
  'plumbing company',
  'HVAC company',
  'roofing contractor',
  'electrical contractor',
  'painting company',
  'flooring company',
  'cleaning service',
  'junk removal service',
  'moving company',
  'auto repair shop',
  'pressure washing service',
  'pool service',
  'pest control service',
  'general contractor',
  'handyman service',
  'concrete company',
  'fence company',
];

const CITIES_BY_STATE = {
  TX: ['Houston', 'Dallas', 'San Antonio', 'Austin', 'Fort Worth', 'Arlington', 'El Paso', 'Corpus Christi', 'Plano', 'Lubbock'],
  FL: ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St. Petersburg', 'Fort Lauderdale', 'Tallahassee', 'Cape Coral', 'Gainesville', 'Pensacola'],
  GA: ['Atlanta', 'Columbus', 'Savannah', 'Augusta', 'Macon', 'Roswell', 'Marietta', 'Athens'],
  TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga', 'Clarksville', 'Murfreesboro', 'Franklin'],
  NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Youngstown'],
  IN: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Bloomington'],
  AZ: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Scottsdale', 'Gilbert', 'Tempe', 'Glendale'],
};

const APOLLO_TITLES = ['Owner', 'Founder', 'CEO', 'President', 'Proprietor'];

function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).trim().replace(/[^+\d]/g, '');
  if (p.startsWith('+')) return p.slice(0, 16);
  if (p.length === 10) return `+1${p}`;
  if (p.length === 11 && p.startsWith('1')) return `+${p}`;
  return p.length >= 7 ? p.slice(0, 16) : '';
}

function makeLead({ company = '', phone = '', city = '', state = '', source = '', industry = '', notes = '' }) {
  return {
    company: String(company || '').trim().slice(0, 80),
    phone: normalizePhone(phone),
    city: String(city || '').trim().slice(0, 40),
    state: String(state || '').trim().toUpperCase().slice(0, 2),
    source,
    industry: String(industry || '').slice(0, 60),
    notes: String(notes || '').slice(0, 200),
  };
}

function deduplicate(leads) {
  const seenPhone = new Set();
  const seenCompany = new Set();
  const out = [];
  for (const lead of leads) {
    const phoneKey = lead.phone && lead.phone.length >= 7 ? lead.phone : null;
    const companyKey = !phoneKey ? String(lead.company || '').toLowerCase().trim() : null;
    if (phoneKey) {
      if (seenPhone.has(phoneKey)) continue;
      seenPhone.add(phoneKey);
    } else if (companyKey) {
      if (seenCompany.has(companyKey)) continue;
      seenCompany.add(companyKey);
    } else {
      continue;
    }
    out.push(lead);
  }
  return out;
}

function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { return null; }
  }
  if (!b || typeof b !== 'object') return null;
  return b;
}

async function fetchMaps({ sdKey, states, deadline, limit, bucket, mapsCallsRef, warnings }) {
  for (const state of states) {
    if (bucket.length >= limit || Date.now() > deadline) break;
    const cities = (CITIES_BY_STATE[state] || []).slice(0, 5);
    for (const city of cities) {
      if (bucket.length >= limit || Date.now() > deadline) break;
      for (const category of MAPS_CATEGORIES) {
        if (bucket.length >= limit || Date.now() > deadline) break;
        const query = `${category} in ${city} ${state}`;
        const u = new URL('https://api.scrapingdog.com/google_maps');
        u.searchParams.set('api_key', sdKey);
        u.searchParams.set('query', query);
        u.searchParams.set('results', '20');
        mapsCallsRef.n++;
        let r;
        try {
          r = await fetch(u.toString(), { signal: AbortSignal.timeout(30000) });
        } catch (e) {
          warnings.push(`Maps fetch error (${city} ${state}): ${e && e.message}`);
          continue;
        }
        if (!r.ok) {
          warnings.push(`Maps HTTP ${r.status} for "${query}"`);
          await sleep(1500);
          continue;
        }
        let data;
        try { data = await r.json(); } catch { continue; }

        // ScrapingDog Google Maps returns search_results[] — NOT local_results or results
        const results = data.search_results || [];
        for (const biz of results) {
          if (bucket.length >= limit) break;
          const phone = normalizePhone(biz.phone || biz.phone_number || '');
          if (!phone) continue;
          const industry = (biz.type || category).replace(' in ' + city + ' ' + state, '').trim();
          bucket.push(makeLead({
            company: biz.title || '',
            phone,
            city,
            state,
            source: 'Google Maps',
            industry: industry.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 60),
            notes: `Rating: ${biz.rating || '—'} | Reviews: ${biz.reviews ?? '—'}`,
          }));
        }
        await sleep(800);
      }
    }
  }
}

async function fetchApollo({ apolloKey, states, deadline, limit, bucket, warnings }) {
  const url = 'https://api.apollo.io/api/v1/mixed_people/api_search';
  const headers = {
    accept: 'application/json',
    'Content-Type': 'application/json',
    'x-api-key': apolloKey,
  };
  let page = 1;
  while (bucket.length < limit && Date.now() < deadline) {
    const payload = {
      person_titles: APOLLO_TITLES,
      person_seniorities: ['owner', 'founder', 'c_suite'],
      organization_locations: states.map((s) => `${s}, United States`),
      organization_num_employees_ranges: ['1,10'],
      q_keywords: 'small business services',
      per_page: Math.min(100, limit - bucket.length + 50),
      page,
    };
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      warnings.push(`Apollo fetch error: ${e && e.message}`);
      break;
    }
    if (r.status === 429) { await sleep(60000); continue; }
    if (!r.ok) { warnings.push(`Apollo HTTP ${r.status}`); break; }
    let data;
    try { data = await r.json(); } catch { break; }
    const people = data.people || [];
    if (!people.length) break;
    for (const p of people) {
      if (bucket.length >= limit) break;
      const org = p.organization || {};
      const name = `${p.first_name || ''} ${p.last_name_obfuscated || ''}`.trim();
      const phone = normalizePhone(p.phone_number || (p.phone_numbers && p.phone_numbers[0] && p.phone_numbers[0].sanitized_number) || '');
      bucket.push(makeLead({
        company: org.name || '',
        phone,
        city: org.city || '',
        state: (org.state || '').slice(0, 2).toUpperCase() || (states[0] || ''),
        source: 'Apollo',
        industry: org.industry || '',
        notes: `Contact: ${name} | Title: ${p.title || ''} | Has phone: ${p.has_direct_phone || false}`,
      }));
    }
    if (people.length < 100) break;
    page++;
    await sleep(800);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = parseBody(req);
  if (!body) return res.status(400).json({ error: 'Invalid JSON' });

  const scraperSecret = process.env.SCRAPER_SECRET || 'Free2026';
  if (body.secret !== scraperSecret) return res.status(401).json({ error: 'Wrong scraper password' });

  const sdKey = process.env.SCRAPINGDOG_API_KEY || '';
  const apolloKey = process.env.APOLLO_API_KEY || process.env.APOLLO_KEY || '';

  if (!sdKey) {
    return res.status(500).json({ ok: false, error: 'SCRAPINGDOG_API_KEY is not set.' });
  }

  let states = Array.isArray(body.states) ? body.states.map((s) => String(s).toUpperCase().slice(0, 2)).filter((s) => /^[A-Z]{2}$/.test(s)) : [];
  if (!states.length) states = ['TX', 'FL'];

  let limit = 200;
  if (body.limit != null) {
    const n = parseInt(String(body.limit), 10);
    if (!isNaN(n)) limit = Math.min(2000, Math.max(1, n));
  }

  const startTime = Date.now();
  const deadline = startTime + 270000;
  const bucket = [];
  const warnings = [];
  const mapsCallsRef = { n: 0 };

  // Always add source context
  warnings.push('FMCSA: skipped — API has no state-filter endpoint and no phone field in carrier records.');
  warnings.push('Yelp: skipped — ScrapingDog lite plan does not include Yelp API; phone not returned even on paid plans.');

  try {
    await fetchMaps({ sdKey, states, deadline, limit, bucket, mapsCallsRef, warnings });
  } catch (e) {
    warnings.push(`Maps pipeline error: ${e && e.message}`);
  }

  if (apolloKey && bucket.length < limit && Date.now() < deadline) {
    try {
      await fetchApollo({ apolloKey, states, deadline, limit, bucket, warnings });
    } catch (e) {
      warnings.push(`Apollo pipeline error: ${e && e.message}`);
    }
  } else if (!apolloKey) {
    warnings.push('Apollo: skipped (APOLLO_API_KEY not set).');
  }

  const deduped = deduplicate(bucket);
  const withPhone = deduped.filter((l) => l.phone && l.phone.length >= 7);
  const noPhone = deduped.length - withPhone.length;
  const out = withPhone.slice(0, limit);

  const bySource = {};
  for (const l of out) {
    bySource[l.source] = (bySource[l.source] || 0) + 1;
  }

  return res.status(200).json({
    ok: true,
    leads: out,
    count: out.length,
    bySource,
    droppedNoPhone: noPhone,
    warnings,
    elapsedMs: Date.now() - startTime,
    mapsRequests: mapsCallsRef.n,
    yelpRequests: 0,
  });
};
