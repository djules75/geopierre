// Géodésie et géométrie de forme pour GeoPierre.
// Toutes les coordonnées sont des paires [lon, lat] en degrés (convention GeoJSON).
// Aucune dépendance : ce module est testable en Node pur.

export const EARTH_RADIUS_KM = 6371.0088;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Distance orthodromique en km (haversine). */
export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Cap initial de a vers b, en degrés dans [0, 360). */
export function bearingDeg([lon1, lat1], [lon2, lat2]) {
  const φ1 = lat1 * DEG, φ2 = lat2 * DEG, Δλ = (lon2 - lon1) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * RAD + 360) % 360;
}

/** Point atteint depuis `origin` après `km` kilomètres au cap `bearing`. */
export function destination([lon, lat], km, bearing) {
  const δ = km / EARTH_RADIUS_KM, θ = bearing * DEG;
  const φ1 = lat * DEG, λ1 = lon * DEG;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return [normalizeLon(λ2 * RAD), φ2 * RAD];
}

export function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Ramène `lon` dans la fenêtre ]ref-180, ref+180] pour éviter les sauts à l'antiméridien. */
export function unwrapLon(lon, ref) {
  let l = lon;
  while (l - ref > 180) l -= 360;
  while (l - ref <= -180) l += 360;
  return l;
}

/** Polyligne orthodromique de `n` segments entre deux points. */
export function greatCircle(a, b, n = 64) {
  const d = distanceKm(a, b);
  if (d < 1e-6) return [a, b];
  const θ = bearingDeg(a, b);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = destination(a, (d * i) / n, θ);
    pts.push([unwrapLon(p[0], a[0]), p[1]]);
  }
  return pts;
}

// --- Polygones ---------------------------------------------------------------

/** Normalise une géométrie GeoJSON en liste de polygones (chaque polygone = liste d'anneaux). */
export function toPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Test point-dans-anneau (ray casting, en lon/lat). */
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(pt, polygon) {
  if (!pointInRing(pt, polygon[0])) return false;
  for (let k = 1; k < polygon.length; k++) if (pointInRing(pt, polygon[k])) return false;
  return true;
}

export function pointInPolygons(pt, polygons) {
  return polygons.some((p) => pointInPolygon(pt, p));
}

/**
 * Aire approchée d'un anneau en km² (formule du lacet dans une projection
 * équirectangulaire locale). Suffisant pour classer des polygones entre eux.
 */
export function ringAreaKm2(ring) {
  if (ring.length < 3) return 0;
  let latSum = 0;
  for (const [, lat] of ring) latSum += lat;
  const k = Math.cos((latSum / ring.length) * DEG) * EARTH_RADIUS_KM * DEG;
  const ky = EARTH_RADIUS_KM * DEG;
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    s += (xj * k) * (yi * ky) - (xi * k) * (yj * ky);
  }
  return Math.abs(s) / 2;
}

export function polygonAreaKm2(polygon) {
  let a = ringAreaKm2(polygon[0]);
  for (let k = 1; k < polygon.length; k++) a -= ringAreaKm2(polygon[k]);
  return Math.max(0, a);
}

/** Centroïde planaire (pondéré par l'aire) d'un anneau, en lon/lat. */
export function ringCentroid(ring) {
  const ref = ring[0][0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = unwrapLon(ring[i][0], ref), yi = ring[i][1];
    const xj = unwrapLon(ring[j][0], ref), yj = ring[j][1];
    const f = xj * yi - xi * yj;
    a += f; cx += (xi + xj) * f; cy += (yi + yj) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += unwrapLon(x, ref); sy += y; }
    return [normalizeLon(sx / ring.length), sy / ring.length];
  }
  a *= 3;
  return [normalizeLon(cx / a), cy / a];
}

