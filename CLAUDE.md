# Base Presents — website

Static one-page website for **Base Presents**, an event brand from Slovakia.
The site copy is in English. The user (Dejvo) talks in Slovak — reply in Slovak.

## Files
- `index.html` — the whole page: HTML with inline styles, exported 1:1 from the Claude design canvas, plus a small countdown script at the bottom
- `assets/base-logo-white.png` — the BASE logo, white on transparent (1955×622). Used in the nav, hero and footer
- `favicon.ico`, `assets/favicon-32.png`, `assets/favicon-512.png`, `assets/apple-touch-icon.png` — favicons (white "B" from the logo on black)
- `assets/og-image.png` — 1200×630 social share preview (Open Graph)
- `assets/archive/*.jpg` — 6 archive photos (432×540, cropped from the BASE project report slides, so low-res). Shown grayscale, color on hover. Swap for full-res originals when available

Open `index.html` directly in a browser — no build step.

`tickets-prototype/` — separate test prototype of own ticket sales (Node 22 + Express + Stripe Checkout in TEST mode,
SQLite via `node:sqlite`). `npm install && npm start` → http://localhost:4242 (`/buy`, `/scan`, `/admin`).
Without `STRIPE_SECRET_KEY` in `tickets-prototype/.env` it runs in demo mode with a simulated payment. Refuses `sk_live_` keys.
`/admin` and `/scan` need a staff login (`/login`, one shared account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, default email base@base.com; HttpOnly session cookie, in-memory sessions).
Not connected to the main site; the main site still sells via Tootoot. See `tickets-prototype/README.md`.

## Design rules
- Strictly black and white: `#000000`, `#FFFFFF`
- Greys: `#A3A3A3` (small text on black), `#5C5C5C` (small text on white), `#141414` / `#262626` / `#333333` (photo placeholders, dividers)
- Fonts (Google Fonts): Montserrat 500–700 for headings and big numbers, Inter for body, JetBrains Mono for small uppercase labels
- Sections alternate black and white: header → hero (logo + next event card with countdown) → marquee → Our events → Tickets → About → Archive → Newsletter → footer/contact
- Must work on phones (flex-wrap layouts, 44 px+ tap targets)

## Events
Base Presents: crew from Košice, since 2021, student parties made with student associations. Slogan "We create emotions".
Two series — do NOT describe Base Presents as "3 events a year":
- **Chodbovica** — indoor multi-stage, multi-genre student night at the Jedlíkova 7 dorm, Košice (1400+ guests).
  Editions 1–4 past (Nov 2022, 2023, 2024, 2025). **Edition 5: 16.11.2026, start 21:07, tickets on sale now.**
- **Chillout** — free open-air daytime party in front of Jedlíkova 9, the biggest student dorm in Košice
  (house music at sunset, chill zones, afterparty at night; 500+ guests). Editions 1–9 past, **edition 10: May 2027** (maybe named "Chillout X").
- Partners so far: Red Bull, Stock, Jägermeister, Šariš, Promotime, Accenture.

## Tickets (Tootoot)
Tickets are sold via Tootoot (tootoot.fm). The `#tickets` section contains the Tootoot iframe embed
(iframe + `host.v2.js` loader script) and below it a fallback link "Open on Tootoot"
(`https://tootoot.fm/sk/events/<event-id>`). For a new edition, paste the new embed code from the event's
admin on tootoot.fm and update the event id in the fallback link.
**Currently a TEST embed** (event `6abe3202504189a5a5f654fd` = H3O Organ Trio, not Chodbovica 5) — replace it.

## Countdown
`EVENT_DATE` near the bottom of `index.html` (local time). Now `2026-11-16T21:07` (Chodbovica 5).

## Still placeholders (text in [square brackets])
Chodbovica 5 line-up ("Line-up announced soon"),
contact emails and phone, social media links. The newsletter form has no backend yet.
The Open Graph `og:url` / `og:image` use `https://basepresents.sk/` as a guess: change it to the real domain.
