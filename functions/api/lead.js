/**
 * POST /api/lead — quiz submission endpoint (Cloudflare Pages Function).
 *
 * The original landing page had no backend at all: the last quiz step only
 * flipped a `done` flag in React state, so every lead was silently discarded.
 * This function is that missing half.
 *
 * Flow: validate -> reject bots -> rate limit -> notify Telegram -> (optional)
 * append to a KV log -> respond.
 *
 * Required environment variables (Pages -> Settings -> Environment variables):
 *   TELEGRAM_BOT_TOKEN   Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     Target chat id, or several separated by commas
 *                        (e.g. "-1001234567890" or "111111111,222222222").
 *                        A lead counts as delivered if at least one succeeds.
 *                        Note: a bot can only message a user who has pressed
 *                        /start on it first; groups need the bot as a member.
 *
 * Optional:
 *   LEADS                KV namespace binding; used for rate limiting and,
 *                        when present, stores every lead as a backup.
 *   ALLOWED_ORIGIN       Comma-separated origins allowed to POST here.
 *                        Defaults to same-origin only.
 */

const MAX_BODY_BYTES = 4096;
const MIN_ELAPSED_MS = 2500;        // a human needs longer than this for 4 steps
const RATE_LIMIT_MAX = 5;           // submissions per IP
const RATE_LIMIT_WINDOW = 3600;     // ... per hour (seconds)

/* Uzbek mobile operator codes — same list as the client. */
const UZ_CODES = new Set([
  '20', '33', '50', '55', '61', '62', '63', '65', '66', '67',
  '69', '70', '71', '72', '73', '74', '75', '76', '77', '78',
  '79', '88', '90', '91', '93', '94', '95', '97', '98', '99'
]);

