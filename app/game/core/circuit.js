// =============================================================================
// MODULE : Circuit — géométrie, repère de Frenet, habillage, trajectoire
// -----------------------------------------------------------------------------
// Un même constructeur sert trois sources de tracés :
//   - procédural : points aléatoires autour d'un cercle (seed) ;
//   - réel       : tracés de circuits existants (données-circuits.js) ;
//   - personnel  : points posés par le joueur dans l'éditeur.
//
// Étapes :
//  1. Spline de Catmull-Rom centripète FERMÉE passant par les points.
//  2. Ré-échantillonnage à pas constant (≈ 2 m) + lissage éventuel (données
//     réelles bruitées).
//  3. Relief (profil d'altitude ou sinusoïdes), repère de Frenet (T, N, B),
//     courbures horizontale et verticale.
//  4. Validation géométrique : rayon mini, aucune portion qui en chevauche
//     une autre (index spatial → coût linéaire).
//  5. Habillage calculé mètre par mètre et de chaque côté : distance des
//     barrières (limitée par les virages serrés et les portions voisines),
//     type de dégagement (herbe, gravier, asphalte), présence de vibreurs.
//  6. Trajectoire de course à courbure minimale (« élastique »), utilisée par
//     l'IA, et sa courbure.
//
// Ce module ne dépend PAS de Three.js : il est testable sous Node.
// =============================================================================
import { creerRng } from './rng.js'

/** Demi-largeur par défaut de la piste (largeur constante = 13 m). */
export const DEMI_LARGEUR = 6.5
/** Largeur d'un vibreur posé à cheval sur le bord de piste. */
export const LARGEUR_VIBREUR = 1.0
/** Types de surface hors piste (par côté et par échantillon). */
export const SURFACE = Object.freeze({ HERBE: 0, GRAVIER: 1, ASPHALTE: 2 })
/** Pas d'échantillonnage visé le long de la spline (mètres). */
const PAS_CIBLE = 2
const DEUX_PI = Math.PI * 2

/** Ramène un angle dans ]-π, π]. */
export function normaliserAngle(a) {
  while (a > Math.PI) a -= DEUX_PI
  while (a <= -Math.PI) a += DEUX_PI
  return a
}

/** Erreur levée quand un tracé est inutilisable (avec la liste des problèmes). */
export class CircuitInvalide extends Error {
  constructor(problemes) {
    super(problemes.map((p) => p.message).join(' ; '))
    this.problemes = problemes
  }
}

// -----------------------------------------------------------------------------
// Spline de Catmull-Rom centripète (formulation de Barry-Goldman), en 2D.
// La version centripète (alpha = 0,5) évite boucles et rebroussements quand
// les points sont très irréguliers (lignes droites de 700 m puis virages
// échantillonnés tous les 10 m dans les données réelles).
// -----------------------------------------------------------------------------
function catmullRomCentripete(p0, p1, p2, p3, u, sortie) {
  const t0 = 0
  const t1 = t0 + Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])) + 1e-9
  const t2 = t1 + Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])) + 1e-9
  const t3 = t2 + Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1])) + 1e-9
  const t = t1 + (t2 - t1) * u
  for (let k = 0; k < 2; k++) {
    const a1 = ((t1 - t) * p0[k] + (t - t0) * p1[k]) / (t1 - t0)
    const a2 = ((t2 - t) * p1[k] + (t - t1) * p2[k]) / (t2 - t1)
    const a3 = ((t3 - t) * p2[k] + (t - t2) * p3[k]) / (t3 - t2)
    const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0)
    const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1)
    sortie[k] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1)
  }
}

