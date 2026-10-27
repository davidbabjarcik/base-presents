# Predaj lístkov — testovací prototyp

Vlastný predaj lístkov pre Base Presents. **Len na skúšanie**: beží u teba na počítači, platby sú buď simulované (demo), alebo cez Stripe v test móde (žiadne skutočné peniaze). Ostré `sk_live_` kľúče server odmietne.

## Spustenie

```bash
cd tickets-prototype
npm install
npm start
```

Potom otvor:

| Stránka | Adresa | Čo robí |
|---|---|---|
| Kúpa | http://localhost:4242/buy | výber počtu lístkov, meno, e-mail → platba |
| Lístky | `/order/<id>?t=<token>` | po zaplatení: lístky s QR kódom (tento odkaz by prišiel e-mailom) |
| Skener | http://localhost:4242/scan | kontrola pri vstupe: kamera alebo ručne zadaný kód |
| Admin | http://localhost:4242/admin | predané, zostáva, tržba, koľko ľudí už prišlo, objednávky |
| Login | http://localhost:4242/login | prihlásenie pre tím (admin + skener) |

Skener a admin sú za prihlásením. Účet sa nastavuje v `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`); predvolený testovací účet je v `.env.example`. Heslo pred ukázaním niekomu inému zmeň. Prihlásenie platí 12 hodín, po reštarte servera sa treba prihlásiť znova. Po 10 zlých pokusoch z jednej adresy sa login na 15 minút zablokuje.

## Demo vs. Stripe test mód

- **Bez `.env`** beží v **demo režime**: namiesto Stripe sa ukáže simulovaná platobná stránka.
- **So Stripe**: vytvor si účet na stripe.com, v Dashboarde zapni **Test mode** → Developers → API keys → skopíruj **Secret key** (`sk_test_…`).
  Skopíruj `.env.example` na `.env` a kľúč vlož do `STRIPE_SECRET_KEY`. Reštartuj server.
  Testovacia karta: `4242 4242 4242 4242`, ľubovoľný budúci dátum, ľubovoľné CVC.

Voliteľne webhook (keď kupujúci zavrie okno hneď po zaplatení, objednávka sa aj tak potvrdí):
nainštaluj Stripe CLI, spusti `stripe listen --forward-to localhost:4242/api/webhook` a vypísaný `whsec_…` daj do `STRIPE_WEBHOOK_SECRET`.

## Ako to funguje

1. Kupujúci vyplní formulár → server **rezervuje miesta** (max. kapacita, max. 6 lístkov na objednávku) na 30 minút.
2. Presmeruje na platbu (Stripe Checkout alebo demo).
3. Po zaplatení server **u Stripe overí**, že platba prešla, a vydá lístky. Každý má náhodný kód `XXXX-XXXX-XXXX` a QR kód.
4. Pri vstupe skener kód overí. Druhé použitie toho istého lístka ukáže **„Used“** s časom prvého vstupu.

Dáta sú v SQLite súbore `data/tickets.db` (zmaž ho, ak chceš začať odznova).

## Čo chýba do ostrej prevádzky

- viac účtov pre tím (teraz je jeden spoločný) a hashované heslá v databáze
- skutočné posielanie e-mailov (teraz sa len vypíše do konzoly), napr. cez Resend alebo Brevo
- hosting s HTTPS (Render, Railway, Fly.io…), záloha databázy
- Stripe účet overený na firmu/živnosť, obchodné podmienky, GDPR, vrátenie peňazí
- faktúry/doklady a dane — poradiť sa s účtovníkom
- záťažový test pred spustením predaja
