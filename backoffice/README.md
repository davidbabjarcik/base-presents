# BASE Hub — interný systém Base Presents

Interná aplikácia pre tím Base Presents. **Prototyp**: beží u teba na počítači (`localhost`). Platby sú len simulované alebo v Stripe **test móde**, žiadne skutočné peniaze.

Čo v ňom je:

| Sekcia | Adresa | Na čo je |
|---|---|---|
| Prihlásenie | http://localhost:4242/login | vstup pre tím |
| Prehľad | `/app` | najbližší event, predané lístky, nízky sklad, najbližšie promo, top nápady, posledný event |
| Lístky | `/tickets` | predaj lístkov: predané, zostáva, tržba, koľko ľudí prišlo, objednávky |
| Skener | `/scan` | kontrola lístkov pri vstupe (kamera alebo ručne zadaný kód) |
| Sklad | `/stock` | alko / nealko: stav, minimum, nákup, výdaj na event, straty, inventúra, história |
| Promo | `/promo` | promo kalendár: čo, kde (Instagram, TikTok, plagáty…), kedy, kto, stav |
| Štatistiky | `/stats` | porovnanie eventov: počet ľudí, počet barov, tržby barov, € na hosťa, najlepší bar a produkt |
| Nápady | `/ideas` | nápady na nové eventy: prečo, plusy a mínusy, hlasovanie, stav |
| Účty | `/users` | len admin: ľudia, roly, heslá, demo dáta |
| E-shop (verejný) | http://localhost:4242/buy | kúpa lístkov pre návštevníkov |

---

## 🔑 Prihlasovacie údaje

| Účet | E-mail (login) | Heslo | Čo vidí |
|---|---|---|---|
| **Admin** | `base@base.com` | `admin` | všetko + správa účtov a demo dát |
| **Lístky** | `listky@base.com` | `baselistky` | lístky, skener, promo, nápady |
| **Staff (tím)** | `staff@base.com` | `basestaff` | sklad, promo, štatistiky, nápady |

- Účty sa vytvoria pri **prvom spustení** z `backoffice/.env`. Ďalších ľudí pridáš v **Účty** (`/users`) ako admin.
- Heslá sa dajú zmeniť v **Účty**. Zmena v `.env` už existujúci účet nezmení.
- ⚠️ Tieto heslá sú slabé a sú len na skúšanie u teba na počítači. **Pred tým, ako by to bežalo na internete, ich zmeň** (a potom ich aj tu prepíš alebo zmaž).
- Prihlásenie platí 12 hodín. Po 10 zlých pokusoch z jednej adresy sa login na 15 minút zablokuje.

---

## Spustenie

Treba mať **Node.js 22.13 alebo novší** (`node --version`).

```bash
cd backoffice
npm install
npm start
```

Potom otvor http://localhost:4242/login.

Server pri štarte vypíše adresu a režim platieb. Vypíše aj varovanie `ExperimentalWarning: SQLite…`, to je v poriadku.

### Nastavenia (`backoffice/.env`)

Súbor `.env` **sa nedáva na GitHub** (je v `.gitignore`). Vzor so všetkými možnosťami je v `.env.example`.

| Premenná | Čo to je |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | admin účet (vytvorí sa pri prvom štarte) |
| `TICKETS_EMAIL`, `TICKETS_PASSWORD` | účet na predaj lístkov |
| `STAFF_EMAIL`, `STAFF_PASSWORD` | účet pre tím |
| `STRIPE_SECRET_KEY` | Stripe **testovací** kľúč `sk_test_…`. Prázdne = demo platba. Ostrý `sk_live_` kľúč server odmietne. |
| `STRIPE_WEBHOOK_SECRET` | voliteľné, z `stripe listen` |
| `EVENT_NAME`, `EVENT_DATE`, `EVENT_VENUE` | event, na ktorý sa predávajú lístky (teraz Chodbovica 5) |
| `TICKET_NAME`, `TICKET_PRICE_CENTS` | názov a cena lístka v centoch (`1000` = 10 €) |
| `EVENT_CAPACITY`, `MAX_PER_ORDER` | kapacita (1400) a max. lístkov na objednávku (6) |
| `PORT`, `BASE_URL` | port (4242) a adresa servera |

### Dáta

Všetko je v jednom súbore **`backoffice/data/base.db`** (SQLite). Tiež nejde na GitHub.

- **Záloha** = skopíruj tento súbor (keď server nebeží).
- **Začať odznova** = zastav server, zmaž priečinok `data/` a spusti znova. Účty, eventy aj demo dáta sa vytvoria nanovo.

---

## Sekcie podrobne

### Lístky a skener
1. Návštevník na `/buy` vyberie počet lístkov, vyplní meno a e-mail.
2. Server **podrží miesta na 30 minút** (nepredá viac, ako je kapacita).
3. Platba: bez Stripe kľúča sa ukáže **simulovaná platba**. So Stripe kľúčom sa ukáže skutočná platobná stránka Stripe v test móde (testovacia karta `4242 4242 4242 4242`, ľubovoľný budúci dátum, ľubovoľné CVC).
4. Po zaplatení dostane stránku s lístkami. Každý lístok má **QR kód** a kód `XXXX-XXXX-XXXX`. E-mail sa zatiaľ neposiela, odkaz sa len vypíše do konzoly servera.
5. Pri vstupe **Skener** ukáže: **Valid** (vitaj), **Used** (už použitý, aj s časom) alebo **Invalid** (neexistuje).