/** Échantillonne densément la spline fermée puis ré-échantillonne à pas constant. */
function echantillonnerSpline(points) {
  const nb = points.length
  // Subdivision proportionnelle à la longueur de chaque segment.
  const dense = []
  const tmp = [0, 0]
  for (let i = 0; i < nb; i++) {
    const p0 = points[(i - 1 + nb) % nb], p1 = points[i]
    const p2 = points[(i + 1) % nb], p3 = points[(i + 2) % nb]
    const sub = Math.max(4, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5))
    for (let j = 0; j < sub; j++) {
      catmullRomCentripete(p0, p1, p2, p3, j / sub, tmp)
      dense.push(tmp[0], tmp[1])
    }
  }
  return reechantillonner(dense, PAS_CIBLE)
}

/** Ré-échantillonne une polyligne fermée (x, z entrelacés) à pas constant. */
function reechantillonner(dense, pasCible) {
  const nd = dense.length / 2
  const cumul = new Float64Array(nd + 1)
  for (let i = 0; i < nd; i++) {
    const j = (i + 1) % nd
    cumul[i + 1] = cumul[i] + Math.hypot(dense[j * 2] - dense[i * 2], dense[j * 2 + 1] - dense[i * 2 + 1])
  }
  const longueur = cumul[nd]
  const n = Math.max(24, Math.round(longueur / pasCible))
  const pas = longueur / n
  const px = new Float32Array(n), pz = new Float32Array(n)
  let k = 0
  for (let i = 0; i < n; i++) {
    const s = i * pas
    while (k < nd - 1 && cumul[k + 1] < s) k++
    const f = cumul[k + 1] > cumul[k] ? (s - cumul[k]) / (cumul[k + 1] - cumul[k]) : 0
    const a = k, b = (k + 1) % nd
    px[i] = dense[a * 2] + (dense[b * 2] - dense[a * 2]) * f
    pz[i] = dense[a * 2 + 1] + (dense[b * 2 + 1] - dense[a * 2 + 1]) * f
  }
  return { n, pas, longueur, px, pz }
}

/** Lissage circulaire par moyenne glissante (fenêtre de ±rayon échantillons). */
export function lisserCirculaire(source, rayon) {
  const n = source.length
  const sortie = new Float32Array(n)
  if (rayon <= 0) { sortie.set(source); return sortie }
  let somme = 0
  for (let k = -rayon; k <= rayon; k++) somme += source[((k % n) + n) % n]
  for (let i = 0; i < n; i++) {
    sortie[i] = somme / (2 * rayon + 1)
    somme += source[(i + rayon + 1) % n] - source[(i - rayon + n) % n]
  }
  return sortie
}

/** Minimum glissant circulaire (érosion) sur ±rayon échantillons. */
function minGlissant(source, rayon) {
  const n = source.length, sortie = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let m = Infinity
    for (let k = -rayon; k <= rayon; k++) { const v = source[(i + k + n) % n]; if (v < m) m = v }
    sortie[i] = m
  }
  return sortie
}

/** Dilatation d'un masque binaire circulaire sur ±rayon échantillons. */
function dilater(masque, rayon) {
  const n = masque.length, sortie = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!masque[i]) continue
    for (let k = -rayon; k <= rayon; k++) sortie[(i + k + n) % n] = 1
  }
  return sortie
}

