const DEFAULT_TRAINING_LINKS = [
  {
    title: 'Bookkeeping and Accounting Course for Beginners | From Basics to Trial Balance',
    url: 'https://www.youtube.com/watch?v=Wi82FpxMSW4',
    note: 'P&L, trial balance, and core fundamentals.',
    kind: 'Video',
  },
  {
    title: 'What is Bookkeeping and What Does a Bookkeeper Do?',
    url: 'https://www.youtube.com/watch?v=Q_6A1ieXgp4',
    note: 'Short intro: what bookkeepers do day-to-day and why clean books matter for owners.',
    kind: 'Video',
  },
  {
    title: 'The Only BOOKKEEPING Tutorial You Need 2026 | For Beginners',
    url: 'https://www.youtube.com/watch?v=24TFLVCceiQ',
    note: 'Balance sheet basics: assets, liabilities, equity.',
    kind: 'Video',
  },
  {
    title: 'Bookkeeping and Accounting Course for Beginners | Basics Explained | Financial Statements',
    url: 'https://www.youtube.com/watch?v=m58r-5LTxoI',
    note: 'How financial statements fit together.',
    kind: 'Video',
  },
  {
    title: 'Bookkeeping Mini Course for Beginners | From Basics to Trial Balance',
    url: 'https://www.youtube.com/watch?v=u3blMsCJnpM',
    note: 'Compact path from basics to trial balance.',
    kind: 'Video',
  },
  {
    title: 'AllSorted Pro Bookkeeping Training',
    url: '/allsortedpro_bookkeeping_training.pptx',
    note: 'Team deck — view in the browser or download. Best on desktop.',
    kind: 'Presentation',
  },
  {
    title: 'AllSorted Pro Cold Calling Training',
    url: '/allsortedpro_coldcalling_training_FINAL.pptx',
    note: 'Cold calling deck — view in the browser or download. Best on desktop.',
    kind: 'Presentation',
  },
  {
    title: 'Dialpad — app downloads',
    url: 'https://www.dialpad.com/download/',
    note: 'Download Dialpad for calling and messaging (desktop and mobile).',
    kind: 'Link',
  },
  {
    title: 'AllSorted Pro Contractor Agreement (v2)',
    url: '/allsortedpro_contractor_agreement.pdf',
    note: 'Latest contractor agreement (v2 PDF) — view in the browser or download.',
    kind: 'PDF',
    section: 'legal',
  },
];

function normalizeLinkSection(x, def) {
  var raw = '';
  if (x && x.section != null && String(x.section).trim() !== '') {
    raw = String(x.section).trim().toLowerCase();
  } else if (def && def.section != null && String(def.section).trim() !== '') {
    raw = String(def.section).trim().toLowerCase();
  } else {
    raw = 'training';
  }
  if (raw === 'legal') return 'legal';
  return 'training';
}

function normalizeTrainingUrl(u) {
  return String(u || '')
    .trim()
    .toLowerCase()
    .replace(/\/$/, '');
}

function defaultTrainingMatchForUrl(nu) {
  for (let k = 0; k < DEFAULT_TRAINING_LINKS.length; k++) {
    const d = DEFAULT_TRAINING_LINKS[k];
    if (normalizeTrainingUrl(d.url) === nu) return d;
  }
  return null;
}