Kamera v skeneri funguje len na `localhost` alebo cez `https://`. Inak treba kód z lístka zadať ručne.

Stripe test kľúč: na stripe.com si vytvor účet, zapni **Test mode** → Developers → API keys → skopíruj **Secret key** do `STRIPE_SECRET_KEY` a reštartuj server.

### Sklad (alko / nealko)
- **Položky**: názov, alko/nealko, jednotka (ks, fľ., sud, bal., l, kg), **minimum**. Keď stav klesne pod minimum, riadok sa zvýrazní ⚠ a ukáže sa aj na Prehľade.
- **Pohyb** (každá zmena sa zapíše do histórie aj s menom, kto ju urobil):
  - *Purchase / delivery (+)*: prišiel tovar
  - *Used at an event (−)*: minulo sa na evente (vyberieš ktorom)
  - *Loss / broken (−)*: rozbité, stratené
  - *Stocktake (=)*: inventúra, zadáš, koľko reálne napočítaš, a stav sa prepíše
- Nedá sa vydať viac, ako je na sklade.

### Promo kalendár
- Mesačný kalendár (na mobile zoznam). Eventy sú označené bielou čiarou.
- Príspevok: dátum, čas, kanál (Instagram, TikTok, Facebook, Plagáty, Rádio, Influencer, Newsletter, Iné), čo, k akému eventu, kto to robí, poznámka/caption.
- Stav: **Planned** → **Ready** (biele pole) → **Posted** (prečiarknuté). Klikni na príspevok a môžeš ho upraviť alebo zmazať.

### Štatistiky eventov
- **Grafy**: hostia na event, tržba barov na event, útrata na hosťa (€/hosť), najpredávanejšie produkty. Prejdi myšou na pruh a ukáže sa detail.
- **Tabuľka porovnania**: hostia, počet barov, tržba barov, z toho alko/nealko, € na hosťa, najlepší bar, top produkt. Filter Chodbovica / Chillout.
- **Detail eventu**: uprav počet hostí, dátum, miesto, poznámky. Pridaj **bary** (napr. Main bar, Shot bar) a ku každému **čo predal** (produkt, alko/nealko, koľko kusov, tržba €). Pri každom bare je graf, čo išlo najviac.
- **Pridať event**: dole na stránke.

Eventy z project reportu (Chodbovica 1–5 s dátumami a miestami, dva Chillouty z roku 2025, Chillout 10) sú tam od začiatku. **Čísla hostí a tržieb pri nich sú DEMO**, len aby bolo vidieť, ako porovnanie funguje. Prepíš ich skutočnými číslami.

### Nápady na eventy
- Ktokoľvek z tímu pridá nápad: **čo** to je a **prečo**.
- Každý môže pridať **plusy (+)** a **mínusy (−)** a hlasovať **▲ / ▼** (druhý klik hlas zruší). Nápady sú zoradené podľa hlasov.
- Admin mení stav: *New → Discussing → Approved / Rejected*. Filter *Open* skryje schválené a zamietnuté.
- Svoj nápad alebo bod môže zmazať autor, admin môže zmazať čokoľvek.

### Účty (len admin)
- Pridať človeka: meno, e-mail, heslo (min. 5 znakov), rola.
- Zmeniť rolu alebo heslo. Po zmene hesla sa ten človek všade odhlási.
- Sám seba admin nezmaže ani si nezoberie admin rolu.
- **Demo dáta**: tlačidlo *Remove demo data* zmaže ukážkové čísla, sklad, promo príspevky a ukážkový nápad. Skutočné eventy a všetko, čo ste zadali vy, ostane.

### Roly
| Rola | Lístky + skener | Sklad | Promo | Štatistiky | Nápady | Účty |
|---|---|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ticket sales (Lístky) | ✓ | – | ✓ | – | ✓ | – |
| Team (Staff) | – | ✓ | ✓ | ✓ | ✓ | – |

Zmena, kto čo vidí: `ACCESS` v `auth.js`.

---

## Ako je to postavené (pre programátora)

- **Node.js 22 + Express**, databáza **SQLite** vstavaná v Node (`node:sqlite`), žiadny build.
- `server.js`: nastavenia, spustenie, prepojenie modulov
- `db.js`: tabuľky a pomocné funkcie
- `auth.js`: účty, heslá (scrypt hash), prihlásenie (HttpOnly cookie, sessions v DB), roly
- `tickets.js`: predaj lístkov, Stripe Checkout, demo platba, QR lístky, check-in
- `hub.js`: API pre sklad, promo, eventy/bary/štatistiky, nápady, účty
- `demo.js`: skutočné eventy z reportu + demo dáta (označené `demo = 1`)
- `public/`: stránky (čisté HTML + JS). Spoločná hlavička, navigácia a pomocné funkcie sú v `public/hub.js` a `public/hub.css`.

Interné stránky sú zatiaľ po anglicky (ako web). Preložiť do slovenčiny sa dajú.

## Čo chýba do ostrej prevádzky

- hosting s HTTPS (Render, Railway, Fly.io…) a pravidelná záloha `data/base.db`
- silné heslá, prípadne prihlásenie cez Google
- skutočné posielanie e-mailov s lístkami (Resend, Brevo…)
- Stripe účet overený na firmu/živnosť, obchodné podmienky, GDPR, vrátenie peňazí
- faktúry/doklady a dane: poradiť sa s účtovníkom
- záťažový test pred spustením predaja
- import predajov z pokladní barov (teraz sa zadávajú ručne)