// -----------------------------------------------------------------------------
// Index spatial : grille régulière d'échantillons (requêtes de voisinage O(1))
// -----------------------------------------------------------------------------
export class GrilleSpatiale {
  constructor(px, pz, taille = 40) {
    this.taille = taille
    this.px = px; this.pz = pz
    this.cases = new Map()
    for (let i = 0; i < px.length; i++) {
      const cle = this.cle(Math.floor(px[i] / taille), Math.floor(pz[i] / taille))
      let liste = this.cases.get(cle)
      if (!liste) { liste = []; this.cases.set(cle, liste) }
      liste.push(i)
    }
  }
  cle(cx, cz) { return cx * 73856093 ^ cz * 19349663 }
  /** Appelle `rappel(i, d2)` pour chaque échantillon à moins de `rayon` de (x, z). */
  voisins(x, z, rayon, rappel) {
    const t = this.taille, r2 = rayon * rayon
    const x0 = Math.floor((x - rayon) / t), x1 = Math.floor((x + rayon) / t)
    const z0 = Math.floor((z - rayon) / t), z1 = Math.floor((z + rayon) / t)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const liste = this.cases.get(this.cle(cx, cz))
        if (!liste) continue
        for (let k = 0; k < liste.length; k++) {
          const i = liste[k], dx = this.px[i] - x, dz = this.pz[i] - z
          const d2 = dx * dx + dz * dz
          if (d2 <= r2) rappel(i, d2)
        }
      }
    }
  }
  /** Échantillon le plus proche (recherche en anneaux croissants). */
  plusProche(x, z, rayonMax = 4000) {
    let meilleur = -1, d2min = Infinity
    for (let r = this.taille; r <= rayonMax * 2; r *= 2) {
      this.voisins(x, z, r, (i, d2) => { if (d2 < d2min) { d2min = d2; meilleur = i } })
      if (meilleur >= 0) break
    }
    return { indice: meilleur, distance: Math.sqrt(d2min) }
  }
}

// -----------------------------------------------------------------------------
// Relief
// -----------------------------------------------------------------------------
/** Profil d'altitude périodique : [[fraction du tour, hauteur], ...] lissé (cosinus). */
function altitudeProfil(points, u) {
  const n = points.length
  let i = 0
  while (i < n && points[i][0] <= u) i++
  const a = points[(i - 1 + n) % n], b = points[i % n]
  const ua = a[0] - (i === 0 ? 1 : 0), ub = b[0] + (i === n ? 1 : 0)
  const f = ub > ua ? (u - ua) / (ub - ua) : 0
  const lisse = (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, f)))) / 2
  return a[1] + (b[1] - a[1]) * lisse
}

function calculerAltitudes(c, altitude, rng) {
  const { n, pas, longueur } = c
  const py = new Float32Array(n)
  if (altitude && altitude.type === 'profil') {
    for (let i = 0; i < n; i++) py[i] = altitudeProfil(altitude.points, (i * pas) / longueur)
  } else {
    // Somme de sinusoïdes périodiques sur la longueur → boucle fermée.
    const amp = altitude && Number.isFinite(altitude.amplitude) ? altitude.amplitude : 8
    const a1 = amp * (0.62 + rng() * 0.35), a2 = amp * (0.3 + rng() * 0.25), a3 = amp * (0.12 + rng() * 0.15)
    const f1 = rng() * DEUX_PI, f2 = rng() * DEUX_PI, f3 = rng() * DEUX_PI
    for (let i = 0; i < n; i++) {
      const u = ((i * pas) / longueur) * DEUX_PI
      py[i] = a1 * Math.sin(u + f1) + a2 * Math.sin(2 * u + f2) + a3 * Math.sin(3 * u + f3)
    }
  }
  // Lissage (≈ gaussienne de 50 m) : pas de marche d'escalier entre deux points
  // du profil, raccordements verticaux réalistes (compressions, crêtes).
  const lisse = lisserCirculaire(lisserCirculaire(lisserCirculaire(py, 12), 12), 12)
  // L'altitude du départ est ramenée à 0 (référence du décor).
  const y0 = lisse[0]
  for (let i = 0; i < n; i++) lisse[i] -= y0
  return lisse
}

/**
 * Repère utilisé (Y vers le haut, comme Three.js) :
 *   T = tangente unitaire (sens de la course)
 *   N = normale unitaire HORIZONTALE pointant vers la GAUCHE de la piste
 *   B = T × N, binormale (≈ verticale, perpendiculaire au revêtement)
 * La normale de Frenet « pure » change de côté à chaque point d'inflexion ;
 * on la stabilise donc avec la verticale de référence (N = Y × T normalisé),
 * ce qui garantit un repère continu pour poser bordures, ligne et véhicules.
 */
