// =============================================================================
// MODULE : Physique du véhicule
// -----------------------------------------------------------------------------
// Modèle « bicyclette » dynamique enrichi (voir docs/PHYSIQUE.md) :
//
//  - État : position (x, z), lacet ψ, vitesses dans le repère du véhicule
//    (vx longitudinale, vy latérale vers la gauche), vitesse de lacet r,
//    rapport engagé et régime moteur.
//  - Charges verticales recalculées à chaque sous-pas : poids (pente
//    comprise), appui aérodynamique (∝ v²) réparti par l'équilibre aéro,
//    accélération verticale due au relief (compressions / crêtes : v²·κv),
//    transfert longitudinal (m·ax·h/L) et transfert latéral par essieu
//    (m·ay·h/voie, réparti selon les barres antiroulis).
//  - Pneus : chaque roue offre μ(Fz)·Fz, avec sensibilité à la charge (μ
//    baisse quand la charge monte) et μ de la surface sous CETTE roue (piste,
//    vibreur, herbe, gravier, dégagement). Un transfert de charge réduit donc
//    l'adhérence totale de l'essieu : c'est ce qui règle sous/survirage.
//  - Adhérence combinée (ellipse de frottement) : l'effort longitudinal
//    (moteur, freins) consomme l'adhérence disponible pour le latéral. Au-delà
//    de la limite, la roue patine ou se bloque et l'adhérence chute (μ de
//    glissement) : survirage de puissance, sous-virage au blocage.
//  - Effort latéral : « formule magique » de Pacejka simplifiée en fonction
//    de l'angle de dérive de l'essieu.
//  - Moteur (courbe de puissance réaliste), boîte à rapports (auto/manuelle,
//    temps de passage = coupure de couple), frein moteur, rupteur,
//    traînée aérodynamique, résistance au roulement et des surfaces.
//  - Aides désactivables : ABS, antipatinage, contrôle de stabilité, aide au
//    contre-braquage (clavier).
//
// Conventions : avant = (sin ψ, cos ψ) dans le plan (x, z) ; gauche =
// (cos ψ, −sin ψ) ; ψ croissant = rotation vers la gauche ; braquage > 0 = à
// gauche. Intégration semi-implicite en 4 sous-pas par pas de simulation
// (480 Hz) : nécessaire avec des pneus aussi raides que des slicks de F1.
// Aucune allocation : les fonctions ne manipulent que des nombres.
// =============================================================================
import { LARGEUR_VIBREUR, SURFACE, projeterLocal, projeterGlobal, normaliserAngle } from './circuit.js'
import { SPECS, RHO, G, coupleMoteur } from './modeles.js'

/** Surface au contact d'une roue. */
export const CONTACT = Object.freeze({ PISTE: 0, VIBREUR: 1, HERBE: 2, GRAVIER: 3, DEGAGEMENT: 4 })
/** Coefficient appliqué au μ du pneu selon la surface. */
const MU_SURFACE = [1, 0.93, 0.55, 0.5, 0.92]
/** Résistance additionnelle : fraction de la charge de la roue... */
const RESISTANCE_SURFACE = [0, 0.004, 0.08, 0.42, 0.006]
/** ... plus un terme proportionnel à la vitesse (enlisement), par m/s. */
const RESISTANCE_VITESSE = [0, 0, 0.003, 0.012, 0]

const SOUS_PAS = 4
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/** Surface sous un point situé à l'écart latéral d de l'axe, à l'échantillon idx. */
export function contactEn(c, idx, d) {
  const dl = c.demiLargeur, a = Math.abs(d), gauche = d > 0
  if (a <= dl - 0.15) return CONTACT.PISTE
  if ((gauche ? c.vibG[idx] : c.vibD[idx]) && a <= dl - 0.15 + LARGEUR_VIBREUR) return CONTACT.VIBREUR
  if (a <= dl + 0.3) return CONTACT.PISTE // ligne blanche de bord de piste
  const s = gauche ? c.surfG[idx] : c.surfD[idx]
  return s === SURFACE.HERBE ? CONTACT.HERBE : s === SURFACE.GRAVIER ? CONTACT.GRAVIER : CONTACT.DEGAGEMENT
}

