// Orchestration de GeoPierre : état, calculs de correspondance, rendu des deux panneaux.
import {
  analyzeCountry, destination, distanceKm, bearingDeg, profileAt, isoContour, transferShape,
  compassName, unwrapLon,
} from './geo.js';
import { CityIndex } from './cities.js';
import { MapPanel } from './panel.js';

const ACCENT = { a: '#d9480f', b: '#1864ab' };
const fmtKm = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fmtPct = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

const $ = (sel) => document.querySelector(sel);

const state = {
  a: 'FRA', b: 'CHN',
  mode: 'prop',          // 'prop' | 'abs'
  ghost: true,
  driver: 'a',           // côté qui pilote (dernier manipulé)
  bearing: 158,          // cap depuis le centre du côté pilote
  fraction: 0.85,        // fraction du rayon-frontière, côté pilote
};
const other = (side) => (side === 'a' ? 'b' : 'a');

let countries, cities, panels;
const analyses = {};       // id -> analyse mise en cache
const sides = { a: null, b: null }; // analyse courante par côté

// --- Chargement ---------------------------------------------------------------
async function load() {
  const [fc, rows] = await Promise.all([
    fetch('data/countries.json').then((r) => r.json()),
    fetch('data/cities.json').then((r) => r.json()),
  ]);
  countries = new Map(fc.features.map((f) => [f.properties.id, f]));
  cities = new CityIndex(rows);
}

function analysis(id) {
  if (!analyses[id]) analyses[id] = analyzeCountry(countries.get(id).geometry);
  return analyses[id];
}

// --- État <-> URL ---------------------------------------------------------------
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('a') && countries.has(h.get('a'))) state.a = h.get('a');
  if (h.get('b') && countries.has(h.get('b'))) state.b = h.get('b');
  if (h.get('m') === 'abs' || h.get('m') === 'prop') state.mode = h.get('m');
  if (h.has('g')) state.ghost = h.get('g') === '1';
  if (h.get('drv') === 'a' || h.get('drv') === 'b') state.driver = h.get('drv');
  if (h.has('brg')) state.bearing = +h.get('brg') || 0;
  if (h.has('f')) state.fraction = Math.max(0, +h.get('f') || 0);
}
let hashTimer;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = new URLSearchParams({
      a: state.a, b: state.b, m: state.mode, g: state.ghost ? '1' : '0', drv: state.driver,
      brg: state.bearing.toFixed(1), f: state.fraction.toFixed(3),
    });
    history.replaceState(null, '', `#${h}`);
  }, 150);
}

// --- Calcul de la correspondance ------------------------------------------------
/** Pour chaque côté : distance, fraction, cible et villes. */
function compute() {
  const d = state.driver, o = other(d);
  const A = sides[d], B = sides[o];
  const θ = state.bearing;
  const rA = profileAt(A.profile, θ), rB = profileAt(B.profile, θ);
  const kmA = state.fraction * rA;
  const kmB = state.mode === 'abs' ? kmA : state.fraction * rB;
  const out = {};
  out[d] = { km: kmA, fraction: state.fraction, radius: rA };
  out[o] = { km: kmB, fraction: rB > 0 ? kmB / rB : 0, radius: rB };
  for (const s of ['a', 'b']) {
    const an = sides[s];
    const r = out[s];
    r.bearing = θ;
    r.target = destination(an.center, r.km, θ);
    r.target[0] = unwrapLon(r.target[0], an.center[0]);
    r.city = cities.nearest(r.target);
    r.centerCity = cities.nearest(an.center, { country: state[s] }) || cities.nearest(an.center);
    r.name = countries.get(state[s]).properties.name;
  }
  return out;
}

// --- Rendu -------------------------------------------------------------------------
function render({ trail = false } = {}) {
  const res = compute();
  for (const s of ['a', 'b']) {
    const p = panels[s], an = sides[s], r = res[s];
    p.setTarget(r.target);
    p.setContour(state.mode === 'abs'
      ? isoContour(an.center, an.profile, { km: r.km })
      : isoContour(an.center, an.profile, { fraction: r.fraction }));
    if (trail) p.pushTrail(r.target);
    renderReadout(s, r);
  }
  renderSentence(res);
  writeHash();
}