function construireRepere(c) {
  const { n, pas, px, pz, py } = c
  const tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n)
  const nx = new Float32Array(n), nz = new Float32Array(n)
  const bx = new Float32Array(n), by = new Float32Array(n), bz = new Float32Array(n)
  const cap = new Float32Array(n), pente = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n
    const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a]
    const l3 = Math.hypot(dx, dy, dz), l2 = Math.hypot(dx, dz)
    tx[i] = dx / l3; ty[i] = dy / l3; tz[i] = dz / l3
    nx[i] = dz / l2; nz[i] = -dx / l2 // N = Y × T
    bx[i] = ty[i] * nz[i]             // B = T × N
    by[i] = tz[i] * nx[i] - tx[i] * nz[i]
    bz[i] = -ty[i] * nx[i]
    pente[i] = dy / l2
    cap[i] = Math.atan2(dx, dz) // même convention que le lacet : avant = (sin ψ, cos ψ)
  }
  // Courbure horizontale signée (> 0 : virage à gauche), base de ±3 échantillons.
  const k = 3, brute = new Float32Array(n)
  for (let i = 0; i < n; i++) brute[i] = normaliserAngle(cap[(i + k) % n] - cap[(i - k + n) % n]) / (2 * k * pas)
  // Courbure verticale (> 0 : creux / compression, < 0 : crête), base de ±5.
  const kv = 5, vert = new Float32Array(n)
  for (let i = 0; i < n; i++) vert[i] = (py[(i + kv) % n] - 2 * py[i] + py[(i - kv + n) % n]) / ((kv * pas) * (kv * pas))
  Object.assign(c, {
    tx, ty, tz, nx, nz, bx, by, bz, cap, pente,
    courbure: lisserCirculaire(brute, 2),
    courbureVerticale: lisserCirculaire(vert, 4)
  })
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------
/**
 * Renvoie la liste des problèmes du tracé (vide = utilisable) :
 *  - virage plus serré que la demi-largeur (le bord intérieur se replierait) ;
 *  - deux portions éloignées en abscisse qui se chevauchent dans le plan.
 * @param {object} exigences { rayonMin, separationMin } seuils (optionnels)
 */
export function problemesTrace(c, exigences = {}) {
  const { n, pas, px, pz, courbure, demiLargeur } = c
  const rayonMin = exigences.rayonMin ?? demiLargeur + 2.5
  const separation = exigences.separationMin ?? 2 * (demiLargeur + LARGEUR_VIBREUR + 1)
  const problemes = []
  // Rayon minimal : on signale le pire virage, une fois par zone.
  let i = 0
  while (i < n) {
    if (Math.abs(courbure[i]) > 1 / rayonMin) {
      let pire = i
      while (i < n && Math.abs(courbure[i]) > 1 / rayonMin) { if (Math.abs(courbure[i]) > Math.abs(courbure[pire])) pire = i; i++ }
      problemes.push({ type: 'rayon', indice: pire, x: px[pire], z: pz[pire], message: `Virage trop serré (rayon ${(1 / Math.abs(courbure[pire])).toFixed(0)} m)` })
    } else i++
  }
  // Chevauchements : voisins spatiaux éloignés le long du tracé.
  const ecartIndices = Math.ceil((separation * 2.2 + 20) / pas)
  const vus = new Set()
  for (let i = 0; i < n; i += 2) {
    let trouve = -1
    c.grille.voisins(px[i], pz[i], separation, (j) => {
      const di = Math.min(Math.abs(i - j), n - Math.abs(i - j))
      if (di > ecartIndices) trouve = j
    })
    if (trouve >= 0) {
      const zone = Math.floor(i / 40)
      if (!vus.has(zone)) {
        vus.add(zone)
        problemes.push({ type: 'croisement', indice: i, x: px[i], z: pz[i], message: 'Deux portions de piste se touchent ou se croisent' })
      }
    }
  }
  return problemes
}