export async function onRequestPost(context) {
  const { request, env } = context;

  const cors = corsHeaders(request, env);
  if (cors === null) return json({ error: 'forbidden_origin' }, 403);

  /* ---------------------------------------------------------- read + parse */

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, cors);

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413, cors);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }
  if (!body || typeof body !== 'object') return json({ error: 'invalid_body' }, 400, cors);

  /* ------------------------------------------------------------- anti-spam */

  // Honeypot: the field is visually hidden, so only a bot fills it in.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return json({ ok: true }, 200, cors);   // pretend success, drop silently
  }

  // Timing: a real person cannot answer four questions this fast.
  const elapsed = Number(body.elapsedMs);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_ELAPSED_MS) {
    return json({ ok: true }, 200, cors);
  }

  /* ------------------------------------------------------------ validation */

  const name = str(body.name, 60);
  if (name.trim().length < 2) return json({ error: 'invalid_name' }, 422, cors);

  const digits = str(body.phone, 20).replace(/\D/g, '').replace(/^998/, '');
  if (digits.length !== 9 || !UZ_CODES.has(digits.slice(0, 2))) {
    return json({ error: 'invalid_phone' }, 422, cors);
  }
  const phone = '+998' + digits;

  const age = str(body.age, 40);
  const branch = str(body.branch, 80);
  if (!age || !branch) return json({ error: 'incomplete' }, 422, cors);

  /* ----------------------------------------------------------- rate limit */

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (env.LEADS) {
    const key = `rl:${ip}`;
    const seen = Number((await env.LEADS.get(key)) || 0);
    if (seen >= RATE_LIMIT_MAX) return json({ error: 'rate_limited' }, 429, cors);
    // expirationTtl restarts the window on each write; acceptable for a
    // landing page where the goal is stopping floods, not exact accounting.
    await env.LEADS.put(key, String(seen + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  }

  /* ------------------------------------------------------------- assemble */

  const cf = request.cf || {};
  // The client sends UTM/click ids under `utm`; older builds used `attribution`.
  // Accept either so attribution survives regardless of which the page posts.
  const attribution = (body.attribution && typeof body.attribution === 'object' && body.attribution)
    || (body.utm && typeof body.utm === 'object' && body.utm)
    || {};

  const lead = {
    receivedAt: new Date().toISOString(),
    name: name.trim(),
    phone,
    age,
    branch,
    source: {
      utm_source: str(attribution.utm_source, 200),
      utm_medium: str(attribution.utm_medium, 200),
      utm_campaign: str(attribution.utm_campaign, 200),
      utm_content: str(attribution.utm_content, 200),
      utm_term: str(attribution.utm_term, 200),
      fbclid: str(attribution.fbclid, 200),
      gclid: str(attribution.gclid, 200),
      referrer: str(attribution.referrer || body.referrer, 200),
      page: str(body.page, 300)
    },
    meta: {
      ip,
      country: str(cf.country, 8),
      city: str(cf.city, 60),
      ua: str(request.headers.get('user-agent'), 200)
    }
  };

  /* -------------------------------------------------------------- deliver */

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  const telegramConfigured = Boolean(token && chatId);

  // Bitrix (CRM) is the system of record and can work on its own; Telegram is
  // the instant notification. Fire both in parallel — neither blocks the other,
  // and a lead survives as long as at least one of them (or KV) succeeds.
  const bitrixPromise = sendToBitrix(env, lead);

  if (!telegramConfigured) {
    console.error('[lead] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set — relying on Bitrix/KV');
    const bitrixId = await bitrixPromise;
    if (bitrixId) lead.bitrixLeadId = bitrixId;
    const ok = Boolean(bitrixId);
    await archive(env, lead, ok ? 'delivered' : 'undelivered');
    if (!ok && !env.LEADS) return json({ error: 'not_configured' }, 500, cors);
    return json({ ok: true }, 200, cors);
  }

  const text = formatMessage(lead);
  const targets = String(chatId).split(',').map((c) => c.trim()).filter(Boolean);

  // Send to every configured chat in parallel. One recipient blocking the bot
  // (or never having pressed /start) must not hide the lead from the others.
  const results = await Promise.all(targets.map(async (target) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: target,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
      if (res.ok) return true;
      console.error('[lead] telegram error for', target, res.status,
        (await res.text()).slice(0, 300));
      return false;
    } catch (err) {
      console.error('[lead] telegram request failed for', target, err && err.message);
      return false;
    }
  }));

  const bitrixId = await bitrixPromise;         // CRM lead id, or null
  const delivered = results.some(Boolean) || Boolean(bitrixId);

  if (bitrixId) lead.bitrixLeadId = bitrixId;
  await archive(env, lead, delivered ? 'delivered' : 'undelivered');

  // A lead that reached KV is not lost even if Telegram was down, so only
  // report an error when we have no copy at all.
  if (!delivered && !env.LEADS) return json({ error: 'delivery_failed' }, 502, cors);

  return json({ ok: true }, 200, cors);
}

/* Reject anything that is not a POST with a clear, cacheable answer. */
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  if (context.request.method === 'OPTIONS') {
    const cors = corsHeaders(context.request, context.env);
    return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
  }
  return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST, OPTIONS' });
}

/* ------------------------------------------------------------------ helpers */

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function formatMessage(lead) {
  const s = lead.source;
  const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
    .map((k) => (s[k] ? `${k.replace('utm_', '')}: ${escapeHtml(s[k])}` : null))
    .filter(Boolean);

  const lines = [
    '🤖 <b>Yangi ariza — Robbit</b>',
    '',
    `👤 <b>Ism:</b> ${escapeHtml(lead.name)}`,
    `📞 <b>Telefon:</b> <a href="tel:${escapeHtml(lead.phone)}">${escapeHtml(lead.phone)}</a>`,
    `🎂 <b>Yosh:</b> ${escapeHtml(lead.age)}`,
    `📍 <b>Filial:</b> ${escapeHtml(lead.branch)}`
  ];

  if (utm.length) lines.push('', `📊 <b>Manba:</b> ${utm.join(' · ')}`);
  else if (s.referrer) lines.push('', `📊 <b>Manba:</b> ${escapeHtml(s.referrer)}`);

  const geo = [lead.meta.city, lead.meta.country].filter(Boolean).join(', ');
  if (geo) lines.push(`🌍 ${escapeHtml(geo)}`);

  lines.push('', `🕒 ${escapeHtml(tashkentTime(lead.receivedAt))}`);
  return lines.join('\n');
}