/** Courbe de Pacejka simplifiée, normalisée dans [-1, 1]. */
function pacejka(derive, rigidite, forme) {
  return Math.sin(forme * Math.atan(rigidite * derive))
}

/** Capacité d'adhérence d'une roue (N), sensibilité à la charge comprise. */
function capaciteRoue(spec, fz, muSurface) {
  const p = spec.pneus
  const facteur = clamp(1 - p.sensibilite * (fz / spec.chargeNominale - 1), 0.55, 1.15)
  return p.mu * muSurface * facteur * fz
}

/** Accélération latérale soutenable (m/s²) à vitesse v, sur piste sèche. */
export function accelerationLaterale(spec, v) {
  return spec.pneus.mu * 0.92 * (G + (0.5 * RHO * spec.aero.SCz * v * v) / spec.masse)
}

/**
 * Angle de braquage maximal utile en fonction de la vitesse : au clavier (tout
 * ou rien) on demande un peu plus que l'adhérence disponible, jamais plus.
 * L'appui aérodynamique augmente le virage possible à haute vitesse.
 */
export function braquageMax(spec, vitesse) {
  const anglePic = 2.08 / spec.pneus.rigidite // dérive du pic d'effort
  const v2 = vitesse * vitesse + 1
  return Math.min(spec.direction.angleMax, anglePic * 0.85 + (spec.empattement * accelerationLaterale(spec, vitesse) * 1.08) / v2)
}

/** Crée un véhicule (joueur ou IA). Toutes les propriétés sont pré-déclarées. */
export function creerVehicule(id, nom, couleur, estJoueur, modele = 'hypercar') {
  return {
    id, nom, couleur, estJoueur,
    // --- Apparence et caractéristiques ---
    accent: 0xffffff, modele, spec: SPECS[modele] ?? SPECS.hypercar,
    // --- État physique ---
    x: 0, y: 0, z: 0, lacet: 0,
    vx: 0, vy: 0, r: 0, braquage: 0, angleRoues: 0,
    // --- Transmission ---
    rapport: 1, regime: 0, passage: 0, boiteAuto: true, demandePassage: 0, tempsArret: 0,
    // --- État précédent (interpolation du rendu entre deux pas fixes) ---
    xPrec: 0, yPrec: 0, zPrec: 0, lacetPrec: 0,
    // --- Commandes (clavier, manette ou IA), dans [0, 1] / [-1, 1] ---
    cmdGaz: 0, cmdFrein: 0, cmdDir: 0, cmdFam: false,
    // --- Aides au pilotage ---
    aides: { abs: true, antipatinage: true, stabilite: 2, contreBraquage: true },
    // --- Position sur le circuit ---
    idx: 0, s: 0, d: 0, progression: 0, horsPiste: 0,
    tourMax: -1,
    tempsDebutTour: 0, dernierTour: 0, meilleurTour: Infinity,
    fini: false, tempsFin: 0,
    // --- Télémétrie (HUD, sons, effets) ---
    axF: 0, ayF: 0, ax: 0, ay: 0, appui: 0, chargeAv: 0, chargeAr: 0,
    usageAv: 0, usageAr: 0, fyAv: 0, fyAr: 0, patinage: 0, blocage: 0, vibration: 0, absActif: 0, tcActif: 0,
    contacts: new Uint8Array(4),
    glisse: 0, roueAngle: 0, choc: 0, contactMur: 0,
    // --- État du pilote IA ---
    ia: { niveau: 1, decalagePerso: 0, lat: 0, bloque: 0, vitesseCible: 0 }
  }
}

/** Change le modèle physique d'un véhicule (choix du joueur). */
export function definirModele(v, modele) {
  v.modele = modele
  v.spec = SPECS[modele] ?? SPECS.hypercar
}

const _proj = { idx: 0, s: 0, d: 0, lelong: 0 }

