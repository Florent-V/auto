# NEON APEX — simulation de course

Jeu de course 3D dans le navigateur, axé sur le réalisme :
- **9 circuits célèbres** reconstruits à partir de leurs tracés réels (Monza, Spa-Francorchamps, Silverstone, Monaco, Interlagos, Spielberg, Zandvoort, Imola, Hungaroring) ;
- des **circuits procéduraux** (une seed = un tracé) et un **éditeur** pour dessiner les siens ;
- **trois voitures** (monoplace type F1, hypercar, GT) à la physique distincte ;
- **jour, crépuscule ou nuit** ;
- cinq pilotes IA et un fantôme de votre meilleur tour.

Nuxt 4 + Nuxt UI pour l'interface, Three.js pour le rendu, physique écrite pour le jeu (voir [docs/PHYSIQUE.md](docs/PHYSIQUE.md)).

## Lancer

```bash
docker compose up --build
```

Puis ouvrir <http://localhost:3000>.

Sans Docker (Node ≥ 22) :

```bash
npm install
```

```bash
npm run dev
```

### Liens directs

| Paramètre | Exemple | Effet |
| --- | --- | --- |
| `circuit` | `?circuit=spa` | circuit célèbre (`monza`, `spa`, `silverstone`, `monaco`, `interlagos`, `spielberg`, `zandvoort`, `imola`, `hungaroring`) |
| `seed` | `?seed=1234`, `?seed=monaco` | circuit procédural |
| `trace` | `?trace=AUEI…` | circuit personnel (le tracé complet tient dans le lien) |
| `ambiance` | `?ambiance=nuit` | `jour`, `crepuscule` ou `nuit` |
| `voiture` | `?voiture=f1` | `f1`, `hypercar` ou `sportive` |
| `autopilot` | `?autopilot=1` | mode démonstration |

## Circuits

- **Célèbres** : géométrie réelle, longueur fidèle à 1,5 % près, sens de rotation correct (Interlagos et Imola anti-horaires). Relief inspiré des circuits : les 100 m de dénivelé de Spa et le Raidillon à 17 %, la montée du Casino à Monaco, la côte de Spielberg. Monaco est un tracé urbain entre murs et grillages, au milieu des immeubles.
- **Procéduraux** : spline fermée sans auto-intersection, générée à partir d'une seed partageable.
- **Personnels** : éditeur plein écran (onglet Circuit → Mes circuits).
  - **Édition** : on place, déplace ou supprime des points ; on règle largeur, relief et paysage, ou l'on part d'un circuit célèbre simplifié.
  - **Validation en direct** : le tracé est vérifié par le moteur du jeu (virages trop serrés, portions qui se touchent).
  - **Conservation** : circuits enregistrés dans le navigateur et partageables par lien.

L'habillage est calculé mètre par mètre :
- **Dégagements** : herbe tondue, bac à graviers dans les virages rapides, asphalte dans les virages lents.
- **Vibreurs** : en relief, à la corde et en sortie de virage.
- **Barrières** : glissières, murs de pneus et grillages ; murs en béton en ville.
- **Équipements** : stands, tribunes, panneaux, portique avec feux de départ façon F1, mâts d'éclairage.
- **Paysage** : forêt, plaine, dunes, montagne ou ville.

## Physique

Résumé (détails, équations et validation chiffrée dans [docs/PHYSIQUE.md](docs/PHYSIQUE.md)) :
- **Charges** : charge de chaque roue (poids, appui aérodynamique, transferts longitudinal et latéral, compressions et crêtes du relief).
- **Pneus** : modèle de Pacejka, sensibilité à la charge, ellipse de frottement (patinage, blocage), surface sous chaque roue.
- **Transmission et freins** : moteur à courbe de puissance réaliste, boîte automatique ou manuelle, rupteur, frein moteur, freins à répartition.
- **Aides** : ABS avec contrôle de freinage en courbe, antipatinage, contrôle de stabilité, toutes désactivables.

| Voiture | 0-100 km/h | V. max | 100-0 km/h | Latéral |
| --- | --- | --- | --- | --- |
| Monoplace | 2,4 s | 337 km/h | 18,6 m | jusqu'à 3,4 g |
| Hypercar | 3,1 s | 363 km/h | 27,2 m | 1,6 g |
| Sportive | 4,4 s | 324 km/h | 33,1 m | 1,1 g |

## Commandes

| Clavier | Manette | Action |
| --- | --- | --- |
| ↑ / W | gâchette droite | accélérer (progressif à la manette) |
| ↓ / S | gâchette gauche | freiner, puis marche arrière à l'arrêt |
| ← → / A D | stick gauche | diriger |
| Espace | A | frein à main |
| E / Q | gâchettes hautes | monter / descendre un rapport (boîte manuelle) |
| C | Y | caméra : poursuite, poursuite proche, capot, embarquée |
| T | Select | télémétrie (diagramme g-g, appui, charges, adhérence, ABS/TC) |
| P / Échap | Start | pause (l'ambiance se change aussi depuis la pause) |
| R | X | replacer la voiture |
| M | | couper le son |

Les touches sont lues par position physique : sur un clavier AZERTY, WASD = ZQSD et Q = A.

## Développement

```bash
npm test          # 15 tests : circuits, physique, IA, tours, fantôme, collisions
npm run banc      # banc d'essai physique (tableau Markdown)
npm run chronos   # temps au tour de l'IA sur les circuits célèbres
```

```
app/
  components/        Interface Nuxt UI (menu, HUD, éditeur, écran de fin)
  game/
    core/            Simulation pure, sans Three.js (testable sous Node)
      circuit.js       spline, repère de Frenet, validation, habillage, trajectoire
      circuits-reels.js / donnees-circuits.js   circuits célèbres
      trace-perso.js   circuits personnels (encodage, validation)
      modeles.js       caractéristiques physiques des voitures
      vehicule.js      dynamique du véhicule
      ia.js            pilotes IA (profil g-g, contrôleur de Stanley)
      collisions.js, fantome.js, course.js, rng.js
    rendu/           Three.js : scène et ambiances, décor, textures, voitures, effets, caméra
    audio.js         son synthétisé (moteur selon régime et cylindres)
    entrees.js       clavier et manette
    moteur.js        boucle de jeu à pas fixe
docs/PHYSIQUE.md     analyse de la physique
outils/              banc d'essai et chronos
tests/               tests de jeu automatisés
```

## Crédits

Tracés des circuits dérivés du jeu de données [f1-circuits](https://github.com/bacinger/f1-circuits) de Tomislav Bacinger, sous licence MIT (notice reproduite dans `app/game/core/donnees-circuits.js`). Ces données ne sont pas officielles ; les noms désignent les lieux dont les tracés s'inspirent. Les marques des panneaux publicitaires sont fictives.
