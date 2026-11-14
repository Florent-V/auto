// =============================================================================
// MODULE : Circuit procédural
// -----------------------------------------------------------------------------
// 1. Points de contrôle aléatoires répartis autour d'un cercle (rayon variable).
// 2. Spline de Catmull-Rom centripète FERMÉE passant par ces points.
// 3. Ré-échantillonnage à pas constant en abscisse curviligne (≈ 2 m).
// 4. Repère de Frenet (T, N, B) en chaque échantillon + courbure signée.
// 5. Validation géométrique (rayon mini, absence d'auto-intersection) ; en cas
//    d'échec on retente avec une sous-seed dérivée : le résultat reste
//    entièrement déterministe pour une seed donnée.
// 6. Pré-calculs pour l'IA : profil de vitesse et trajectoire « idéale ».
//
// Ce module ne dépend PAS de Three.js : il est testable sous Node.
// =============================================================================
import { creerRng } from './rng.js'

/** Demi-largeur de la piste (largeur constante = 13 m). */
export const DEMI_LARGEUR = 6.5
/** Largeur du vibreur posé à cheval sur le bord de piste. */
export const LARGEUR_VIBREUR = 1.0
/** Distance latérale des barrières : au-delà, le véhicule est repoussé. */
export const LIMITE_LATERALE = 15
/** Pas d'échantillonnage visé le long de la spline (mètres). */
const PAS_CIBLE = 2
/** Rayon de courbure minimal accepté (doit dépasser LIMITE_LATERALE). */
const RAYON_MIN = 23
/** Écart minimal entre deux portions distinctes du tracé. */
const SEPARATION_MIN = 2 * LIMITE_LATERALE + 5

const DEUX_PI = Math.PI * 2

/** Ramène un angle dans ]-π, π]. */
export function normaliserAngle(a) {
  while (a > Math.PI) a -= DEUX_PI
  while (a <= -Math.PI) a += DEUX_PI
  return a
}

// -----------------------------------------------------------------------------
// Spline de Catmull-Rom centripète (formulation de Barry-Goldman), en 2D.
// La paramétrisation centripète (alpha = 0,5) évite boucles et points de
// rebroussement que produit la version uniforme quand les points sont irréguliers.
// -----------------------------------------------------------------------------
function catmullRomCentripete(p0, p1, p2, p3, u, sortie) {
  const t0 = 0
  const t1 = t0 + Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]))
  const t2 = t1 + Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]))
  const t3 = t2 + Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]))
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
    // Variation de rayon : bruit par point + une harmonique lente qui donne au
    // circuit une forme générale moins circulaire.
    const harmonique = 0.12 * Math.sin(2 * angle + phase)
    const rayon = rayonBase * (1 + ((rng() - 0.5) * 0.62 + harmonique) * amplitude)
    points.push([Math.cos(angle) * rayon, Math.sin(angle) * rayon])
  }
  if (rng() < 0.5) points.reverse() // sens de rotation aléatoire
  return points
}

/** Échantillonne densément la spline fermée puis ré-échantillonne à pas constant. */
function echantillonnerSpline(points) {
  const nb = points.length
  const SUBDIV = 48
  const dense = new Float64Array(nb * SUBDIV * 2)
  const tmp = [0, 0]
  for (let i = 0; i < nb; i++) {
    const p0 = points[(i - 1 + nb) % nb], p1 = points[i]
    const p2 = points[(i + 1) % nb], p3 = points[(i + 2) % nb]
    for (let j = 0; j < SUBDIV; j++) {
      catmullRomCentripete(p0, p1, p2, p3, j / SUBDIV, tmp)
      dense[(i * SUBDIV + j) * 2] = tmp[0]
      dense[(i * SUBDIV + j) * 2 + 1] = tmp[1]
    }
  }
  // Longueurs cumulées de la polyligne dense (fermée).
  const nd = nb * SUBDIV
  const cumul = new Float64Array(nd + 1)
  for (let i = 0; i < nd; i++) {
    const j = (i + 1) % nd
    cumul[i + 1] = cumul[i] + Math.hypot(dense[j * 2] - dense[i * 2], dense[j * 2 + 1] - dense[i * 2 + 1])
  }
  const longueur = cumul[nd]
  const n = Math.round(longueur / PAS_CIBLE)
  const pas = longueur / n
  const px = new Float32Array(n), pz = new Float32Array(n)
  let k = 0
  for (let i = 0; i < n; i++) {
    const s = i * pas
    while (cumul[k + 1] < s) k++
    const f = (s - cumul[k]) / (cumul[k + 1] - cumul[k])
    const a = k, b = (k + 1) % nd
    px[i] = dense[a * 2] + (dense[b * 2] - dense[a * 2]) * f
    pz[i] = dense[a * 2 + 1] + (dense[b * 2 + 1] - dense[a * 2 + 1]) * f
  }
  return { n, pas, longueur, px, pz }
}

