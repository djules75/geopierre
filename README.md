# GeoPierre

Deux cartes côte à côte, deux pays, une même règle : la distance que vous tracez sur l'une se
répercute en direct sur l'autre. Paris–Marseille « vaut » quoi en Chine ? Réponse immédiate,
en kilomètres ou en proportion de la forme du pays.

Application 100 % statique, sans serveur ni clé d'API : toutes les données sont embarquées.

## Lancer

```bash
npm run dev          # sert le dossier sur http://localhost:5173
```

N'importe quel serveur statique convient (`python3 -m http.server`, GitHub Pages…). Ouvrir
`index.html` directement depuis le disque ne marche pas : le navigateur bloque le chargement
des données en `file://`.

## Utiliser

- **Le point de départ est fixe** : le barycentre du territoire principal de chaque pays.
- **Déplacez le point** (ou cliquez sur une carte) : l'autre carte répond en temps réel.
- **Absolu** : même distance en kilomètres, même cap, sur les deux cartes.
- **Proportionnel** : même *fraction* du trajet centre → frontière, dans le même cap.
  La distance à la frontière est mesurée dans chaque direction (profil radial à 0,25°),
  la règle épouse donc exactement la forme de chaque pays, pas seulement sa largeur ou sa hauteur.
- **Fantôme** : la silhouette de l'autre pays posée sur la carte. À taille réelle en mode
  absolu (la France tient dans un coin de la Chine), déformée pour épouser le pays hôte en mode
  proportionnel.
- **Balayage** : la cible fait un tour complet sur les deux cartes et dessine la même
  « ligne d'horizon », à fraction constante.
- **Villes** : chaque cible est traduite en ville réelle (« jusqu'à Nîmes », « jusqu'à Liuzhou »).
- **Partage** : l'état complet (pays, mode, cap, fraction) vit dans l'URL.
- **Clavier** : `←` `→` cap, `↑` `↓` distance, `M` mode, `F` fantôme, `S` balayage, `X` échanger.

Le thème suit le réglage clair/sombre du système.

## Comment c'est calculé

`src/geo.js` (sans dépendance, testé en Node) :

1. **Territoire principal** : le plus grand polygone, puis par agrégation les polygones voisins
   assez grands (≥ 0,5 % de l'aire du plus grand) et assez proches (écart ≤ max(50 km, ½ rayon
   équivalent)). La Corse reste avec la France ; la Guyane, l'Alaska ou Hawaï sont écartés et
   s'affichent en filigrane.
2. **Barycentre** : centroïde pondéré par l'aire ; s'il tombe hors du pays (croissants,
   archipels), on prend le point intérieur le plus profond d'une grille.
3. **Profil radial** : dans la projection azimutale équidistante centrée sur le barycentre,
   chaque cap est une demi-droite ; on garde pour chaque cap l'intersection la plus lointaine
   avec la frontière.
4. **Correspondance** : au cap θ, fraction f = d / r(θ) côté piloté ; de l'autre côté,
   d' = d (absolu) ou d' = f · r'(θ) (proportionnel).

## Données

- Frontières : Natural Earth 1:50m, simplifiées (`data/countries.json`, ~530 ko).
- Villes : Natural Earth 1:10m populated places, ≥ 50 000 habitants ou capitale (`data/cities.json`).
- Fond de carte : les mêmes frontières, dessinées en vectoriel, donc aucune tuile à charger.
- Leaflet 1.9.4 est embarqué dans `vendor/`.

Régénérer : déposer les deux GeoJSON Natural Earth dans `scripts/raw/` puis `npm run build:data`.

## Tests

```bash
npm test
```

Vérifie la géodésie, le profil radial, la sélection du territoire principal (Corse, Alaska,
Hokkaidō…), le transfert de silhouette et l'analyse de tous les pays sans valeur dégénérée.
