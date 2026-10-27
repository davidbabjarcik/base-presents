// Small helpers for server-rendered public pages (payment, tickets).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';

export function page(title, body, mode) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Base Presents</title>
<link rel="icon" href="/assets/favicon-32.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/style.css"></head><body>
<header class="top"><a href="/buy"><img src="/assets/base-logo-white.png" alt="Base Presents" height="22"></a>
<span class="badge">${mode === 'demo' ? 'Demo mode' : 'Stripe test mode'}</span></header>
<main class="wrap"><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
