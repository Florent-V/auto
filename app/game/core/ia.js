// =============================================================================
// MODULE : Pilotes IA
// -----------------------------------------------------------------------------
// Chaque IA :
//  1. connaît sa projection sur la spline (idx, s, d) ;
//  2. vise un point situé quelques mètres devant elle sur la trajectoire de
//     course (courbure minimale, calculée par le circuit), décalée selon son
//     style et les manœuvres d'évitement (« pure pursuit ») ;
//  3. règle gaz / frein pour suivre un PROFIL DE VITESSE propre à sa voiture,
//     calculé à partir de la physique : adhérence, appui aérodynamique,
//     relief (compressions / crêtes), traînée, freins et pente ;
//  4. évite les autres véhicules (dépassement par le côté libre, sinon elle
//     cale sa vitesse sur le véhicule qui la précède).
// Le même contrôleur sert de pilote automatique au joueur (mode démo).
// =============================================================================
import { normaliserAngle } from './circuit.js'
import { RHO, G } from './modeles.js'
import { braquageMax, placerSurCircuit } from './vehicule.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/**
 * Profil de vitesse « limite » d'une voiture sur un circuit (m/s, par échantillon).
 *
 *  Virage : v²·κ ≤ μ·(g + k·v² + κv·v²), avec k = ½ρ·SCz/m (appui) et κv la
 *  courbure verticale ; d'où v² = μg / (κ − μ(k + κv)) si le dénominateur est
 *  positif, sinon la seule limite est la vitesse de pointe.
 *  Freinage (passe arrière) : décélération μ(g + k·v²) + traînée − pente.
 *  Calculé une fois par (circuit, voiture) puis mis en cache.
 */
export function profilVitesse(c, spec) {
  if (c.profils.has(spec.nom)) return c.profils.get(spec.nom)
  const n = c.n
  const k = (0.5 * RHO * spec.aero.SCz) / spec.masse
  const kx = (0.5 * RHO * spec.aero.SCx) / spec.masse
  // Marge de sécurité : sensibilité à la charge, transferts, dérive du pic.
  const mu = spec.pneus.mu * 0.87
  const muFrein = spec.pneus.mu * 0.84
  const vPointe = 0.97 * Math.cbrt((spec.moteur.puissanceMax * spec.boite.rendement) / (0.5 * RHO * spec.aero.SCx))
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const kappa = Math.abs(c.courbureLigne[i])
    const den = kappa - mu * (k + c.courbureVerticale[i])
    v[i] = den > 1e-6 ? Math.min(vPointe, Math.sqrt((mu * G) / den)) : vPointe
  }
  // Passe arrière (deux tours : le circuit est une boucle). Diagramme g-g :
  // la décélération disponible est ce qui reste du cercle d'adhérence une fois
  // l'accélération latérale du virage servie (a_long² + a_lat² ≤ a_max²).
  for (let passe = 0; passe < 2; passe++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n, vs = v[j]
      const aMax = muFrein * (G + (k + Math.max(0, c.courbureVerticale[i])) * vs * vs)
      const aLat = vs * vs * Math.abs(c.courbureLigne[i])
      const freinPneus = Math.sqrt(Math.max(0, aMax * aMax - aLat * aLat))
      const decel = freinPneus + kx * vs * vs + G * c.pente[i]
      v[i] = Math.min(v[i], Math.sqrt(vs * vs + 2 * Math.max(1.5, decel) * c.pasLigne[i]))
    }
  }
  v.vPointe = vPointe
  c.profils.set(spec.nom, v)
  return v
}

/**
 * Calcule les commandes (gaz, frein, direction) d'un véhicule piloté par IA.
 * @param {number} plafondVitesse limite globale (ex. tour d'honneur)
 */
