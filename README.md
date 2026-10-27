# Base Presents

Projekt Base Presents z Košíc (Chodbovica, Chillout). Má dve časti:

| Časť | Priečinok | Čo to je |
|---|---|---|
| **Web** | `index.html`, `assets/` | verejná jednostránková stránka. Lístky sa predávajú **priamo na webe cez náš ticketing** (BASE Hub). V menu je **Login** pre tím. |
| **BASE Hub** | `backoffice/` | interný systém pre tím: lístky + skener, sklad alko/nealko/materiál, staff rozpis po hodinách, promo kalendár, štatistiky eventov a barov, nápady na eventy, účty. Beží lokálne cez Node.js. |

## BASE Hub — rýchly štart

```bash
cd backoffice
npm install
npm start
```

Web spustíš napríklad takto (v hlavnom priečinku):

```bash
python -m http.server 8765
```

| Čo | Adresa |
|---|---|
| Web | http://localhost:8765 |
| Prihlásenie pre tím | http://localhost:4242/login (alebo **Login** v menu webu) |

Aby fungoval nákup lístkov na webe, **musí bežať aj BASE Hub**. Inak formulár napíše, že predaj je offline.

| Účet | E-mail | Heslo | Čo vidí |
|---|---|---|---|
| Admin | `base@base.com` | `admin` | všetko |
| Lístky | `listky@base.com` | `baselistky` | lístky, skener, promo, nápady |
| Staff | `staff@base.com` | `basestaff` | sklad, staff rozpis, promo, štatistiky, nápady |

⚠️ Heslá sú len na skúšanie lokálne. Pred spustením na internete ich zmeň.

Všetko ostatné (sekcie, nastavenia, Stripe, zálohy, čo chýba do ostrej prevádzky) je v **[backoffice/README.md](backoffice/README.md)**.

## Web

Popis stránky, dizajnové pravidlá a čo je ešte placeholder: **[CLAUDE.md](CLAUDE.md)**.
