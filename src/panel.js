// Un panneau = une carte Leaflet dédiée à un pays, avec ses couches :
// fond vectoriel embarqué (tous les pays + villes), contour du pays, centre,
// point cible déplaçable, segment, contour iso, silhouette fantôme et trace du balayage.
/* global L */
import { greatCircle } from './geo.js';

const ATTRIBUTION = 'Données <a href="https://www.naturalearthdata.com/">Natural Earth</a>';
const toLatLngs = (ring) => ring.map(([lon, lat]) => [lat, lon]);

/** Population minimale d'une ville pour être étiquetée, selon le zoom. */
function popThreshold(zoom) {
  if (zoom < 3) return 8e6;
  if (zoom < 4) return 3e6;
  if (zoom < 5) return 1.2e6;
  if (zoom < 6) return 500e3;
  if (zoom < 7) return 200e3;
  if (zoom < 8) return 80e3;
  return 0;
}

export class MapPanel {
  constructor(el, { accent, world, cities, onDrag, onClick }) {
    this.el = el;
    this.accent = accent;
    this.cities = cities;
    this.onDrag = onDrag;
    this.onClick = onClick;
    this.map = L.map(el, {
      zoomControl: false, attributionControl: false, worldCopyJump: false,
      zoomSnap: 0.25, wheelPxPerZoomLevel: 90, minZoom: 1.5, maxZoom: 10,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution(ATTRIBUTION).addTo(this.map);

    // Fond : toutes les terres, en filigrane. Les styles sont dans styles.css (.gp-land).
    this.landLayer = L.layerGroup().addTo(this.map);
    const landStyle = { className: 'gp-land', weight: 1, interactive: false };
    for (const f of world) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) L.polygon(poly.map(toLatLngs), landStyle).addTo(this.landLayer);
    }

    this.ghostLayer = L.layerGroup().addTo(this.map);
    this.countryLayer = L.layerGroup().addTo(this.map);
    this.cityLayer = L.layerGroup().addTo(this.map);
    this.contourLayer = L.layerGroup().addTo(this.map);
    this.trailLayer = L.layerGroup().addTo(this.map);
    this.segmentLayer = L.layerGroup().addTo(this.map);

    this.centerMarker = L.marker([0, 0], {
      icon: L.divIcon({ className: 'gp-center', iconSize: [14, 14] }), interactive: false, keyboard: false,
    }).addTo(this.map);
    this.targetMarker = L.marker([0, 0], {
      icon: L.divIcon({ className: 'gp-target', iconSize: [22, 22] }), draggable: true, keyboard: false, autoPan: true,
    }).addTo(this.map);
    this.targetMarker.on('drag', (e) => {
      const { lat, lng } = e.target.getLatLng();
      this.onDrag([lng, lat]);
    });
    this.map.on('click', (e) => this.onClick([e.latlng.lng, e.latlng.lat]));
    this.map.on('moveend zoomend', () => this.renderCities());
    this.map.setView([20, 0], 2);
  }

  /** Étiquettes des villes visibles, filtrées par population selon le zoom. */
  renderCities() {
    this.cityLayer.clearLayers();
    const zoom = this.map.getZoom();
    const min = popThreshold(zoom);
    const b = this.map.getBounds().pad(0.05);
    const visible = [];
    for (const c of this.cities.cities) {
      if (c.pop < min && !(c.capital && zoom >= 3)) continue;
      const lat = c.lonlat[1];
      let lon = c.lonlat[0];
      if (!b.contains([lat, lon])) {
        lon += 360; if (!b.contains([lat, lon])) { lon -= 720; if (!b.contains([lat, lon])) continue; }
      }
      visible.push({ c, lat, lon });
    }
    visible.sort((x, y) => y.c.pop - x.c.pop);
    // Placement glouton : une étiquette qui chevaucherait une plus grande ville est omise.
    const placed = [];
    let count = 0;
    for (const { c, lat, lon } of visible) {
      if (count >= 80) break;
      const pt = this.map.latLngToContainerPoint([lat, lon]);
      const box = { x1: pt.x - 4, y1: pt.y - 9, x2: pt.x + 8 + c.name.length * 6.2, y2: pt.y + 7 };
      if (placed.some((b) => box.x1 < b.x2 && box.x2 > b.x1 && box.y1 < b.y2 && box.y2 > b.y1)) continue;
      placed.push(box);
      count++;
      L.marker([lat, lon], {
        icon: L.divIcon({ className: `gp-city${c.capital ? ' is-capital' : ''}`, html: `<i></i><span>${c.name}</span>`, iconSize: [0, 0] }),
        interactive: false, keyboard: false,
      }).addTo(this.cityLayer);
    }
  }