function renderGhosts() {
  for (const s of ['a', 'b']) {
    const o = other(s);
    if (!state.ghost) { panels[s].setGhost(null); continue; }
    const src = sides[o], dst = sides[s];
    const profiles = state.mode === 'prop' ? { source: src.profile, target: dst.profile } : undefined;
    panels[s].setGhost(transferShape(src.main, src.center, dst.center, profiles), ACCENT[o], { soft: state.mode === 'prop' });
  }
}

function cityLabel(c) {
  if (!c) return '—';
  return c.distanceKm < 25 ? c.name : `${c.name} (à ${fmtKm.format(c.distanceKm)} km)`;
}

function renderReadout(side, r) {
  const root = $(`#panel-${side}`);
  root.querySelector('.ro-km').textContent = `${fmtKm.format(r.km)} km`;
  root.querySelector('.ro-frac').textContent = `${fmtPct.format(r.fraction * 100)} %`;
  root.querySelector('.ro-frac-wrap').title = `Distance centre → frontière dans ce cap : ${fmtKm.format(r.radius)} km`;
  root.querySelector('.ro-bearing').textContent = `${Math.round(r.bearing)}° ${compassName(r.bearing, true)}`;
  root.querySelector('.ro-city').textContent = cityLabel(r.city);
  root.querySelector('.ro-center').textContent = r.centerCity ? `près de ${r.centerCity.name}` : '';
  const isDriver = state.driver === side;
  root.classList.toggle('is-driver', isDriver);
  const lockKm = state.mode === 'abs', lockFrac = state.mode === 'prop';
  root.querySelector('.ro-km-wrap').classList.toggle('is-locked', !isDriver && lockKm);
  root.querySelector('.ro-frac-wrap').classList.toggle('is-locked', !isDriver && lockFrac);
}

function renderSentence(res) {
  const d = state.driver, o = other(d);
  const A = res[d], B = res[o];
  const dir = compassName(state.bearing);
  const versDir = /^[eo]/.test(dir) ? `vers l’${dir}` : `vers le ${dir}`;
  const toA = A.city ? `jusqu’à ${A.city.name}` : 'jusqu’à la cible';
  const toB = B.city ? `jusqu’à ${B.city.name}` : 'jusqu’à la cible';
  const start = state.mode === 'abs'
    ? `<b>${fmtKm.format(A.km)} km</b> ${versDir} depuis le centre <b>${withArticle(A.name, 'de')}</b>, ${toA}. `
      + `La même distance <b>${withArticle(B.name, 'en')}</b> mène ${toB}, soit <b>${fmtPct.format(B.fraction * 100)} %</b> du chemin vers sa frontière contre <b>${fmtPct.format(A.fraction * 100)} %</b>.`
    : `Parcourir <b>${fmtPct.format(A.fraction * 100)} %</b> du chemin vers la frontière, ${versDir}, c’est <b>${fmtKm.format(A.km)} km</b> <b>${withArticle(A.name, 'en')}</b> (${toA}) `
      + `et <b>${fmtKm.format(B.km)} km</b> <b>${withArticle(B.name, 'en')}</b> (${toB}).`;
  $('#sentence').innerHTML = start;
}

/**
 * Article défini : « la France », « le Chili », « les États-Unis ».
 * form = 'en' : « en France » / « au Chili » / « aux États-Unis ».
 * form = 'de' : « de la France » / « du Chili » / « des États-Unis » / « de l’Italie ».
 */
