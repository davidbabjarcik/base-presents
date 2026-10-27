// Add a photo report (album) to the website.
//
//   cd tools
//   node add-album.mjs "C:\Fotky\Chodbovica 5" --title "Chodbovica 5" --date 2026-11-16 --series Chodbovica --by "Meno fotografa"
//   node add-album.mjs "C:\Users\...\Downloads\album.zip" --title "Chodbovica 5" --date 2026-11-16
//
// The source can be a folder or a .zip (e.g. a Facebook album download). Subfolders are included.
// Photos are read straight from the ZIP, nothing is unpacked to disk.
// Every photo is turned upright, shrunk to max 2000 px (web) + a 640 px thumbnail, saved as JPEG
// without any metadata (no GPS, no camera info). Output: photos/<album>/ + photos/albums.json.
// Options:
//   --title "…"        album name (required)
//   --date YYYY-MM-DD  event date (required)
//   --series …         Chodbovica | Chillout | Other (default Other)
//   --by "…"           photographer (shown as credit)
//   --slug …           folder name (default from title + year)
//   --cover N          which photo is the cover (number in the album, default 1)
//   --originals URL    link to full-resolution photos (Google Drive, WeTransfer…)
//   --replace          overwrite an album with the same slug

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import AdmZip from 'adm-zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHOTOS = path.join(ROOT, 'photos');
const BIG = 2000, THUMB = 640;
const EXT = /\.(jpe?g|png|webp|tiff?)$/i;
const MAX_PHOTO = 80 * 1024 * 1024;            // skip anything bigger (broken file / zip bomb)
const MAX_TOTAL = 8 * 1024 * 1024 * 1024;      // max 8 GB of photos in one album

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true; else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
const die = (msg) => { console.error('✗ ' + msg); process.exit(1); };

function folderSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => {
    const p = path.join(dir, e.name);
    return s + (e.isDirectory() ? folderSize(p) : fs.statSync(p).size);
  }, 0);
}

const a = args(process.argv.slice(2));
const src = a._[0];
if (!src || !fs.existsSync(src)) die('Give the folder or .zip with photos as the first argument.');
const isZip = fs.statSync(src).isFile() && /\.zip$/i.test(src);
if (!isZip && !fs.statSync(src).isDirectory()) die('The first argument must be a folder or a .zip file.');
if (!a.title) die('Add --title "…"');
if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) die('Add --date YYYY-MM-DD');
const series = ['Chodbovica', 'Chillout'].includes(a.series) ? a.series : 'Other';
const slug = slugify(a.slug || `${a.title} ${a.date.slice(0, 4)}`);
if (!slug) die('Could not make a folder name, add --slug');
if (a.originals && !/^https:\/\//.test(a.originals)) die('--originals must be an https:// link');

// Collect photos: { name, size, read() -> Buffer | path } from a folder (with subfolders) or a ZIP
const skipName = (p) => p.split(/[\\/]/).some((part) => part.startsWith('.') || part === '__MACOSX');
let files = [];
if (isZip) {
  let zip;
  try { zip = new AdmZip(src); } catch (e) { die('Could not open the ZIP: ' + e.message); }
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !EXT.test(entry.entryName) || skipName(entry.entryName)) continue;
    const size = entry.header.size;
    if (size > MAX_PHOTO) { console.warn(`  ! skipped ${entry.entryName}: too big`); continue; }
    files.push({ name: entry.entryName, size, read: () => entry.getData() });
  }
} else {
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.name.startsWith('.') || e.name === '__MACOSX') continue;
      if (e.isDirectory()) walk(p);
      else if (EXT.test(e.name)) files.push({ name: path.relative(src, p), size: fs.statSync(p).size, read: () => p });
    }
  };
  walk(src);
}
files.sort((x, y) => natural.compare(x.name, y.name));
if (!files.length) die(`No JPG/PNG/WEBP photos found in that ${isZip ? 'ZIP' : 'folder'}.`);
if (files.reduce((t, f) => t + f.size, 0) > MAX_TOTAL) die('More than 8 GB of photos. Split the album.');

const outDir = path.join(PHOTOS, slug);
if (fs.existsSync(outDir)) {
  if (!a.replace) die(`Album "${slug}" already exists. Use --replace to overwrite it.`);
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(outDir, 'thumbs'), { recursive: true });

console.log(`→ ${files.length} photos from ${src}\n→ album: photos/${slug}/`);
const photos = [];
let inBytes = 0, i = 0;
for (const file of files) {
  i++;
  const name = String(photos.length + 1).padStart(3, '0') + '.jpg';
  inBytes += file.size;
  let input;
  try { input = file.read(); } catch (e) { console.warn(`  ! skipped ${file.name}: ${e.message}`); continue; }
  try {
    const big = await sharp(input).rotate()
      .resize({ width: BIG, height: BIG, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toFile(path.join(outDir, name));
    await sharp(input).rotate()
      .resize({ width: THUMB, height: THUMB * 2, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70, mozjpeg: true })
      .toFile(path.join(outDir, 'thumbs', name));
    photos.push({ f: name, w: big.width, h: big.height });
  } catch (e) {
    console.warn(`  ! skipped ${file.name}: ${e.message}`);
    continue;
  }
  if (i % 10 === 0 || i === files.length) process.stdout.write(`\r  ${i}/${files.length}`);
}
process.stdout.write('\n');
if (!photos.length) die('No photo could be processed.');

const coverIdx = Math.min(photos.length, Math.max(1, Number(a.cover) || 1)) - 1;
const album = {
  slug, title: String(a.title), date: a.date, series,
  by: a.by ? String(a.by) : null,
  originals: a.originals || null,
  cover: photos[coverIdx].f,
  photos
};
fs.writeFileSync(path.join(outDir, 'album.json'), JSON.stringify(album, null, 1));

// Update the list of albums the website reads
const listFile = path.join(PHOTOS, 'albums.json');
let list = [];
try { list = JSON.parse(fs.readFileSync(listFile, 'utf8')); } catch { list = []; }
list = list.filter((x) => x.slug !== slug);
const c = photos[coverIdx];
list.push({ slug, title: album.title, date: album.date, series, by: album.by, count: photos.length, cover: { f: c.f, w: c.w, h: c.h } });
list.sort((x, y) => y.date.localeCompare(x.date));
fs.writeFileSync(listFile, JSON.stringify(list, null, 1));

const outBytes = folderSize(outDir), total = folderSize(PHOTOS);
console.log(`✓ ${photos.length} photos · ${mb(inBytes)} → ${mb(outBytes)} on the web`);
console.log(`  All photo reports together: ${mb(total)}`);
if (total > 800 * 1024 * 1024) console.log('  ⚠ Close to the ~1 GB GitHub Pages limit. Time to move photos elsewhere (see README).');
console.log(`  Commit + push, then open: gallery.html?a=${slug}`);