/** Pose un véhicule sur le circuit à l'abscisse s et l'écart latéral d. */
export function placerSurCircuit(v, c, s, d, vitesse = 0) {
  const sMod = ((s % c.longueur) + c.longueur) % c.longueur
  const i = Math.floor(sMod / c.pas) % c.n
  const reste = sMod - i * c.pas
  v.x = c.px[i] - c.nz[i] * reste + c.nx[i] * d
  v.z = c.pz[i] + c.nx[i] * reste + c.nz[i] * d
  v.lacet = c.cap[i]
  v.vx = vitesse; v.vy = 0; v.r = 0; v.braquage = 0; v.angleRoues = 0
  v.rapport = 1; v.passage = 0; v.regime = v.spec.moteur.ralenti; v.demandePassage = 0; v.tempsArret = 0
  v.axF = 0; v.ayF = 0
  projeterGlobal(c, v.x, v.z, _proj)
  v.idx = _proj.idx; v.s = _proj.s; v.d = _proj.d
  v.y = c.py[v.idx] + c.pente[v.idx] * _proj.lelong
  v.xPrec = v.x; v.yPrec = v.y; v.zPrec = v.z; v.lacetPrec = v.lacet
  v.glisse = 0; v.horsPiste = 0
}

// -----------------------------------------------------------------------------
// Boîte de vitesses
// -----------------------------------------------------------------------------
function rapportTotal(spec, rapport) {
  if (rapport > 0) return spec.rapportsTotaux[rapport - 1]
  return -spec.boite.marcheArriere * spec.boite.pont
}

/** Régime imposé par les roues sur un rapport donné (tr/min). */
function regimeRoues(spec, vx, rapport) {
  return Math.abs(((vx / spec.rayonRoue) * rapportTotal(spec, rapport) * 30) / Math.PI)
}

function passer(v, nouveau) {
  v.rapport = nouveau
  v.passage = v.spec.boite.tempsPassage
}

/**
 * Choix du rapport. Automatique : on monte quand le rapport supérieur donne
 * plus de force à la roue (point de passage optimal) ou au rupteur ; on
 * descend quand le rapport inférieur en donne nettement plus, ou au freinage
 * tant que le régime reste sous le rupteur. Marche arrière : à l'arrêt, frein
 * maintenu 0,3 s.
 */
function gererBoite(v, dt) {
  const s = v.spec, nb = s.boite.rapports.length
  v.passage = Math.max(0, v.passage - dt)
  // Marche arrière / retour en première.
  if (v.rapport > 0 && v.vx < 0.6 && v.cmdFrein > 0.5 && v.cmdGaz < 0.1) {
    v.tempsArret += dt
    if (v.tempsArret > 0.3) { passer(v, -1); v.tempsArret = 0 }
  } else v.tempsArret = 0
  if (v.rapport < 0) {
    if (v.cmdGaz > 0.1 && v.vx > -0.6) passer(v, 1)
    return
  }
  if (v.passage > 0) return
  const r = regimeRoues(s, v.vx, v.rapport)
  if (!v.boiteAuto) {
    if (v.demandePassage > 0 && v.rapport < nb) passer(v, v.rapport + 1)
    else if (v.demandePassage < 0 && v.rapport > 1) {
      // Refus si le rapport inférieur ferait sur-régimer le moteur.
      if (regimeRoues(s, v.vx, v.rapport - 1) < s.moteur.regimeMax * 1.02) passer(v, v.rapport - 1)
    }
    v.demandePassage = 0
    return
  }
  v.demandePassage = 0
  const force = (rap, regime) => coupleMoteur(s, regime) * rapportTotal(s, rap)
  if (v.rapport < nb && v.cmdGaz > 0.2) {
    const rHaut = regimeRoues(s, v.vx, v.rapport + 1)
    if (r >= s.moteur.regimeMax * 0.99 || (r > s.moteur.regimePuissance * 0.8 && force(v.rapport + 1, rHaut) > force(v.rapport, r))) {
      passer(v, v.rapport + 1)
      return
    }
  }
  if (v.rapport > 1) {
    const rBas = regimeRoues(s, v.vx, v.rapport - 1)
    if (rBas < s.moteur.regimeMax * 0.92) {
      const freinage = v.cmdFrein > 0.2 && rBas < s.moteur.regimeMax * 0.82
      const plusFort = v.cmdGaz > 0.5 && force(v.rapport - 1, rBas) > force(v.rapport, r) * 1.12
      const sousRegime = r < s.moteur.ralenti * 1.8
      if (freinage || plusFort || sousRegime) passer(v, v.rapport - 1)
    }
  }
}