function withArticle(name, form = false) {
  const plural = /^(États|Émirats|Pays|Îles|Philippines|Maldives|Seychelles|Comores|Bahamas|Fidji|Kiribati|Tuvalu|Samoa|Palaos|Antilles|Bermudes|Caïmans|Tonga)/i.test(name) && /s$/.test(name);
  const vowel = /^[aeiouyéèêàâîïôûùÉÈÊÀÂÎÏÔÛÙ]/i.test(name);
  const masc = /^(Chili|Brésil|Canada|Japon|Mexique|Pérou|Maroc|Portugal|Danemark|Royaume|Viêt|Vietnam|Kenya|Nigéria|Nigeria|Sénégal|Mali|Niger|Tchad|Soudan|Congo|Gabon|Cameroun|Bénin|Togo|Ghana|Liban|Yémen|Qatar|Koweït|Bahreïn|Pakistan|Bangladesh|Népal|Bhoutan|Sri|Laos|Cambodge|Myanmar|Kazakhstan|Ouzbékistan|Turkménistan|Kirghizistan|Tadjikistan|Luxembourg|Liechtenstein|Monténégro|Kosovo|Belize|Guatemala|Honduras|Salvador|Nicaragua|Costa|Panama|Venezuela|Paraguay|Uruguay|Suriname|Guyana|Groenland|Zimbabwe|Botswana|Mozambique|Malawi|Burundi|Rwanda|Lesotho|Swaziland|Eswatini|Burkina|Libéria|Sierra|Cap|Timor|Brunei|Vanuatu|Soudan|Monaco|Vatican|Saint|Zaïre|Zambie|Chypre|Royaume-Uni|Tibet|Québec|Texas|Iran|Irak|Israël|Oman|Afghanistan|Turkménistan|Taïwan|Angola|Égypte|Équateur|Haïti|Ouganda|Uruguay|Zimbabwe)/i.test(name);
  // Les noms féminins sont la règle par défaut en français pour les pays finissant en -e.
  const fem = !plural && !masc && /e$/i.test(name) && !/^(Mexique|Mozambique|Zimbabwe|Belize|Cambodge|Zaïre|Suriname|Monténégro)/i.test(name);
  if (form === 'en' || form === true) {
    if (plural) return `aux ${name}`;
    if (fem || vowel) return `en ${name}`;
    return `au ${name}`;
  }
  if (form === 'de') {
    if (plural) return `des ${name}`;
    if (vowel) return `de l’${name}`;
    return fem ? `de la ${name}` : `du ${name}`;
  }
  if (plural) return `les ${name}`;
  if (vowel) return `l’${name}`;
  return `${fem ? 'la' : 'le'} ${name}`;
}

// --- Interactions ---------------------------------------------------------------------
function setFromPoint(side, lonlat) {
  stopSweep();
  const an = sides[side];
  const km = distanceKm(an.center, lonlat);
  const θ = bearingDeg(an.center, lonlat);
  state.driver = side;
  state.bearing = θ;
  state.fraction = km / Math.max(1e-6, profileAt(an.profile, θ));
  for (const s of ['a', 'b']) panels[s].clearTrail();
  render();
}

function setCountry(side, id) {
  if (!countries.has(id)) return;
  stopSweep();
  state[side] = id;
  sides[side] = analysis(id);
  panels[side].setCountry(sides[side]);
  panels[side].clearTrail();
  $(`#select-${side}`).value = id;
  $(`#panel-${side} .panel-title`).textContent = countries.get(id).properties.name;
  renderGhosts();
  render();
}

function swapSides() {
  stopSweep();
  [state.a, state.b] = [state.b, state.a];
  state.driver = other(state.driver);
  for (const s of ['a', 'b']) {
    sides[s] = analysis(state[s]);
    panels[s].setCountry(sides[s]);
    panels[s].clearTrail();
    $(`#select-${s}`).value = state[s];
    $(`#panel-${s} .panel-title`).textContent = countries.get(state[s]).properties.name;
  }
  renderGhosts();
  render();
}

function setMode(mode) {
  stopSweep();
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  $('#mode-hint').textContent = mode === 'abs'
    ? 'Même distance, même cap sur les deux cartes.'
    : 'Même fraction du chemin centre → frontière, dans le même cap : la règle épouse la forme de chaque pays.';
  for (const s of ['a', 'b']) panels[s].clearTrail();
  renderGhosts();
  render();
}

function setGhost(on) {
  state.ghost = on;
  const b = $('#btn-ghost');
  b.classList.toggle('is-active', on);
  b.setAttribute('aria-pressed', String(on));
  renderGhosts();
  writeHash();
}