/**
 * Vérifie que le tracé est exploitable :
 *  - rayon de courbure partout supérieur à RAYON_MIN (les bandes décalées
 *    jusqu'aux barrières ne se replient donc jamais sur elles-mêmes) ;
 *  - deux portions éloignées en abscisse curviligne restent éloignées dans le
 *    plan : ni la piste ni ses dégagements ne peuvent se croiser.
 */
function validerTrace(c) {
  const { n, pas, px, pz, courbure } = c
  for (let i = 0; i < n; i++) if (Math.abs(courbure[i]) > 1 / RAYON_MIN) return false
  const ecartIndices = Math.ceil(85 / pas)
  const d2min = SEPARATION_MIN * SEPARATION_MIN
  for (let i = 0; i < n; i += 2) {
    for (let j = i + ecartIndices; j < n; j += 2) {
      if (n - j + i < ecartIndices) break // voisins « par l'autre côté » de la boucle
      const dx = px[i] - px[j], dz = pz[i] - pz[j]
      if (dx * dx + dz * dz < d2min) return false
    }
  }
  return true
}

/** Lissage circulaire par moyenne glissante (fenêtre de ±rayon échantillons). */
function lisserCirculaire(source, rayon) {
  const n = source.length
  const sortie = new Float32Array(n)
  let somme = 0
  for (let k = -rayon; k <= rayon; k++) somme += source[(k + n) % n]
  for (let i = 0; i < n; i++) {
    sortie[i] = somme / (2 * rayon + 1)
    somme += source[(i + rayon + 1) % n] - source[(i - rayon + n) % n]
  }
  return sortie
}

/**
 * Construit toutes les données dérivées d'un tracé plan : relief, repère de
 * Frenet, courbure, pente.
 *
 * Repère utilisé (Y vers le haut, comme Three.js) :
 *   T = tangente unitaire (sens de la course)
 *   N = normale unitaire HORIZONTALE pointant vers la GAUCHE de la piste
 *   B = T × N, binormale (≈ verticale, perpendiculaire au revêtement)
 * La normale de Frenet « pure » change de côté à chaque point d'inflexion ;
 * on la stabilise donc avec la verticale de référence (N = Y × T normalisé),
 * ce qui garantit un repère continu pour poser bordures, ligne et véhicules.
 */
function construireRepere(c, rng) {
  const { n, pas, px, pz, longueur } = c
  const py = new Float32Array(n), pente = new Float32Array(n)
  // Relief : somme de sinusoïdes périodiques sur la longueur → boucle fermée.
  const a1 = 5 + rng() * 3, a2 = 2.5 + rng() * 2, a3 = 1 + rng() * 1.2
  const f1 = rng() * DEUX_PI, f2 = rng() * DEUX_PI, f3 = rng() * DEUX_PI
  for (let i = 0; i < n; i++) {
    const u = (i * pas / longueur) * DEUX_PI
    py[i] = a1 * Math.sin(u + f1) + a2 * Math.sin(2 * u + f2) + a3 * Math.sin(3 * u + f3)
  }
  const tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n)
  const nx = new Float32Array(n), nz = new Float32Array(n)
  const bx = new Float32Array(n), by = new Float32Array(n), bz = new Float32Array(n)
  const cap = new Float32Array(n), courbureBrute = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n
    const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a]
    const l3 = Math.hypot(dx, dy, dz), l2 = Math.hypot(dx, dz)
    tx[i] = dx / l3; ty[i] = dy / l3; tz[i] = dz / l3
    // N = Y × T, normalisé (composante verticale nulle).
    nx[i] = dz / l2; nz[i] = -dx / l2
    // B = T × N
    bx[i] = ty[i] * nz[i]
    by[i] = tz[i] * nx[i] - tx[i] * nz[i]
    bz[i] = -ty[i] * nx[i]
    pente[i] = dy / l2
    // Cap : même convention que le lacet des véhicules, avant = (sin ψ, cos ψ).
    cap[i] = Math.atan2(dx, dz)
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n
    courbureBrute[i] = normaliserAngle(cap[b] - cap[a]) / (2 * pas) // > 0 : virage à gauche
  }
  Object.assign(c, { py, pente, tx, ty, tz, nx, nz, bx, by, bz, cap, courbure: lisserCirculaire(courbureBrute, 1) })
}

