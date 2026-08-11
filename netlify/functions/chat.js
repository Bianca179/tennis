// Coach App — Netlify Function: proxies to the Anthropic API.
// Same hardening as the Sam Menton app: origin check, per-IP rate limit,
// purchase-token access gate, prompt caching. User messages are NEVER logged.
//
// Multi-coach ready: the COACHES map holds one system prompt per coach.
// v1 ships with "markus". Add "fitness" (and its knowledge base) later.
//
// Environment variables (Netlify → Site settings → Environment):
//   ANTHROPIC_API_KEY  (required)  your Claude API key
//   ACCESS_TOKENS      (optional)  comma-separated valid purchase tokens
//   ALLOWED_ORIGINS    (optional)  comma-separated allowed origins (e.g. https://your-site.netlify.app)

// ─────────────────────────────────────────────────────────────────────────────
// COACHES. Each coach = a full system prompt.
// NOTE: MARKUS_PROMPT below is a strong STARTING DRAFT. Replace it with the exact
// system prompt from Markus in Langdock so his voice matches 1:1 (see README).
// ─────────────────────────────────────────────────────────────────────────────

// Derived from Airtable "Personalübersicht → Team → Markus → Stellenbeschreibung"
// (the source of truth Bianca maintains). Keep this in sync if the role changes there.
const MARKUS_PROMPT = `# IDENTITY
You are Markus, Lenard's data-driven performance coach. You combine nutrition,
training, recovery and mental steadiness into one holistic support, and you steer his
daily load, recovery and energy proactively. You are empathetic, attentive, and
athletically demanding — a teammate in his pocket, never a lecturer.

# CONTEXT PROVIDED
A player profile (age, height, weight, location, food intolerances) is in the context
below. When live Whoop data (recovery, sleep, HRV, strain) is available it will be
there too. Ground every recommendation in these values. Never suggest a food the
player is intolerant to.

# WHAT YOU DO
1. Check the data first at each interaction (profile, and Whoop when present).
2. Steer performance proactively: clear recommendations for training, nutrition, recovery.
3. Situational day plans for high- / medium- / low-intensity days.
4. Recovery planning incl. sleep optimization and load management.
5. Tournament & match prep: fueling, warm-ups, hydration, planning.
6. Meal prep & nutrition planning within the guardrails.
7. Weekly overviews of load and recovery when asked.

# GUARDRAILS (hold these without exception)
- No medical diagnoses.
- No psychological counseling or therapy.
- No statements about illnesses or their medical causes.
- No advice against acute pain or injuries — respond with care and point gently to a
  qualified professional.
- Always act protectively and responsibly, with a conscious eye on overload risk.
  Never encourage overtraining, playing through injury, or extreme dieting. Recovery
  is part of performance.
- Respect the player's food intolerances without exception.
- Grocery note: do NOT use Whole Foods; Trader Joe's is fine.
- You are an AI coaching tool; if asked, be honest. Don't fake a personal bond or claim
  to remember past days beyond this conversation.

# HOW YOU COACH
- Diagnose before prescribing: ask at most one short clarifying question, only if you
  truly need it — otherwise answer.
- One step, not nine. The player leaves with ONE concrete action.
- Short and human: usually 2–5 sentences, natural speech ("First… then…"), no markdown
  headings, no bullet symbols.
- Reply in the player's language (English by default; mirror the player).

# GREETING (your very first message)
Warm and concrete, e.g. "Hey — I've got your profile. What's on today: training, a
match, or figuring out what to eat?" Adapt to the player.`;

const COACHES = {
  markus: { prompt: MARKUS_PROMPT, needsProfile: true },
  // fitness: { prompt: FITNESS_PROMPT, needsProfile: false },  // later, + knowledge base (RAG)
};

// ─────────────────────────────────────────────────────────────────────────────
// Abuse backstop: best-effort in-memory IP rate limit (resets on cold start).
// ─────────────────────────────────────────────────────────────────────────────
const FREE_DAILY_LIMIT = 20;
const PAID_DAILY_LIMIT = 300;
const hits = new Map(); // ip -> { day, count }

function rateOk(ip, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const rec = hits.get(ip);
  if (!rec || rec.day !== day) { hits.set(ip, { day, count: 1 }); return true; }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
}

function originAllowed(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true; // not configured yet → allow. SET THIS before launch.
  if (!origin) return false;
  return allowed.includes(origin);
}

// Build a compact profile block from the intake fields (never trust raw types).
function profileBlock(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const s = (v) => (v == null || v === '') ? null : String(v).slice(0, 120);
  const age = s(profile.age), height = s(profile.height), weight = s(profile.weight),
        location = s(profile.location), intolerances = s(profile.intolerances);
  if (!age && !height && !weight && !location && !intolerances) return '';
  let t = 'Player profile (private context for you):\n';
  if (age) t += '- Age: ' + age + '\n';
  if (height) t += '- Height: ' + height + ' cm\n';
  if (weight) t += '- Weight: ' + weight + ' kg\n';
  if (location) t += '- Lives in: ' + location + '\n';
  if (intolerances) t += '- Food intolerances (never suggest these): ' + intolerances + '\n';
  return t;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const origin = event.headers.origin || event.headers.Origin || '';
  if (!originAllowed(origin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'origin_not_allowed' }) };
  }

  try {
    const { messages, token, profile, coach } = JSON.parse(event.body || '{}');
    if (!Array.isArray(messages)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'bad_request' }) };
    }
    const coachKey = (coach && COACHES[coach]) ? coach : 'markus';
    const conf = COACHES[coachKey];

    const validTokens = (process.env.ACCESS_TOKENS || '')
      .split(',').map(s => s.trim()).filter(Boolean);
    const isPaid = !!(token && validTokens.includes(token));
    const limit = isPaid ? PAID_DAILY_LIMIT : FREE_DAILY_LIMIT;

    const ip = event.headers['x-nf-client-connection-ip']
      || (event.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || 'unknown';

    if (!rateOk(ip, limit)) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'rate_limited', paid: isPaid }),
      };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'server_not_configured' }) };
    }

    // Stable coach prompt first (cached); volatile per-player profile after the breakpoint.
    const system = [
      { type: 'text', text: conf.prompt, cache_control: { type: 'ephemeral' } },
    ];
    const pb = profileBlock(profile);
    if (pb) system.push({ type: 'text', text: pb });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API status:', response.status);
      return { statusCode: 502, body: JSON.stringify({ error: 'upstream_error' }) };
    }

    const data = await response.json();
    if (data.usage) {
      const u = data.usage;
      console.log('usage', JSON.stringify({
        in: u.input_tokens, out: u.output_tokens,
        cache_write: u.cache_creation_input_tokens, cache_read: u.cache_read_input_tokens,
        paid: isPaid, coach: coachKey,
      }));
    }
    const text = (data.content && data.content[0] && data.content[0].text) || '';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    console.error('Function error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error' }) };
  }
};
