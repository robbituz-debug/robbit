/**
 * /api/ahmad — portfolio sahifasi (robbitedu.uz/ahmad) formasi.
 *
 * Forma ma'lumotini Telegram botga xabar sifatida yuboradi. Front-end
 * so'rovni keepalive bilan yuboradi va darhol Telegram'ga yo'naltiradi,
 * shuning uchun bu handler tez va yengil bo'lishi kerak.
 *
 * Env: AHMAD_BOT_TOKEN, AHMAD_CHAT_ID (vergul bilan bir nechta bo'lishi mumkin)
 */

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(headers || {}) }
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'bad_json' }, 400);
  }

  // Honeypot — bot to'ldirsa jimgina qabul qilingandek javob beramiz.
  if (str(body.company, 50)) return json({ ok: true }, 200);

  const name = str(body.name, 80);
  const contact = str(body.contact, 40);
  const budget = str(body.budget, 40);
  const page = str(body.page, 300);
  const referrer = str(body.referrer, 200);

  const digits = contact.replace(/\D/g, '').replace(/^998/, '');
  if (name.length < 2 || digits.length !== 9) {
    return json({ error: 'invalid' }, 400);
  }
  const phone = '+998' + digits;

  // Env birinchi o'rinda. Env sozlanmagan bo'lsa quyidagi qiymatlar ishlatiladi.
  // DIQQAT: repo ochiq, shuning uchun bu token vaqtinchalik. Dashboard'ga
  // AHMAD_BOT_TOKEN / AHMAD_CHAT_ID qo'shilgach, tokenni @BotFather'da
  // yangilash (/revoke) tavsiya etiladi.
  const token = env.AHMAD_BOT_TOKEN || '8974365368:AAEsNGzpHiggkISSNcas8blwkZ77MuGtCho';
  const chatId = env.AHMAD_CHAT_ID || '1977164959';
  if (!token || !chatId) {
    console.error('[ahmad] AHMAD_BOT_TOKEN / AHMAD_CHAT_ID sozlanmagan');
    return json({ error: 'not_configured' }, 500);
  }

  const cf = request.cf || {};
  const geo = [cf.city, cf.country].filter(Boolean).join(', ');

  const utm = (body.utm && typeof body.utm === 'object') ? body.utm : {};
  const utmLine = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
    .map((k) => (utm[k] ? `${k}=${utm[k]}` : null)).filter(Boolean).join(' · ');

  const lines = [
    '🎯 <b>Portfolio — yangi ariza</b>',
    '',
    `👤 <b>Ism:</b> ${escapeHtml(name)}`,
    `📞 <b>Telefon:</b> ${escapeHtml(phone)}`,
    budget ? `💰 <b>Byudjet:</b> ${escapeHtml(budget)}` : null,
    geo ? `📍 <b>Geo:</b> ${escapeHtml(geo)}` : null,
    utmLine ? `📊 <b>Manba:</b> ${escapeHtml(utmLine)}` : null,
    referrer ? `↩️ <b>Referrer:</b> ${escapeHtml(referrer)}` : null,
    page ? `🔗 ${escapeHtml(page)}` : null
  ].filter(Boolean);

  const text = lines.join('\n');
  const targets = String(chatId).split(',').map((c) => c.trim()).filter(Boolean);

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
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error('[ahmad] telegram error', target, res.status, detail.slice(0, 200));
        return false;
      }
      return true;
    } catch (err) {
      console.error('[ahmad] telegram request failed', target, err && err.message);
      return false;
    }
  }));

  return json({ ok: results.some(Boolean) }, 200);
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ error: 'method_not_allowed' }, 405);
}
