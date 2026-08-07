/* ==========================================================================
   ROBBIT landing — application logic
   Plain ES2019, no framework, no CDN. Behaviour is a 1:1 port of the original
   DC/React component plus the production fixes documented in the README:
   real form submission, validation, anti-spam, retry, analytics events.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.ROBBIT_CONFIG || {};
  var STEPS = 4;
  var STORAGE_KEY = 'robbit.quiz.v1';

  /* ---------------------------------------------------------------- utils */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Fires an analytics event on every provider that is configured.
     Silent no-op when no IDs are set. */
  function track(name, params) {
    try {
      if (window.fbq) window.fbq('track', name, params || {});
      if (window.ym && CFG.yandexMetrikaId) window.ym(CFG.yandexMetrikaId, 'reachGoal', name);
      if (window.gtag) window.gtag('event', name, params || {});
    } catch (e) { /* analytics must never break the page */ }
  }

  /* ------------------------------------------------------------ page state */

  var state = {
    step: 0,
    age: null,
    branch: null,
    name: '',
    phone: '',
    done: false,
    sheetOpen: false,
    sending: false,
    startedAt: Date.now()
  };

  /* Restore an in-progress quiz so a reload (or a bounce to the phone's
     dialer and back) does not throw away what the visitor already typed. */
  function loadState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s && typeof s === 'object' && !s.done) {
        state.step = Math.min(STEPS - 1, Math.max(0, s.step | 0));
        state.age = typeof s.age === 'number' ? s.age : null;
        state.branch = typeof s.branch === 'number' ? s.branch : null;
        state.name = typeof s.name === 'string' ? s.name.slice(0, 60) : '';
        state.phone = typeof s.phone === 'string' ? s.phone.slice(0, 12) : '';
      }
    } catch (e) { /* private mode / disabled storage */ }
  }

  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        step: state.step, age: state.age, branch: state.branch,
        name: state.name, phone: state.phone, done: state.done
      }));
    } catch (e) { /* ignore */ }
  }

  function clearState() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------ DOM handles */

  var form = $('#quiz');
  var doneBox = $('#done');
  var errorBox = $('#error');
  var stepLabel = $('#step-label');
  var progressBar = $('#progress-bar');
  var progressTrack = $('#progress-track');
  var backBtn = $('#back');
  var nextBtn = $('#next');
  var nextLabel = $('#next-label');
  var nameInput = $('#name');
  var phoneInput = $('#phone');
  var hpInput = $('#company');
  var shell = $('#ariza');
  var backdrop = $('.quiz-backdrop');

  /* ------------------------------------------------------------ option list */

  function optionMarkup(list, kind) {
    return list.map(function (label, i) {
      return '<button type="button" role="radio" aria-checked="false" data-i="' + i + '" ' +
        'class="opt-' + kind + ' opt-off hv-opt">' +
        '<span class="dot"></span><span>' + esc(label) + '</span></button>';
    }).join('');
  }

  function renderOptions() {
    var ageBox = $('#ages');
    var branchBox = $('#branches');
    ageBox.innerHTML = optionMarkup(CFG.ages || [], 'age');
    branchBox.innerHTML = optionMarkup(CFG.branches || [], 'branch');

    ageBox.addEventListener('click', function (e) { pick(e, 'age'); });
    branchBox.addEventListener('click', function (e) { pick(e, 'branch'); });
  }

  function pick(e, key) {
    var btn = e.target.closest('button[data-i]');
    if (!btn) return;
    state[key] = parseInt(btn.getAttribute('data-i'), 10);
    hideError();
    paintOptions();
    saveState();
  }

  function paintOptions() {
    [['#ages', 'age'], ['#branches', 'branch']].forEach(function (pair) {
      $$(pair[0] + ' button[data-i]').forEach(function (b) {
        var on = parseInt(b.getAttribute('data-i'), 10) === state[pair[1]];
        b.classList.toggle('opt-on', on);
        b.classList.toggle('opt-off', !on);
        b.classList.toggle('hv-opt', !on);
        b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    });
  }

  /* ------------------------------------------------------------- validation */

  /* Digits only, drop a leading 998, cap at 9, group as "90 123 45 67". */
  function fmtPhone(raw) {
    var d = String(raw).replace(/\D/g, '').replace(/^998/, '').slice(0, 9);
    return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)]
      .filter(Boolean).join(' ');
  }

  /* Uzbek mobile operator codes. Rejects obvious typos before they reach a
     methodist's call list — the original only checked the digit count. */
  var UZ_CODES = ['20', '33', '50', '55', '61', '62', '63', '65', '66', '67',
    '69', '70', '71', '72', '73', '74', '75', '76', '77', '78',
    '79', '88', '90', '91', '93', '94', '95', '97', '98', '99'];

  function phoneDigits() { return state.phone.replace(/\D/g, ''); }

  function phoneValid() {
    var d = phoneDigits();
    return d.length === 9 && UZ_CODES.indexOf(d.slice(0, 2)) !== -1;
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }

  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  /* ------------------------------------------------------------- rendering */

  function render() {
    $$('.q-step').forEach(function (el) {
      el.classList.toggle('is-active', parseInt(el.getAttribute('data-step'), 10) === state.step);
    });

    stepLabel.textContent = (state.step + 1) + ' / ' + STEPS;
    progressBar.style.width = ((state.step + 1) / STEPS * 100) + '%';
    progressTrack.setAttribute('aria-valuenow', String(state.step + 1));

    backBtn.hidden = state.step === 0;
    nextLabel.textContent = state.step === STEPS - 1 ? 'Arizani yuborish' : 'Davom etish';

    nameInput.value = state.name;
    phoneInput.value = state.phone;
    paintOptions();

    form.hidden = state.done;
    doneBox.hidden = !state.done;
  }

  function focusStep() {
    if (state.step === 2) nameInput.focus();
    else if (state.step === 3) phoneInput.focus();
  }

  /* ---------------------------------------------------------- step handling */

  function goNext() {
    if (state.sending) return;

    if (state.step === 0 && state.age === null) return showError('Iltimos, yoshni tanlang.');
    if (state.step === 1 && state.branch === null) return showError('Iltimos, filialni tanlang.');
    if (state.step === 2 && state.name.trim().length < 2) return showError('Iltimos, ismingizni yozing.');
    if (state.step === 3) {
      if (phoneDigits().length < 9) return showError('Telefon raqamni to‘liq kiriting.');
      if (!phoneValid()) return showError('Telefon raqam noto‘g‘ri. Masalan: 90 123 45 67');
      return submit();
    }

    hideError();
    state.step += 1;
    saveState();
    render();
    focusStep();
    track('QuizStep', { step: state.step });
  }

  function goBack() {
    if (state.sending) return;
    hideError();
    state.step = Math.max(0, state.step - 1);
    saveState();
    render();
  }

  function restart() {
    state.step = 0;
    state.age = null;
    state.branch = null;
    state.name = '';
    state.phone = '';
    state.done = false;
    state.startedAt = Date.now();
    clearState();
    hideError();
    render();
  }

  /* ------------------------------------------------------------- submission */

  function setSending(on) {
    state.sending = on;
    nextBtn.classList.toggle('btn-busy', on);
    nextBtn.disabled = on;
    nextLabel.innerHTML = on
      ? '<span class="spinner" aria-hidden="true"></span>Yuborilmoqda…'
      : 'Arizani yuborish';
  }

  /* UTM / referrer context, so the sales team knows which ad produced
     the lead. Read once at load — a hash change must not lose it. */
  var ATTRIBUTION = (function () {
    var q = new URLSearchParams(location.search);
    var out = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'gclid'].forEach(function (k) {
        var v = q.get(k);
        if (v) out[k] = v.slice(0, 200);
      });
    out.referrer = (document.referrer || '').slice(0, 200);
    out.landing = location.pathname + location.search.slice(0, 300);
    return out;
  })();

  function payload() {
    return {
      age: (CFG.ages || [])[state.age] || '',
      ageIndex: state.age,
      branch: (CFG.branches || [])[state.branch] || '',
      branchIndex: state.branch,
      name: state.name.trim().slice(0, 60),
      phone: '+998' + phoneDigits(),
      company: hpInput ? hpInput.value : '',        // honeypot, must stay empty
      elapsedMs: Date.now() - state.startedAt,       // bot filter on the server
      attribution: ATTRIBUTION,
      page: location.href.slice(0, 300)
    };
  }

  function postLead(body, attempt) {
    attempt = attempt || 1;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;

    return fetch(CFG.leadEndpoint || '/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      keepalive: true
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (res.ok) return res.json().catch(function () { return { ok: true }; });
      /* 4xx is our fault or the visitor's — do not retry.
         5xx / network is transient — retry twice with backoff. */
      if (res.status >= 500 && attempt < 3) {
        return delay(attempt * 700).then(function () { return postLead(body, attempt + 1); });
      }
      return res.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(j.error || 'HTTP ' + res.status);
      });
    }).catch(function (err) {
      if (timer) clearTimeout(timer);
      if (attempt < 3 && (err.name === 'AbortError' || err.name === 'TypeError')) {
        return delay(attempt * 700).then(function () { return postLead(body, attempt + 1); });
      }
      throw err;
    });
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function submit() {
    hideError();
    setSending(true);
    var body = payload();

    postLead(body).then(function () {
      state.done = true;
      setSending(false);
      clearState();
      $('#done-name').textContent = body.name;
      $('#done-phone').textContent = state.phone;
      render();
      track('Lead', { content_name: 'robbit-quiz', branch: body.branch, age: body.age });
      if (shell && typeof shell.scrollIntoView === 'function') {
        shell.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }).catch(function (err) {
      setSending(false);
      showError('Arizani yuborib bo‘lmadi. Iltimos, qayta urinib ko‘ring yoki ' +
        (CFG.phoneDisplay || '+998 78 777 37 77') + ' raqamiga qo‘ng‘iroq qiling.');
      if (window.console) console.error('[robbit] lead submit failed:', err);
      track('LeadFailed', { reason: String(err && err.message || err).slice(0, 120) });
    });
  }

  /* -------------------------------------------------------- mobile sheet UI */

  function openSheet(e) {
    if (window.innerWidth > 720) return;      // desktop: the card is always visible
    if (e) e.preventDefault();
    state.sheetOpen = true;
    shell.classList.add('open');
    backdrop.hidden = false;
    document.body.classList.add('sheet-lock');
    track('OpenQuiz');
    setTimeout(focusStep, 260);
  }

  function closeSheet() {
    state.sheetOpen = false;
    shell.classList.remove('open');
    backdrop.hidden = true;
    document.body.classList.remove('sheet-lock');
  }

  /* ----------------------------------------------------------- image slots */

  /* Ports the geometry of the original <image-slot> element: fit the frame
     with a cover baseline, then apply the author's zoom (s) and pan (x, y)
     that were saved in .image-slots.state.json. Recomputed on resize because
     the baseline depends on the frame's aspect ratio. */
  var SLOT_VIEWS = {
    'slot-1': { s: 1.1127384122828419, x: -5.6369206141420936, y: -3.3953241331448254 },
    'slot-2': { s: 1, x: 0, y: -3.2716030544704857 },
    'slot-3': { s: 1, x: 0, y: -7.222222222222221 }
  };

  function fitSlot(slot) {
    var img = slot.querySelector('img');
    if (!img || !img.naturalWidth) return;

    var view = null;
    Object.keys(SLOT_VIEWS).forEach(function (cls) {
      if (slot.classList.contains(cls)) view = SLOT_VIEWS[cls];
    });
    if (!view) return;

    var fw = slot.clientWidth, fh = slot.clientHeight;
    if (!fw || !fh) return;

    var iw = img.naturalWidth, ih = img.naturalHeight;
    var base = Math.max(fw / iw, fh / ih);      // cover
    var k = base * view.s;

    img.style.width = (iw * k / fw * 100) + '%';
    img.style.height = (ih * k / fh * 100) + '%';
    img.style.left = (50 + view.x) + '%';
    img.style.top = (50 + view.y) + '%';
    img.setAttribute('data-fitted', '');
  }

  function initSlots() {
    var slots = $$('.slot');
    if (!slots.length) return;

    function fitAll() { slots.forEach(fitSlot); }

    slots.forEach(function (slot) {
      var img = slot.querySelector('img');
      if (!img) return;
      if (img.complete && img.naturalWidth) fitSlot(slot);
      else img.addEventListener('load', function () { fitSlot(slot); });
    });

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(fitAll);
      slots.forEach(function (s) { ro.observe(s); });
    } else {
      window.addEventListener('resize', fitAll);
    }
  }

  /* --------------------------------------------------------------- counters */

  function runCounters() {
    var nodes = $$('#stats [data-count]');
    var t0 = performance.now(), dur = 1600;

    function tick(now) {
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      nodes.forEach(function (el) {
        var target = parseFloat(el.getAttribute('data-count'));
        var round = parseFloat(el.getAttribute('data-round') || '1');
        var suffix = el.getAttribute('data-suffix') || '';
        var v = Math.round(target * eased / round) * round;
        el.textContent = v.toLocaleString('ru-RU').replace(/ /g, ' ') + suffix;
      });
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function watchCounters() {
    var el = $('#stats');
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return runCounters();
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        io.disconnect();
        runCounters();
      }
    }, { threshold: 0.35 });
    io.observe(el);
  }

  /* ----------------------------------------------------------------- videos */

  function renderVideos() {
    var row = $('#video-row');
    if (!row) return;
    var vids = CFG.videos || [];

    row.innerHTML = vids.map(function (v, i) {
      var thumb = 'https://i.ytimg.com/vi/' + encodeURIComponent(v.id) + '/hqdefault.jpg';
      return '' +
        '<div class="lift" style="flex:none;width:min(272px,78vw);scroll-snap-align:start;border-radius:30px;overflow:hidden;background:linear-gradient(150deg,rgba(255,255,255,0.78) 0%,rgba(255,255,255,0.4) 100%);backdrop-filter:blur(26px) saturate(185%);-webkit-backdrop-filter:blur(26px) saturate(185%);border:1px solid rgba(255,255,255,0.85);box-shadow:inset 0 1.5px 1px rgba(255,255,255,0.95),0 22px 50px rgba(31,80,180,0.18)">' +
          '<div class="v-frame" data-i="' + i + '" style="position:relative;width:100%;aspect-ratio:9 / 16;background:#0B1030">' +
            '<div class="v-idle" style="position:absolute;inset:0;cursor:pointer">' +
              '<img src="' + thumb + '" alt="" loading="lazy" decoding="async" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block">' +
              '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,20,60,0) 45%,rgba(10,20,60,0.45) 100%);pointer-events:none"></div>' +
              '<div style="position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:flex-end;padding:16px;pointer-events:none">' +
                '<button type="button" class="hv-play" aria-label="Videoni ko‘rish" style="pointer-events:auto;width:58px;height:58px;border-radius:50%;border:1px solid rgba(255,255,255,0.7);background:linear-gradient(135deg,rgba(40,221,255,0.92) 0%,rgba(81,81,255,0.92) 100%);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:#FFFFFF;font-size:20px;font-weight:900;cursor:pointer;box-shadow:inset 0 1.5px 1px rgba(255,255,255,0.7),0 14px 30px rgba(60,90,255,0.46);padding-left:4px">▶</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:18px 20px 22px">' +
            '<div style="font-size:16px;font-weight:900;color:#1E1A44;margin-bottom:4px">' + esc(v.title) + '</div>' +
            '<div style="font-size:14px;font-weight:600;color:#4F4A7A">' + esc(v.meta) + '</div>' +
          '</div>' +
        '</div>';
    }).join('');

    row.addEventListener('click', function (e) {
      var frame = e.target.closest('.v-frame');
      if (!frame) return;
      playVideo(frame, vids[parseInt(frame.getAttribute('data-i'), 10)]);
    });
  }

  /* Swaps the poster for the embed. If the iframe is still blank after
     2.5s the visitor is behind something that blocks YouTube, so we offer
     a direct link instead of leaving a dead black rectangle. */
  function playVideo(frame, v) {
    if (!v || frame.getAttribute('data-playing') === '1') return;
    frame.setAttribute('data-playing', '1');

    var iframe = document.createElement('iframe');
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(v.id) +
      '?autoplay=1&rel=0&playsinline=1';
    iframe.title = 'Ota-ona fikri';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;border:none;display:block');

    var loaded = false;
    iframe.addEventListener('load', function () { loaded = true; });

    frame.innerHTML = '';
    frame.appendChild(iframe);
    track('PlayTestimonial', { video_id: v.id });

    setTimeout(function () {
      if (loaded) return;
      frame.innerHTML =
        '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;background:linear-gradient(160deg,rgba(11,16,48,0.92) 0%,rgba(31,48,120,0.92) 100%)">' +
          '<div style="font-size:15px;line-height:1.5;font-weight:700;color:rgba(255,255,255,0.9)">Video shu yerda ochilmadi</div>' +
          '<a href="https://youtube.com/shorts/' + encodeURIComponent(v.id) + '" target="_blank" rel="noopener" class="hv-white" style="padding:13px 22px;border-radius:999px;background:linear-gradient(135deg,#28DDFF 0%,#5151FF 100%);color:#FFFFFF;font-size:15px;font-weight:800;box-shadow:inset 0 1px 1px rgba(255,255,255,0.6),0 12px 28px rgba(60,90,255,0.44)">YouTube’da ko‘rish</a>' +
        '</div>';
    }, 2500);
  }

  /* --------------------------------------------------------------- tracking */

  function loadAnalytics() {
    if (CFG.metaPixelId) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
      (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq('init', CFG.metaPixelId);
      window.fbq('track', 'PageView');
    }

    if (CFG.yandexMetrikaId) {
      /* eslint-disable */
      (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();k=e.createElement(t),a=e.getElementsByTagName(t)[0],
      k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
      (window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');
      /* eslint-enable */
      window.ym(CFG.yandexMetrikaId, 'init', {
        clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: false
      });
    }

    if (CFG.gtagId) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CFG.gtagId);
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', CFG.gtagId);
    }
  }

  /* ------------------------------------------------------------------- init */

  function init() {
    loadState();
    renderOptions();
    renderVideos();
    render();
    initSlots();
    watchCounters();
    loadAnalytics();

    form.addEventListener('submit', function (e) { e.preventDefault(); goNext(); });
    backBtn.addEventListener('click', goBack);
    $('#restart').addEventListener('click', restart);

    nameInput.addEventListener('input', function () {
      state.name = nameInput.value;
      hideError();
      saveState();
    });

    phoneInput.addEventListener('input', function () {
      var pos = phoneInput.selectionStart;
      var before = phoneInput.value.length;
      state.phone = fmtPhone(phoneInput.value);
      phoneInput.value = state.phone;
      /* Keep the caret sane after the spaces are re-inserted. */
      var shift = phoneInput.value.length - before;
      try { phoneInput.setSelectionRange(pos + shift, pos + shift); } catch (e) { /* ignore */ }
      hideError();
      saveState();
    });

    $$('[data-open-sheet]').forEach(function (el) {
      el.addEventListener('click', openSheet);
    });
    $$('[data-close-sheet]').forEach(function (el) {
      el.addEventListener('click', closeSheet);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.sheetOpen) closeSheet();
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 720 && state.sheetOpen) closeSheet();
    });

    var row = $('#video-row');
    $('#scroll-prev').addEventListener('click', function () {
      row.scrollBy({ left: -290, behavior: 'smooth' });
    });
    $('#scroll-next').addEventListener('click', function () {
      row.scrollBy({ left: 290, behavior: 'smooth' });
    });

    $$('[data-track]').forEach(function (el) {
      el.addEventListener('click', function () {
        var n = el.getAttribute('data-track');
        track(n === 'call' ? 'Contact' : 'ClickSocial', { channel: n });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
