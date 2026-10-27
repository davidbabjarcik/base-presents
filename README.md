# Base Presents

Projekt Base Presents z Košíc (Chodbovica, Chillout). Má dve časti:

| Časť | Priečinok | Čo to je |
|---|---|---|
| **Web** | `index.html`, `assets/` | verejná jednostránková stránka. Otvor `index.html` v prehliadači, netreba nič inštalovať. Lístky sa predávajú cez Tootoot. |
| **BASE Hub** | `backoffice/` | interný systém pre tím: lístky + skener, sklad alko/nealko, promo kalendár, štatistiky eventov a barov, nápady na eventy, účty. Beží lokálne cez Node.js. |

## BASE Hub — rýchly štart

```bash
cd backoffice
npm install
npm start
```

Otvor http://localhost:4242/login

| Účet | E-mail | Heslo | Čo vidí |
|---|---|---|---|
| Admin | `base@base.com` | `admin` | všetko |
| Lístky | `listky@base.com` | `baselistky` | lístky, skener, promo, nápady |
| Staff | `staff@base.com` | `basestaff` | sklad, promo, štatistiky, nápady |

⚠️ Heslá sú len na skúšanie lokálne. Pred spustením na internete ich zmeň.

Všetko ostatné (sekcie, nastavenia, Stripe, zálohy, čo chýba do ostrej prevádzky) je v **[backoffice/README.md](backoffice/README.md)**.

## Web

Popis stránky, dizajnové pravidlá a čo je ešte placeholder: **[CLAUDE.md](CLAUDE.md)**.
