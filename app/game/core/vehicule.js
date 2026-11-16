// =============================================================================
// MODULE : Physique du véhicule — modèle bicyclette dynamique
// -----------------------------------------------------------------------------
// Les deux roues de chaque essieu sont fusionnées en une roue virtuelle (avant
// directrice, arrière motrice). État : position (x, z), lacet ψ, vitesses dans
// le repère du véhicule (vx longitudinale, vy latérale vers la gauche) et
// vitesse de lacet r.
//
// Conventions : avant = (sin ψ, cos ψ) dans le plan (x, z) ; gauche = (cos ψ,
// −sin ψ) ; ψ croissant = rotation vers la gauche ; braquage > 0 = à gauche.
//
// Les efforts latéraux des pneus suivent une « formule magique » de Pacejka
// simplifiée en fonction de l'angle de dérive : ils saturent puis décroissent
// légèrement, ce qui produit naturellement sous-virage, survirage et dérapages.
// À très basse vitesse le modèle dynamique devient raide ; on le fond donc
// progressivement dans un modèle cinématique (r = vx·tan δ / L).
//
// Aucune allocation : la fonction `pasVehicule` ne manipule que des nombres.
// =============================================================================
import { DEMI_LARGEUR, LIMITE_LATERALE, projeterLocal, projeterGlobal, normaliserAngle } from './circuit.js'

// --- Constantes physiques ----------------------------------------------------
export const MASSE = 1200          // kg
const INERTIE_LACET = 1700         // kg·m²
const DIST_AV = 1.25               // centre de gravité → essieu avant (m)
const DIST_AR = 1.35               // centre de gravité → essieu arrière (m)
export const EMPATTEMENT = DIST_AV + DIST_AR
const G = 9.81
const CHARGE_AV = MASSE * G * DIST_AR / EMPATTEMENT
const CHARGE_AR = MASSE * G * DIST_AV / EMPATTEMENT

export const MU_PISTE = 1.25       // adhérence sur asphalte
export const MU_HERBE = 0.6        // adhérence hors piste (herbe / gravier)
const PUISSANCE = 205000           // W
const FORCE_MOTRICE_MAX = 10500    // N (limite de couple à basse vitesse)
const FORCE_FREIN = 15500          // N
const FORCE_MARCHE_AR = 4500       // N
const VITESSE_MARCHE_AR = 11       // m/s
const C_AERO = 0.5                 // traînée : F = C·v²
const SURVIRAGE = 0.13             // perte d'adhérence arrière à haute vitesse
const ADH_AVANT = 0.9              // train avant un peu moins mordant : sous-vireur à basse vitesse
const VITESSE_REF_SURVIRAGE = 70   // m/s
const BRAQUAGE_MAX = 0.55          // rad
const TAUX_BRAQUAGE = 2.4          // rad/s : vitesse de braquage limitée
const TAUX_RAPPEL = 4.0            // rad/s : retour au centre plus rapide
const DERIVE_COMMANDEE = 0.11      // rad : dérive avant demandée à haute vitesse
const STABILITE_MARGE = 1.3        // tolérance sur la vitesse de lacet soutenable
const STABILITE_GAIN = 9           // 1/s : raideur du contrôle de stabilité
const CHASSE = 1.0                 // auto-alignement des roues avant sur la vitesse

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/** Courbe de Pacejka simplifiée, normalisée dans [-1, 1]. */
function pacejka(derive) {
  return Math.sin(1.4 * Math.atan(9 * derive))
}

/**
 * Amplitude maximale de la commande de direction en fonction de la vitesse :
 * grand angle à basse vitesse (épingles), puis on tend vers l'angle de dérive
 * qui exploite le pic d'adhérence du train avant.
 */
export function braquageMax(vitesse) {
  return Math.min(BRAQUAGE_MAX, DERIVE_COMMANDEE + (MU_PISTE * G * EMPATTEMENT) / (vitesse * vitesse + 1))
}