// -----------------------------------------------------------------------------
// Habillage : barrières, dégagements, vibreurs
// -----------------------------------------------------------------------------
function calculerHabillage(c, urbain) {
  const { n, pas, px, pz, nx, nz, courbure, demiLargeur } = c
  const kLarge = lisserCirculaire(lisserCirculaire(courbure, 10), 10) // courbure sur ~80 m
  const limMin = demiLargeur + LARGEUR_VIBREUR + 0.4
  const lim = [new Float32Array(n), new Float32Array(n)] // [gauche, droite]
  for (let cote = 0; cote < 2; cote++) {
    const s = cote === 0 ? 1 : -1
    for (let i = 0; i < n; i++) {
      let l
      if (urbain) l = demiLargeur + 1.6
      else {
        // Dégagement de base, élargi à l'extérieur des virages rapides.
        const ext = -kLarge[i] * s // > 0 : ce côté est l'extérieur du virage
        l = demiLargeur + 8 + (ext > 0 ? Math.min(26, ext * 2600) : 0)
      }
      // Côté intérieur d'un virage serré : la bande ne doit pas se replier.
      const k = courbure[i] * s
      if (k > 1e-4) l = Math.min(l, 0.85 / k)
      // Portion de piste voisine de ce côté : on partage l'espace.
      c.grille.voisins(px[i], pz[i], 90, (j) => {
        const di = Math.min(Math.abs(i - j), n - Math.abs(i - j))
        if (di * pas < 120) return
        const dx = px[j] - px[i], dz = pz[j] - pz[i]
        const lateral = (dx * nx[i] + dz * nz[i]) * s
        const long = Math.abs(dx * -nz[i] + dz * nx[i])
        if (lateral > 0 && long < 30) l = Math.min(l, lateral / 2 - 0.3)
      })
      lim[cote][i] = Math.max(limMin, l)
    }
    // Barrière régulière : érosion puis moyenne glissante (pas de dents de scie).
    lim[cote] = lisserCirculaire(minGlissant(lim[cote], 6), 6)
    for (let i = 0; i < n; i++) lim[cote][i] = Math.max(limMin, lim[cote][i])
  }
  // Surfaces et vibreurs.
  const surf = [new Uint8Array(n), new Uint8Array(n)]
  const vib = [new Uint8Array(n), new Uint8Array(n)]
  const kMoyen = lisserCirculaire(courbure, 4)
  for (let cote = 0; cote < 2; cote++) {
    const s = cote === 0 ? 1 : -1
    const interieur = new Uint8Array(n), exterieur = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const k = kMoyen[i] * s
      if (k > 1 / 240) interieur[i] = 1
      // Extérieur, en sortie de virage (courbure qui décroît).
      const suivant = Math.abs(kMoyen[(i + 6) % n])
      if (k < -1 / 170 && suivant < Math.abs(kMoyen[i])) exterieur[i] = 1
      if (urbain) surf[cote][i] = SURFACE.ASPHALTE
      else {
        const ext = -kLarge[i] * s
        if (ext > 1 / 260) {
          // Vitesse de passage estimée : bac à graviers dans les virages rapides,
          // dégagement asphalté (moderne) dans les virages lents.
          const v = Math.sqrt(11 / Math.max(Math.abs(kLarge[i]), 1e-4))
          surf[cote][i] = v > 42 ? SURFACE.GRAVIER : SURFACE.ASPHALTE
        } else surf[cote][i] = SURFACE.HERBE
      }
    }
    const v = dilater(interieur, 6), e = dilater(exterieur, 8)
    for (let i = 0; i < n; i++) vib[cote][i] = v[i] || e[i] ? 1 : 0
    // Nettoyage : pas de zones de moins de 30 m (on prolonge la précédente).
    const minRun = Math.round(30 / pas)
    let debut = 0
    for (let i = 1; i <= n; i++) {
      if (i === n || surf[cote][i] !== surf[cote][debut]) {
        if (i - debut < minRun && debut > 0) for (let k = debut; k < i; k++) surf[cote][k] = surf[cote][debut - 1]
        debut = i
      }
    }
  }
  Object.assign(c, { limG: lim[0], limD: lim[1], surfG: surf[0], surfD: surf[1], vibG: vib[0], vibD: vib[1] })
}