function mergeTrainingLinksWithDefaults(stored) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(stored) ? stored : [];
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (!x || typeof x !== 'object') continue;
    const nu = normalizeTrainingUrl(x.url);
    if (!nu || seen.has(nu)) continue;
    seen.add(nu);
    const def = defaultTrainingMatchForUrl(nu);
    const noteRaw = String(x.note || '').trim();
    const noteMerged = String(noteRaw || (def && def.note) || '').slice(0, 500);
    out.push({
      title: String(x.title || '').slice(0, 200),
      url: String(x.url || '').trim().slice(0, 2000),
      note: noteMerged,
      kind: String(x.kind || 'Video').slice(0, 40),
      section: normalizeLinkSection(x, def),
    });
  }
  for (let j = 0; j < DEFAULT_TRAINING_LINKS.length; j++) {
    const d = DEFAULT_TRAINING_LINKS[j];
    const nu = normalizeTrainingUrl(d.url);
    if (!nu || seen.has(nu)) continue;
    seen.add(nu);
    out.push({
      title: d.title.slice(0, 200),
      url: d.url.trim().slice(0, 2000),
      note: d.note.slice(0, 500),
      kind: d.kind.slice(0, 40),
      section: normalizeLinkSection(null, d),
    });
  }
  return out;
}

function resourceSectionOf(item) {
  if (!item || typeof item !== 'object') return 'training';
  const nu = normalizeTrainingUrl(item.url);
  const def = defaultTrainingMatchForUrl(nu);
  return normalizeLinkSection(item, def);
}

function absoluteResourceUrlForKb(u, origin) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(origin || 'https://allsortedpro.com').replace(/\/$/, '');
  return base + (s.startsWith('/') ? s : '/' + s);
}

function formatResourcesKnowledgeForAssistant(links, origin) {
  if (!Array.isArray(links) || !links.length) return '';
  const site = origin || process.env.PORTAL_PUBLIC_URL || 'https://allsortedpro.com';
  const training = [];
  const legal = [];
  for (let i = 0; i < links.length; i++) {
    const x = links[i];
    if (!x || typeof x !== 'object') continue;
    if (resourceSectionOf(x) === 'legal') legal.push(x);
    else training.push(x);
  }
  const lines = [];
  lines.push('## Caller portal — Resources page (curated library)');
  lines.push(
    'The Team portal has a **Resources** page with two sections: **Training library** (videos, decks, links) and **Legal & agreements** (contracts/reference). Admins can edit the library under Admin → Resources library. When you recommend materials, use only titles and URLs from this list. Relative paths are on the site origin.'
  );
  lines.push('');
  lines.push('### Training library');
  if (!training.length) {
    lines.push('(none)');
  } else {
    training.forEach(function (it, idx) {
      const title = String(it.title || 'Untitled').replace(/\*/g, '') || 'Untitled';
      const kind = String(it.kind || 'Link') || 'Link';
      const u = absoluteResourceUrlForKb(it.url, site);
      lines.push(idx + 1 + '. **' + title + '** [' + kind + ']');
      if (it.note) lines.push('   - ' + String(it.note).replace(/\n/g, ' '));
      if (u) lines.push('   - ' + u);
    });
  }
  lines.push('');
  lines.push('### Legal & agreements');
  if (!legal.length) {
    lines.push('(none)');
  } else {
    legal.forEach(function (it, idx) {
      const title = String(it.title || 'Untitled').replace(/\*/g, '') || 'Untitled';
      const kind = String(it.kind || 'Link') || 'Link';
      const u = absoluteResourceUrlForKb(it.url, site);
      lines.push(idx + 1 + '. **' + title + '** [' + kind + ']');
      if (it.note) lines.push('   - ' + String(it.note).replace(/\n/g, ' '));
      if (u) lines.push('   - ' + u);
    });
  }
  lines.push('');
  lines.push(
    'The Resources page also has a **Browse by type** filter (Video, PDF, Presentation, etc.). Mention that filter when it helps people find the right format.'
  );
  var out = lines.join('\n');
  if (out.length > 20000) {
    out = out.slice(0, 20000) + '\n… [truncated]';
  }
  return out;
}

module.exports = {
  DEFAULT_TRAINING_LINKS,
  normalizeLinkSection,
  normalizeTrainingUrl,
  defaultTrainingMatchForUrl,
  mergeTrainingLinksWithDefaults,
  resourceSectionOf,
  formatResourcesKnowledgeForAssistant,
};