/** Pré-calculs destinés aux pilotes IA. */
function calculerAidesIA(c) {
  const { n, pas, courbure } = c
  // Profil de vitesse : limite d'adhérence latérale en virage...
  const ACC_LAT = 9.6, DECEL = 9, V_MAX = 95
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) v[i] = Math.min(V_MAX, Math.sqrt(ACC_LAT / Math.max(Math.abs(courbure[i]), 1e-4)))
  // ... puis propagation arrière de la capacité de freinage (deux passes
  // car le circuit est une boucle).
  for (let passe = 0; passe < 2; passe++) {
    for (let i = n - 1; i >= 0; i--) {
      const suivant = v[(i + 1) % n]
      v[i] = Math.min(v[i], Math.sqrt(suivant * suivant + 2 * DECEL * pas))
    }
  }
  c.vitesseProfil = v
  // Trajectoire idéale simplifiée : on se décale vers l'intérieur des virages
  // proportionnellement à la courbure lissée sur une trentaine de mètres.
  const lisse = lisserCirculaire(lisserCirculaire(courbure, 8), 8)
  const ligne = new Float32Array(n)
  const maxi = DEMI_LARGEUR - 2.4
  for (let i = 0; i < n; i++) ligne[i] = Math.max(-maxi, Math.min(maxi, lisse[i] * 130))
  c.ligneIdeale = ligne
}

/**
 * Point d'entrée : génère un circuit complet et valide à partir d'une seed.
 * @param {number} seed entier 32 bits non signé
 */
export function genererCircuit(seed) {
  const MAX_TENTATIVES = 60
  for (let tentative = 0; tentative <= MAX_TENTATIVES; tentative++) {
    // Sous-seed dérivée de façon déterministe (constante du nombre d'or).
    const rng = creerRng((seed ^ Math.imul(tentative, 0x9e3779b9)) >>> 0)
    const points = tirerPointsDeControle(rng, tentative)
    const c = echantillonnerSpline(points)
    c.seed = seed
    c.tentative = tentative
    c.pointsControle = points
    construireRepere(c, rng)
    if (tentative < MAX_TENTATIVES && !validerTrace(c)) continue
    calculerAidesIA(c)
    // Boîte englobante (mini-carte, terrain).
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < c.n; i++) {
      if (c.px[i] < minX) minX = c.px[i]
      if (c.px[i] > maxX) maxX = c.px[i]
      if (c.pz[i] < minZ) minZ = c.pz[i]
      if (c.pz[i] > maxZ) maxZ = c.pz[i]
    }
    c.bornes = { minX, maxX, minZ, maxZ }
    return c
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

/** Projection GLOBALE (recherche exhaustive) : utilisée hors boucle de jeu. */
export function projeterGlobal(c, x, z, sortie) {
  let meilleur = 0, d2min = Infinity
  for (let i = 0; i < c.n; i++) {
    const dx = x - c.px[i], dz = z - c.pz[i]
    const d2 = dx * dx + dz * dz
    if (d2 < d2min) { d2min = d2; meilleur = i }
  }
  return projeterLocal(c, x, z, meilleur, sortie)
}

/** Indice d'échantillon correspondant à une abscisse curviligne quelconque. */
export function indiceDepuisAbscisse(c, s) {
  const i = Math.floor(s / c.pas) % c.n
  return i < 0 ? i + c.n : i
}