// -----------------------------------------------------------------------------
// Trajectoire de course à courbure minimale
// -----------------------------------------------------------------------------
/**
 * Méthode de l'« élastique » : chaque point de la trajectoire est attiré vers
 * le milieu de ses voisins (ce qui réduit la courbure), dans la limite de la
 * largeur de piste. Les voisinages larges dessinent les grandes lignes
 * (extérieur – corde – extérieur), les petits affinent.
 */
function calculerTrajectoire(c) {
  const { n, pas, px, pz, nx, nz, demiLargeur } = c
  // Marge latérale : demi-largeur de voiture + 15 cm ; là où un vibreur existe,
  // les pilotes y posent deux roues (point de corde, sortie) : ~1 m de mieux.
  // Le vibreur doit couvrir toute la voiture (±6 échantillons ≈ ±12 m) pour
  // être utilisé : la roue extérieure reste alors sur le vibreur (dl + 0,45 m).
  const vibreurPlein = (masque, i) => {
    for (let k = -6; k <= 6; k++) if (!masque[(i + k + n) % n]) return false
    return true
  }
  const margeG = new Float32Array(n), margeD = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    margeG[i] = vibreurPlein(c.vibG, i) ? demiLargeur - 0.6 : demiLargeur - 1.15
    margeD[i] = vibreurPlein(c.vibD, i) ? demiLargeur - 0.6 : demiLargeur - 1.15
  }
  const o = new Float32Array(n)
  const X = new Float32Array(n), Z = new Float32Array(n)
  for (const [k, iterations] of [[24, 60], [14, 60], [8, 60], [4, 40]]) {
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) { X[i] = px[i] + nx[i] * o[i]; Z[i] = pz[i] + nz[i] * o[i] }
      for (let i = 0; i < n; i++) {
        const a = (i - k + n) % n, b = (i + k) % n
        const mx = (X[a] + X[b]) / 2 - px[i], mz = (Z[a] + Z[b]) / 2 - pz[i]
        const vise = mx * nx[i] + mz * nz[i]
        o[i] += 0.55 * (vise - o[i])
        if (o[i] > margeG[i]) o[i] = margeG[i]
        else if (o[i] < -margeD[i]) o[i] = -margeD[i]
      }
    }
  }
  // Lissage final (une voiture ne suit pas de cassure à l'échelle du mètre),
  // sans sortir des limites.
  const ligne = lisserCirculaire(lisserCirculaire(o, 3), 3)
  for (let i = 0; i < n; i++) ligne[i] = Math.max(-margeD[i], Math.min(margeG[i], ligne[i]))
  // Courbure et pas de la trajectoire (pour le profil de vitesse des IA),
  // mesurée sur une corde de ~24 m.
  const kr = new Float32Array(n), dsr = new Float32Array(n)
  for (let i = 0; i < n; i++) { X[i] = px[i] + nx[i] * ligne[i]; Z[i] = pz[i] + nz[i] * ligne[i] }
  for (let i = 0; i < n; i++) {
    const a = (i - 6 + n) % n, b = (i + 6) % n, j = (i + 1) % n
    const capA = Math.atan2(X[i] - X[a], Z[i] - Z[a]), capB = Math.atan2(X[b] - X[i], Z[b] - Z[i])
    const l = Math.hypot(X[b] - X[i], Z[b] - Z[i]) + Math.hypot(X[i] - X[a], Z[i] - Z[a])
    kr[i] = normaliserAngle(capB - capA) / Math.max(l / 2, 1e-3)
    dsr[i] = Math.hypot(X[j] - X[i], Z[j] - Z[i])
  }
  const capLigne = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n
    capLigne[i] = Math.atan2(X[b] - X[a], Z[b] - Z[a])
  }
  c.ligneIdeale = ligne
  c.margeG = margeG; c.margeD = margeD
  c.capLigne = capLigne
  c.courbureLigne = lisserCirculaire(kr, 2)
  c.pasLigne = dsr
}

