// Ink Wise Paramedical Tattoo Directory — static site builder.
// Reads approved artists from a published Google Sheet (CSV) and writes a
// static site to ./dist. No npm dependencies (Node 18+).
//
// Env:
//   SHEET_CSV_URL  published-to-web CSV of the "Directory" tab
//   SITE_URL       e.g. https://directory.shopinkwise.com
//   ZCTA_FILE      path to Census ZCTA gazetteer .txt (optional; enables ZIP search)
//   LOCAL_CSV      path to a local CSV instead of SHEET_CSV_URL (testing)

import fs from 'node:fs';
import path from 'node:path';

const SITE_URL = (process.env.SITE_URL || 'https://directory.shopinkwise.com').replace(/\/$/, '');
const SHOP = 'https://www.shopinkwise.com';
const SIGNUP = SHOP + '/get-listed';
const LOGO = 'https://images.squarespace-cdn.com/content/v1/6ad56318c1f8a072da8f78e1/79808d89-d840-43c1-bf9b-91e8abecfc7f/ink-wise-logo-header.png?format=500w';
const OUT = path.resolve('dist');

// ---------- CSV ----------
function parseCSV(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// Map sheet headers to fields by keyword, so column order/labels can change.
const FIELDS = {
  approved: ['approved', 'approve', 'show'],
  first: ['first name', 'first'],
  last: ['last name', 'last'],
  name: ['your name', 'artist name', 'full name', 'name'],
  business: ['business', 'studio'],
  city: ['city'],
  state: ['state', 'province', 'region'],
  zip: ['zip', 'postal'],
  country: ['country'],
  services: ['services', 'service', 'specialt'],
  instagram: ['instagram'],
  website: ['website', 'web site'],
  booking: ['booking', 'book'],
  phone: ['public phone', 'phone'],
  photo: ['photo', 'image', 'picture', 'logo'],
  about: ['about', 'bio', 'description'],
  slug: ['slug'],
};
function mapHeaders(headers) {
  const h = headers.map(x => x.toLowerCase().trim());
  const idx = {};
  for (const [key, words] of Object.entries(FIELDS)) {
    for (const w of words) {
      const i = h.findIndex((x, j) => x.includes(w) && !Object.values(idx).includes(j) && !(key === 'name' && /business|studio|first|last/.test(x)));
      if (i >= 0) { idx[key] = i; break; }
    }
  }
  return idx;
}

// ---------- helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const US_STATES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico' };
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([k, v]) => [v.toLowerCase(), k]));
function normCountry(c) {
  const x = String(c || '').trim();
  if (!x || /^(us|usa|u\.s\.a?\.?|united states( of america)?|america)$/i.test(x)) return 'United States';
  if (/^(ca|can|canada)$/i.test(x)) return 'Canada';
  if (/^(uk|u\.k\.|gb|great britain|england|united kingdom)$/i.test(x)) return 'United Kingdom';
  if (/^(au|aus|australia)$/i.test(x)) return 'Australia';
  if (/^(mx|mex|mexico|méxico)$/i.test(x)) return 'Mexico';
  return x.replace(/\b\w/g, m => m.toUpperCase());
}
function normState(s, country) {
  const x = String(s || '').trim();
  if (country !== 'United States') return x;
  const up = x.toUpperCase().replace(/\./g, '');
  if (US_STATES[up]) return up;
  return STATE_BY_NAME[x.toLowerCase()] || x;
}
function normUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.href : ''; } catch { return ''; }
}
function normInstagram(v) {
  v = String(v || '').trim();
  if (!v) return null;
  const m = v.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = (m ? m[1] : v.replace(/^@/, '')).replace(/[^A-Za-z0-9._]/g, '');
  return handle ? { handle, url: 'https://www.instagram.com/' + handle + '/' } : null;
}
// Google Drive share links -> direct image links
function normPhoto(u) {
  u = normUrl(u);
  const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  if (m) return 'https://lh3.googleusercontent.com/d/' + m[1] + '=w800';
  return u;
}

