// =============================================================================
// MODULE : Pilotes IA
// -----------------------------------------------------------------------------
// Chaque IA :
//  1. connaît sa projection sur la spline (idx, s, d) ;
//  2. vise un point situé quelques mètres devant elle sur la trajectoire
//     (« pure pursuit »), décalé latéralement selon la ligne idéale, son style
//     personnel et les manœuvres d'évitement ;
//  3. règle gaz / frein pour suivre le profil de vitesse du circuit, pondéré
//     par son niveau (chaque IA a une vitesse de référence différente) ;
//  4. évite les autres véhicules (dépassement par le côté libre, sinon elle
//     cale sa vitesse sur le véhicule qui la précède).
// Le même contrôleur sert de pilote automatique au joueur (mode démo).
// =============================================================================
import { DEMI_LARGEUR, normaliserAngle } from './circuit.js'
import { EMPATTEMENT, braquageMax, placerSurCircuit } from './vehicule.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const LAT_MAX = DEMI_LARGEUR - 1.4

/**
 * Calcule les commandes (gaz, frein, direction) d'un véhicule piloté par IA.
 * @param {number} plafondVitesse limite globale (ex. tour de décélération)
 */
export function piloterIA(v, vehicules, c, dt, plafondVitesse) {
  const ia = v.ia
  const vitesse = Math.max(v.vx, 0)
  const n = c.n

  // --- 1. Décalage latéral visé ---------------------------------------------
  const iLigne = (v.idx + 6) % n
  let latCible = clamp(c.ligneIdeale[iLigne] + ia.decalagePerso, -LAT_MAX, LAT_MAX)
  let limiteVitesse = plafondVitesse

  // --- 2. Évitement des autres véhicules ------------------------------------
  const horizon = 7 + vitesse * 0.7
  for (let k = 0; k < vehicules.length; k++) {
    const o = vehicules[k]
    if (o === v) continue
    let ds = o.s - v.s
    if (ds > c.longueur / 2) ds -= c.longueur
    else if (ds < -c.longueur / 2) ds += c.longueur
    if (ds < -4.6 || ds > horizon) continue
    const dl = o.d - v.d
    if (ds > 3.6) {
      // Véhicule devant, plus lent, sur notre trajectoire : on déboîte.
      if (Math.abs(o.d - latCible) < 2.9 && o.vx < vitesse + 2) {
        // Côté choisi : celui où l'on est déjà engagé, sinon le plus dégagé.
        const cote = Math.abs(dl) > 0.9 ? (dl > 0 ? -1 : 1) : (o.d > 0 ? -1 : 1)
        let candidat = clamp(o.d + cote * 3.1, -LAT_MAX, LAT_MAX)
        if (Math.abs(candidat - o.d) < 2.4) {
          // Pas la place de ce côté : on essaie l'autre, sinon on temporise.
          candidat = clamp(o.d - cote * 3.1, -LAT_MAX, LAT_MAX)
          if (Math.abs(candidat - o.d) < 2.4 || Math.abs(dl) < 2.2) {
            limiteVitesse = Math.min(limiteVitesse, Math.max(o.vx, 4) + (ds - 7) * 0.6)
          }
        }
        latCible = candidat
      }
    } else if (Math.abs(dl) < 3.0) {
      // Côte à côte : répulsion latérale simple.
      latCible = clamp(latCible + (dl > 0 ? -1 : 1) * (3.0 - Math.abs(dl)) * 1.2, -LAT_MAX, LAT_MAX)
    }
  }
  // Le décalage évolue à vitesse limitée → pas de coup de volant brutal.
  ia.lat += clamp(latCible - ia.lat, -4 * dt, 4 * dt)

  // --- 3. Direction : poursuite d'un point situé devant ---------------------
  const distVisee = 7 + vitesse * 0.42
  const j = (v.idx + Math.round(distVisee / c.pas)) % n
  const cibleX = c.px[j] + c.nx[j] * ia.lat
  const cibleZ = c.pz[j] + c.nz[j] * ia.lat
  const dx = cibleX - v.x, dz = cibleZ - v.z
  const sinL = Math.sin(v.lacet), cosL = Math.cos(v.lacet)
  const devant = dx * sinL + dz * cosL
  const cote = dx * cosL - dz * sinL
  const braquage = Math.atan2(2 * EMPATTEMENT * cote, devant * devant + cote * cote)
  v.cmdDir = clamp(braquage / braquageMax(vitesse), -1, 1)

  // --- 4. Vitesse : profil du circuit pondéré par le niveau -----------------
  let cible = Math.min(c.vitesseProfil[(v.idx + 3) % n] * ia.niveau, ia.vitesseRef, limiteVitesse)
  // Hors trajectoire (dépassement, évitement) : marge de sécurité en virage.
  const horsLigne = Math.min(1, Math.abs(v.d - c.ligneIdeale[v.idx]) / 4)
  if (cible < 55) cible *= 1 - 0.07 * horsLigne
  if (v.horsPiste > 0.5) cible = Math.min(cible, 24)
  ia.vitesseCible = cible
  const erreur = cible - v.vx
  v.cmdGaz = clamp(erreur * 0.6, 0, 1)
  v.cmdFrein = erreur < -1.2 ? clamp(-erreur * 0.3, 0, 1) : 0
  v.cmdFam = false

  // --- 5. Filet de sécurité : remise en piste si bloquée ou à contresens ----
  const erreurCap = Math.abs(normaliserAngle(v.lacet - c.cap[v.idx]))
  if ((v.vx < 2 && cible > 5) || erreurCap > 1.9) ia.bloque += dt
  else ia.bloque = Math.max(0, ia.bloque - dt * 2)
  if (ia.bloque > 2) {
    const progression = v.progression
    placerSurCircuit(v, c, v.s, clamp(v.d, -LAT_MAX, LAT_MAX), 8)
    v.progression = progression
    ia.bloque = 0
    ia.lat = v.d
  }
}