/** Distance minimale (km) entre les sommets de deux anneaux. */
function minVertexGapKm(ringA, ringB) {
  let best = Infinity;
  const stepA = Math.max(1, Math.floor(ringA.length / 200));
  const stepB = Math.max(1, Math.floor(ringB.length / 200));
  for (let i = 0; i < ringA.length; i += stepA) {
    for (let j = 0; j < ringB.length; j += stepB) {
      const d = distanceKm(ringA[i], ringB[j]);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Sélectionne le « territoire principal » : le plus grand polygone, puis, par
 * agrégation, les polygones voisins assez grands (≥ 0,5 % de l'aire maximale)
 * et assez proches (écart ≤ max(50 km, 0,5 × rayon équivalent du plus grand)).
 * La Corse reste avec la France, l'Alaska et la Guyane sont écartés.
 */
export function mainlandPolygons(polygons) {
  if (polygons.length <= 1) return polygons.slice();
  const items = polygons.map((p) => ({ p, area: polygonAreaKm2(p) }))
    .sort((a, b) => b.area - a.area);
  const maxArea = items[0].area;
  const radius = Math.sqrt(maxArea / Math.PI);
  const gapMax = Math.max(50, 0.5 * radius);
  const kept = [items[0]];
  const pending = items.slice(1).filter((it) => it.area >= 0.005 * maxArea);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const cand = pending[i];
      if (kept.some((k) => minVertexGapKm(k.p[0], cand.p[0]) <= gapMax)) {
        kept.push(cand);
        pending.splice(i, 1);
        changed = true;
      }
    }
  }
  return kept.map((k) => k.p);
}

export function polygonsBounds(polygons) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const poly of polygons) for (const [lon, lat] of poly[0]) {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Barycentre du territoire : centroïde pondéré par l'aire. S'il tombe hors du
 * pays (formes en croissant, archipels), on prend le point intérieur le plus
 * « profond » d'une grille, approximation du pôle d'inaccessibilité.
 */
export function territoryCenter(polygons) {
  let total = 0, cx = 0, cy = 0;
  const ref = polygons[0][0][0][0];
  for (const poly of polygons) {
    const a = polygonAreaKm2(poly);
    const [lon, lat] = ringCentroid(poly[0]);
    cx += unwrapLon(lon, ref) * a; cy += lat * a; total += a;
  }
  const centroid = total > 0 ? [normalizeLon(cx / total), cy / total] : ringCentroid(polygons[0][0]);
  if (pointInPolygons(centroid, polygons)) return { point: centroid, inside: true };

  const b = polygonsBounds(polygons);
  const vertices = polygons.flatMap((p) => p[0]);
  const vStep = Math.max(1, Math.floor(vertices.length / 400));
  let best = null, bestScore = -1;
  const N = 36;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const pt = [b.minLon + ((b.maxLon - b.minLon) * i) / N, b.minLat + ((b.maxLat - b.minLat) * j) / N];
    if (!pointInPolygons(pt, polygons)) continue;
    let dmin = Infinity;
    for (let k = 0; k < vertices.length; k += vStep) {
      const d = distanceKm(pt, vertices[k]);
      if (d < dmin) dmin = d;
    }
    if (dmin > bestScore) { bestScore = dmin; best = pt; }
  }
  return { point: best || centroid, inside: !!best };
}

// --- Profil radial -------------------------------------------------------------

/** Projette un point dans le plan azimutal équidistant centré en `center` : [x, y] en km. */
export function toAzimuthal(center, pt) {
  const ρ = distanceKm(center, pt);
  const az = bearingDeg(center, pt) * DEG;
  return [ρ * Math.sin(az), ρ * Math.cos(az)];
}

/**
 * Profil radial : pour chaque cap entier 0..359, la distance (km) du centre au
 * point le plus éloigné de la frontière dans cette direction. C'est la règle
 * « épouse la forme » du mode proportionnel. Calculé dans la projection
 * azimutale équidistante, où chaque cap est une demi-droite depuis l'origine.
 */
export function radialProfile(center, polygons, steps = 1440) {
  const edges = [];
  for (const poly of polygons) {
    const ring = poly[0];
    const proj = ring.map((v) => toAzimuthal(center, v));
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) edges.push([proj[j], proj[i]]);
  }
  const profile = new Float64Array(steps);
  for (let s = 0; s < steps; s++) {
    const θ = (s * 360) / steps * DEG;
    const dx = Math.sin(θ), dy = Math.cos(θ);
    let far = 0;
    for (const [[x1, y1], [x2, y2]] of edges) {
      // Intersection demi-droite (0,0)+t·(dx,dy), t ≥ 0, avec le segment [P1,P2].
      const ex = x2 - x1, ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (x1 * ey - y1 * ex) / den;
      const u = (x1 * dy - y1 * dx) / den;
      if (t >= 0 && u >= 0 && u <= 1 && t > far) far = t;
    }
    profile[s] = far;
  }
  // Un cap sans intersection (centre hors du pays, cas limite) hérite de ses voisins.
  for (let s = 0; s < steps; s++) {
    if (profile[s] > 0) continue;
    let l = s, r = s;
    while (profile[(l + steps) % steps] === 0 && l > s - steps) l--;
    while (profile[r % steps] === 0 && r < s + steps) r++;
    profile[s] = (profile[(l + steps) % steps] + profile[r % steps]) / 2 || 1;
  }
  return profile;
}

