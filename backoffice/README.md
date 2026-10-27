# BASE Hub — interný systém Base Presents

Interná aplikácia pre tím Base Presents. **Prototyp**: beží u teba na počítači (`localhost`). Platby sú len simulované alebo v Stripe **test móde**, žiadne skutočné peniaze.

Čo v ňom je:

| Sekcia | Adresa | Na čo je |
|---|---|---|
| Prihlásenie | http://localhost:4242/login | vstup pre tím |
| Prehľad | `/app` | najbližší event, predané lístky, nízky sklad, najbližšie promo, top nápady, posledný event |
| Lístky | `/tickets` | predaj lístkov: predané, zostáva, tržba, koľko ľudí prišlo, objednávky |
| Skener | `/scan` | kontrola lístkov pri vstupe (kamera alebo ručne zadaný kód) |
| Sklad | `/stock` | alko / nealko / materiál: stav, objem, cena za kus, hodnota skladu, odbery (aj komis a free), výdaj na event, straty, inventúra, história |
| Staff | `/staff` | rozpis ľudí po hodinách (07:00–01:00) na každý deň: príprava, bar, rádio… |
| Promo | `/promo` | promo kalendár: čo, kde (Instagram, TikTok, plagáty…), kedy, kto, stav |
| Štatistiky | `/stats` | porovnanie eventov: počet ľudí, počet barov, tržby barov, € na hosťa, najlepší bar a produkt |
| Nápady | `/ideas` | nápady na nové eventy: prečo, plusy a mínusy, hlasovanie, stav |
| Účty | `/users` | len admin: ľudia, roly, heslá, demo dáta |
| Nákup lístkov | sekcia **Tickets** na webe (http://localhost:8765/#tickets) | formulár na webe predáva cez BASE Hub. Záložná samostatná stránka: http://localhost:4242/buy |

---

## 🔑 Prihlasovacie údaje

| Účet | E-mail (login) | Heslo | Čo vidí |
|---|---|---|---|
| **Admin** | `base@base.com` | `admin` | všetko + správa účtov a demo dát |
| **Lístky** | `listky@base.com` | `baselistky` | lístky, skener, promo, nápady |
| **Staff (tím)** | `staff@base.com` | `basestaff` | sklad, staff rozpis, promo, štatistiky, nápady |

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
| `SITE_URL` | adresa verejného webu (http://localhost:8765). Len odtiaľ môže web predávať lístky a sem sa vráti zákazník, keď platbu zruší. |
| `SITE_ORIGINS` | voliteľné: ďalšie adresy webu oddelené čiarkou. `null` = `index.html` otvorený priamo zo súboru. |

### Dáta

Všetko je v jednom súbore **`backoffice/data/base.db`** (SQLite). Tiež nejde na GitHub.

- **Záloha** = skopíruj tento súbor (keď server nebeží).
- **Začať odznova** = zastav server, zmaž priečinok `data/` a spusti znova. Účty, eventy aj demo dáta sa vytvoria nanovo.

---

## Sekcie podrobne

### Lístky a skener
1. Návštevník na **webe v sekcii Tickets** (alebo na záložnej stránke `/buy`) vyberie počet lístkov, vyplní meno a e-mail. Web si od BASE Hubu načíta názov eventu, cenu a koľko lístkov zostáva.
2. Server **podrží miesta na 30 minút** (nepredá viac, ako je kapacita).
3. Platba: bez Stripe kľúča sa ukáže **simulovaná platba**. So Stripe kľúčom sa ukáže skutočná platobná stránka Stripe v test móde (testovacia karta `4242 4242 4242 4242`, ľubovoľný budúci dátum, ľubovoľné CVC).
4. Po zaplatení dostane stránku s lístkami. Každý lístok má **QR kód** a kód `XXXX-XXXX-XXXX`. E-mail sa zatiaľ neposiela, odkaz sa len vypíše do konzoly servera.
5. Pri vstupe **Skener** ukáže: **Valid** (vitaj), **Used** (už použitý, aj s časom) alebo **Invalid** (neexistuje).

Kamera v skeneri funguje len na `localhost` alebo cez `https://`. Inak treba kód z lístka zadať ručne.

Stripe test kľúč: na stripe.com si vytvor účet, zapni **Test mode** → Developers → API keys → skopíruj **Secret key** do `STRIPE_SECRET_KEY` a reštartuj server.

### Sklad (alko / nealko / materiál)
- **Hore**: hodnota skladu spolu a zvlášť alko / nealko (stav × posledná cena za kus).
- **Položky**: názov, typ (alko, nealko, **materiál**: stany, plachty, reťaze, vrecia, poháre…), **objem v litroch** (0,7 / 1 / 0,25…), jednotka (ks, fľ., sud, bal., karton, l, kg, m), **cena za kus**, **minimum**, poznámka. Rovnaký názov s iným objemom je iná položka (Jägermeister 0,7 l a 1 l).
- Keď stav klesne pod minimum, riadok sa zvýrazní ⚠ a ukáže sa aj na Prehľade.
- Stav môže byť aj desatinný (0,5 = načatá fľaša).
- **Pohyb** (každá zmena sa zapíše do histórie s dátumom a menom, kto ju zadal):
  - *Order / delivery (+)*: odber. Zadáš **cenu za kus**, **od koho** (Metro, dodávateľ, náš sklad…) a **dohodu**: *Bought* (kúpené), *Komis* (nepredané sa vracia) alebo *Free* (zadarmo od partnera). Cena sa uloží ako nová cena položky.
  - *Used at an event (−)*: minulo sa na evente (vyberieš ktorom)
  - *Loss / broken / promo (−)*: rozbité, stratené, dané na promo
  - *Stocktake (=)*: inventúra / čo ostalo. Zadáš, koľko reálne napočítaš, a stav sa prepíše.
- Dátum pohybu sa dá zmeniť (napr. keď zapisuješ odber spätne).
- **História** sa dá filtrovať (odbery, eventy, straty, inventúry). Pri odberoch je súčet ceny (bez free). Tlačidlo **↺** pohyb vráti (stav sa vráti späť).
- Nedá sa vydať viac, ako je na sklade.

### Staff (rozpis ľudí)
- Každý **deň** má vlastný rozpis: dátum, názov (napr. „Chodbovica 5 · event day“), event a poznámky (porady, štart…).
- Ľudia sú v **skupinách**: *Prep* (príprava), *Bar*, *Radio*. Dá sa napísať aj vlastná skupina (napr. *Baby*, *Security*).
- Pri každom človeku je mriežka hodín **07:00 až 01:00**. **Klikni** na hodinu = je tam / nie je tam. **Ťahaj** myšou alebo prstom cez viac hodín a vyplní ich naraz.
- Spodný riadok každej skupiny ukazuje, **koľko ľudí je tam v danú hodinu**.
- Pri človeku sa dá písať poznámka (napr. „operatívne“, „len poobede“). Meno a poznámka sa uložia, keď klikneš mimo poľa.
- **Nový deň** sa dá vytvoriť prázdny alebo ako **kópia** iného dňa (rovnakí ľudia aj hodiny). V detaile dňa je aj *Duplicate day*.
- Mená sa pri písaní ponúkajú z ľudí, ktorí už boli v niektorom rozpise.

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
| Rola | Lístky + skener | Sklad | Staff | Promo | Štatistiky | Nápady | Účty |
|---|---|---|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ticket sales (Lístky) | ✓ | – | – | ✓ | – | ✓ | – |
| Team (Staff) | – | ✓ | ✓ | ✓ | ✓ | ✓ | – |

Zmena, kto čo vidí: `ACCESS` v `auth.js`.

---

## Ako je to postavené (pre programátora)

- **Node.js 22 + Express**, databáza **SQLite** vstavaná v Node (`node:sqlite`), žiadny build.
- `server.js`: nastavenia, spustenie, prepojenie modulov
- `db.js`: tabuľky a pomocné funkcie
- `auth.js`: účty, heslá (scrypt hash), prihlásenie (HttpOnly cookie, sessions v DB), roly
- `tickets.js`: predaj lístkov, Stripe Checkout, demo platba, QR lístky, check-in
- `hub.js`: API pre sklad, staff rozpis, promo, eventy/bary/štatistiky, nápady, účty
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