// -----------------------------------------------------------------------------
// Constructeur principal
// -----------------------------------------------------------------------------
/**
 * Construit un circuit complet.
 * @param {object} def
 * @param {number[][]} def.points  points de passage [[x, z], ...] (boucle fermée)
 * @param {number} [def.demiLargeur]
 * @param {object} [def.altitude]  { type: 'profil', points } | { type: 'sinus', amplitude }
 * @param {boolean} [def.urbain]   murs au ras de la piste (tracé en ville)
 * @param {number} [def.lissage]   lissage des positions (données réelles), en échantillons
 * @param {number} [def.seed]      graine du relief et du décor
 * @param {object} [def.exigences] seuils de validation (voir problemesTrace)
 * @param {boolean} [def.tolerant] ne lève pas d'erreur : renvoie aussi les problèmes
 */
export function construireCircuit(def) {
  const seed = (def.seed ?? 1) >>> 0
  const rng = creerRng((seed ^ 0x2545f491) >>> 0)
  const c = echantillonnerSpline(def.points)
  if (def.lissage > 0) {
    // Données réelles : on gomme le bruit de numérisation sans écraser les épingles.
    for (let passe = 0; passe < 2; passe++) {
      const lx = lisserCirculaire(c.px, def.lissage), lz = lisserCirculaire(c.pz, def.lissage)
      const re = []
      for (let i = 0; i < c.n; i++) re.push(lx[i], lz[i])
      Object.assign(c, reechantillonner(re, PAS_CIBLE))
    }
  }
  Object.assign(c, {
    seed, id: def.id ?? `seed-${seed}`, nom: def.nom ?? `Circuit #${seed}`,
    demiLargeur: def.demiLargeur ?? DEMI_LARGEUR, urbain: !!def.urbain,
    paysage: def.paysage ?? 'plaine', source: def.source ?? 'procedural'
  })
  c.py = calculerAltitudes(c, def.altitude, rng)
  construireRepere(c)
  c.grille = new GrilleSpatiale(c.px, c.pz, 40)
  c.problemes = problemesTrace(c, def.exigences)
  if (c.problemes.length && !def.tolerant) throw new CircuitInvalide(c.problemes)
  calculerHabillage(c, c.urbain)
  calculerTrajectoire(c)
  // Boîte englobante (mini-carte, terrain).
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < c.n; i++) {
    if (c.px[i] < minX) minX = c.px[i]
    if (c.px[i] > maxX) maxX = c.px[i]
    if (c.pz[i] < minZ) minZ = c.pz[i]
    if (c.pz[i] > maxZ) maxZ = c.pz[i]
    if (c.py[i] < minY) minY = c.py[i]
    if (c.py[i] > maxY) maxY = c.py[i]
  }
  c.bornes = { minX, maxX, minZ, maxZ, minY, maxY }
  c.profils = new Map() // profils de vitesse par type de voiture (voir ia.js)
  return c
}

// -----------------------------------------------------------------------------
// Circuits procéduraux
// -----------------------------------------------------------------------------
/** Points de contrôle : angles croissants (polygone étoilé) et rayon variable. */
function tirerPointsDeControle(rng, tentative) {
  const nb = 8 + Math.floor(rng() * 5) // 8 à 12 points de contrôle
  const rayonBase = 185 + tentative * 2.5 // on « aère » le tracé si on retente
  // L'amplitude des variations se resserre au fil des tentatives : la
  // dernière tentative est un cercle parfait, donc toujours valide.
  const amplitude = Math.max(0, 1 - tentative / 60)
  const phase = rng() * DEUX_PI
  const points = []
  for (let i = 0; i < nb; i++) {
    const angle = ((i + (rng() - 0.5) * 0.6 * amplitude) / nb) * DEUX_PI
    const harmonique = 0.12 * Math.sin(2 * angle + phase)
    const rayon = rayonBase * (1 + ((rng() - 0.5) * 0.62 + harmonique) * amplitude)
    points.push([Math.cos(angle) * rayon, Math.sin(angle) * rayon])
  }
  if (rng() < 0.5) points.reverse() // sens de rotation aléatoire
  return points
}

