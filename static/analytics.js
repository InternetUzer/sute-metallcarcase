(() => {
  'use strict';
  const counter = document.currentScript?.dataset.counter;
  const csrf = document.querySelector('meta[name="analytics-csrf"]')?.content;
  const enabled = /^[1-9][0-9]{0,11}$/.test(counter || '');
  if (enabled) {
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.append(script);
    window.ym(Number(counter), 'init', {defer: true, clickmap: false, trackLinks: false, webvisor: false, sendTitle: false});
    // Never send request descriptions, contacts or arbitrary query strings to Metrica.
    const clean = new URL(location.pathname, location.origin);
    const query = new URLSearchParams(location.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = query.get(key);
      if (value) clean.searchParams.set(key, value.slice(0, 100));
    }
    let referer = '';
    try { referer = new URL(document.referrer).origin; } catch (_) { /* Direct visit. */ }
    window.ym(Number(counter), 'hit', clean.href, {referer});
    if (document.querySelector('[data-lead-confirmed="true"]')) window.ym(Number(counter), 'reachGoal', 'lead_saved');
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    const href = link.getAttribute('href');
    let goal = href.startsWith('tel:') ? 'phone_click' : href.startsWith('mailto:') ? 'email_click' : '';
    if (!goal) {
      try { if (new URL(href, location.origin).hostname === 't.me') goal = 'telegram_click'; } catch (_) { return; }
    }
    if (!goal) return;
    if (csrf) fetch('/analytics/event', {method: 'POST', credentials: 'same-origin', keepalive: true,
      body: new URLSearchParams({csrf_token: csrf, event: goal, path: location.pathname})}).catch(() => {});
    if (enabled) window.ym(Number(counter), 'reachGoal', goal);
  });
})();
