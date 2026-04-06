const {
  mergeTrainingLinksWithDefaults,
  formatResourcesKnowledgeForAssistant,
} = require('./training-library-shared');

function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return null;
  }
  try {
    return require('@vercel/kv').kv;
  } catch {
    return null;
  }
}

async function getAssistantKbExtra() {
  const envKb = process.env.TEAM_ASSISTANT_KNOWLEDGE || '';
  const kv = getKv();
  let kvKb = '';
  if (kv) {
    try {
      const raw = await kv.get('portal:assistant_kb');
      if (raw != null) {
        kvKb = typeof raw === 'string' ? raw : String(raw);
      }
    } catch {
      kvKb = '';
    }
  }
  let resourcesKb = '';
  try {
    let stored = [];
    if (kv) {
      let raw;
      try {
        raw = await kv.get('portal:training_links');
      } catch {
        raw = null;
      }
      if (raw != null) {
        if (typeof raw === 'string') {
          try {
            stored = JSON.parse(raw);
          } catch {
            stored = [];
          }
        } else if (Array.isArray(raw)) {
          stored = raw;
        }
      }
    }
    if (!Array.isArray(stored)) stored = [];
    const merged = mergeTrainingLinksWithDefaults(stored);
    resourcesKb = formatResourcesKnowledgeForAssistant(merged);
  } catch {
    resourcesKb = formatResourcesKnowledgeForAssistant(mergeTrainingLinksWithDefaults([]));
  }
  const parts = [kvKb.trim(), envKb.trim(), resourcesKb.trim()].filter(Boolean);
  return parts.join('\n\n');
}

function mergeKnowledgeIntoMessages(messages, kbBlock) {
  if (!kbBlock) return messages;
  const msgs = messages.map(function (m) {
    return { role: m.role, content: m.content };
  });
  const block =
    '\n\n---\nAdditional business context (admin knowledge base / env):\n' + kbBlock;
  let idx = msgs.findIndex(function (m) {
    return m.role === 'system';
  });
  if (idx >= 0) {
    const c = msgs[idx].content;
    const base = typeof c === 'string' ? c : '';
    msgs[idx] = {
      role: 'system',
      content: base + block,
    };
  } else {
    msgs.unshift({
      role: 'system',
      content:
        'You are a helpful assistant for AllSorted Pro, a bookkeeping service for small business owners.' +
        block,
    });
  }
  return msgs;
}

function openRouterErrorMessage(data) {
  if (!data || typeof data !== 'object') return '';
  const e = data.error;
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  if (e && typeof e === 'object' && e.message != null) return String(e.message);
  return '';
}

function extractCompletionText(data) {
  if (!data || typeof data !== 'object') return { error: 'Invalid response' };
  const ch = data.choices && data.choices[0] && data.choices[0].message;
  if (ch && typeof ch.content === 'string') {
    return { text: ch.content };
  }
  if (ch && Array.isArray(ch.content)) {
    const joined = ch.content
      .map(function (p) {
        if (!p || typeof p !== 'object') return '';
        if (p.type === 'text' && p.text != null) return String(p.text);
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (joined) return { text: joined };
  }
  if (data.error) {
    return { error: openRouterErrorMessage(data) || 'Provider returned error' };
  }
  if (Array.isArray(data.choices) && data.choices.length === 0) {
    return { error: 'Empty choices from model' };
  }
  return { error: 'No completion in response' };
}

function messagesHaveUserImages(messages) {
  if (!Array.isArray(messages)) return false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const c = m.content;
    if (!Array.isArray(c)) continue;
    for (let j = 0; j < c.length; j++) {
      const p = c[j];
      if (
        p &&
        p.type === 'image_url' &&
        p.image_url &&
        typeof p.image_url.url === 'string' &&
        p.image_url.url
      ) {
        return true;
      }
    }
  }
  return false;
}

function buildModelList(hasVision) {
  const primary = process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4.6';
  const extra = (process.env.OPENROUTER_MODEL_FALLBACKS || '')
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  const visionFallbacks = [
    'google/gemini-2.0-flash-001',
    'anthropic/claude-3.5-sonnet',
  ];
  const smallFallbacks = [
    'google/gemma-2-9b-it:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
  ];
  const defaults = hasVision
    ? [primary].concat(visionFallbacks).concat(smallFallbacks)
    : [primary].concat(smallFallbacks).concat(visionFallbacks);
  const all = defaults.concat(extra);
  const seen = {};
  return all.filter(function (m) {
    if (!m || seen[m]) return false;
    seen[m] = true;
    return true;
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const messagesIn = body.messages;
  if (!Array.isArray(messagesIn) || messagesIn.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Assistant is not configured yet.',
      code: 'missing_openrouter_key',
    });
  }

  let kbExtra = '';
  try {
    kbExtra = await getAssistantKbExtra();
  } catch {
    kbExtra = '';
  }
  const hasVision = messagesHaveUserImages(messagesIn);
  let messages;
  try {
    messages = JSON.parse(
      JSON.stringify(mergeKnowledgeIntoMessages(messagesIn, kbExtra))
    );
  } catch {
    return res.status(400).json({ error: 'Invalid message payload' });
  }

  const models = buildModelList(hasVision);
  const siteUrl = process.env.OPENROUTER_SITE_URL || 'https://allsortedpro.com';

  let lastErr = '';

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    let resp;
    try {
      resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': siteUrl,
          'X-Title': 'AllSorted Pro Team Assistant',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.6,
          max_tokens: 3072,
        }),
      });
    } catch (e) {
      lastErr = e && e.message ? e.message : 'Upstream request failed';
      continue;
    }

    let data;
    try {
      data = await resp.json();
    } catch {
      lastErr = 'Invalid JSON from OpenRouter';
      continue;
    }

    if (!resp.ok) {
      const msg =
        openRouterErrorMessage(data) ||
        (data && data.message) ||
        'OpenRouter error ' + resp.status;
      lastErr = typeof msg === 'string' ? msg : JSON.stringify(msg);
      continue;
    }

    const extracted = extractCompletionText(data);
    if (extracted.error) {
      lastErr = extracted.error;
      continue;
    }

    return res.status(200).json({
      ok: true,
      text: extracted.text,
      model,
      fallbackIndex: i,
    });
  }

  return res.status(502).json({
    error:
      lastErr ||
      'All configured models failed. Check OpenRouter status or set OPENROUTER_MODEL / OPENROUTER_MODEL_FALLBACKS.',
  });
};