/** Crée un véhicule (joueur ou IA). Toutes les propriétés sont pré-déclarées. */
export function creerVehicule(id, nom, couleur, estJoueur) {
  return {
    id, nom, couleur, estJoueur,
    // --- Apparence (sans effet sur la physique) ---
    accent: 0xffffff, modele: 'hypercar',
    // --- État physique ---
    x: 0, y: 0, z: 0, lacet: 0,
    vx: 0, vy: 0, r: 0, braquage: 0, angleRoues: 0,
    // --- État précédent (interpolation du rendu entre deux pas fixes) ---
    xPrec: 0, yPrec: 0, zPrec: 0, lacetPrec: 0,
    // --- Commandes (remplies par le clavier ou par l'IA) ---
    cmdGaz: 0, cmdFrein: 0, cmdDir: 0, cmdFam: false,
    // --- Réglages individuels ---
    puissance: 1,          // facteur de puissance moteur
    assistance: !estJoueur, // les IA n'ont pas de survirage (pilotage plus sûr)
    // --- Position sur le circuit ---
    idx: 0, s: 0, d: 0, progression: 0, horsPiste: 0,
    tourMax: -1,           // nb de passages de ligne − 1 (= tours bouclés)
    tempsDebutTour: 0, dernierTour: 0, meilleurTour: Infinity,
    fini: false, tempsFin: 0,
    // --- Retours pour effets visuels / sonores ---
    glisse: 0, roueAngle: 0, choc: 0, contactMur: 0,
    // --- État du pilote IA ---
    ia: { niveau: 1, vitesseRef: 60, decalagePerso: 0, lat: 0, bloque: 0, vitesseCible: 0 }
  }
}

const _proj = { idx: 0, s: 0, d: 0, lelong: 0 }

/** Pose un véhicule sur le circuit à l'abscisse s et l'écart latéral d, à l'arrêt. */
export function placerSurCircuit(v, c, s, d, vitesse = 0) {
  const sMod = ((s % c.longueur) + c.longueur) % c.longueur
  const i = Math.floor(sMod / c.pas) % c.n
  const reste = sMod - i * c.pas
  v.x = c.px[i] - c.nz[i] * reste + c.nx[i] * d
  v.z = c.pz[i] + c.nx[i] * reste + c.nz[i] * d
  v.lacet = c.cap[i]
  v.vx = vitesse; v.vy = 0; v.r = 0; v.braquage = 0
  projeterGlobal(c, v.x, v.z, _proj)
  v.idx = _proj.idx; v.s = _proj.s; v.d = _proj.d
  v.y = c.py[v.idx] + c.pente[v.idx] * _proj.lelong
  v.xPrec = v.x; v.yPrec = v.y; v.zPrec = v.z; v.lacetPrec = v.lacet
  v.glisse = 0; v.horsPiste = 0
}

/**
 * Avance la simulation d'un véhicule d'un pas de temps fixe `dt`.
 */
