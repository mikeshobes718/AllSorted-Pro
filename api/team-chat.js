const {
  mergeTrainingLinksWithDefaults,
  formatResourcesKnowledgeForAssistant,
} = require('./training-library-shared');

const { getSupabaseAdmin } = require('../lib/supabase-server');

const BUILT_IN_KNOWLEDGE = `
## AllSorted Pro — Company Overview
AllSorted Pro is a done-for-you bookkeeping service built for small business owners across the United States. We handle monthly bookkeeping inside QuickBooks Online so owners never have to touch their own books.

### What We Do (included in every plan)
- Monthly bookkeeping in QuickBooks Online (categorized & reconciled)
- Bank & credit card reconciliation
- Expense categorization
- Monthly Profit & Loss statement (P&L)
- Tax-ready books year-round
- Dedicated bookkeeper (same person every month)
- Support via hello@allsortedpro.com or (917) 773-3276

### Pricing (memorize this — callers ask constantly)
- **First 2 weeks: FREE** — no credit card, no commitment, full service
- **Months 1–3 after trial: $97/month** — proving period so client sees the value
- **Month 4 onward: $197/month** — still a fraction of a local bookkeeper ($300–$500+)
- No long-term contract. Month-to-month. Cancel anytime with 30 days' notice.
- Catch-up bookkeeping for clients who are months behind: mention on the free call for a custom quote.

### Ideal Customer
- Small business owners who are doing their own books (or not doing them at all)
- Owners spending 5–10 hours/month on bookkeeping
- Owners whose books are 2–3+ months behind
- Owners dreading tax season or quarterly estimates
- Owners paying their CPA extra to clean up messy books
- Any industry with financial transactions — we are not niche-specific

### How It Works (3-step onboarding)
1. **Book a free 15-minute call** — we learn about the business and accounts. No pressure, no pitch.
2. **Setup** — we connect via QuickBooks. The client does not lift a finger.
3. **Clean books, every month** — reconciled accounts and a P&L delivered monthly.

### Booking Link & Contact
- Calendly: https://calendly.com/hello-allsortedpro/30min
- Phone: (917) 773-3276
- Email: hello@allsortedpro.com
- Website: https://allsortedpro.com

---

## Cold Call Script & Objection Handling

### Opening (Cold Open)
"Hi, is this [Owner Name]?
Great, this is [Your Name] calling from AllSorted Pro. We do bookkeeping specifically for small business owners — a lot of the owners we talk to are spending 5 to 10 hours a month dealing with their own books.
We offer the first two weeks completely free — no credit card, no commitment — just to show you what we do. Is that something worth a quick 15-minute conversation?"

### If They Say "What Is This About?"
"Sure — we handle bookkeeping for business owners. We do everything in QuickBooks — reconciling your accounts, categorizing expenses, sending you a monthly report. Most owners save 6 to 8 hours a month. Your first two weeks are completely free, no credit card. Does that sound like it could help you?"

### Booking the Appointment
"I can send you a link right now to grab a 15-minute time slot that works for you. It's completely free, no pressure. What's a good email or number to send that to?"

### Objection Responses

**"I already have a bookkeeper/accountant"**
"That's great — a lot of our clients have CPAs too. We actually make their job easier by delivering clean, organized books every month. Most CPAs love it because it saves them time at tax season. Is your bookkeeping fully caught up right now?"

**"I do it myself"**
"Totally get it — how many hours would you say it takes you each month? Most owners tell us 5 to 10. That's real time back in your day. After the two-week free trial, it's $97/month for three months while we prove our value, then $197 — still a fraction of a local bookkeeper. Worth a 15-minute chat?"

**"How much does it cost?"**
"First two weeks are completely free — no credit card, no commitment. After that it's $97/month for the first three months while we prove our value, then $197/month. That's still a fraction of what a local bookkeeper charges. Most owners spend more than that on software they barely use."

**"Not interested"**
"Totally fair. Can I just ask — is it that bookkeeping is handled, or more that the timing isn't right? Either way I won't bother you, I just want to understand."

**"Send me an email"**
"Absolutely. What's the best email? And just so I can personalize it — is bookkeeping something you're handling yourself right now or do you have someone?"

**"I'm busy right now"**
"Of course — when's a better time to call back? I'll put it in the calendar and reach out then."

### Calling Best Practices
- Always be warm, professional, conversational — never robotic
- Use the prospect's name
- Mirror their language and energy
- Don't oversell — the free trial sells itself
- If they have any interest at all, get the appointment booked
- Log every call attempt — even voicemails and no-answers — in the dashboard
- Set callback reminders for "call me later" prospects
- Target: 80+ dials per day, 14+ conversations

---

## Team Operations & Compensation

### Caller Commission & Pay Structure
- **$25 one-time bonus** per **Won** appointment only — **not** for Showed alone. In Appointments, set **Won — paid + 2+ weeks onboarded** when payment is in and onboarding is complete. Log with your employee ID so commission attributes correctly.
- **Base pay**: $200/month if you hit 80+ dials/day consistently
- **Recurring**: $10/month per active client you personally closed
- **Closes target**: 5/month

### Lead Statuses (portal)
- **New** — not worked yet
- **No Answer** — attempted, no contact
- **Callback** — they asked to be called back (don't lose these!)
- **Booked** — meeting scheduled
- **Not Interested** — declined or disqualified
- **Called** — attempted; update to a specific status when you know the outcome

### Appointment Statuses
- **Scheduled** — upcoming meeting
- **Showed** — client attended the meeting
- **No Show** — client did not attend
- **Cancelled** — meeting was cancelled
- **Won** — use ONLY when payment is in AND client completed at least two weeks of onboarding (not just "meeting went well")

### Shift Options
- **Shift A (EST, recommended)**: 8am–12pm EST / 9pm–1am PHT — 4hrs/day, 5 days/week = 20hrs/week
- **Shift B (CST, alternative)**: 8am–12pm CST / 10pm–2am PHT — same hours

### Career Path: Sales Manager
Open position — earned, not given. Requirements:
- Minimum 3 months as a caller
- 30+ clients personally closed
- Zero ghost days in last 60 days
- Consistent 80+ daily dials
What the Sales Manager gets:
- $400/month base pay (reduced to 40 dials/day)
- $25 bonus per personal **Won** (same as caller — paid client), still active
- $5/month recurring per active client ANY team member closes
- $10/month recurring on your own clients
- Example: 50 team clients = ~$650/month; 100 = ~$900/month+

---

## QuickBooks & Bookkeeping Basics (for caller context)

### What Is Bookkeeping?
Recording, categorizing, and reconciling a business's financial transactions. Ensures books are accurate for tax filing, financial decisions, and compliance.

### Key Terms Callers Should Know
- **Reconciliation**: Matching bank/credit card statements against QuickBooks records to make sure nothing is missing or duplicated.
- **Categorization**: Assigning each transaction to the right expense category (rent, utilities, supplies, etc.).
- **P&L (Profit & Loss)**: A report showing revenue minus expenses for a period. Also called an income statement. This is the #1 deliverable we send clients monthly.
- **Balance Sheet**: A snapshot of assets, liabilities, and owner's equity at a point in time.
- **Trial Balance**: A list of all accounts and their balances — used to verify debits equal credits.
- **Accounts Payable (AP)**: Money the business owes to suppliers.
- **Accounts Receivable (AR)**: Money owed to the business by customers.
- **Chart of Accounts**: The list of all categories/accounts in QuickBooks.

### Why Clean Books Matter (use in calls)
- Avoids nasty surprises at tax time
- Makes quarterly estimates easier
- Gives owners a real picture of profitability
- CPAs charge LESS when books are already clean
- Required for loans, investors, or selling the business

---

## Portal & Dashboard Guide

### Pages
- **Overview** — today's stats: calls, bookings, show rate, commission, recent activity, lead breakdown
- **Goals** — personal targets and progress tracking
- **Time Clock** — clock in/out, breaks, today's hours, 14-day timesheet (everyone; sidebar under Dashboard)
- **Lead Queue** — working list of prospects; sync from server, add companies, set statuses
- **Call Log** — full history of attempts and outcomes
- **Appointments** — all booked meetings with contact count tracking
- **Admin** (admin only) — scraper, database, AI config, team management, signup approvals, **Timesheets** tab (oversight, manual adjustments, activity feed)
- **Quo line** (admin only) — OpenPhone / Quo API data for the sales line
- **Script & Objections** — talk tracks and rebuttals to reference during calls
- **Team assistant** — this AI helper
- **Resources** — training videos, presentations, links, legal documents
- **Settings** — profile, display name, password

### Dialing Software
The team uses **Dialpad** for calling and messaging. Download: https://www.dialpad.com/download/

### Time Clock & attendance (official — answer these questions from this section)

**Where:** Caller portal → left sidebar → **Dashboard** section → **Time Clock**. You can also use the URL hash **#timeclock** on the dashboard page.

**What it is:** The built-in **Time Clock** is how we record work time. Clock in when you start your shift, clock out when you finish. Breaks are tracked with **Start Break** / **End Break** so net hours exclude break time.

**Buttons on the Time Clock page:**
- **Clock In** (green) — start of your work period
- **Start Break** / **End Break** — step away for meal or rest (amber / blue)
- **Clock Out** (red) — end of shift
- Optional **note** field — e.g. late start with manager approval, or other context

**On the same page:** **Today's summary** (hours worked, break count, total break time) and **My Timesheet** for the **last 14 days** (date, clock in/out, breaks, net hours, notes per shift).

**How it connects to shifts:** Use **Shift Options** above (Shift A EST or Shift B CST). Clock in when you begin your scheduled window unless your manager gives different instructions.

**Admins:** **Admin** → **Timesheets** tab — who's working now, date-range team timesheet browser, weekly summary cards, attendance flags, manual time adjustments, 24-hour team activity feed.

**Assistant rule:** If someone asks how to clock in, track hours, or log attendance, **always** explain using **Time Clock** in the sidebar. **Do not** say the time clock is missing from documentation or that you cannot answer — it is documented here and in the portal.

---

## FAQ — Common Caller Questions

**Q: Does the client need to know QuickBooks?**
A: No. We handle everything inside QuickBooks. They get simple monthly reports.

**Q: What if the client is months behind?**
A: We offer catch-up bookkeeping. Tell them to mention it on the free call and we'll give a straightforward quote.

**Q: Is there a contract?**
A: No. Month-to-month, cancel anytime with 30 days' notice.

**Q: What types of businesses do we work with?**
A: Any small business with financial transactions. We are not niche-specific — restaurants, contractors, e-commerce, services, you name it.

**Q: What happens during the free two weeks?**
A: Full service — exactly what they'd get as a paying client. No credit card required to start.

**Q: Is the client's data secure?**
A: Yes. We use QuickBooks Online accountant access, which is secure and encrypted. No sensitive data is shared over email.

**Q: What if I don't know the answer to a prospect's question?**
A: Say "Great question — let me confirm that with my team and get right back to you." Then ask a manager or check here.

**Q: How do I clock in or track my hours?**
A: Open the portal → sidebar **Dashboard** → **Time Clock**. Tap **Clock In** at shift start, use **Start Break** / **End Break** as needed, **Clock Out** when done. Your timesheet for the last 14 days is on that page. Admins use **Admin** → **Timesheets** for team oversight.
`.trim();