const SERVICE_DEFS = [
  { key: 'scar', label: 'Scars', match: /scar/i },
  { key: 'stretch', label: 'Stretch Marks', match: /stretch/i },
  { key: 'areola', label: 'Areola', match: /areola|nipple|mastectomy/i },
  { key: 'inkless', label: 'Inkless', match: /inkless/i },
  { key: 'vitiligo', label: 'Vitiligo', match: /vitiligo|skin tone|hypopig/i },
];
const ICONS = {
  scar: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 30 C16 22, 32 22, 40 16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M14 22l3 7M21 19l2 7M28 17l1 7M35 14l0 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  stretch: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 14c6 2 10 8 10 20M20 10c6 3 9 10 9 26M31 12c5 3 7 9 7 20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  areola: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="24" cy="24" r="5" fill="currentColor"/></svg>',
  inkless: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8c6 9 11 15 11 21a11 11 0 0 1-22 0c0-6 5-12 11-21z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M19 30a5 5 0 0 0 5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  vitiligo: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" stroke-width="3"/><path d="M17 20c3-3 8-2 9 2s-3 6-7 5-4-5-2-7z" fill="currentColor"/><circle cx="30" cy="29" r="3.5" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.6" fill="currentColor"/></svg>',
  ig: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>',
  web: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

// ---------- ZIP centroids ----------
function loadZcta(file) {
  const zip5 = new Map();
  if (!file || !fs.existsSync(file)) return zip5;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const head = lines[0].split('\t').map(s => s.trim().toUpperCase());
  const iz = head.indexOf('GEOID'), ila = head.indexOf('INTPTLAT'), ilo = head.indexOf('INTPTLONG');
  for (const l of lines.slice(1)) {
    const p = l.split('\t'); if (p.length < 3) continue;
    const z = p[iz].trim(), la = parseFloat(p[ila]), lo = parseFloat(p[ilo]);
    if (/^\d{5}$/.test(z) && isFinite(la) && isFinite(lo)) zip5.set(z, [la, lo]);
  }
  return zip5;
}

// ---------- page chrome ----------
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400;600&family=Josefin+Sans:wght@400;600&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet">';
function page({ title, desc, canonical, body, jsonld = [], extraHead = '', ogImage = '' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<link rel="icon" href="${SITE_URL}/favicon.svg" type="image/svg+xml">${FONTS}<link rel="stylesheet" href="${SITE_URL}/style.css">
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('')}${extraHead}</head><body>
<header class="top"><a class="logo" href="${SHOP}" aria-label="Ink Wise shop"><img src="${LOGO}" alt="Ink Wise" width="120" height="68"></a>
<nav><a href="${SITE_URL}/">Directory</a><a href="${SHOP}/shop">Shop Inks</a><a class="btn-sm" href="${SIGNUP}">Get Listed</a></nav></header>
<main>${body}</main>
<footer class="foot"><div class="rule"><span>INK WISE</span></div>
<p class="tag">Know more. Mix better.</p>
<p class="small">Every artist here is an Ink Wise customer. Listings are not an endorsement or a certification. Artists are responsible for their own licensing and work. <a href="${SHOP}/contact">Report a listing</a></p>
<p class="small"><a href="${SHOP}">shopinkwise.com</a> · <a href="${SIGNUP}">Get listed</a></p></footer>
</body></html>`;
}

function serviceIcons(a, big = false) {
  return `<ul class="svc${big ? ' big' : ''}">${a.services.map(k => { const d = SERVICE_DEFS.find(s => s.key === k); return `<li title="${d.label}"><span class="ic">${ICONS[k]}</span><span>${d.label}</span></li>`; }).join('')}</ul>`;
}
function avatar(a, cls = 'av') {
  if (a.photo) return `<img class="${cls}" src="${esc(a.photo)}" alt="${esc(a.name)} paramedical tattoo work" loading="lazy" referrerpolicy="no-referrer">`;
  const ini = a.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `<div class="${cls} mono" aria-hidden="true"><span>${esc(ini)}</span></div>`;
}
const placeLine = a => [a.city, a.country === 'United States' ? a.state : [a.state, a.country].filter(Boolean).join(', ')].filter(Boolean).join(', ');

// ---------- build ----------
async function main() {
  let csv;
  if (process.env.LOCAL_CSV) csv = fs.readFileSync(process.env.LOCAL_CSV, 'utf8');
  else {
    const url = process.env.SHEET_CSV_URL;
    if (!url) { console.warn('SHEET_CSV_URL not set yet: building an empty directory.'); csv = 'Your Name,Approved\n'; }
    else {
      const r = await fetch(url, { redirect: 'follow' });
      if (!r.ok) throw new Error('Sheet fetch failed: ' + r.status);
      csv = await r.text();
    }
  }
  const rows = parseCSV(csv.replace(/^\uFEFF/, ''));
  const idx = mapHeaders(rows[0]);
  if (idx.name === undefined && idx.first === undefined) throw new Error('No name column found. Headers: ' + rows[0].join(' | '));
  const get = (r, k) => (idx[k] === undefined ? '' : (r[idx[k]] || '').trim());
  const zip5 = loadZcta(process.env.ZCTA_FILE);

  const used = new Set();
  const artists = [];
  for (const r of rows.slice(1)) {
    if (idx.approved !== undefined && !/^(y|yes|true|x|✓|approved|1)$/i.test(get(r, 'approved'))) continue;
    const name = (get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim(); if (!name) continue;
    const country = normCountry(get(r, 'country'));
    const state = normState(get(r, 'state'), country);
    const rawCity = get(r, 'city');
    const city = rawCity === rawCity.toLowerCase() || rawCity === rawCity.toUpperCase() ? rawCity.toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, b) => a + b.toUpperCase()) : rawCity;
    const zip = get(r, 'zip').toUpperCase();
    const svcText = get(r, 'services');
    const services = SERVICE_DEFS.filter(s => s.match.test(svcText)).map(s => s.key);
    let slug = slugify(get(r, 'slug') || [name, city, state].filter(Boolean).join(' '));
    let s2 = slug, n = 2; while (used.has(s2)) s2 = slug + '-' + n++; slug = s2; used.add(slug);
    const z5 = zip.match(/^\d{5}/)?.[0];
    const ll = country === 'United States' && z5 ? zip5.get(z5) || null : null;
    artists.push({
      name, business: get(r, 'business'), city, state, zip: z5 || '', country,
      stateName: country === 'United States' ? (US_STATES[state] || state) : state,
      services, instagram: normInstagram(get(r, 'instagram')), website: normUrl(get(r, 'website')),
      booking: normUrl(get(r, 'booking')), phone: get(r, 'phone'), photo: normPhoto(get(r, 'photo')),
      about: get(r, 'about').slice(0, 600), slug, ll,
    });
  }
  const ck = a => (a.country === 'United States' ? '0' : '1' + a.country) + '|' + a.stateName + '|' + a.city + '|' + a.name;
  artists.sort((a, b) => ck(a).localeCompare(ck(b)));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync('static/style.css', path.join(OUT, 'style.css'));
  fs.copyFileSync('static/app.js', path.join(OUT, 'app.js'));
  fs.copyFileSync('static/favicon.svg', path.join(OUT, 'favicon.svg'));
  const host = new URL(SITE_URL).hostname;
  if (!host.endsWith('github.io')) fs.writeFileSync(path.join(OUT, 'CNAME'), host + '\n');
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

  // ZIP3 centroid table for client-side "near me" (small: ~900 entries)
  const z3 = {};
  for (const [z, [la, lo]] of zip5) { const k = z.slice(0, 3); (z3[k] ||= [0, 0, 0]); z3[k][0] += la; z3[k][1] += lo; z3[k][2]++; }
  const zip3 = Object.fromEntries(Object.entries(z3).map(([k, [a, b, c]]) => [k, [+(a / c).toFixed(3), +(b / c).toFixed(3)]]));
  fs.writeFileSync(path.join(OUT, 'zip3.json'), JSON.stringify(zip3));

  const pub = artists.map(a => ({ n: a.name, b: a.business, c: a.city, s: a.state, sn: a.stateName, co: a.country, sv: a.services, p: a.photo, u: '/artists/' + a.slug + '/', ll: a.ll }));
  fs.writeFileSync(path.join(OUT, 'artists.json'), JSON.stringify(pub));

  const urls = [SITE_URL + '/'];
  const card = a => `<li class="card" data-co="${esc(a.country)}" data-s="${esc(a.stateName)}" data-sv="${a.services.join(' ')}" ${a.ll ? `data-ll="${a.ll.join(',')}"` : ''}>
<a href="/artists/${a.slug}/">${avatar(a)}<div class="ci"><h3>${esc(a.name)}</h3>${a.business ? `<p class="biz">${esc(a.business)}</p>` : ''}<p class="loc"><span class="ic sm">${ICONS.pin}</span>${esc(placeLine(a))}<span class="dist"></span></p>${serviceIcons(a)}</div></a></li>`;

  // Regions (US states + countries)
  const regions = new Map();
  for (const a of artists) {
    const label = a.country === 'United States' ? a.stateName : a.country;
    const slug = slugify(label);
    if (!regions.has(slug)) regions.set(slug, { label, list: [] });
    regions.get(slug).list.push(a);
  }
  const regionOpts = [...regions.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));

  const searchBox = (preset = '') => `<form class="search" id="search" onsubmit="return false">
<label class="field zipf"><span class="ic">${ICONS.pin}</span><input id="zip" inputmode="numeric" maxlength="5" placeholder="ZIP code" aria-label="ZIP code"></label>
<button type="button" id="near" class="btn">Find near me</button>
<button type="button" id="geo" class="btn ghost" title="Use my location"><span class="ic">${ICONS.locate}</span><span class="hide-sm">My location</span></button>
<select id="region" aria-label="State or country"><option value="/">All locations</option>${regionOpts.map(([s, r]) => `<option value="/${s}/"${r.label === preset ? ' selected' : ''}>${esc(r.label)} (${r.list.length})</option>`).join('')}</select>
</form>
<div class="chips" id="chips">${SERVICE_DEFS.filter(s => artists.some(a => a.services.includes(s.key))).map(s => `<button type="button" class="chip" data-k="${s.key}"><span class="ic">${ICONS[s.key]}</span>${s.label}</button>`).join('')}</div>
<p class="status" id="status" aria-live="polite"></p>`;

  // Index
  const total = artists.length;
  const indexBody = `<section class="hero"><p class="eyebrow">INK WISE DIRECTORY</p><h1>Find a Paramedical<br>Tattoo Artist</h1><p class="sub">Scars · Stretch Marks · Areola</p>${searchBox()}</section>
<section class="wrap"><ul class="grid" id="grid">${artists.map(card).join('\n')}</ul>${total ? '' : '<p class="empty">New artists are being added. Check back soon.</p>'}</section>
<section class="cta"><div><h2>Are you an artist?</h2><p>Ink Wise customers get listed free.</p></div><a class="btn" href="${SIGNUP}">Get Listed</a></section>
<script src="/app.js" defer></script>`;
  fs.writeFileSync(path.join(OUT, 'index.html'), page({
    title: 'Paramedical Tattoo Artist Directory | Find Scar & Stretch Mark Camouflage Near You',
    desc: `Find a paramedical tattoo artist near you for scar camouflage, stretch mark camouflage and areola restoration. ${total} artist${total === 1 ? '' : 's'} listed. Search by ZIP code or state.`,
    canonical: SITE_URL + '/', body: indexBody,
    jsonld: [{ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Paramedical Tattoo Artist Directory', itemListElement: artists.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_URL}/artists/${a.slug}/`, name: a.name })) }],
  }));

  // Region pages
  for (const [slug, r] of regions) {
    const isUS = r.list[0].country === 'United States';
    const cities = [...new Set(r.list.map(a => a.city).filter(Boolean))];
    const body = `<section class="hero small"><p class="eyebrow"><a href="/">DIRECTORY</a> / ${esc(r.label.toUpperCase())}</p><h1>Paramedical Tattoo Artists<br>in ${esc(r.label)}</h1><p class="sub">${r.list.length} artist${r.list.length === 1 ? '' : 's'}${cities.length ? ' · ' + esc(cities.slice(0, 6).join(' · ')) : ''}</p>${searchBox(r.label)}</section>
<section class="wrap"><ul class="grid" id="grid" data-region="1">${r.list.map(card).join('\n')}</ul></section>
<section class="cta"><div><h2>Are you an artist in ${esc(r.label)}?</h2><p>Ink Wise customers get listed free.</p></div><a class="btn" href="${SIGNUP}">Get Listed</a></section>
<script src="/app.js" defer></script>`;
    fs.mkdirSync(path.join(OUT, slug), { recursive: true });
    fs.writeFileSync(path.join(OUT, slug, 'index.html'), page({
      title: `Paramedical Tattoo Artists in ${r.label} | Scar & Stretch Mark Camouflage`,
      desc: `Paramedical tattoo artists in ${r.label}${cities.length ? ' (' + cities.slice(0, 4).join(', ') + ')' : ''} for scar camouflage, stretch mark camouflage and areola tattooing. Ink Wise directory.`,
      canonical: `${SITE_URL}/${slug}/`, body,
    }));
    urls.push(`${SITE_URL}/${slug}/`);
    r.slug = slug; r.isUS = isUS;
  }

  // Artist pages
  for (const a of artists) {
    const region = regions.get(slugify(a.country === 'United States' ? a.stateName : a.country));
    const svcNames = a.services.map(k => SERVICE_DEFS.find(s => s.key === k).label);
    const svcPhrase = svcNames.length ? svcNames.join(', ').replace(/, ([^,]*)$/, ' and $1').toLowerCase() : 'paramedical tattooing';
    const where = placeLine(a);
    const links = [
      a.booking && `<a class="btn" href="${esc(a.booking)}" rel="nofollow noopener" target="_blank"><span class="ic">${ICONS.cal}</span>Book</a>`,
      a.instagram && `<a class="btn ghost" href="${esc(a.instagram.url)}" rel="nofollow noopener" target="_blank"><span class="ic">${ICONS.ig}</span>@${esc(a.instagram.handle)}</a>`,
      a.website && `<a class="btn ghost" href="${esc(a.website)}" rel="noopener" target="_blank"><span class="ic">${ICONS.web}</span>Website</a>`,
      a.phone && `<a class="btn ghost" href="tel:${esc(a.phone.replace(/[^\d+]/g, ''))}"><span class="ic">${ICONS.phone}</span>${esc(a.phone)}</a>`,
    ].filter(Boolean).join('');
    const mapQ = encodeURIComponent([a.city, a.state, a.zip, a.country].filter(Boolean).join(' '));
    const body = `<section class="artist">
<p class="eyebrow"><a href="/">DIRECTORY</a>${region ? ` / <a href="/${region.slug}/">${esc(region.label.toUpperCase())}</a>` : ''}</p>
<div class="ahead">${avatar(a, 'av big')}<div><h1>${esc(a.name)}</h1>${a.business ? `<p class="biz">${esc(a.business)}</p>` : ''}<p class="loc"><span class="ic sm">${ICONS.pin}</span>${esc(where)}</p><p class="badge">Ink Wise Artist</p></div></div>
${a.services.length ? `<h2 class="h2">Services</h2>${serviceIcons(a, true)}` : ''}
${a.about ? `<p class="about">${esc(a.about)}</p>` : ''}
${links ? `<div class="links">${links}</div>` : ''}
${where ? `<div class="map"><iframe title="Map of ${esc(where)}" loading="lazy" src="https://maps.google.com/maps?q=${mapQ}&z=10&output=embed"></iframe></div>` : ''}
<p class="back"><a href="${region ? '/' + region.slug + '/' : '/'}">← More artists${region ? ' in ' + esc(region.label) : ''}</a></p>
</section>`;
    const title = `${a.name}${a.business && a.business !== a.name ? ' – ' + a.business : ''} | Paramedical Tattoo${a.city ? ' in ' + a.city + (a.state ? ', ' + a.state : '') : ''}`;
    const desc = `${a.name}${a.business ? ' of ' + a.business : ''} offers ${svcPhrase} camouflage tattooing${where ? ' in ' + where : ''}. ${a.about ? a.about.slice(0, 80) : 'Ink Wise directory listing.'}`.slice(0, 160);
    const ld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: a.business || a.name, url: `${SITE_URL}/artists/${a.slug}/`,
      address: { '@type': 'PostalAddress', addressLocality: a.city || undefined, addressRegion: a.state || undefined, postalCode: a.zip || undefined, addressCountry: a.country },
      ...(a.photo ? { image: a.photo } : {}), ...(a.phone ? { telephone: a.phone } : {}),
      ...(a.about ? { description: a.about } : {}),
      sameAs: [a.instagram?.url, a.website].filter(Boolean),
      ...(a.ll ? { geo: { '@type': 'GeoCoordinates', latitude: a.ll[0], longitude: a.ll[1] } } : {}),
      ...(svcNames.length ? { knowsAbout: svcNames.map(s => s + ' camouflage tattoo') } : {}),
      ...(a.business ? { employee: { '@type': 'Person', name: a.name } } : {}) };
    const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Directory', item: SITE_URL + '/' },
      ...(region ? [{ '@type': 'ListItem', position: 2, name: region.label, item: `${SITE_URL}/${region.slug}/` }] : []),
      { '@type': 'ListItem', position: region ? 3 : 2, name: a.name, item: `${SITE_URL}/artists/${a.slug}/` }] };
    fs.mkdirSync(path.join(OUT, 'artists', a.slug), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'artists', a.slug, 'index.html'), page({ title, desc, canonical: `${SITE_URL}/artists/${a.slug}/`, body, jsonld: [ld, crumbs], ogImage: a.photo }));
    urls.push(`${SITE_URL}/artists/${a.slug}/`);
  }

  // 404, sitemap, robots
  fs.writeFileSync(path.join(OUT, '404.html'), page({ title: 'Page not found | Ink Wise Directory', desc: 'This listing is no longer available.', canonical: SITE_URL + '/',
    body: `<section class="hero small"><h1>Listing not found</h1><p class="sub">It may have moved or been removed.</p><p><a class="btn" href="/">Search the directory</a></p></section>` }));
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  console.log(`Built ${artists.length} artists, ${regions.size} regions, ${zip5.size} ZIPs -> ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
