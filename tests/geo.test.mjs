import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  distanceKm, bearingDeg, destination, pointInPolygon, mainlandPolygons, territoryCenter,
  radialProfile, profileAt, transferShape, analyzeCountry, toPolygons, compassName, unwrapLon,
} from '../src/geo.js';

const PARIS = [2.3522, 48.8566];
const MARSEILLE = [5.3698, 43.2965];

test('distance Paris–Marseille ≈ 660 km', () => {
  const d = distanceKm(PARIS, MARSEILLE);
  assert.ok(Math.abs(d - 661) < 5, `d=${d}`);
});

test('destination puis distance/cap : aller-retour cohérent', () => {
  const p = destination(PARIS, 500, 135);
  assert.ok(Math.abs(distanceKm(PARIS, p) - 500) < 1e-6);
  assert.ok(Math.abs(bearingDeg(PARIS, p) - 135) < 1e-6);
});

test('destination traverse proprement l’antiméridien', () => {
  const p = destination([179.5, 0], 200, 90);
  assert.ok(p[0] < -178 && p[0] > -180);
  assert.equal(unwrapLon(p[0], 179.5) > 180, true);
});

test('point dans polygone carré avec trou', () => {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
  assert.equal(pointInPolygon([1, 1], square), true);
  assert.equal(pointInPolygon([5, 5], square), false);
  assert.equal(pointInPolygon([11, 5], square), false);
});

test('profil radial d’un carré : rayons attendus sur les axes et diagonales', () => {
  // Carré de ±1° autour de l'équateur : ~111 km de demi-côté.
  const sq = [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]];
  const center = [0, 0];
  const prof = radialProfile(center, [sq]);
  const half = distanceKm(center, [1, 0]);
  assert.ok(Math.abs(profileAt(prof, 90) - half) < 1, 'est');
  assert.ok(Math.abs(profileAt(prof, 0) - distanceKm(center, [0, 1])) < 1, 'nord');
  assert.ok(Math.abs(profileAt(prof, 45) - half * Math.SQRT2) < 3, 'diagonale');
});

test('mainland : la Corse reste, la Guyane part', () => {
  const fc = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
  const fra = fc.features.find((f) => f.properties.id === 'FRA');
  const all = toPolygons(fra.geometry);
  const main = mainlandPolygons(all);
  assert.ok(main.length < all.length, 'des territoires lointains ont été écartés');
  const corsica = [9.1, 42.2], cayenne = [-52.3, 4.9], lyon = [4.83, 45.76];
  assert.equal(main.some((p) => pointInPolygon(lyon, p)), true, 'Lyon');
  assert.equal(main.some((p) => pointInPolygon(corsica, p)), true, 'Corse');
  assert.equal(main.some((p) => pointInPolygon(cayenne, p)), false, 'Cayenne');
});

test('mainland USA : Alaska et Hawaï écartés, Floride gardée', () => {
  const fc = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
  const usa = fc.features.find((f) => f.properties.id === 'USA');
  const main = mainlandPolygons(toPolygons(usa.geometry));
  assert.equal(main.some((p) => pointInPolygon([-150, 64], p)), false, 'Alaska');
  assert.equal(main.some((p) => pointInPolygon([-157.8, 21.3], p)), false, 'Hawaï');
  assert.equal(main.some((p) => pointInPolygon([-81.4, 28.5], p)), true, 'Floride');
});

test('mainland Japon : Hokkaidō et Kyūshū conservés', () => {
  const fc = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
  const jpn = fc.features.find((f) => f.properties.id === 'JPN');
  const main = mainlandPolygons(toPolygons(jpn.geometry));
  assert.equal(main.some((p) => pointInPolygon([142.5, 43.3], p)), true, 'Hokkaidō');
  assert.equal(main.some((p) => pointInPolygon([130.7, 32.8], p)), true, 'Kyūshū');
});

test('centre de la France : au cœur du pays, profil ~ 500 km vers le sud', () => {
  const fc = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
  const fra = fc.features.find((f) => f.properties.id === 'FRA');
  const a = analyzeCountry(fra.geometry);
  assert.ok(a.centerInside);
  assert.ok(Math.abs(a.center[0] - 2.5) < 1.2 && Math.abs(a.center[1] - 46.6) < 1, `centre=${a.center}`);
  const south = profileAt(a.profile, 180);
  assert.ok(south > 350 && south < 600, `sud=${south}`);
  const east = profileAt(a.profile, 90);
  assert.ok(east > 200 && east < 400, `est=${east}`);
});

test('tous les pays s’analysent sans valeur dégénérée', () => {
  const fc = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
  for (const f of fc.features) {
    const a = analyzeCountry(f.geometry);
    assert.ok(Number.isFinite(a.center[0]) && Number.isFinite(a.center[1]), f.properties.id);
    assert.ok(a.profile.every((r) => Number.isFinite(r) && r > 0), `profil ${f.properties.id}`);
  }
});

test('transfert de silhouette : taille réelle conservée', () => {
  const fc = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
  const fra = analyzeCountry(fc.features.find((f) => f.properties.id === 'FRA').geometry);
  const chn = analyzeCountry(fc.features.find((f) => f.properties.id === 'CHN').geometry);
  const ghost = transferShape(fra.main, fra.center, chn.center);
  const v0 = fra.main[0][0][0], g0 = ghost[0][0][0];
  assert.ok(Math.abs(distanceKm(fra.center, v0) - distanceKm(chn.center, g0)) < 0.01);
  const morph = transferShape(fra.main, fra.center, chn.center, { source: fra.profile, target: chn.profile });
  const m0 = morph[0][0][0];
  const az = bearingDeg(fra.center, v0);
  const ρ = distanceKm(fra.center, v0);
  const expected = ρ / Math.max(profileAt(fra.profile, az), ρ) * profileAt(chn.profile, az);
  assert.ok(Math.abs(distanceKm(chn.center, m0) - expected) < 0.01);
});

test('transfert morphé : tout sommet reste dans l’enveloppe radiale de la cible', () => {
  const fc = JSON.parse(readFileSync(new URL('../data/countries.json', import.meta.url)));
  const chn = analyzeCountry(fc.features.find((f) => f.properties.id === 'CHN').geometry);
  const fra = analyzeCountry(fc.features.find((f) => f.properties.id === 'FRA').geometry);
  const morph = transferShape(chn.main, chn.center, fra.center, { source: chn.profile, target: fra.profile });
  for (const poly of morph) for (const v of poly[0]) {
    const az = bearingDeg(fra.center, v);
    assert.ok(distanceKm(fra.center, v) <= profileAt(fra.profile, az) * 1.02 + 1);
  }
});

test('rose des vents en français', () => {
  assert.equal(compassName(0), 'nord');
  assert.equal(compassName(157), 'sud-sud-est');
  assert.equal(compassName(270, true), 'O');
  assert.equal(compassName(359), 'nord');
});
