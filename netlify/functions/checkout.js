// Coach App — dynamic Stripe Checkout (Voca-style).
// The app sends the selection (which coaches / bundle, which period); this function
// maps it to your Stripe Price IDs, creates a Checkout Session, and returns its URL.
// The app then redirects the buyer to Stripe. Prices are NEVER trusted from the client —
// only price *keys* are sent; the amounts live in Stripe.
//
// Environment variables (Netlify → Site settings → Environment):
//   STRIPE_SECRET_KEY        sk_live_… (or sk_test_… while testing)
//   PRICE_MARKUS_MONTHLY     price_…   (recurring price for Markus)
//   PRICE_SAM_MONTHLY        price_…
//   PRICE_FITNESS_MONTHLY    price_…
//   PRICE_BUNDLE_MONTHLY     price_…   (all coaches)
//
// NOTE ON UNLOCKING ACCESS (production step): after payment Stripe redirects to
// success_url. For a real entitlement, add a Stripe webhook (checkout.session.completed)
// that issues a per-buyer token and emails them a link with ?key=TOKEN. Until that's
// wired, success_url returns ?paid=1 and the app grants local access (MVP).

const PRICES = {
  markus_monthly:  () => process.env.PRICE_MARKUS_MONTHLY,
  sam_monthly:     () => process.env.PRICE_SAM_MONTHLY,
  fitness_monthly: () => process.env.PRICE_FITNESS_MONTHLY,
  bundle_monthly:  () => process.env.PRICE_BUNDLE_MONTHLY,
};

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
    const period = body.period === 'monthly' ? 'monthly' : 'monthly'; // only monthly for now
    const email = (typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) ? body.email : null;

    // Resolve selected keys → Stripe price ids
    const priceIds = [];
    for (const it of items) {
      const key = String(it) + '_' + period;
      const resolver = PRICES[key];
      const pid = resolver && resolver();
      if (pid) priceIds.push(pid);
    }
    if (!priceIds.length) return { statusCode: 400, body: JSON.stringify({ error: 'no_valid_items' }) };

    const origin = event.headers.origin || event.headers.Origin ||
      ('https://' + (event.headers.host || 'localhost'));

    const params = {
      'mode': 'subscription',
      'success_url': origin + '/?paid=1',
      'cancel_url': origin + '/?paid=0',
      'allow_promotion_codes': 'true',
    };
    if (email) params['customer_email'] = email;
    const parts = form(params);
    priceIds.forEach((pid, i) => {
      parts.push('line_items[' + i + '][price]=' + encodeURIComponent(pid));
      parts.push('line_items[' + i + '][quantity]=1');
    });

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