export function pasVehicule(v, c, dt) {
  v.xPrec = v.x; v.yPrec = v.y; v.zPrec = v.z; v.lacetPrec = v.lacet

  const sinL = Math.sin(v.lacet), cosL = Math.cos(v.lacet)
  const vAbs = Math.abs(v.vx)

  // --- 1. Surface : transition douce piste → herbe au-delà du vibreur -------
  const hors = clamp((Math.abs(v.d) - DEMI_LARGEUR - 0.6) / 1.2, 0, 1)
  v.horsPiste = hors
  const mu = MU_PISTE + (MU_HERBE - MU_PISTE) * hors

  // --- 2. Direction : vitesse de braquage limitée ---------------------------
  const cible = clamp(v.cmdDir, -1, 1) * braquageMax(vAbs)
  const ecart = cible - v.braquage
  const rappel = Math.abs(cible) < Math.abs(v.braquage) || cible * v.braquage < 0
  const tauxMax = (rappel ? TAUX_RAPPEL : TAUX_BRAQUAGE) * dt
  v.braquage += clamp(ecart, -tauxMax, tauxMax)
  // Poids du modèle dynamique : 0 sous 2 m/s (et en marche arrière), 1 dès 6 m/s.
  const w = clamp((v.vx - 2) / 4, 0, 1)
  const vxDerive = Math.max(vAbs, 3)
  // Angle de la vitesse au niveau de l'essieu avant.
  const angleVitesseAv = Math.atan2(v.vy + DIST_AV * v.r, vxDerive)
  // Effet de chasse (joueur) : les roues avant s'alignent en partie sur la
  // direction réelle du déplacement. En glisse, cela produit un contre-braquage
  // naturel : le survirage reste rattrapable au clavier.
  let delta = v.braquage
  if (!v.assistance) delta = clamp(delta + CHASSE * w * angleVitesseAv, -BRAQUAGE_MAX, BRAQUAGE_MAX)
  v.angleRoues = delta

  // --- 3. Efforts longitudinaux ---------------------------------------------
  let fx = 0
  if (v.cmdGaz > 0) fx += v.cmdGaz * Math.min(FORCE_MOTRICE_MAX, (PUISSANCE * v.puissance) / Math.max(vAbs, 5))
  if (v.cmdFrein > 0) {
    if (v.vx > 1) fx -= v.cmdFrein * FORCE_FREIN
    else if (v.vx > -VITESSE_MARCHE_AR) fx -= v.cmdFrein * FORCE_MARCHE_AR // marche arrière
  }
  // Limite de motricité / freinage imposée par la surface.
  const fxLimite = mu * MASSE * G * 0.95
  fx = clamp(fx, -fxLimite, fxLimite)
  const tauxMotricite = fx > 0 ? fx / (mu * CHARGE_AR * 2) : 0
  // Frein à main : bloque partiellement l'arrière.
  const sensVx = clamp(v.vx * 4, -1, 1)
  if (v.cmdFam) fx -= sensVx * mu * CHARGE_AR * 0.55
  // Traînée aérodynamique, résistance au roulement, enlisement hors piste, pente.
  fx -= C_AERO * v.vx * vAbs
  fx -= sensVx * MASSE * (0.18 + hors * (4.5 + 0.08 * vAbs))
  const alignement = -sinL * c.nz[v.idx] + cosL * c.nx[v.idx] // avant · tangente
  fx -= MASSE * G * c.pente[v.idx] * alignement

  // --- 4. Efforts latéraux (pneus) ------------------------------------------
  const deriveAv = delta - angleVitesseAv
  const deriveAr = -Math.atan2(v.vy - DIST_AR * v.r, vxDerive)
  let adhAr = 1
  if (v.assistance) {
    adhAr = 1.06
  } else {
    // Léger survirage à haute vitesse : l'arrière perd un peu d'adhérence.
    const rapport = Math.min(1, vAbs / VITESSE_REF_SURVIRAGE)
    adhAr = 1 - SURVIRAGE * rapport * rapport
    // Cercle de friction simplifié : accélérer fort réduit le grip latéral arrière.
    adhAr *= Math.sqrt(1 - 0.3 * tauxMotricite * tauxMotricite)
  }
  if (v.cmdFam) adhAr *= 0.42
  const fyAv = mu * CHARGE_AV * (v.assistance ? 1 : ADH_AVANT) * pacejka(deriveAv)
  const fyAr = mu * CHARGE_AR * adhAr * pacejka(deriveAr)

  // --- 5. Intégration (Euler semi-implicite) --------------------------------
  const cosD = Math.cos(delta), sinD = Math.sin(delta)
  const ax = (fx - fyAv * sinD) / MASSE + v.vy * v.r
  const ay = (fyAv * cosD + fyAr) / MASSE - v.vx * v.r
  let ar = (DIST_AV * fyAv * cosD - DIST_AR * fyAr) / INERTIE_LACET
  // Contrôle de stabilité (joueur) : on amortit la vitesse de lacet qui dépasse
  // ce que l'adhérence permet de soutenir (≈ μ·g / v). Les glissades restent
  // possibles mais ne dégénèrent pas en tête-à-queue ; le frein à main le coupe.
  if (!v.assistance && !v.cmdFam) {
    const lacetMax = (STABILITE_MARGE * mu * G) / Math.max(vAbs, 8)
    if (v.r > lacetMax) ar -= STABILITE_GAIN * (v.r - lacetMax)
    else if (v.r < -lacetMax) ar -= STABILITE_GAIN * (v.r + lacetMax)
  }
  const relax = Math.min(1, 10 * dt)
  v.vx += ax * dt
  v.vy += w * ay * dt - (1 - w) * v.vy * relax
  v.r += w * ar * dt + (1 - w) * ((v.vx * Math.tan(delta)) / EMPATTEMENT - v.r) * relax
  if (v.cmdGaz === 0 && v.cmdFrein === 0 && Math.abs(v.vx) < 0.25) v.vx = 0
  v.lacet = normaliserAngle(v.lacet + v.r * dt)
  // Le lacet précédent doit rester « proche » pour l'interpolation du rendu.
  if (v.lacet - v.lacetPrec > Math.PI) v.lacetPrec += 2 * Math.PI
  else if (v.lacet - v.lacetPrec < -Math.PI) v.lacetPrec -= 2 * Math.PI
  v.x += (v.vx * sinL + v.vy * cosL) * dt
  v.z += (v.vx * cosL - v.vy * sinL) * dt

  // Indicateur de glisse (fumée, crissements, traces).
  const deriveMax = Math.max(Math.abs(deriveAr), Math.abs(deriveAv) * 0.8)
  const glisseCible = vAbs > 6 ? clamp((deriveMax - 0.11) / 0.22, 0, 1) : 0
  v.glisse += (glisseCible - v.glisse) * Math.min(1, 12 * dt)
  v.roueAngle += v.vx * dt / 0.34

  synchroniserAvecCircuit(v, c)
}

