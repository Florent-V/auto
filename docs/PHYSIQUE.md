# Analyse de la physique de NEON APEX

Ce document décrit le modèle physique des voitures, ses hypothèses, ses paramètres et sa validation chiffrée. Tous les chiffres viennent de la simulation elle-même, reproductibles avec :

```bash
npm run banc      # essais normalisés (accélération, freinage, adhérence latérale)
npm run chronos   # meilleurs tours de l'IA sur les 9 circuits célèbres
npm test          # 15 tests de jeu et de physique
```

## 1. Choix du modèle

J'ai écrit une physique dédiée plutôt qu'un moteur de corps rigides générique (Rapier, Cannon). Une voiture de course se résume surtout à **quatre contacts pneu-sol** et aux **charges** qui s'y appliquent. Un moteur générique modélise mal les pneus et produit des comportements instables à 300 km/h. Le modèle retenu est un **modèle bicyclette dynamique enrichi** : les deux roues d'un essieu sont fusionnées pour la dynamique du châssis, mais les **charges, surfaces et adhérences sont calculées roue par roue**.

Avantages :
- **Déterministe** : même seed et mêmes commandes donnent exactement la même course, ce qui est testé.
- **Testable hors navigateur** : le cœur ne dépend pas de Three.js.
- **Léger** : environ 3 µs par voiture et par pas, soit environ 2 ms de calcul par seconde de jeu pour les 6 voitures.

État d'une voiture : position `(x, z)`, lacet `ψ`, vitesses dans le repère du véhicule (`vx` longitudinale, `vy` latérale), vitesse de lacet `r`, rapport engagé, régime moteur.

## 2. Charges verticales

À chaque sous-pas, la charge de chaque roue est recalculée :

| Terme | Formule | Effet |
| --- | --- | --- |
| Poids (pente comprise) | `m·g·cos θ` réparti selon la position du centre de gravité | une F1 porte 45 % à l'avant |
| Relief | `+ m·v²·κv` (κv = courbure verticale de la piste) | compression d'Eau Rouge : la voiture est plaquée ; crête : elle s'allège |
| Appui aérodynamique | `½·ρ·SCz·v²`, réparti par l'équilibre aéro | à 300 km/h une F1 « pèse » plus de 2,5 fois son poids |
| Transfert longitudinal | `m·ax·h / L` | au freinage l'avant se charge : il tourne mieux, l'arrière décroche |
| Transfert latéral | `m·ay·h / voie`, réparti par les barres antiroulis | la roue extérieure se charge |

