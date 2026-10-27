# Stripe — ako rozbehať platby za lístky

Lístky sa predávajú cez **BASE Hub** (`backoffice/`). Platby kartou spracúva **Stripe Checkout**: zákazník zaplatí na zabezpečenej stránke Stripe a vráti sa k nám po lístky s QR kódom.

Sú tri režimy:

| Režim | Kedy | Skutočné peniaze? |
|---|---|---|
| **Demo** | v `.env` nie je žiadny Stripe kľúč | nie, platba je len simulovaná |
| **Test mód** | v `.env` je kľúč `sk_test_…` | nie, platí sa testovacími kartami |
| **Naostro** | kľúč `sk_live_…` | **áno**. BASE Hub ho zatiaľ zámerne **odmietne** (pozri koniec návodu) |

> ⚠️ **Tajné kľúče** (`sk_test_…`, `sk_live_…`, `whsec_…`) patria **len do `backoffice/.env`**. Nikdy ich nedávaj do gitu, do kódu, do chatu ani nikomu neposielaj. `.env` je v `.gitignore`, takže na GitHub nejde.

---

## 1. Stripe účet

1. Choď na **https://stripe.com** → *Sign up* a vytvor účet (e-mail, heslo, krajina **Slovakia**).
2. Na začiatku nemusíš vypĺňať údaje o firme. Test mód funguje hneď.

## 2. Testovací kľúč

1. V Stripe Dashboarde zapni vpravo hore prepínač **Test mode** (alebo „Sandbox“).
2. Choď do **Developers → API keys**.
3. Pri **Secret key** klikni *Reveal* a skopíruj kľúč, ktorý začína `sk_test_…`.
   (Publishable key `pk_test_…` nepotrebujeme.)

## 3. Kľúč do BASE Hubu

1. Otvor súbor `backoffice/.env` (ak neexistuje, skopíruj `backoffice/.env.example` na `backoffice/.env`).
2. Vlož kľúč:
   ```
   STRIPE_SECRET_KEY=sk_test_...tvoj_kluc...
   ```
3. Skontroluj aj event, cenu a kapacitu:
   ```
   EVENT_NAME=Chodbovica 5
   EVENT_DATE=16.11.2026 · 21:07
   EVENT_VENUE=Jedlíkova 7, Košice
   TICKET_NAME=Presale
   TICKET_PRICE_CENTS=1000      # cena v centoch: 1000 = 10,00 €
   EVENT_CAPACITY=1400
   MAX_PER_ORDER=6
   ```
4. Reštartuj BASE Hub (v termináli `Ctrl+C`, potom znova):
   ```bash
   cd backoffice
   npm start
   ```
   V konzole musí byť **`payments: stripe-test`**. Ak je tam `demo`, kľúč sa nenačítal (preklep, medzera, zlý súbor).

## 4. Vyskúšaj nákup

