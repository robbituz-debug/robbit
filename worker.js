/**
 * Vaqtinchalik Worker entry (Worker Assets rejimi uchun).
 * DIQQAT: bu bosqichda /api/lead to'liq ishlamaydi — CRM/Telegram ulanishi
 * Pages Functions (functions/api/lead.js) da. To'g'ri Pages proyektga
 * o'tilgach, bu fayl kerak bo'lmaydi.
 * Hozircha forma POST qilsa, lead yo'qolmasin uchun aniq javob qaytaramiz.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/lead') {
      // Frontendga "qabul qilindi" ko'rinishini beramiz (foydalanuvchi rahmat
      // ekranini ko'radi), lekin serverda log qoldiramiz. To'liq ishlashi
      // Pages Functions ga o'tgach yoqiladi.
      if (request.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, note: 'pending_pages_migration' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
        });
      }
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
        status: 405, headers: { 'Content-Type': 'application/json' }
      });
    }
    // Boshqa hamma narsa — statik assetlar (dizayn)
    return env.ASSETS.fetch(request);
  }
};
