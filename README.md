# Base Presents

Projekt Base Presents z Košíc (Chodbovica, Chillout). Má dve časti:

| Časť | Priečinok | Čo to je |
|---|---|---|
| **Web** | `index.html`, `assets/` | verejná jednostránková stránka. Lístky sa predávajú **priamo na webe cez náš ticketing** (BASE Hub). V menu je **Login** pre tím. |
| **BASE Hub** | `backoffice/` | interný systém pre tím: lístky (aj PDF s vlastným dizajnom) + skener, sklad alko/nealko/materiál, staff rozpis po hodinách s verejným zápisom, promo kalendár, štatistiky eventov a barov, nápady na eventy, účty. Beží lokálne cez Node.js. |

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

## Fotoreporty (galérie z eventov)

Albumy fotiek sú priamo na webe (GitHub Pages): sekcia **Archive** ukazuje 3 najnovšie, všetky sú na `gallery.html`.
Každý album má mriežku fotiek, zväčšenie na celú obrazovku, listovanie šípkami alebo potiahnutím prstom, stiahnutie fotky a zdieľanie.

**Pridanie albumu** (raz nainštaluj: `cd tools` a `npm install`):

```bash
cd tools
node add-album.mjs "C:\Fotky\Chodbovica 5" --title "Chodbovica 5" --date 2026-11-16 --series Chodbovica --by "Meno fotografa"
```

Potom commit + push a o minútu je album online.

- Skript zoberie všetky JPG/PNG z priečinka (zoradené podľa názvu súboru), otočí ich správne, zmenší na max. **2000 px** + náhľad 640 px a **zmaže z nich všetky metadáta** (GPS, fotoaparát). Z 8 MB fotky je cca 300–400 kB.
- Voliteľné: `--cover 12` (titulná fotka = 12. v poradí), `--originals "https://…"` (odkaz na plné rozlíšenie, napr. Google Drive), `--slug …` (názov priečinka), `--replace` (prepísať existujúci album).
- Výsledok: `photos/<album>/` (fotky, `thumbs/`, `album.json`) a zoznam `photos/albums.json`.
- **Zmazať album**: zmaž jeho priečinok v `photos/` a jeho záznam v `photos/albums.json`.
- **Miesto**: GitHub Pages má limit cca **1 GB**, čo je zhruba 2 500–3 000 fotiek (8–10 eventov po 300). Skript vypíše, koľko už fotky zaberajú, a varuje pri 800 MB. Originály v plnom rozlíšení nechajte u fotografa alebo na Google Drive a dajte na ne odkaz cez `--originals`.

## Web

Popis stránky, dizajnové pravidlá a čo je ešte placeholder: **[CLAUDE.md](CLAUDE.md)**.