// -----------------------------------------------------------------------------
// Intégration
// -----------------------------------------------------------------------------
/** Avance la simulation d'un véhicule d'un pas de temps fixe `dt`. */
export function pasVehicule(v, c, dt) {
  v.xPrec = v.x; v.yPrec = v.y; v.zPrec = v.z; v.lacetPrec = v.lacet
  gererBoite(v, dt)
  const h = dt / SOUS_PAS
  v.vibration *= 0.85
  for (let k = 0; k < SOUS_PAS; k++) {
    integrer(v, c, h)
    synchroniserAvecCircuit(v, c)
  }
  // Le lacet précédent doit rester « proche » pour l'interpolation du rendu.
  if (v.lacet - v.lacetPrec > Math.PI) v.lacetPrec += 2 * Math.PI
  else if (v.lacet - v.lacetPrec < -Math.PI) v.lacetPrec -= 2 * Math.PI
  v.roueAngle += (v.vx * dt) / v.spec.rayonRoue
}

function integrer(v, c, h) {
  const s = v.spec, m = s.masse, L = s.empattement, a = s.distAv, b = s.distAr
  const i = v.idx
  const sinL = Math.sin(v.lacet), cosL = Math.cos(v.lacet)
  const vAbs = Math.abs(v.vx)
  const sensVx = clamp(v.vx * 4, -1, 1)

  // --- 1. Surfaces sous chaque roue (AV-G, AV-D, AR-G, AR-D) -----------------
  const ecartCap = Math.sin(v.lacet - c.cap[i])
  const demiVoie = s.voie / 2
  const dAv = v.d + a * ecartCap, dAr = v.d - b * ecartCap
  const iAv = (i + Math.round(a / c.pas)) % c.n
  const ct = v.contacts
  ct[0] = contactEn(c, iAv, dAv + demiVoie); ct[1] = contactEn(c, iAv, dAv - demiVoie)
  ct[2] = contactEn(c, i, dAr + demiVoie); ct[3] = contactEn(c, i, dAr - demiVoie)
  let horsPiste = 0, surVibreur = 0
  for (let k = 0; k < 4; k++) {
    if (ct[k] >= CONTACT.HERBE && ct[k] !== CONTACT.DEGAGEMENT) horsPiste += 0.25
    if (ct[k] === CONTACT.VIBREUR) surVibreur += 0.25
  }
  v.horsPiste = horsPiste
  if (surVibreur > 0) v.vibration = Math.max(v.vibration, surVibreur * Math.min(1, vAbs / 25))

  // --- 2. Charges verticales ---------------------------------------------------
  const q = 0.5 * RHO * v.vx * v.vx
  const appui = s.aero.SCz * q
  const pente = c.pente[i]
  const cosPente = 1 / Math.sqrt(1 + pente * pente)
  // Relief : en compression (κv > 0) la voiture est plaquée, sur une crête elle s'allège.
  const fzVertical = Math.max(0.08 * m * G, m * (G * cosPente + v.vx * v.vx * c.courbureVerticale[i]))
  const transfertLong = (m * v.axF * s.hauteurCG) / L
  const fzAv = Math.max(50, fzVertical * (b / L) + appui * s.aero.equilibreAv - transfertLong)
  const fzAr = Math.max(50, fzVertical * (a / L) + appui * (1 - s.aero.equilibreAv) + transfertLong)
  // Transfert latéral (ay > 0 : accélération vers la gauche → roues droites chargées).
  const transfertLat = (m * v.ayF * s.hauteurCG) / s.voie
  const tAv = transfertLat * s.antiroulisAv, tAr = transfertLat * (1 - s.antiroulisAv)
  const fzAvG = Math.max(0, fzAv / 2 - tAv), fzAvD = Math.max(0, fzAv / 2 + tAv)
  const fzArG = Math.max(0, fzAr / 2 - tAr), fzArD = Math.max(0, fzAr / 2 + tAr)
  const capAv = capaciteRoue(s, fzAvG, MU_SURFACE[ct[0]]) + capaciteRoue(s, fzAvD, MU_SURFACE[ct[1]])
  const capAr = capaciteRoue(s, fzArG, MU_SURFACE[ct[2]]) + capaciteRoue(s, fzArD, MU_SURFACE[ct[3]])
  v.appui = appui; v.chargeAv = fzAv; v.chargeAr = fzAr

  // --- 3. Direction : vitesse de braquage limitée ------------------------------
  const cible = clamp(v.cmdDir, -1, 1) * braquageMax(s, vAbs)
  const ecart = cible - v.braquage
  const rappel = Math.abs(cible) < Math.abs(v.braquage) || cible * v.braquage < 0
  const tauxMax = s.direction.vitesse * (rappel ? 1.6 : 1) * h
  v.braquage += clamp(ecart, -tauxMax, tauxMax)
  // Poids du modèle dynamique : 0 sous 2 m/s (et en marche arrière), 1 dès 6 m/s.
  const w = clamp((v.vx - 2) / 4, 0, 1)
  const vxDerive = Math.max(vAbs, 4)
  const angleVitesseAv = Math.atan2(v.vy + a * v.r, vxDerive)
  let delta = v.braquage
  // Aide au contre-braquage : les roues s'alignent en partie sur la trajectoire
  // réelle (effet de chasse). Le survirage reste rattrapable au clavier.
  if (v.aides.contreBraquage) delta = clamp(delta + w * angleVitesseAv, -s.direction.angleMax, s.direction.angleMax)
  v.angleRoues = delta

  // --- 4. Moteur, freins : efforts longitudinaux demandés ----------------------
  let gaz = v.cmdGaz, frein = v.cmdFrein
  if (v.rapport < 0) { gaz = v.cmdFrein; frein = v.cmdGaz } // marche arrière : rôles inversés
  const total = rapportTotal(s, v.rapport)
  const mo = s.moteur
  let regime = regimeRoues(s, v.vx, v.rapport)
  // Embrayage qui patine au démarrage : le moteur reste dans sa plage utile.
  if (Math.abs(v.rapport) === 1 && regime < mo.regimePuissance * 0.55) regime = Math.max(regime, mo.ralenti + (mo.regimePuissance * 0.55 - mo.ralenti) * gaz)
  regime = Math.max(mo.ralenti, regime)
  let couple = 0
  if (v.passage > 0 || regime >= mo.regimeMax) couple = 0 // passage de rapport ou rupteur
  else if (gaz > 0.02) couple = coupleMoteur(s, regime) * gaz
  else couple = -mo.frein * mo.coupleRef * (regime / mo.regimeMax) // frein moteur
  v.regime += (Math.min(regime, mo.regimeMax) - v.regime) * Math.min(1, 30 * h)
  let demandeAr = (couple * total * s.boite.rendement) / s.rayonRoue
  if (couple < 0) demandeAr = -Math.abs(demandeAr) * sensVx
  const forceFrein = frein * s.freins.forceMax
  let demandeAv = -sensVx * forceFrein * s.freins.repartitionAv
  demandeAr += -sensVx * forceFrein * (1 - s.freins.repartitionAv)
  // ABS (avec contrôle de freinage en courbe) : la demande de freinage ne
  // dépasse jamais l'adhérence encore disponible une fois l'effort latéral
  // en cours servi (ellipse de frottement) → pas de blocage, ni de perte du
  // train arrière en freinant dans un virage.
  let absActif = 0, tcActif = 0
  if (v.aides.abs && frein > 0) {
    const dispoAv = Math.sqrt(Math.max(0, capAv * capAv - v.fyAv * v.fyAv * 0.9)) * 0.97
    const dispoAr = Math.sqrt(Math.max(0, capAr * capAr - v.fyAr * v.fyAr * 0.95)) * 0.95
    if (Math.abs(demandeAv) > dispoAv) { demandeAv = Math.sign(demandeAv) * dispoAv; absActif = 1 }
    if (demandeAr * sensVx < 0 && Math.abs(demandeAr) > dispoAr) { demandeAr = Math.sign(demandeAr) * dispoAr; absActif = 1 }
  }
  // Antipatinage : la motricité laisse la place à l'effort latéral en cours.
  if (v.aides.antipatinage && demandeAr * sensVx > 0) {
    const dispo = Math.sqrt(Math.max(0, capAr * capAr - v.fyAr * v.fyAr)) * 0.95
    if (Math.abs(demandeAr) > dispo) { demandeAr = Math.sign(demandeAr) * dispo; tcActif = 1 }
  }
  v.absActif = absActif; v.tcActif = tcActif
  // Frein à main : bloque le train arrière.
  if (v.cmdFam) demandeAr += -sensVx * capAr * 1.6

  // --- 5. Pneus : ellipse de frottement + Pacejka --------------------------------
  const p = s.pneus
  const deriveAv = delta - angleVitesseAv
  const deriveAr = -Math.atan2(v.vy - b * v.r, vxDerive)
  let fxAv, latAv, fxAr, latAr, glisseAv = 0, glisseAr = 0
  if (Math.abs(demandeAv) <= capAv) { fxAv = demandeAv; latAv = Math.sqrt(capAv * capAv - fxAv * fxAv) }
  else { fxAv = Math.sign(demandeAv) * capAv * p.glissement; latAv = capAv * p.glissement * 0.3; glisseAv = 1 }
  if (Math.abs(demandeAr) <= capAr) { fxAr = demandeAr; latAr = Math.sqrt(capAr * capAr - fxAr * fxAr) }
  else { fxAr = Math.sign(demandeAr) * capAr * p.glissement; latAr = capAr * p.glissement * 0.35; glisseAr = 1 }
  // À l'arrêt, les freins immobilisent la voiture (pas d'oscillation).
  if (vAbs < 0.4 && frein > 0.05 && Math.abs(couple) < 1e-6) { fxAv = -v.vx * m * 4; fxAr = 0 }
  const fyAv = latAv * pacejka(deriveAv, p.rigidite, p.forme)
  const fyAr = latAr * pacejka(deriveAr, p.rigidite, p.forme)
  v.fyAv = fyAv; v.fyAr = fyAr
  v.patinage = glisseAr && demandeAr * sensVx > 0 ? 1 : 0
  v.blocage = (glisseAv && demandeAv * sensVx < 0) || (glisseAr && demandeAr * sensVx < 0) ? 1 : 0
  v.usageAv = capAv > 0 ? Math.sqrt(fxAv * fxAv + fyAv * fyAv) / capAv : 0
  v.usageAr = capAr > 0 ? Math.sqrt(fxAr * fxAr + fyAr * fyAr) / capAr : 0

  // --- 6. Résistances : air, roulement, surfaces, pente --------------------------
  let resistance = s.aero.SCx * q + s.roulement * (fzAv + fzAr)
  resistance += fzAvG * (RESISTANCE_SURFACE[ct[0]] + RESISTANCE_VITESSE[ct[0]] * vAbs)
  resistance += fzAvD * (RESISTANCE_SURFACE[ct[1]] + RESISTANCE_VITESSE[ct[1]] * vAbs)
  resistance += fzArG * (RESISTANCE_SURFACE[ct[2]] + RESISTANCE_VITESSE[ct[2]] * vAbs)
  resistance += fzArD * (RESISTANCE_SURFACE[ct[3]] + RESISTANCE_VITESSE[ct[3]] * vAbs)
  const alignement = -sinL * c.nz[i] + cosL * c.nx[i] // avant · tangente
  const gravite = -m * G * pente * cosPente * alignement

  // --- 7. Équations du mouvement --------------------------------------------------
  const cosD = Math.cos(delta), sinD = Math.sin(delta)
  const fx = fxAv * cosD - fyAv * sinD + fxAr - resistance * sensVx + gravite
  const fy = fxAv * sinD + fyAv * cosD + fyAr
  let mz = a * (fxAv * sinD + fyAv * cosD) - b * fyAr
  // Contrôle de stabilité : on amortit la vitesse de lacet qui dépasse ce que
  // l'adhérence permet de soutenir (≈ μ·g / v). Coupé par le frein à main.
  if (v.aides.stabilite > 0 && !v.cmdFam) {
    const lacetMax = (accelerationLaterale(s, vAbs) * (v.aides.stabilite === 2 ? 1.15 : 1.5)) / Math.max(vAbs, 8)
    const gain = (v.aides.stabilite === 2 ? 9 : 4) * s.inertieLacet
    if (v.r > lacetMax) mz -= gain * (v.r - lacetMax)
    else if (v.r < -lacetMax) mz -= gain * (v.r + lacetMax)
  }
  const axCorps = fx / m, ayCorps = fy / m
  const relax = Math.min(1, 10 * h)
  v.vx += (axCorps + v.vy * v.r) * h
  v.vy += w * (ayCorps - v.vx * v.r) * h - (1 - w) * v.vy * relax
  v.r += w * (mz / s.inertieLacet) * h + (1 - w) * ((v.vx * Math.tan(delta)) / L - v.r) * relax
  if (gaz < 0.02 && frein < 0.02 && vAbs < 0.15) v.vx = 0
  // Accélérations filtrées (suspensions) pour les transferts de charge.
  const filtre = Math.min(1, 18 * h)
  v.axF += (axCorps - v.axF) * filtre
  v.ayF += (ayCorps - v.ayF) * filtre
  v.ax = v.axF / G; v.ay = v.ayF / G

  v.lacet = normaliserAngle(v.lacet + v.r * h)
  v.x += (v.vx * sinL + v.vy * cosL) * h
  v.z += (v.vx * cosL - v.vy * sinL) * h

  // Indicateur de glisse (fumée, crissements, traces).
  const anglePic = 2.08 / p.rigidite
  const exces = Math.max(Math.abs(deriveAr), Math.abs(deriveAv) * 0.8) / anglePic
  let glisseCible = vAbs > 5 ? clamp((exces - 1.15) * 1.2, 0, 1) : 0
  if (glisseAv || glisseAr) glisseCible = Math.max(glisseCible, vAbs > 3 ? 0.9 : 0)
  v.glisse += (glisseCible - v.glisse) * Math.min(1, 12 * h)
}