/**
 * Génère un circuit procédural valide à partir d'une seed. En cas d'échec de
 * validation, on retente avec une sous-seed dérivée : le résultat reste
 * entièrement déterministe pour une seed donnée.
 */
export function genererCircuit(seed) {
  const MAX_TENTATIVES = 60
  for (let tentative = 0; tentative <= MAX_TENTATIVES; tentative++) {
    const rng = creerRng((seed ^ Math.imul(tentative, 0x9e3779b9)) >>> 0)
    const points = tirerPointsDeControle(rng, tentative)
    const paysages = ['foret', 'plaine', 'foret', 'dunes']
    const c = construireCircuit({
      points, seed, tolerant: true, paysage: paysages[seed % paysages.length],
      altitude: { type: 'sinus', amplitude: 7 + rng() * 5 },
      // Exigences plus strictes qu'un tracé réel : virages et dégagements généreux.
      exigences: { rayonMin: 20, separationMin: 2 * (DEMI_LARGEUR + 14) }
    })
    c.tentative = tentative
    c.pointsControle = points
    if (c.problemes.length === 0 || tentative === MAX_TENTATIVES) return c
  }
  throw new Error('Génération de circuit impossible') // inatteignable (cercle final)
}

// -----------------------------------------------------------------------------
// Projection d'un point sur la spline.
// -----------------------------------------------------------------------------
/**
 * Projection LOCALE : cherche l'échantillon le plus proche dans une fenêtre
 * autour de `indice` (la position précédente), puis affine le long de la
 * tangente. Écrit dans `sortie` : idx, s (abscisse curviligne), d (écart
 * latéral signé, > 0 à gauche). Aucune allocation.
 * La recherche locale interdit aussi les « sauts » d'une portion de piste à
 * une autre : la progression ne peut évoluer que continûment.
 */
export function projeterLocal(c, x, z, indice, sortie) {
  const { n, px, pz, nx, nz, pas } = c
  let meilleur = indice, d2min = Infinity
  for (let k = -8; k <= 12; k++) {
    const i = (indice + k + n) % n
    const dx = x - px[i], dz = z - pz[i]
    const d2 = dx * dx + dz * dz
    if (d2 < d2min) { d2min = d2; meilleur = i }
  }
  const dx = x - px[meilleur], dz = z - pz[meilleur]
  // Tangente horizontale unitaire déduite de N : (−nz, nx).
  const lelong = -dx * nz[meilleur] + dz * nx[meilleur]
  let s = meilleur * pas + lelong
  if (s < 0) s += c.longueur
  else if (s >= c.longueur) s -= c.longueur
  sortie.idx = meilleur
  sortie.s = s
  sortie.d = dx * nx[meilleur] + dz * nz[meilleur]
  sortie.lelong = lelong
  return sortie
}

/** Projection GLOBALE (index spatial) : utilisée hors boucle de jeu. */
export function projeterGlobal(c, x, z, sortie) {
  const { indice } = c.grille.plusProche(x, z)
  return projeterLocal(c, x, z, Math.max(0, indice), sortie)
}

/** Indice d'échantillon correspondant à une abscisse curviligne quelconque. */
export function indiceDepuisAbscisse(c, s) {
  const i = Math.floor(s / c.pas) % c.n
  return i < 0 ? i + c.n : i
}