/**
 * Re-projette le véhicule sur la spline : met à jour idx / s / d, la
 * progression cumulée (signée), l'altitude, et applique les barrières.
 */
export function synchroniserAvecCircuit(v, c) {
  const sAvant = v.s
  projeterLocal(c, v.x, v.z, v.idx, _proj)

  // --- Barrières : on ne quitte jamais le couloir |d| ≤ LIMITE_LATERALE ------
  v.contactMur *= 0.9
  if (Math.abs(_proj.d) > LIMITE_LATERALE) {
    const cote = _proj.d > 0 ? 1 : -1
    const i = _proj.idx
    const depassement = Math.abs(_proj.d) - LIMITE_LATERALE
    v.x -= c.nx[i] * cote * depassement
    v.z -= c.nz[i] * cote * depassement
    // Vitesse monde → composante sortante le long de N, que l'on réfléchit.
    const sinL = Math.sin(v.lacet), cosL = Math.cos(v.lacet)
    let mvx = v.vx * sinL + v.vy * cosL
    let mvz = v.vx * cosL - v.vy * sinL
    const vn = (mvx * c.nx[i] + mvz * c.nz[i]) * cote
    if (vn > 0) {
      mvx -= 1.25 * vn * c.nx[i] * cote
      mvz -= 1.25 * vn * c.nz[i] * cote
      const frottement = 1 - Math.min(0.25, vn * 0.02)
      v.vx = (mvx * sinL + mvz * cosL) * frottement
      v.vy = (mvx * cosL - mvz * sinL) * frottement
      v.contactMur = Math.min(1, v.contactMur + vn * 0.15)
    }
    projeterLocal(c, v.x, v.z, i, _proj)
  }

  v.idx = _proj.idx; v.d = _proj.d; v.s = _proj.s
  // Variation d'abscisse ramenée dans [-L/2, L/2] : progression signée, qui
  // recule si l'on roule à contresens.
  let ds = v.s - sAvant
  if (ds > c.longueur / 2) ds -= c.longueur
  else if (ds < -c.longueur / 2) ds += c.longueur
  v.progression += ds
  v.y = c.py[v.idx] + c.pente[v.idx] * _proj.lelong
}