/**
 * Re-projette le véhicule sur la spline : met à jour idx / s / d, la
 * progression cumulée (signée), l'altitude, et applique les barrières.
 */
export function synchroniserAvecCircuit(v, c) {
  const sAvant = v.s
  projeterLocal(c, v.x, v.z, v.idx, _proj)

  // --- Barrières : la carrosserie ne franchit jamais le mur de son côté --------
  v.contactMur *= 0.97
  const gauche = _proj.d > 0
  const limite = (gauche ? c.limG[_proj.idx] : c.limD[_proj.idx]) - v.spec.demiLargeurCaisse
  if (Math.abs(_proj.d) > limite) {
    const cote = gauche ? 1 : -1
    const i = _proj.idx
    const depassement = Math.abs(_proj.d) - limite
    v.x -= c.nx[i] * cote * depassement
    v.z -= c.nz[i] * cote * depassement
    // Vitesse monde → composante sortante le long de N, absorbée (restitution faible).
    const sinL = Math.sin(v.lacet), cosL = Math.cos(v.lacet)
    let mvx = v.vx * sinL + v.vy * cosL
    let mvz = v.vx * cosL - v.vy * sinL
    const vn = (mvx * c.nx[i] + mvz * c.nz[i]) * cote
    if (vn > 0) {
      mvx -= 1.2 * vn * c.nx[i] * cote
      mvz -= 1.2 * vn * c.nz[i] * cote
      // Frottement contre le mur : perte de vitesse tangentielle proportionnelle au choc.
      const frottement = 1 - Math.min(0.45, vn * 0.035)
      v.vx = (mvx * sinL + mvz * cosL) * frottement
      v.vy = (mvx * cosL - mvz * sinL) * frottement
      v.r *= 0.7
      v.contactMur = Math.min(1, v.contactMur + vn * 0.12)
      if (vn * 1.2 > v.choc) v.choc = vn * 1.2
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