function tashkentTime(iso) {
  try {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short'
    }).format(new Date(iso)) + ' (Toshkent)';
  } catch {
    return iso;
  }
}

/**
 * Create a Lead (CRM Lid) in Bitrix24 via an inbound webhook.
 * The webhook URL is read from env.BITRIX_WEBHOOK_URL (kept out of source),
 * e.g. "https://<portal>.bitrix24.kz/rest/<user>/<code>/".
 * Non-blocking by design: a Bitrix failure must never lose the lead, since
 * Telegram + KV already hold a copy. Returns the created lead id or null.
 */
async function sendToBitrix(env, lead) {
  const base = env.BITRIX_WEBHOOK_URL;
  if (!base) return null;
  const url = base.replace(/\/+$/, '') + '/crm.lead.add.json';

  const s = lead.source;
  const utmBits = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
    .map((k) => (s[k] ? `${k}=${s[k]}` : null)).filter(Boolean).join(' · ');
  const comments = [
    `Yosh: ${lead.age}`,
    `Filial: ${lead.branch}`,
    utmBits ? `Manba: ${utmBits}` : null,
    s.fbclid ? `fbclid: ${s.fbclid}` : null,
    s.referrer ? `Referrer: ${s.referrer}` : null,
    s.page ? `Sahifa: ${s.page}` : null,
    (lead.meta.city || lead.meta.country) ? `Geo: ${[lead.meta.city, lead.meta.country].filter(Boolean).join(', ')}` : null
  ].filter(Boolean).join('\n');

  const fields = {
    TITLE: `Robbit sayt — ${lead.name} (${lead.branch})`,
    NAME: lead.name,
    SOURCE_ID: 'WEB',
    SOURCE_DESCRIPTION: s.utm_source ? `sayt / ${s.utm_source}` : 'robbitedu.uz',
    OPENED: 'Y',
    PHONE: [{ VALUE: lead.phone, VALUE_TYPE: 'MOBILE' }],
    COMMENTS: comments,
    // Custom maydonlar (Bitrix'da alohida ko'rinadi)
    UF_CRM_1765477720905: lead.age,     // Farzandining Yoshi (Jiddi)
    UF_CRM_1727904923821: lead.branch,  // Filialni tanlang (Target uchun)
    UTM_SOURCE: s.utm_source || '',
    UTM_MEDIUM: s.utm_medium || '',
    UTM_CAMPAIGN: s.utm_campaign || '',
    UTM_CONTENT: s.utm_content || '',
    UTM_TERM: s.utm_term || ''
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, params: { REGISTER_SONET_EVENT: 'Y' } })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.result) return data.result;
    console.error('[lead] bitrix error', res.status, JSON.stringify(data).slice(0, 300));
    return null;
  } catch (err) {
    console.error('[lead] bitrix request failed', err && err.message);
    return null;
  }
}

async function archive(env, lead, status) {
  if (!env.LEADS) return;
  try {
    const key = `lead:${lead.receivedAt}:${lead.phone}`;
    await env.LEADS.put(key, JSON.stringify({ ...lead, status }));
  } catch (err) {
    console.error('[lead] KV archive failed:', err && err.message);
  }
}

/**
 * Same-origin by default. ALLOWED_ORIGIN widens it when the page is served
 * from another host (e.g. a .uz mirror pointing at this API).
 * Returns null when the origin is not allowed.
 */
function corsHeaders(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return {};                       // same-origin form post / curl
  const self = new URL(request.url).origin;
  const allowed = new Set([self]);
  if (env && env.ALLOWED_ORIGIN) {
    env.ALLOWED_ORIGIN.split(',').forEach((o) => allowed.add(o.trim()));
  }
  if (!allowed.has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(headers || {})
    }
  });
}