1. Otvor web (http://localhost:8765/#tickets) alebo http://localhost:4242/buy.
2. Vyber lístky, vyplň meno a e-mail → **Continue to payment**. Otvorí sa stránka **Stripe Checkout**.
3. Zaplať **testovacou kartou** (dátum platnosti ľubovoľný v budúcnosti, CVC ľubovoľné 3 čísla):

   | Karta | Čo sa stane |
   |---|---|
   | `4242 4242 4242 4242` | platba prejde |
   | `4000 0025 0000 3155` | banka si vyžiada overenie (3D Secure), potvrď ho v okne |
   | `4000 0000 0000 9995` | platba sa zamietne (nedostatok peňazí) |

4. Po zaplatení ťa Stripe vráti na stránku s lístkami (QR kódy + **Download PDF**).
5. V BASE Hube → **Tickets** uvidíš objednávku ako *paid*. V Stripe Dashboarde (test mód) → **Payments** uvidíš platbu.
6. Skús aj **zrušenie**: na Stripe stránke klikni späť. Vrátiš sa na web s hláškou, že sa nič nestiahlo.

## 5. Webhook (odporúčané)

Bez webhooku sa lístky vydajú, keď sa zákazník po platbe vráti na našu stránku. Keby ale hneď po zaplatení zavrel okno, objednávka by ostala „pending“. Webhook je správa zo Stripe priamo nášmu serveru („zaplatené“), takže sa lístky vydajú vždy.

**Lokálne (na tvojom počítači):**
1. Nainštaluj **Stripe CLI**: https://docs.stripe.com/stripe-cli
2. V termináli:
   ```bash
   stripe login
   stripe listen --forward-to localhost:4242/api/webhook
   ```
3. CLI vypíše `Your webhook signing secret is whsec_…`. Daj ho do `backoffice/.env`:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
4. Reštartuj BASE Hub. Kým `stripe listen` beží, Stripe posiela udalosti tvojmu počítaču.

**Keď bude BASE Hub na internete:**
1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. URL: `https://<adresa-base-hubu>/api/webhook`
3. Udalosti: `checkout.session.completed` a `checkout.session.expired`.
4. Skopíruj **Signing secret** (`whsec_…`) do `.env` na serveri ako `STRIPE_WEBHOOK_SECRET`.

## 6. Vzhľad platobnej stránky

Stripe Dashboard → **Settings → Branding**:
- nahraj **logo** (biele BASE na čiernom alebo čierne na bielom: `assets/base-logo-black.png`),
- farby: pozadie/akcent **#000000**, tlačidlá **#000000**.

Stripe Dashboard → **Settings → Payment methods**: zapni **Apple Pay** a **Google Pay**. Checkout ich potom ponúkne sám, na mobile je to najrýchlejšie.

Na **Settings → Public details** nastav **statement descriptor** (čo uvidí zákazník na výpise), napr. `BASE PRESENTS`.

---

## 7. Naostro (skutočné peniaze), až keď bude všetko pripravené

Treba spraviť:

1. **Aktivovať Stripe účet**: Dashboard → *Activate account*. Vyplníte, kto predáva (živnosť, s.r.o. alebo občianske združenie), IČO, adresu, **IBAN** na výplaty a overenie totožnosti.
2. **BASE Hub dať na internet** s **HTTPS** (Railway, Render, Fly.io…). Lokálne z počítača sa naostro predávať nedá.
3. Na webe nastaviť `TICKETS_API` v `index.html` na adresu BASE Hubu a v `.env` na serveri `BASE_URL` a `SITE_URL`.
4. **Upraviť BASE Hub, aby prijal `sk_live_` kľúč.** Teraz ho zámerne odmieta, aby sa omylom nenaúčtovali skutočné peniaze. Je to jedna podmienka v `backoffice/server.js` (hľadaj `sk_test_`).
5. Pridať **posielanie lístkov e-mailom** (napr. Resend alebo Brevo). Teraz sa odkaz na lístky len vypíše do konzoly.
6. **Obchodné podmienky** a **reklamačný poriadok / vrátenie peňazí**, **GDPR** (čo robíme s menom a e-mailom) a odkaz na ne pri nákupe.
7. Poradiť sa s **účtovníkom** (faktúry/doklady, DPH, eKasa pri online platbách).
8. Live kľúč `sk_live_…` (Dashboard bez Test mode → Developers → API keys) dať **len** do `.env` na serveri a nastaviť live webhook (krok 5).
9. Pred spustením predaja spraviť **jednu skutočnú platbu** (napr. lístok za 1 €), vrátiť ju (Payments → Refund) a skontrolovať, že všetko sedí.

**Poplatky:** Stripe si berie poplatok z každej platby (pri európskych kartách približne 1,5 % + 0,25 €, pri iných viac). Aktuálne ceny sú na https://stripe.com/pricing. Peniaze chodia na IBAN automaticky (štandardne po pár dňoch).

---

## Keď niečo nefunguje

| Problém | Riešenie |
|---|---|
| konzola píše `payments: demo` | kľúč nie je v `backoffice/.env` alebo je tam preklep. Po zmene reštartuj server. |
| server sa nespustí: „only runs with a Stripe TEST key“ | v `.env` je `sk_live_…`. Pre test daj `sk_test_…`. |
| „Payment could not be started“ | zlý alebo zrušený kľúč, alebo nefunguje internet. Pozri chybu v konzole servera. |
| po platbe „Payment pending“ | Stripe ešte nepotvrdil platbu. Obnov stránku o pár sekúnd, alebo nastav webhook (krok 5). |
| formulár na webe píše „offline“ | BASE Hub nebeží, alebo je v `index.html` zlá adresa v `TICKETS_API`. |
| objednávka ostala *pending* | zákazník platbu nedokončil. Miesta sa po 30 minútach uvoľnia samé. |
