# NEON APEX — course procédurale

Jeu de course 3D jouable dans le navigateur : chaque *seed* engendre un circuit
fermé unique, cinq pilotes IA, un fantôme de votre meilleur tour, le tout dans
une ambiance crépuscule néon. Nuxt 4 + Nuxt UI pour l'interface, Three.js pour
le rendu, physique maison (modèle bicyclette) pour les véhicules.

## Lancer

```bash
docker compose up --build
```

Puis ouvrir <http://localhost:3000>. Un circuit précis : `http://localhost:3000/?seed=1234`
(la seed peut aussi être un mot : `?seed=monaco`). Mode démonstration :
`?seed=1234&autopilot=1`.

Sans Docker (Node ≥ 22) :

```bash
npm install
```

```bash
npm run dev
```

Tests de simulation (sans navigateur, exécutés aussi pendant le build Docker) :

```bash
npm test
```

## Commandes

| Touche | Action |
| --- | --- |
| ↑ / W | Accélérer |
| ↓ / S | Freiner, puis marche arrière |
| ← → / A D | Diriger |
| Espace | Frein à main |
| P ou Échap | Pause |
| R | Replacer la voiture au centre de la piste |
| M | Couper / rétablir le son |
| Entrée | Démarrer (menu, écran de fin) |

Les touches sont lues par position physique : sur un clavier AZERTY, WASD = ZQSD.

## Architecture

```
app/
  components/        Interface Nuxt UI (menu, HUD, écran de fin)
  game/
    core/            Simulation pure, sans Three.js (testable sous Node)
      rng.js           générateur pseudo-aléatoire à seed
      circuit.js       spline Catmull-Rom fermée, repère de Frenet, validation
      vehicule.js      physique : modèle bicyclette dynamique + pneus Pacejka
      ia.js            pilotes IA (poursuite d'un point, évitement)
      collisions.js    contacts entre véhicules (impulsions)
      fantome.js       enregistrement / relecture interpolée du meilleur tour
      course.js        machine à états, tours, chrono, classement
    rendu/           Three.js : scène, décor, voitures, effets, caméra, mini-carte
    audio.js         son entièrement synthétisé (Web Audio)
    entrees.js       clavier
    moteur.js        boucle de jeu à pas fixe, liaison simulation ↔ rendu ↔ HUD
tests/               tests de jeu automatisés (node --test)
```

Choix de conception notables :

- **Physique maison plutôt que Rapier** : déterministe, testable hors
  navigateur, et bien plus stable pour une voiture arcade qu'un corps rigide
  générique.
- **Pas de temps fixe à 120 Hz** avec interpolation du rendu : la simulation
  est identique quelle que soit la fréquence de l'écran.
- **Circuit garanti sans auto-intersection** : points de contrôle à angles
  croissants, rayon de courbure minimal et distance minimale entre portions
  vérifiés ; en cas d'échec, nouvelle tentative avec une sous-seed dérivée
  (le résultat reste déterministe).
- **Tours infalsifiables** : la progression est cumulée et signée le long de la
  spline, à partir d'une projection locale ; ni marche arrière ni coupe à
  travers champ ne valident un tour.
- **Aucune allocation dans la boucle de jeu** : tampons typés pré-alloués,
  vecteurs réutilisés, particules et traces recyclées en anneau.