Les accélérations utilisées pour les transferts sont filtrées (constante de temps d'environ 55 ms), comme le feraient des suspensions.

## 3. Pneus

**Capacité d'une roue** : `F_max = μ · μ_surface · f(Fz) · Fz`, avec la sensibilité à la charge `f(Fz) = 1 − k·(Fz/Fz₀ − 1)`. Un pneu deux fois plus chargé n'adhère pas deux fois plus. Conséquence directe : **un transfert de charge réduit l'adhérence totale de l'essieu**, et la répartition antiroulis règle le sous-virage ou le survirage, exactement comme sur une vraie voiture.

**Effort latéral** : formule magique de Pacejka simplifiée, `Fy = F_lat · sin(C·atan(B·α))` en fonction de l'angle de dérive `α` de l'essieu. L'effort sature au pic (≈ 5° pour des slicks, ≈ 7° pour des pneus route), puis décroît.

**Adhérence combinée** (ellipse de frottement) : l'effort longitudinal (moteur, freins) consomme l'adhérence disponible, `F_lat = √(F_max² − Fx²)`. Si la demande dépasse `F_max`, la roue **patine ou se bloque** : l'effort tombe au μ de glissement (≈ 80 %) et il ne reste presque plus rien en latéral. On retrouve alors :
- le survirage de puissance, à l'accélération en sortie de virage ;
- le sous-virage au blocage des roues avant ;
- le tête-à-queue au frein à main.

**Surfaces**, prises sous chaque roue :

| Surface | μ relatif | Résistance supplémentaire |
| --- | --- | --- |
| Piste | 1,00 | — |
| Vibreur | 0,93 | vibrations (caméra, son, caisse) |
| Herbe | 0,55 | 8 % de la charge + enlisement ∝ v |
| Gravier | 0,50 | 42 % de la charge + enlisement ∝ v (≈ 0,7 g de décélération) |
| Dégagement asphalté | 0,92 | faible |

## 4. Groupe motopropulseur et freins

- **Moteur** : courbe de puissance `P(x) = Pmax·(x + x² − x³)`, avec `x` = régime / régime de puissance maxi. Le couple maxi tombe vers mi-régime, le rupteur coupe l'injection, et le frein moteur est proportionnel au régime.
- **Boîte** : rapports réels (8 en F1, 7 pour l'hypercar, 6 pour la GT), rendement de transmission, temps de passage pendant lequel le couple est coupé (30 ms en F1, 140 ms en GT).
  - **Automatique** : elle monte au point de passage **optimal**, quand le rapport supérieur donne plus de force à la roue. Elle rétrograde au freinage tant que le régime le permet.
  - **Manuelle** : elle refuse un rétrogradage qui ferait sur-régimer le moteur.
- **Démarrage** : l'embrayage patine, donc le moteur reste dans sa plage utile.
- **Freins** : force maximale et répartition avant/arrière propres à chaque voiture.

## 5. Aides au pilotage (désactivables)

- **ABS avec contrôle de freinage en courbe** : la demande de freinage est limitée à l'adhérence restante une fois l'effort latéral servi. Sans cela, freiner en courbe faisait partir l'arrière en tête-à-queue : le défaut a été trouvé et corrigé en traçant la F1 dans Eau Rouge.
- **Antipatinage** : la motricité laisse la place à l'effort latéral en cours.
- **Contrôle de stabilité** : il amortit la vitesse de lacet au-delà de ce que l'adhérence permet de soutenir (≈ a_lat/v).
- **Aide au contre-braquage** (clavier) : les roues avant s'alignent en partie sur la trajectoire réelle (effet de chasse), ce qui rend une glisse rattrapable avec des touches tout-ou-rien. À la manette, la direction est analogique.

Préréglages : complètes, partielles (stabilité réduite : la voiture glisse) ou aucune (simulation pure).

## 6. Intégration numérique

- Pas fixe de **120 Hz**, découpé en **4 sous-pas (480 Hz)**, intégration semi-implicite. Le sous-découpage est nécessaire : des slicks de F1 (raideur de dérive de plusieurs centaines de kN/rad pour 800 kg) rendent le système raide, et un pas de 120 Hz devient instable à basse vitesse.
- Sous 6 m/s, le modèle dynamique est fondu progressivement dans un modèle **cinématique**, sans singularité à l'arrêt.
- Le rendu interpole entre les deux derniers états : le mouvement reste fluide quelle que soit la fréquence de l'écran.

## 7. Paramètres des voitures

| | Monoplace F1 | Hypercar | Sportive GT |
| --- | --- | --- | --- |
| Masse (pilote compris) | 800 kg | 1 350 kg | 1 480 kg |
| Puissance | 735 kW (≈ 1 000 ch) | 650 kW (≈ 880 ch) | 420 kW (≈ 570 ch) |
| Régime maxi | 12 500 tr/min | 8 600 tr/min | 7 600 tr/min |
| Empattement / hauteur CdG | 2,92 m / 0,28 m | 2,60 m / 0,40 m | 2,60 m / 0,48 m |
| Répartition des masses AV | 45 % | 42 % | 51 % |
| SCx / SCz | 1,25 / 5,0 m² | 0,88 / 1,15 m² | 0,74 / 0,25 m² |
| μ pneus (pic) | 1,90 (slicks) | 1,45 | 1,22 |
| Force de freinage maxi | 42 kN | 26 kN | 20 kN |

Ce sont des ordres de grandeur publics arrondis : règlements techniques et fiches constructeurs pour la F1, données de presse pour les deux autres catégories.

## 8. Validation : banc d'essai (`npm run banc`)

Mesures sur anneau plat géant (accélération, freinage avec ABS) et sur cercle en régime quasi stationnaire (vitesse augmentée de 0,25 m/s par seconde, direction asservie au lacet visé).

| Voiture | 0-100 km/h | 0-200 km/h | 0-300 km/h | V. max | 100-0 | 200-0 | Décél. max | Latéral R60 | Latéral R250 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Monoplace | 2.43 s | 4.50 s | 9.1 s | 337 km/h (R8) | 18.6 m | 56.5 m | 3.89 g | 2.84 g | 3.41 g |
| Hypercar | 3.05 s | 6.66 s | 14.1 s | 363 km/h (R7) | 27.2 m | 101.1 m | 1.72 g | 1.43 g | 1.61 g |
| Sportive | 4.37 s | 10.49 s | 27.7 s | 324 km/h (R6) | 33.1 m | 127.8 m | 1.31 g | 1.10 g | 1.08 g |

Comparaison avec les ordres de grandeur réels :
- **F1** : 0-100 en ≈ 2,6 s, 0-200 en ≈ 4,5-5 s, 100-0 en ≈ 17 m, vitesse de pointe ≈ 340-350 km/h. Accélérations, freinages et vitesse sont cohérents. L'adhérence latérale à haute vitesse (3,4 g sur le cercle de 250 m) reste **en dessous** des 4-5 g d'une F1 réelle, car le modèle ne simule ni l'appui variable avec la hauteur de caisse ni l'effet de sol.
- **Hypercar** : 0-100 en ≈ 2,8-3 s et 0-200 en ≈ 6-7 s pour une hypercar à moteur central de 900 ch. Cohérent.
- **GT** : 0-100 en ≈ 3,5-4,5 s, 100-0 en ≈ 32-35 m, environ 1,1 g sur pneus route. Cohérent.

Le banc est aussi un test : `npm test` vérifie ces fourchettes, la hiérarchie entre voitures, l'effet de l'ABS (sans ABS, les roues bloquent et la distance s'allonge), celui de l'antipatinage (sans lui, une F1 patine au départ), l'appui (plus de 2 g de charge à 300 km/h), la compression d'Eau Rouge, le gravier et la boîte.

## 9. Validation : temps au tour (`npm run chronos`)

Meilleur tour du pilote IA le plus rapide (niveau « difficile ») après deux tours de course, avec les 6 voitures en piste.

| Circuit | Monoplace | Hypercar | Sportive | Vitesse max (F1) | Repère F1 réel* |
| --- | --- | --- | --- | --- | --- |
| Monza | 1:24.19 | 1:49.78 | 2:06.97 | 336 km/h | ≈ 1:21 |
| Spa-Francorchamps | 1:56.84 | 2:31.11 | 2:53.95 | 333 km/h | ≈ 1:46 |
| Silverstone | 1:42.74 | 2:18.93 | 2:37.36 | 328 km/h | ≈ 1:27 |
| Monaco | 1:22.97 | 1:43.34 | 1:57.06 | 311 km/h | ≈ 1:13 |
| Interlagos | 1:17.12 | 1:45.81 | 2:00.27 | 333 km/h | ≈ 1:11 |
| Spielberg | 1:12.28 | 1:33.46 | 1:47.23 | 320 km/h | ≈ 1:05 |
| Zandvoort | 1:20.16 | 1:48.99 | 2:03.19 | 327 km/h | ≈ 1:11 |
| Imola | 1:23.44 | 1:49.78 | 2:06.08 | 335 km/h | ≈ 1:15 |
| Hungaroring | 1:26.58 | 1:55.01 | 2:09.70 | 326 km/h | ≈ 1:17 |

\* Ordre de grandeur des meilleurs tours en course de F1 récents, arrondi à la seconde ; ce n'est pas une référence officielle.

La F1 simulée est **4 à 18 % plus lente** que la réalité. La hiérarchie est respectée : les circuits les plus « aéro » (Silverstone, Hungaroring) sont les plus pénalisés, Monza le moins. Causes identifiées :
1. **Appui** : coefficient constant, sans effet de sol ni réglage par circuit. C'est l'écart principal dans les virages rapides.
2. **Géométrie** : les tracés réels sont lissés pour retirer le bruit de numérisation. Sans ce lissage, des pointes de courbure parasites créaient de faux virages serrés et les tours étaient 25-30 % plus lents. Le lissage conserve la longueur à mieux que 1,5 % mais ne restitue pas parfaitement les rayons réels.
3. **Pilote IA** : il garde une marge (≈ 13 % sur μ dans son profil de vitesse) pour rester stable en peloton.

Je n'ai pas gonflé les paramètres pour coller aux chronos : chaque réglage reste dans une plage physiquement défendable. Le seul relevé, l'appui de la F1 passé de 3,9 à 5,0 m², corrige une sous-estimation (une F1 actuelle se situe vers 4,5-5,5 m²).

## 10. Intelligence artificielle

- **Trajectoire de course** : méthode de l'« élastique » à courbure minimale. Chaque point est attiré vers le milieu de ses voisins, à plusieurs échelles (48 m → 8 m), dans les limites de la piste. Là où un vibreur existe sur toute la longueur de la voiture, les pilotes y posent deux roues, ce qui leur donne environ 1 m de largeur de plus.
- **Profil de vitesse** issu de la physique (diagramme g-g) :
  - en virage, `v² = μ·g / (κ − μ·(k_aéro + κv))` : l'appui et les compressions augmentent la vitesse possible ;
  - au freinage, une passe arrière utilise ce qui reste du cercle d'adhérence une fois l'accélération latérale servie.
- **Direction** : contrôleur de Stanley, utilisé en conduite autonome. Il combine l'anticipation de la courbure, la correction du cap et celle de l'écart latéral. Il a remplacé un « pure pursuit » qui coupait les virages : jusqu'à 3 m d'écart, et 2 à 4 fois plus de temps hors piste.
- **Course** : dépassements par le côté libre ; en duel en courbe, le pilote qui n'est pas devant lève légèrement le pied ; remise en piste si bloqué.

## 11. Limites connues

- Modèle à un seul essieu par train : pas de différentiel, pas de température ni d'usure des pneus, pas de pluie.
- Appui aérodynamique constant (pas d'effet de sol, d'aspiration ni de DRS).
- Pas de dévers (Zandvoort a des virages relevés dans la réalité).
- Relief des circuits réels approximé à partir de repères connus : les services publics d'altitude n'étaient pas joignables depuis l'environnement de développement.
- Les mesures du banc correspondent à un pilote parfait ; au clavier, on reste en dessous.
