// Recherche de la ville notable la plus proche d'un point.
import { distanceKm } from './geo.js';

export class CityIndex {
  /** @param {Array} rows lignes [nom, pays, lat, lon, population, capitale] */
  constructor(rows) {
    this.cities = rows.map(([name, country, lat, lon, pop, capital]) => ({
      name, country, lonlat: [lon, lat], pop, capital: capital === 1,
    }));
  }

  /**
   * Ville la plus proche, en privilégiant légèrement les grandes villes :
   * la distance est pondérée par un bonus logarithmique de population, pour
   * que « près de Marseille » l'emporte sur une banlieue plus proche de 3 km.
   */
  nearest(lonlat, { country } = {}) {
    let best = null, bestScore = Infinity;
    for (const c of this.cities) {
      if (country && c.country !== country) continue;
      const d = distanceKm(lonlat, c.lonlat);
      if (d > 400) continue;
      const bonus = Math.log10(Math.max(c.pop, 1000)) * 4;
      const score = d - bonus;
      if (score < bestScore) { bestScore = score; best = { ...c, distanceKm: d }; }
    }
    return best;
  }
}
