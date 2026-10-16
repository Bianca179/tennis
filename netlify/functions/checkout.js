// Coach App — dynamic Stripe Checkout (Voca-style).
// The app sends the selection (which coaches / bundle, which period); this function
// maps it to your Stripe Price IDs, creates a Checkout Session, and returns its URL.
// The app then redirects the buyer to Stripe. Prices are NEVER trusted from the client —
// only price *keys* are sent; the amounts live in Stripe.
//
// Environment variables (Netlify → Site configuration → Environment variables):
//   STRIPE_SECRET_KEY   sk_live_… or a restricted key (rk_live_…) with Checkout Sessions: write
//
// Prices (Stripe account "AIVa", created 2026-10-16; public IDs, not secret):
//   1 coach          €12.90 / $13.90 per month  → PRICE_SINGLE (USD via currency_options)
//   all three coaches €25.80 / $27.80 per month → PRICE_BUNDLE  ("3 for the price of 2")
// Two or more coaches selected = the bundle (it costs the same as two).
//
// NOTE ON UNLOCKING ACCESS (production step): after payment Stripe redirects to
// success_url. For a real entitlement, add a Stripe webhook (checkout.session.completed)
// that issues a per-buyer token and emails them a link with ?key=TOKEN. Until that's
// wired, success_url returns ?paid=1 and the app grants local access (MVP).

const PRICE_SINGLE = process.env.PRICE_SINGLE || 'price_1URGhNGEviYfSgztQmQPwnAk';
const PRICE_BUNDLE = process.env.PRICE_BUNDLE || 'price_1URGjbGEviYfSgztFwNzsQfM';
const COACH_KEYS = ['markus', 'sam', 'alex'];

function form(obj) {
  // Stripe wants application/x-www-form-urlencoded with bracket notation.
  const parts = [];
  function add(key, val) { parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val)); }
  Object.keys(obj).forEach(k => add(k, obj[k]));
  return parts;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return { statusCode: 500, body: JSON.stringify({ error: 'stripe_not_configured' }) };

    const body = JSON.parse(event.body || '{}');
    const items = Array.isArray(body.items) ? body.items : [];
    const email = (typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) ? body.email : null;

    // Resolve the selection → exactly one Stripe price (never trust amounts from the client)
    const coaches = items.map(String).filter(k => COACH_KEYS.includes(k));
    const bundle = items.map(String).includes('bundle') || coaches.length >= 2;
    if (!bundle && coaches.length !== 1) return { statusCode: 400, body: JSON.stringify({ error: 'no_valid_items' }) };
    const priceId = bundle ? PRICE_BUNDLE : PRICE_SINGLE;
    const plan = bundle ? 'bundle' : coaches[0];

    const origin = event.headers.origin || event.headers.Origin ||
      ('https://' + (event.headers.host || 'localhost'));

    const params = {
      'mode': 'subscription',
      'success_url': origin + '/?paid=1',
      'cancel_url': origin + '/?paid=0',
      'allow_promotion_codes': 'true',
    };
    if (email) params['customer_email'] = email;
    // Same currency the app showed (both are defined on the Stripe prices).
    if (body.currency === 'usd' || body.currency === 'eur') params['currency'] = body.currency;
    const parts = form(params);
    parts.push('line_items[0][price]=' + encodeURIComponent(priceId));
    parts.push('line_items[0][quantity]=1');
    // Which coach a single-coach buyer chose (for support and, later, server-side access)
    parts.push('subscription_data[metadata][plan]=' + encodeURIComponent(plan));
    parts.push('metadata[plan]=' + encodeURIComponent(plan));
    // Partner who brought the buyer (e.g. "lenard"), for commission. Only a short slug is accepted.
    const ref = (typeof body.ref === 'string' && /^[a-z0-9_-]{1,30}$/i.test(body.ref)) ? body.ref.toLowerCase() : '';
    if (ref) {
      parts.push('metadata[ref]=' + encodeURIComponent(ref));
      parts.push('subscription_data[metadata][ref]=' + encodeURIComponent(ref));
    }
    // Auto-renewal disclosure right next to the pay button (US auto-renewal laws, EU transparency).
    const de = body.lang === 'de';
    const cancelUrl = origin + (de ? '/kuendigen.html' : '/en/cancel.html');
    const renewText = de
      ? 'Monatsabo: verlängert sich automatisch jeden Monat zum angezeigten Preis, bis du kündigst. Jederzeit online kündbar: ' + cancelUrl
      : 'Monthly subscription: renews automatically every month at the price shown until you cancel. Cancel anytime online: ' + cancelUrl;
    parts.push('custom_text[submit][message]=' + encodeURIComponent(renewText));

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + secret,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: parts.join('&'),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('stripe error:', data && data.error && data.error.message);
      return { statusCode: 502, body: JSON.stringify({ error: 'stripe_error' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ url: data.url }) };
  } catch (err) {
    console.error('checkout error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error' }) };
  }
};
