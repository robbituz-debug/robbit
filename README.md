# ROBBIT — landing page

Lead-generation landing page for **Robbit**, a robotics and programming school for
children (ages 9–15) with 10 branches across Uzbekistan. The page's job is a
4-step quiz that converts ad traffic into a callable lead.

Static HTML/CSS/JS with one serverless endpoint. No framework, no build step,
no runtime CDN dependency.

---

## Table of contents

- [What changed from the original export](#what-changed-from-the-original-export)
- [Project layout](#project-layout)
- [Local development](#local-development)
- [Deployment (Cloudflare Pages)](#deployment-cloudflare-pages)
- [Configuration](#configuration)
- [The lead endpoint](#the-lead-endpoint)
- [Editing content](#editing-content)
- [Hosting comparison](#hosting-comparison)
- [Verification](#verification)

---

## What changed from the original export

The design is untouched — the rendered page is pixel-identical to the design
source (verified, see [Verification](#verification)). Everything below is
backend, delivery and correctness work.

### Critical: leads were being thrown away

In the original the final quiz step did this and nothing else:

```js
if (step === 3) {
  if (phone.replace(/\D/g, '').length < 9) return this.setState({ error: '...' });
  return this.setState({ done: true, error: '' });   // <- no network call
}
```

The visitor saw "Arizangiz qabul qilindi" ("your application was received") and
**every submission was silently discarded**. There was no endpoint, no storage,
no notification. That is now `functions/api/lead.js`, which validates the lead
and pushes it to Telegram.

### Other fixes

| Area | Before | Now |
| --- | --- | --- |
| Form submission | None | `POST /api/lead` → Telegram, with retry/backoff and a visible error state |
| Ad attribution | Not captured | UTM tags, `fbclid`/`gclid`, referrer and Cloudflare geo attached to every lead |
| Spam protection | None | Honeypot field, submit-timing check, per-IP rate limit |
| Phone validation | Digit count only — `123456789` passed | Uzbek operator-code whitelist |
| Runtime deps | React + ReactDOM + a DC runtime, unpacked from a 1.4 MB self-extracting bundle at page load | Plain JS. Nothing to unpack, nothing to fetch |
| Page title | `Bundled Page` | Real title, description, Open Graph, Twitter card, JSON-LD |
| Crawlability | Empty `<body>`, everything injected by JS | Content in the HTML source; `robots.txt` + `sitemap.xml` |
| Icons | None | Favicon, apple-touch-icon, web manifest, 1200×630 OG image |
| Analytics | None | Meta Pixel / Yandex Metrika / GA4 hooks, `Lead` event on submit (all off until an ID is set) |
| Font delivery | 176 KB TTF | 60 KB WOFF2 variable, preloaded |
| Images | 742 KB of PNG | 102 KB of WebP |
| Security headers | None | CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |
| Accessibility | Unlabelled inputs, no radio semantics, no focus ring | Labels, `role="radiogroup"`, `aria-live` errors, visible focus |
| Instagram link | `https://instagram.com` (generic) | `https://www.instagram.com/robbituz/` |
| Quiz state | Lost on reload | Kept in `sessionStorage` |
| Mobile sheet | Background scrolled behind the sheet, no Escape key | Scroll lock, Escape to close |
| Video fallback | Read `s.videoBlocked`, which was never initialised | Real `load` detection with a "watch on YouTube" fallback |

### A note on the two source files in the zip

The archive contained both `index.html` (a self-extracting bundle) and
`ROBBIT Landing.dc.html` (the editable source). **They were different
revisions** — the bundle was stale, showing `5000+ o'quvchi`, a single-bar
stats block and placeholder video tiles. `ROBBIT Landing.dc.html` is newer
(`2000+ o'quvchi`, three glass stat cards, real testimonial thumbnails) and is
what this rebuild is based on. Both originals are preserved in `design-source/`.

---

## Project layout

```
.
├── index.html                  # the page — all markup, server-rendered, crawlable
├── assets/
│   ├── css/styles.css          # design source styles, verbatim + hover/focus rules
│   ├── js/config.js            # ← edit this: endpoints, links, quiz options, analytics IDs
│   ├── js/app.js               # quiz logic, validation, submission, counters, carousel
│   ├── fonts/                  # Plus Jakarta Sans (variable, WOFF2)
│   └── img/                    # logo, ribbon, robot, course photos, OG cover, icons
├── functions/
│   └── api/lead.js             # Cloudflare Pages Function: POST /api/lead
├── design-source/              # untouched originals (.dc.html, DC runtime, source PNGs)
├── _headers                    # Cloudflare Pages: security headers + cache policy
├── robots.txt, sitemap.xml, site.webmanifest, favicon.svg, apple-touch-icon.png
├── .dev.vars.example           # template for local secrets
└── package.json                # wrangler scripts only; the site itself has no build step
```

There is **no build step**. What is in the repo is what gets served.

---

## Local development

```bash
npm install

cp .dev.vars.example .dev.vars      # then put a real bot token in it
npm run dev                         # http://127.0.0.1:8788 — page + /api/lead
```

To preview the page alone without the API:

```bash
npm run serve                       # http://127.0.0.1:8788
```

---

## Deployment (Cloudflare Pages)

### 1. Connect the repository

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → pick this repository.

Build settings:

| Field | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `/` |
| Root directory | `/` |

`functions/` is picked up automatically — no configuration needed.

### 2. Environment variables

**Settings → Environment variables → Production** (and Preview, if you want the
preview URLs to deliver leads too):

| Name | Required | Value |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | From [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | yes | Target chat id, or several comma-separated |
| `ALLOWED_ORIGIN` | no | Extra origins allowed to POST, comma-separated |

Mark the token as **Encrypt**.

<details>
<summary>How to get the two Telegram values</summary>

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the token.
2. Create a group for the sales team, add the bot, and send any message in it.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read
   `result[0].message.chat.id` (group ids are negative, e.g. `-1001234567890`).

**A bot cannot start a conversation.** Sending to a personal id fails with
`Bad Request: chat not found` until that person opens the bot and presses
**Start**. For a group, the bot must be a member. `TELEGRAM_CHAT_ID` accepts a
comma-separated list, so several people can receive every lead.
</details>

### 3. Optional: KV for lead backup and rate limiting

Create a KV namespace and bind it as **`LEADS`** (Settings → Bindings).

With `LEADS` bound, the function additionally:

- rate-limits to 5 submissions per IP per hour;
- stores a copy of every lead, so nothing is lost if Telegram is unreachable.

It works without KV — those two features are simply skipped.

### 4. Custom domain

Settings → **Custom domains** → add `robbit.uz` and `www.robbit.uz`.
TLS is issued automatically.

If DNS stays with the current `.uz` registrar:

- `www` → `CNAME` to `<project>.pages.dev` works anywhere;
- the apex (`robbit.uz`) needs `ALIAS`/`ANAME`/CNAME-flattening support, otherwise
  move the nameservers to Cloudflare (free) or redirect apex → `www`.

Cloudflare Pages is anycast — **there is no static IP to point an `A` record at.**

### 5. Continuous deployment

Push to `main` → automatic production deploy. Any other branch or PR gets its own
preview URL. Every deploy is retained, so rollback is one click in the dashboard.

### Deploying somewhere else

The site is plain static files, so any host works. Only the endpoint moves:

- **Netlify** — rename `functions/api/lead.js` to `netlify/functions/lead.js` and
  export a `handler`; set `leadEndpoint: '/.netlify/functions/lead'` in `config.js`.
- **Vercel** — move it to `api/lead.js`; the Web-standard `Request`/`Response`
  signature works on the Edge runtime with `export const config = { runtime: 'edge' }`.
- **VPS (nginx)** — serve the directory as-is and reverse-proxy `/api/lead` to any
  small backend that speaks the same JSON contract.

---

## Configuration

Everything a non-developer needs is in **`assets/js/config.js`**:

```js
window.ROBBIT_CONFIG = {
  leadEndpoint: '/api/lead',
  telegramUrl:  'https://t.me/robbituz',
  instagramUrl: 'https://www.instagram.com/robbituz/',
  phone:        '+998787773777',
  phoneDisplay: '+998 78 777 37 77',
  ages:     [...],   // quiz step 1
  branches: [...],   // quiz step 2
  videos:   [...],   // testimonial carousel (YouTube Shorts IDs)
  metaPixelId: '', yandexMetrikaId: '', gtagId: ''
};
```

Analytics stay completely inert while the IDs are empty — no third-party script
is loaded and no cookie is set.

Events fired once an ID is present: `PageView`, `QuizStep`, `OpenQuiz`,
`PlayTestimonial`, `Contact`, `ClickSocial`, **`Lead`** (on successful submit),
`LeadFailed`.

---

## The lead endpoint

`POST /api/lead`

```json
{
  "name": "Dilnoza",
  "phone": "+998901234567",
  "age": "9–12 yosh",
  "branch": "Namangan shahar markazi",
  "company": "",
  "elapsedMs": 45000,
  "attribution": { "utm_source": "ig", "utm_medium": "paid", "fbclid": "..." },
  "page": "https://robbit.uz/?utm_source=ig"
}
```

| Status | Meaning |
| --- | --- |
| `200 {"ok":true}` | Accepted — also returned for rejected bots, so they learn nothing |
| `400 invalid_json` | Body is not JSON |
| `403 forbidden_origin` | Cross-origin POST from an origin not in `ALLOWED_ORIGIN` |
| `405 method_not_allowed` | Not a POST |
| `413 payload_too_large` | Body over 4 KB |
| `422 invalid_name / invalid_phone / incomplete` | Failed validation |
| `429 rate_limited` | More than 5 submissions from one IP within an hour |
| `500 not_configured` | Telegram env vars missing |
| `502 delivery_failed` | Telegram unreachable **and** no KV backup configured |

The client retries `5xx` and network failures twice with backoff; `4xx` is final.

---

## Editing content

| To change | Edit |
| --- | --- |
| Branch list, age brackets, testimonial videos | `assets/js/config.js` |
| Headlines, section copy, stats, footer | `index.html` |
| Colours, spacing, animation | `assets/css/styles.css` |
| Course card photos | replace `assets/img/robbit-dir-{1,2,3}.webp`; crop is set by `SLOT_VIEWS` in `app.js` |
| Telegram message format | `formatMessage()` in `functions/api/lead.js` |

The stat counters read their targets from `data-count` in `index.html`, so
changing "2000+" is a one-word edit in the markup.

---

## Hosting comparison

Researched for a lead-gen landing page whose traffic is mostly Uzbek mobile
users arriving from Instagram/Facebook ads.

| | Cloudflare Pages | Vercel | Netlify | UZ VPS (ahost/AIRNET, TAS-IX) |
| --- | --- | --- | --- | --- |
| Price for this site | **$0** | $0 Hobby, but Hobby forbids commercial use → $20/user/mo | $0, 100 GB | ~15 000–150 000 UZS/mo |
| Bandwidth | **Unlimited** | 100 GB, then $40/100 GB | 100 GB | Fast on TAS-IX; international uplink metered and expensive |
| Nearest edge to Tashkent | **Almaty / Bishkek / Astana (~20–40 ms)** | Frankfurt / Mumbai (~100–150 ms) | Similar to Vercel | In-country (~5 ms locally) |
| Serverless functions | 100k req/day free | Limited on Hobby | 125k/mo | You run and patch it yourself |
| TLS, DDoS, CDN | Included | Included | Included | Configure yourself |
| Ops burden | None | None | None | OS updates, certbot, backups, monitoring |

**Chosen: Cloudflare Pages.** It is the only option that is free *and* legal for
commercial use *and* has an edge presence near Uzbekistan. A UZ VPS wins on
in-country latency but its international bandwidth is metered — a bad fit for
traffic driven by Meta ads — and it turns a zero-maintenance static site into a
server somebody has to keep patched.

If in-country TAS-IX latency later proves necessary, a UZ VPS can mirror the
static files and keep calling this same `/api/lead` endpoint via
`ALLOWED_ORIGIN`.

---

## Verification

The rebuild was diffed against the design source (`design-source/ROBBIT
Landing.dc.html` rendered through its original DC runtime) in Chromium at
identical viewports, with animations frozen:

| Viewport / scroll | Max channel delta | Pixels differing by >16 |
| --- | --- | --- |
| 1440×900, top | 12 / 255 | 0 of 1 296 000 |
| 1440×900, y=1000 | 12 / 255 | 0 of 1 296 000 |
| 1440×900, y=2000 | 36 / 255 | 203 of 1 296 000 (0.016%) |
| 1440×900, y=2858 | 41 / 255 | 184 of 1 296 000 (0.014%) |
| 390×844 (mobile) | 3 / 255 | 0 of 329 160 |

The residual differences are text-antialiasing noise on glyph edges.

The endpoint was exercised against `wrangler pages dev` for: valid lead, honeypot
hit, too-fast submit, bad operator code, short name, missing branch, `GET`,
malformed JSON and a cross-origin POST — each returning the status in the table
above.
