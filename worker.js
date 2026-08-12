/**
 * Worker entry — statik assetlarni beradi va /api/lead ni boshqaradi.
 *
 * Lead mantiqi (validatsiya, anti-spam, Bitrix CRM, Telegram) bitta manbada:
 * functions/api/lead.js. Uni shu yerdan import qilib ishlatamiz, shunda kod
 * takrorlanmaydi. Pages Functions "context" shaklini kutadi, shuning uchun
 * Worker (request, env) ni o'sha shaklga o'rab uzatamiz.
 */
import { onRequestPost, onRequest as leadOnRequest } from './functions/api/lead.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/lead') {
      // Pages Functions imzosi: onRequest({ request, env, ... })
      const context = {
        request,
        env,
        waitUntil: (p) => ctx.waitUntil(p),
        next: () => env.ASSETS.fetch(request)
      };
      return leadOnRequest(context);
    }

    // Boshqa hamma yo'l — statik assetlar (dizayn, rasmlar, JS, CSS)
    return env.ASSETS.fetch(request);
  }
};