export function piloterIA(v, vehicules, c, dt, plafondVitesse) {
  const ia = v.ia, spec = v.spec
  const vitesse = Math.max(v.vx, 0)
  const n = c.n
  // Limites latérales : les vibreurs ne sont exploitables que là où la
  // trajectoire de course les prévoit ; ailleurs on reste sur l'asphalte.
  const latMax = c.demiLargeur - 1.2
  const profil = profilVitesse(c, spec)

  // --- 1. Décalage latéral visé ---------------------------------------------
  const iLigne = (v.idx + 4) % n
  // Style personnel : léger décalage, réduit là où la trajectoire frôle un bord.
  const ligne = c.ligneIdeale[iLigne]
  let latCible = clamp(ligne + ia.decalagePerso, Math.min(ligne, -latMax), Math.max(ligne, latMax))
  let limiteVitesse = plafondVitesse
  let enDuel = false

  // --- 2. Évitement des autres véhicules ------------------------------------
  const horizon = 8 + vitesse * 0.75
  const decalage = Math.min(3.1, c.demiLargeur * 0.6)
  for (let k = 0; k < vehicules.length; k++) {
    const o = vehicules[k]
    if (o === v) continue
    let ds = o.s - v.s
    if (ds > c.longueur / 2) ds -= c.longueur
    else if (ds < -c.longueur / 2) ds += c.longueur
    if (ds < -5.2 || ds > horizon) continue
    const dl = o.d - v.d
    if (ds > 4.4) {
      // Véhicule devant, plus lent, sur notre trajectoire : on déboîte.
      if (Math.abs(o.d - latCible) < 2.9 && o.vx < vitesse + 2) {
        const cote = Math.abs(dl) > 0.9 ? (dl > 0 ? -1 : 1) : (o.d > 0 ? -1 : 1)
        let candidat = clamp(o.d + cote * decalage, -latMax, latMax)
        if (Math.abs(candidat - o.d) < 2.4) {
          candidat = clamp(o.d - cote * decalage, -latMax, latMax)
          if (Math.abs(candidat - o.d) < 2.4 || Math.abs(dl) < 2.2) {
            limiteVitesse = Math.min(limiteVitesse, Math.max(o.vx, 4) + (ds - 8) * 0.6)
          }
        }
        latCible = candidat
      }
    } else if (Math.abs(dl) < 3.0) {
      // Côte à côte : on garde un espace latéral, et en courbe le pilote qui
      // n'est pas devant lève un peu le pied plutôt que de pousser l'autre dehors.
      latCible = clamp(latCible + (dl > 0 ? -1 : 1) * (3.0 - Math.abs(dl)) * 0.8, -latMax, latMax)
      if (ds < 0.5 && Math.abs(c.courbureLigne[v.idx]) > 1 / 300) enDuel = true
    }
  }
  // Jamais au-delà des marges du point (vibreur compris s'il est prévu).
  latCible = clamp(latCible, -c.margeD[iLigne], c.margeG[iLigne])
  // Le décalage évolue à vitesse limitée → pas de coup de volant brutal.
  ia.lat += clamp(latCible - ia.lat, -4 * dt, 4 * dt)

  // --- 3. Direction : contrôleur de Stanley + anticipation de courbure --------
  //  δ = atan(L·κ) [courbure de la trajectoire un peu devant]
  //    + écart de cap (cap de la trajectoire − lacet)
  //    + atan(k·e / v) [ramène sur la trajectoire, e = écart latéral]
  const ahead = (v.idx + Math.round((3 + vitesse * 0.08) / c.pas)) % n
  const kappa = c.courbureLigne[ahead]
  const ecartCap = normaliserAngle(c.capLigne[v.idx] - v.lacet)
  const ecartLat = ia.lat - v.d
  const deltaVise = Math.atan(spec.empattement * kappa) + ecartCap + Math.atan((1.6 * ecartLat) / (vitesse + 3))
  v.cmdDir = clamp(deltaVise / braquageMax(spec, vitesse), -1, 1)

  // --- 4. Vitesse : profil physique, avec anticipation du freinage ----------
  const avance = Math.round((vitesse * 0.12) / c.pas)
  const brut = Math.min(profil[(v.idx + 1 + avance) % n], profil[(v.idx + 1) % n] * 1.02)
  // Le niveau du pilote joue sur la vitesse de passage et le freinage, pas sur
  // la pointe : en ligne droite, tout le monde est à fond.
  let cible = brut >= profil.vPointe * 0.995 ? Infinity : brut * ia.niveau
  cible = Math.min(cible, limiteVitesse)
  // Hors trajectoire (dépassement, évitement) : marge de sécurité en virage.
  const horsLigne = Math.min(1, Math.abs(v.d - c.ligneIdeale[v.idx]) / 4)
  cible *= 1 - 0.06 * horsLigne * Math.min(1, Math.abs(c.courbureLigne[v.idx]) * 150)
  if (enDuel) cible *= 0.96
  if (v.horsPiste > 0.4) cible = Math.min(cible, 22)
  ia.vitesseCible = cible
  const erreur = cible - v.vx
  v.cmdGaz = clamp(erreur * 0.5, 0, 1)
  v.cmdFrein = erreur < -0.6 ? clamp(-erreur * 0.35, 0, 1) : 0
  v.cmdFam = false

  // --- 5. Filet de sécurité : remise en piste si bloquée ou à contresens ----
  const erreurCap = Math.abs(normaliserAngle(v.lacet - c.cap[v.idx]))
  if ((v.vx < 2 && cible > 5) || erreurCap > 1.9) ia.bloque += dt
  else ia.bloque = Math.max(0, ia.bloque - dt * 2)
  if (ia.bloque > 2) {
    const progression = v.progression
    placerSurCircuit(v, c, v.s, clamp(v.d, -latMax, latMax), 8)
    v.progression = progression
    ia.bloque = 0
    ia.lat = v.d
  }
}
