// Coach App — email / lead capture → Airtable "Steuerzentrale".
//
// Writes each trial signup (and Whoop-setup request) into your EXISTING tables:
//   1) "Leads (Inbound)"  → tagged Lead-Spur = "App"
//   2) "Kontakte" (customer list) → tagged Tags = "App"
// (typecast:true creates the "App" select option automatically if it doesn't exist yet.)
//
// Environment variables (Netlify → Site settings → Environment):
//   AIRTABLE_TOKEN   Airtable Personal Access Token with data.records:write on the Steuerzentrale base
//   AIRTABLE_BASE    optional override; defaults to Steuerzentrale (appqscSUAbAqQGMpk)
//   LEADS_TABLE      optional; default "Leads (Inbound)"
//   CONTACTS_TABLE   optional; default "Kontakte"
//
// Fallback: if AIRTABLE_TOKEN is unset but SUBSCRIBE_WEBHOOK is, the lead is POSTed there.
// If neither is set, it is written to the function log.

const BASE           = process.env.AIRTABLE_BASE    || 'appqscSUAbAqQGMpk'; // Steuerzentrale
const LEADS_TABLE    = process.env.LEADS_TABLE       || 'Leads (Inbound)';
const CONTACTS_TABLE = process.env.CONTACTS_TABLE    || 'Kontakte';

async function airtableCreate(token, table, fields) {
  const url = 'https://api.airtable.com/v0/' + BASE + '/' + encodeURIComponent(table);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }], typecast: true }),
  });
  if (!res.ok) console.error('airtable write to "' + table + '" failed:', res.status);
  return res.ok;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body || '{}');
    const email = String(body.email || '').trim().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'bad_email' }) };
    }
    const isWhoop = body.request === 'whoop';
    const note = isWhoop ? 'Matchplan app — Whoop setup requested' : 'Matchplan app — free trial started';
    const ts = body.ts || new Date().toISOString();

    const token = process.env.AIRTABLE_TOKEN;
    if (token) {
      // 1) Leads (Inbound), tagged as "App"
      await airtableCreate(token, LEADS_TABLE, {
        'Name': email,            // no separate name collected in the app
        'E-Mail': email,
        'Lead-Spur': 'App',
        'Nachricht': note,
      });
      // 2) Customer list (Kontakte), tagged "App"
      await airtableCreate(token, CONTACTS_TABLE, {
        'Name': email,
        'Email': email,
        'Tags': ['App'],
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    const hook = process.env.SUBSCRIBE_WEBHOOK;
    if (hook) {
      try {
        await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, spur: 'App', note, ts }) });
      } catch (e) { console.error('subscribe forward failed:', e.message); }
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    console.log('lead', JSON.stringify({ email, spur: 'App', note, ts }));
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'server_error' }) };
  }
};
