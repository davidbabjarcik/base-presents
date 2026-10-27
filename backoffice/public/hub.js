// Shared code for BASE Hub internal pages: login check, navigation, small helpers.
(function () {
  const SECTIONS = [
    ['app', '/app', 'Overview'],
    ['tickets', '/tickets', 'Tickets'],
    ['tickets', '/scan', 'Scanner'],
    ['stock', '/stock', 'Stock'],
    ['staff', '/staff', 'Staff'],
    ['promo', '/promo', 'Promo'],
    ['stats', '/stats', 'Stats'],
    ['ideas', '/ideas', 'Ideas'],
    ['users', '/users', 'Users']
  ];

  const Hub = {
    user: null,
    $: (sel, root) => (root || document).querySelector(sel),
    eur: (c) => (Number(c || 0) / 100).toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €',
    n: (x) => Number(x || 0).toLocaleString('sk-SK', { maximumFractionDigits: 1 }),
    date: (d) => (d ? new Date(d + 'T12:00').toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '—'),
    when: (ms) => new Date(ms).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }),
    today: () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); },

    // Build DOM safely (text is never parsed as HTML): Hub.h('td', {class:'num'}, 'text', childNode)
    h(tag, attrs, ...kids) {
      const el = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
      for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : String(k));
      return el;
    },

    async api(url, opts = {}) {
      const r = await fetch(url, {
        method: opts.method || (opts.body ? 'POST' : 'GET'),
        headers: opts.body ? { 'Content-Type': 'application/json' } : {},
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
      if (r.status === 401) { location.replace('/login?next=' + encodeURIComponent(location.pathname)); throw new Error('Not logged in'); }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Something went wrong');
      return data;
    },

    toast(msg) {
      const t = Hub.h('div', { class: 'toast', role: 'status' }, msg);
      document.body.append(t);
      setTimeout(() => t.remove(), 2600);
    },

    formData(form) {
      const o = {};
      new FormData(form).forEach((v, k) => { o[k] = v; });
      return o;
    },

    // Run an async action, show its error as a toast
    async run(fn) {
      try { return await fn(); } catch (e) { if (e.message !== 'Not logged in') Hub.toast(e.message); }
    },

    // Single-series horizontal bar chart. rows: [{label, value, text, tip}]
    chart(rows, empty) {
      const max = Math.max(0, ...rows.map((r) => r.value || 0));
      if (!rows.length || max === 0) return Hub.h('p', { class: 'chart empty' }, empty || 'No data yet');
      return Hub.h('div', { class: 'chart' }, rows.map((r) =>
        Hub.h('div', { class: 'r', tabindex: '0', 'aria-label': `${r.label}: ${r.text}` },
          Hub.h('span', { class: 'name' }, r.label),
          Hub.h('div', { class: 'track' }, Hub.h('div', { class: 'fill', style: `width:${((r.value || 0) / max) * 100}%` })),
          Hub.h('span', { class: 'val' }, r.text),
          Hub.h('span', { class: 'tip' }, r.tip || `${r.label}: ${r.text}`))));
    },

    // Call on every internal page: checks login + access, draws the header. Resolves with the user.
    async start(section) {
      const r = await fetch('/api/me');
      if (r.status === 401) { location.replace('/login?next=' + encodeURIComponent(location.pathname)); return new Promise(() => {}); }
      const me = await r.json();
      Hub.user = me;
      const allowed = (s) => s === 'app' || me.sections.includes(s);
      const header = Hub.h('header', { class: 'hub-top' },
        Hub.h('div', { class: 'hub-bar' },
          Hub.h('a', { href: '/app', 'aria-label': 'BASE Hub home' }, Hub.h('img', { src: '/assets/base-logo-white.png', alt: '' })),
          Hub.h('div', { class: 'hub-user' },
            Hub.h('span', {}, me.name + ' · ' + me.roleName),
            Hub.h('button', {
              class: 'badge', type: 'button', style: 'background:none;cursor:pointer;min-height:36px',
              onclick: async () => { await fetch('/api/logout', { method: 'POST' }); location.replace('/login'); }
            }, 'Log out'))),
        Hub.h('nav', { class: 'hub-nav', 'aria-label': 'Sections' },
          SECTIONS.filter(([s]) => allowed(s)).map(([, href, label]) =>
            Hub.h('a', { href, 'aria-current': location.pathname === href ? 'page' : null }, label))));
      document.body.prepend(header);
      document.body.classList.add('hub');
      if (section && !allowed(section)) {
        Hub.$('main').replaceChildren(Hub.h('h1', {}, 'No access'), Hub.h('p', { class: 'muted' }, 'Your account cannot open this section.'));
        return new Promise(() => {});
      }
      return me;
    }
  };
  window.Hub = Hub;
})();
