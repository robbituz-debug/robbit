/* ==========================================================================
   ROBBIT landing — runtime configuration
   Edit this file to change endpoints, tracking IDs and content without
   touching the application logic. It is loaded before app.js and is not
   minified on purpose so a non-developer can change it safely.
   ========================================================================== */

window.ROBBIT_CONFIG = {
  /* Endpoint that receives quiz submissions.
     Served by functions/api/lead.js (Cloudflare Pages Function). */
  leadEndpoint: '/api/lead',

  /* Public links */
  telegramUrl: 'https://t.me/robbituz',
  instagramUrl: 'https://www.instagram.com/robbituz/',
  phone: '+998787773777',
  phoneDisplay: '+998 78 777 37 77',

  /* Quiz options. Order matters — the index is what gets submitted. */
  ages: ['9–12 yosh', '13–15 yosh', 'Boshqa'],
  branches: [
    'Toshkent shahri',
    'Namangan shahar markazi',
    'Andijon shahar markazi',
    'Farg‘ona shahar markazi',
    'Samarqand shahar markazi',
    'Navoiy shahar markazi',
    'Qarshi shahar markazi',
    'Guliston shahar markazi',
    'Urganch shahar markazi',
    'Boshqa'
  ],

  /* Parent testimonial videos (YouTube Shorts IDs) */
  videos: [
    { title: 'Ota-ona fikri', meta: 'Robbit o‘quvchisining oilasi', id: 'BVbyZOCjixs' },
    { title: 'Ota-ona fikri', meta: 'Robbit o‘quvchisining oilasi', id: 'wZhuS8ZFwyE' },
    { title: 'Ota-ona fikri', meta: 'Robbit o‘quvchisining oilasi', id: 'D9G2Guh-9Og' },
    { title: 'Ota-ona fikri', meta: 'Robbit o‘quvchisining oilasi', id: 'NONlxbIVuCA' }
  ],

  /* Analytics — leave empty to disable. Nothing is loaded when empty,
     which also keeps the page cookie-free until an ID is set. */
  metaPixelId: '',      // e.g. '1234567890123456'
  yandexMetrikaId: '',  // e.g. '98765432'
  gtagId: ''            // e.g. 'G-XXXXXXXXXX'
};