/** Interpolation linéaire du profil pour un cap quelconque. */
export function profileAt(profile, bearing) {
  const steps = profile.length;
  const pos = ((bearing % 360) + 360) % 360 / 360 * steps;
  const i = Math.floor(pos) % steps, f = pos - Math.floor(pos);
  return profile[i] * (1 - f) + profile[(i + 1) % steps] * f;
}

/**
 * Contour « iso » : la courbe des points à la fraction `fraction` du profil
 * (mode proportionnel), ou à la distance `km` (mode absolu, cercle).
 */
export function isoContour(center, profile, { fraction, km }, steps = 180) {
  const pts = [];
  for (let s = 0; s <= steps; s++) {
    const θ = (s * 360) / steps;
    const r = km !== undefined ? km : fraction * profileAt(profile, θ);
    const p = destination(center, r, θ);
    pts.push([unwrapLon(p[0], center[0]), p[1]]);
  }
  return pts;
}

/**
 * Transfère la silhouette d'un pays sur le centre d'un autre.
 * - Sans profils : taille réelle (distance et cap conservés).
 * - Avec profils (source, target) : chaque sommet est mis à l'échelle du rapport
 *   des profils radiaux dans son cap, ce qui « morphe » la forme source vers la cible.
 */
export function transferShape(polygons, fromCenter, toCenter, profiles) {
  return polygons.map((poly) => poly.map((ring) => ring.map((v) => {
    let ρ = distanceKm(fromCenter, v);
    const az = bearingDeg(fromCenter, v);
    if (profiles) {
      // Un sommet de la frontière est par définition à portée du profil : on borne
      // l'interpolation pour qu'aucune pointe fine ne produise un rapport > 1.
      const rs = Math.max(profileAt(profiles.source, az), ρ), rt = profileAt(profiles.target, az);
      ρ = rs > 0 ? (ρ / rs) * rt : ρ;
    }
    const p = destination(toCenter, ρ, az);
    return [unwrapLon(p[0], toCenter[0]), p[1]];
  })));
}

/** Analyse complète d'un pays : territoire principal, centre, profil, bornes. */
export function analyzeCountry(geometry) {
  const all = toPolygons(geometry);
  const main = mainlandPolygons(all);
  const { point: center, inside } = territoryCenter(main);
  const profile = radialProfile(center, main);
  let areaKm2 = 0;
  for (const p of main) areaKm2 += polygonAreaKm2(p);
  return { all, main, center, centerInside: inside, profile, bounds: polygonsBounds(main), areaKm2 };
}

// --- Présentation --------------------------------------------------------------

const COMPASS_FR = [
  'nord', 'nord-nord-est', 'nord-est', 'est-nord-est', 'est', 'est-sud-est', 'sud-est', 'sud-sud-est',
  'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest', 'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest',
];
const COMPASS_SHORT = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

export function compassName(bearing, short = false) {
  const idx = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return (short ? COMPASS_SHORT : COMPASS_FR)[idx];
}