async function getAssistantKbExtra() {
  const envKb = process.env.TEAM_ASSISTANT_KNOWLEDGE || '';
  const supabase = getSupabaseAdmin();
  let kvKb = '';
  if (supabase) {
    try {
      const { data } = await supabase.from('portal_content').select('value').eq('key', 'assistant_kb').maybeSingle();
      if (data && data.value) {
        kvKb = typeof data.value === 'object' && data.value.content ? String(data.value.content) : '';
      }
    } catch {
      kvKb = '';
    }
  }
  let resourcesKb = '';
  try {
    let stored = [];
    if (supabase) {
      try {
        const { data } = await supabase.from('portal_content').select('value').eq('key', 'training_links').maybeSingle();
        if (data && data.value) {
          stored = Array.isArray(data.value) ? data.value : [];
        }
      } catch {
        stored = [];
      }
    }
    if (!Array.isArray(stored)) stored = [];
    const merged = mergeTrainingLinksWithDefaults(stored);
    resourcesKb = formatResourcesKnowledgeForAssistant(merged);
  } catch {
    resourcesKb = formatResourcesKnowledgeForAssistant(mergeTrainingLinksWithDefaults([]));
  }
  const parts = [BUILT_IN_KNOWLEDGE, kvKb.trim(), envKb.trim(), resourcesKb.trim()].filter(Boolean);
  return parts.join('\n\n');
}

function mergeKnowledgeIntoMessages(messages, kbBlock) {
  if (!kbBlock) return messages;
  const msgs = messages.map(function (m) {
    return { role: m.role, content: m.content };
  });
  const block =
    '\n\n---\nAdditional business context (admin knowledge base / env / built-in):\n' + kbBlock;
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
        'You are the AllSorted Pro Team Assistant — a knowledgeable, friendly AI helper for the AllSorted Pro calling team.' +
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
          temperature: 0.5,
          max_tokens: 4096,
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