// Balayage : la cible fait un tour complet à fraction constante, laissant une trace.
let sweep = null;
function startSweep() {
  if (sweep) return stopSweep();
  const start = performance.now(), from = state.bearing, duration = 9000;
  for (const s of ['a', 'b']) panels[s].clearTrail();
  $('#btn-sweep').classList.add('is-active');
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    state.bearing = (from + 360 * t) % 360;
    render({ trail: true });
    if (t < 1) sweep = requestAnimationFrame(step);
    else { sweep = null; $('#btn-sweep').classList.remove('is-active'); }
  };
  sweep = requestAnimationFrame(step);
}
function stopSweep() {
  if (!sweep) return;
  cancelAnimationFrame(sweep);
  sweep = null;
  $('#btn-sweep').classList.remove('is-active');
}

function onKey(e) {
  if (e.target.matches('select, input, textarea')) return;
  const map = { ArrowLeft: () => { state.bearing = (state.bearing - 1 + 360) % 360; },
    ArrowRight: () => { state.bearing = (state.bearing + 1) % 360; },
    ArrowUp: () => { state.fraction = Math.min(3, state.fraction * 1.02); },
    ArrowDown: () => { state.fraction = Math.max(0.01, state.fraction / 1.02); } };
  if (map[e.key]) { e.preventDefault(); stopSweep(); map[e.key](); render(); }
  else if (e.key === 'm') setMode(state.mode === 'abs' ? 'prop' : 'abs');
  else if (e.key === 'f') setGhost(!state.ghost);
  else if (e.key === 's') startSweep();
  else if (e.key === 'x') swapSides();
}

// --- Démarrage ---------------------------------------------------------------------------
function fillSelects() {
  const byContinent = new Map();
  for (const f of countries.values()) {
    const c = f.properties.continent || 'Autres';
    if (!byContinent.has(c)) byContinent.set(c, []);
    byContinent.get(c).push(f);
  }
  const order = ['Europe', 'Asia', 'Africa', 'North America', 'South America', 'Oceania', 'Seven seas (open ocean)', 'Autres'];
  const labels = { Europe: 'Europe', Asia: 'Asie', Africa: 'Afrique', 'North America': 'Amérique du Nord', 'South America': 'Amérique du Sud', Oceania: 'Océanie', 'Seven seas (open ocean)': 'Îles et océans', Autres: 'Autres' };
  for (const side of ['a', 'b']) {
    const sel = $(`#select-${side}`);
    sel.innerHTML = '';
    for (const c of [...byContinent.keys()].sort((x, y) => order.indexOf(x) - order.indexOf(y))) {
      const og = document.createElement('optgroup');
      og.label = labels[c] || c;
      for (const f of byContinent.get(c)) {
        const o = document.createElement('option');
        o.value = f.properties.id; o.textContent = f.properties.name;
        og.appendChild(o);
      }
      sel.appendChild(og);
    }
    sel.addEventListener('change', () => setCountry(side, sel.value));
  }
}

async function main() {
  await load();
  readHash();
  const world = [...countries.values()];
  panels = {
    a: new MapPanel($('#map-a'), { accent: ACCENT.a, world, cities, onDrag: (p) => setFromPoint('a', p), onClick: (p) => setFromPoint('a', p) }),
    b: new MapPanel($('#map-b'), { accent: ACCENT.b, world, cities, onDrag: (p) => setFromPoint('b', p), onClick: (p) => setFromPoint('b', p) }),
  };

  fillSelects();
  for (const s of ['a', 'b']) {
    sides[s] = analysis(state[s]);
    panels[s].setCountry(sides[s]);
    $(`#select-${s}`).value = state[s];
    $(`#panel-${s} .panel-title`).textContent = countries.get(state[s]).properties.name;
  }
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#btn-ghost').addEventListener('click', () => setGhost(!state.ghost));
  $('#btn-sweep').addEventListener('click', startSweep);
  $('#btn-swap').addEventListener('click', swapSides);
  $('#btn-help').addEventListener('click', () => $('#help').showModal());
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => { for (const s of ['a', 'b']) panels[s].invalidate(); });

  setGhost(state.ghost);
  setMode(state.mode);
  document.body.classList.add('is-ready');
}

main().catch((err) => {
  console.error(err);
  $('#sentence').textContent = `Impossible de charger les données : ${err.message}`;
});
