// Prépare les données embarquées de GeoPierre à partir de Natural Earth.
// Entrées  : scripts/raw/ne_50m_admin_0_countries.geojson
//            scripts/raw/ne_10m_populated_places_simple.geojson
// Sorties  : data/countries.json  (frontières simplifiées, nom FR/EN, continent)
//            data/cities.json     (villes notables : nom, pays, lat, lon, population)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const RAW = 'scripts/raw';
mkdirSync('data', { recursive: true });

// --- Pays -------------------------------------------------------------------
// Simplification Visvalingam pondérée, on garde ~30 % des sommets : les formes
// restent fidèles à l'échelle d'un pays tout en tenant dans ~700 ko.
const simplified = execFileSync('npx', [
  'mapshaper', `${RAW}/ne_50m_admin_0_countries.geojson`,
  '-simplify', 'weighted', '30%', 'keep-shapes',
  '-o', 'format=geojson', 'precision=0.001', '-',
], { maxBuffer: 1 << 28 }).toString();

const raw = JSON.parse(simplified);
const skip = new Set(['ATA']); // Antarctique : barycentre au pôle, non pertinent
// Noms d'usage courts pour l'interface.
const SHORT_FR = { CHN: 'Chine', COD: 'Congo (RDC)', COG: 'Congo', CAF: 'Centrafrique', FSM: 'Micronésie', SGS: 'Géorgie du Sud', IOT: 'Océan Indien britannique', ATF: 'Terres australes françaises', IOA: 'Îles australiennes de l’océan Indien' };
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const countries = raw.features
  .filter((f) => f.properties.TYPE !== 'Indeterminate' && !skip.has(f.properties.ADM0_A3))
  .filter((f) => f.geometry && f.properties.POP_EST > 0)
  .map((f) => ({
    type: 'Feature',
    properties: {
      id: f.properties.ADM0_A3,
      name: SHORT_FR[f.properties.ADM0_A3] || capitalize(f.properties.NAME_FR || f.properties.NAME_EN || f.properties.NAME),
      en: f.properties.NAME_EN || f.properties.NAME,
      continent: f.properties.CONTINENT,
    },
    geometry: f.geometry,
  }))
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name, 'fr'));

// Dédoublonne les codes (ex. territoires rattachés partageant un ADM0_A3).
const seen = new Set();
const unique = countries.filter((f) => {
  if (seen.has(f.properties.id)) return false;
  seen.add(f.properties.id);
  return true;
});
writeFileSync('data/countries.json', JSON.stringify({ type: 'FeatureCollection', features: unique }));

// --- Villes -----------------------------------------------------------------
const places = JSON.parse(readFileSync(`${RAW}/ne_10m_populated_places_simple.geojson`));
const cities = places.features
  .filter((f) => {
    const p = f.properties;
    return seen.has(p.adm0_a3) && (p.pop_max >= 50000 || p.adm0cap === 1 || p.scalerank <= 7);
  })
  .map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    return [p.name, p.adm0_a3, +lat.toFixed(3), +lon.toFixed(3), p.pop_max || 0, p.adm0cap === 1 ? 1 : 0];
  });
writeFileSync('data/cities.json', JSON.stringify(cities));

console.log(`${unique.length} pays, ${cities.length} villes`);