  /** Dessine le pays : tout le territoire en léger, le territoire principal en net. */
  setCountry(analysis) {
    this.analysis = analysis;
    this.countryLayer.clearLayers();
    const faint = { color: this.accent, weight: 1, opacity: 0.4, fillColor: this.accent, fillOpacity: 0.05, interactive: false };
    const strong = { color: this.accent, weight: 1.75, opacity: 0.95, fillColor: this.accent, fillOpacity: 0.13, interactive: false };
    for (const poly of analysis.all) L.polygon(poly.map(toLatLngs), faint).addTo(this.countryLayer);
    for (const poly of analysis.main) L.polygon(poly.map(toLatLngs), strong).addTo(this.countryLayer);
    const [lon, lat] = analysis.center;
    this.centerMarker.setLatLng([lat, lon]);
    this.trailLayer.clearLayers();
    const b = analysis.bounds;
    this.map.fitBounds([[b.minLat, b.minLon], [b.maxLat, b.maxLon]], { padding: [40, 40], animate: false });
    this.renderCities();
  }

  /** Place la cible et trace le segment orthodromique depuis le centre. */
  setTarget(lonlat) {
    const center = this.analysis.center;
    this.targetMarker.setLatLng([lonlat[1], lonlat[0]]);
    this.segmentLayer.clearLayers();
    const line = greatCircle(center, lonlat, 48);
    L.polyline(toLatLngs(line), { className: 'gp-halo', weight: 6, opacity: 0.7, interactive: false }).addTo(this.segmentLayer);
    L.polyline(toLatLngs(line), { color: this.accent, weight: 2.5, opacity: 1, interactive: false }).addTo(this.segmentLayer);
  }

  /** Contour iso (cercle en mode absolu, pays rétréci en mode proportionnel). */
  setContour(points) {
    this.contourLayer.clearLayers();
    if (!points) return;
    L.polyline(toLatLngs(points), {
      color: this.accent, weight: 1.25, opacity: 0.8, dashArray: '4 5', interactive: false,
    }).addTo(this.contourLayer);
  }

  /** Silhouette fantôme de l'autre pays, centrée sur ce pays. */
  setGhost(polygons, ghostColor, { soft = false } = {}) {
    this.ghostLayer.clearLayers();
    if (!polygons) return;
    for (const poly of polygons) {
      L.polygon(poly.map(toLatLngs), {
        color: ghostColor, weight: soft ? 1 : 1.5, opacity: soft ? 0.45 : 0.85, dashArray: '6 4',
        fillColor: ghostColor, fillOpacity: soft ? 0.09 : 0.12, interactive: false,
      }).addTo(this.ghostLayer);
    }
  }

  clearTrail() { this.trailLayer.clearLayers(); this.trailPts = null; }

  /** Ajoute un point à la trace du balayage. */
  pushTrail(lonlat) {
    if (!this.trailPts) {
      this.trailPts = [];
      this.trail = L.polyline([], { color: this.accent, weight: 2, opacity: 0.55, interactive: false }).addTo(this.trailLayer);
    }
    this.trailPts.push([lonlat[1], lonlat[0]]);
    this.trail.setLatLngs(this.trailPts);
  }

  invalidate() { this.map.invalidateSize(); }
}
