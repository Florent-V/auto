// =============================================================================
// MODULE : Moteur — boucle de jeu et liaison simulation ↔ rendu ↔ interface
// -----------------------------------------------------------------------------
// - Simulation à pas FIXE (120 Hz, la physique sous-divise encore en 4) avec
//   accumulateur ; le rendu interpole entre les deux derniers états → mouvement
//   fluide quelle que soit la fréquence de l'écran, physique déterministe.
// - Boucle sans allocation : vecteurs, tampons et objets sont créés une fois.
// - L'interface (Vue) ne reçoit que des valeurs primitives écrites dans un
//   objet réactif `hud` ; chronos et classement sont rafraîchis à basse fréquence.
// - Résolution dynamique : si la machine peine, le pixel ratio est abaissé.
// =============================================================================
import * as THREE from 'three'
import { construireDepuisReference } from './core/circuits-reels.js'
import { Course, ETATS, changerModele } from './core/course.js'
import { EnregistreurFantome } from './core/fantome.js'
import { creerScene } from './rendu/scene.js'
import { creerDecor } from './rendu/decor.js'
import { creerVoiture3D } from './rendu/voiture3d.js'
import { creerFumee, creerTraces } from './rendu/effets.js'
import { creerCamera } from './rendu/camera.js'
import { creerMinimap } from './rendu/minimap.js'
import { creerEntrees } from './entrees.js'
import { creerAudio } from './audio.js'

const PAS_FIXE = 1 / 120
const PAS_MAX_PAR_IMAGE = 8
export const CAMERAS = ['poursuite', 'proche', 'capot', 'embarquee']
/** Caméras embarquées (repère voiture : x gauche, y haut, z avant). */
const POINTS_DE_VUE = {
  f1: { capot: [0, 0.62, 1.25], embarquee: [0, 1.2, -0.38] },
  hypercar: { capot: [0, 0.98, 1.05], embarquee: [0, 1.36, -0.2] },
  sportive: { capot: [0, 1.04, 0.95], embarquee: [0, 1.5, -0.25] }
}
const NB_PROJECTEURS = 4

/** Formate un temps en m:ss.cc (appelé à faible fréquence, hors physique). */
export function formaterTemps(t) {
  if (!Number.isFinite(t) || t <= 0) return '–:––.––'
  const cs = Math.round(t * 100) // arrondi au centième AVANT découpage (pas de « 1:60.00 »)
  const m = Math.floor(cs / 6000), s = (cs % 6000) / 100
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2)
}

/** Valeurs initiales de l'objet HUD (à rendre réactif côté Vue). */
export function creerEtatHud() {
  return {
    pret: false, chargement: false, erreurCircuit: '', etat: ETATS.MENU,
    circuit: { id: '', nom: '', longueur: 0, source: '', denivele: 0 },
    vitesse: 0, rapport: 1, regime: 0, regimeTr: 0, feuxShift: 0, rupteur: false,
    tour: 1, tours: 3, position: 6, total: 6,
    tempsCourse: '0:00.00', tempsTour: '0:00.00', meilleurTour: '–:––.––', dernierTour: '–:––.––',
    decompte: 3, depart: false, contresens: false, horsPiste: false, fantome: false,
    flashRecord: 0, tempsRecord: '', muet: false, autopilote: false, ips: 60,
    camera: 'poursuite', telemetrie: false, manette: false, boiteAuto: true, ambiance: 'jour',
    tele: { gLat: 0, gLong: 0, repartAv: 50, appuiKg: 0, usageAv: 0, usageAr: 0, abs: false, tc: false, patinage: false, blocage: false, surfaces: 'piste' },
    classement: Array.from({ length: 6 }, () => ({ nom: '', couleur: '#fff', joueur: false, ecart: '', meilleur: '', fini: false, tour: 0 }))
  }
}

const NOMS_SURFACES = ['piste', 'vibreur', 'herbe', 'gravier', 'dégagement']
const _pos = new THREE.Vector3(), _vise = new THREE.Vector3()

export class Moteur {
  /**
   * @param {object} p
   * @param {HTMLCanvasElement} p.canvas       canvas WebGL plein écran
   * @param {HTMLCanvasElement} p.canvasCarte  canvas 2D de la mini-carte
   * @param {object} p.hud                     objet réactif (voir creerEtatHud)
   */
  constructor({ canvas, canvasCarte, hud }) {
    this.canvas = canvas
    this.canvasCarte = canvasCarte
    this.hud = hud
    this.rendu = creerScene(canvas)
    this.camera = creerCamera(this.rendu.camera)
    this.audio = creerAudio()
    this.entrees = creerEntrees((action) => this.surAction(action))
    this.enregistreur = new EnregistreurFantome()
    this.options = { tours: 3, difficulte: 'normal', modele: 'hypercar', plateau: 'monotype', aides: 'completes', boiteAuto: true, ambiance: 'jour' }
    this.course = null
    this.circuit = null
    this.decor = null
    this.minimap = null
    this.modeCamera = 0

    // --- Objets 3D créés une fois pour toutes --------------------------------
    this.fumee = creerFumee(this.rendu.scene)
    this.traces = creerTraces(this.rendu.scene, 12)
    this.voitures = []
    this.voitureFantome = null
    // Phares du joueur : un projecteur dynamique (utile surtout la nuit).
    this.phares = new THREE.SpotLight(0xfff1d6, 0, 110, 0.42, 0.65, 1.4)
    this.phares.target.position.set(0, -0.8, 16)
    // Projecteurs du circuit : les 4 mâts les plus proches éclairent réellement
    // les voitures (le sol, lui, reçoit un éclairage précalculé).
    this.projecteurs = []
    for (let k = 0; k < NB_PROJECTEURS; k++) {
      const l = new THREE.PointLight(0xffe9cc, 0, 70, 1.6)
      this.rendu.scene.add(l)
      this.projecteurs.push(l)
    }

    // --- État de la boucle ----------------------------------------------------
    this.accumulateur = 0
    this.tempsPrec = 0
    this.temps = 0
    this.image = 0
    this.roulis = new Float32Array(6)
    this.tangage = new Float32Array(6)
    this.secousse = 0
    this.cadrage = 0; this.cadrageARefaire = false
    this.vuTour = 0; this.vuRecord = 0; this.decomptePrec = -1
    this.etatPrec = ''
    this.ratioMax = Math.min(window.devicePixelRatio || 1, 2)
    this.ratio = this.ratioMax
    this.cumulMs = 0; this.nbImages = 0; this.lenteurs = 0
    this.actif = true

    this._boucle = (t) => this.boucle(t)
    this._redim = () => this.redimensionner()
    this._visibilite = () => {
      if (document.hidden && this.course && this.course.etat === ETATS.COURSE) this.basculerPause()
    }
    window.addEventListener('resize', this._redim)
    document.addEventListener('visibilitychange', this._visibilite)
    this.redimensionner()
    this.idAnimation = requestAnimationFrame(this._boucle)
  }

  // ---------------------------------------------------------------------------
  // Circuit, ambiance, course
  // ---------------------------------------------------------------------------
  /**
   * Construit et affiche un circuit.
   * @param {object} ref { type: 'reel', id } | { type: 'seed', seed } | { type: 'perso', definition }
   */
  chargerCircuit(ref) {
    const circuit = construireDepuisReference(ref)
    if (this.decor) this.decor.liberer()
    this.decor = creerDecor(this.rendu.scene, circuit)
    this.minimap = creerMinimap(this.canvasCarte, circuit)
    this.enregistreur.reinitialiser() // nouveau circuit → nouveaux records
    this.circuit = circuit
    Object.assign(this.hud.circuit, {
      id: circuit.id, nom: circuit.nom, longueur: Math.round(circuit.longueur), source: circuit.source,
      denivele: Math.round(circuit.bornes.maxY - circuit.bornes.minY)
    })
    this.creerCourse()
    this.appliquerAmbiance(this.options.ambiance)
    this.hud.pret = true
  }

  /** Jour, crépuscule ou nuit : ciel, lumières, éclairage du circuit, phares. */
  appliquerAmbiance(nom) {
    this.options.ambiance = nom
    const a = this.rendu.appliquerAmbiance(nom)
    this.hud.ambiance = this.rendu.ambiance
    const f = a.nuit
    if (this.decor) this.decor.appliquerNuit(f)
    for (const v of this.voitures) v.definirNuit(f > 0.5)
    this.phares.intensity = f > 0 ? 140 * f : 0
    if (f === 0) for (const l of this.projecteurs) l.intensity = 0
  }

  /** (Re)crée la course sur le circuit courant avec les options choisies. */
  creerCourse() {
    const o = this.options
    this.course = new Course({
      circuit: this.circuit, tours: o.tours, difficulte: o.difficulte, enregistreur: this.enregistreur,
      modeleJoueur: o.modele, plateau: o.plateau, aides: o.aides, boiteAuto: o.boiteAuto
    })
    this.hud.boiteAuto = o.boiteAuto
    this.equiperVoitures()
    this.vuTour = 0; this.vuRecord = 0; this.decomptePrec = -1
    this.reinitialiserVisuels()
  }

  /**
   * Associe un modèle 3D à chaque véhicule. Les modèles sont conservés d'une
   * course à l'autre ; seul un changement de type en recrée un.
   */
  equiperVoitures() {
    const vehicules = this.course.vehicules
    const nuit = this.rendu.facteurNuit > 0.5
    for (let k = 0; k < vehicules.length; k++) {
      const v = vehicules[k]
      if (this.voitures[k] && this.voitures[k].type === v.modele) continue
      if (this.voitures[k]) this.voitures[k].liberer()
      const m = creerVoiture3D({ type: v.modele, couleur: v.couleur, accent: v.accent })
      m.definirNuit(nuit)
      this.rendu.scene.add(m.groupe)
      this.voitures[k] = m
      if (k === 0) {
        // Phares et fantôme suivent le modèle du joueur.
        this.phares.position.set(0, m.phares.y + 0.15, m.phares.z - 0.2)
        m.groupe.add(this.phares, this.phares.target)
        if (this.voitureFantome) this.voitureFantome.liberer()
        this.voitureFantome = creerVoiture3D({ type: v.modele, fantome: true })
        this.voitureFantome.groupe.visible = false
        this.rendu.scene.add(this.voitureFantome.groupe)
      }
    }
  }

  /** Choix du modèle depuis le menu : la (les) voiture(s) change(nt) à l'écran. */
  definirModeleJoueur(type) {
    this.options.modele = type
    if (!this.course) return
    changerModele(this.course, type)
    this.equiperVoitures()
  }

  reinitialiserVisuels() {
    this.accumulateur = 0
    this.fumee.vider(); this.traces.vider()
    this.camera.recaler()
    this.roulis.fill(0); this.tangage.fill(0)
  }

  /** Lance une course (depuis le menu ou l'écran de fin). */
  lancer(options) {
    if (options) Object.assign(this.options, options)
    this.audio.demarrer()
    this.entrees.etat.autopilote = !!this.hud.autopilote
    this.creerCourse()
    this.course.demarrer()
    this.reinitialiserVisuels()
  }

  retourMenu() {
    if (!this.course || this.course.etat === ETATS.MENU) return
    this.creerCourse()
    this.audio.reprendre()
  }

  basculerPause() {
    if (!this.course || !this.course.basculerPause()) return
    if (this.course.etat === ETATS.PAUSE) this.audio.suspendre()
    else { this.audio.reprendre(); this.tempsPrec = 0 }
  }

  /** Touches ponctuelles (voir entrees.js). */
  surAction(action) {
    const etat = this.course ? this.course.etat : ETATS.MENU
    if (action === 'pause') this.basculerPause()
    else if (action === 'replacer') this.entrees.etat.replacer = true
    else if (action === 'muet') this.hud.muet = this.audio.basculerMuet()
    else if (action === 'camera') { this.modeCamera = (this.modeCamera + 1) % CAMERAS.length; this.hud.camera = CAMERAS[this.modeCamera]; this.camera.recaler() }
    else if (action === 'telemetrie') this.hud.telemetrie = !this.hud.telemetrie
    else if (action === 'valider' && (etat === ETATS.MENU || etat === ETATS.FIN)) this.lancer()
  }

  redimensionner() {
    const l = window.innerWidth, h = window.innerHeight
    this.ratioMax = Math.min(window.devicePixelRatio || 1, 2)
    if (this.ratio > this.ratioMax) this.ratio = this.ratioMax
    this.rendu.redimensionner(l, h, this.ratio)
    this.cadrageARefaire = true
    if (this.course) this.rendu.rendre(this.temps, 0, 0)
  }

  // ---------------------------------------------------------------------------
  // Boucle principale
  // ---------------------------------------------------------------------------
  boucle(tMs) {
    if (!this.actif) return
    this.idAnimation = requestAnimationFrame(this._boucle)
    const brut = this.tempsPrec ? (tMs - this.tempsPrec) / 1000 : 1 / 60
    this.tempsPrec = tMs
    const dt = Math.min(brut, 0.1) // onglet en arrière-plan : pas de « saut »
    const course = this.course
    if (!course) return
    this.image++
    this.temps += dt

    // --- 1. Entrées puis simulation à pas fixe -----------------------------------
    this.entrees.lire()
    const entrees = this.entrees.etat
    this.hud.manette = entrees.manette
    if (course.etat !== ETATS.PAUSE) {
      this.accumulateur += dt
      let pas = 0
      while (this.accumulateur >= PAS_FIXE && pas < PAS_MAX_PAR_IMAGE) {
        course.pas(PAS_FIXE, entrees)
        entrees.replacer = false
        this.accumulateur -= PAS_FIXE
        pas++
      }
      if (pas === PAS_MAX_PAR_IMAGE) this.accumulateur = 0 // machine trop lente : on lâche du lest
    }
    entrees.passage = 0
    const alpha = course.etat === ETATS.PAUSE ? 1 : this.accumulateur / PAS_FIXE

    // --- 2. Synchronisation des objets 3D -------------------------------------
    this.synchroniserVoitures(course, alpha, dt)
    this.mettreAJourCamera(course, alpha, dt)
    this.placerProjecteurs()
    if (course.etat !== ETATS.PAUSE) {
      this.fumee.mettreAJour(dt, this.canvas.height)
      this.traces.valider()
    }
    this.mettreAJourFeux(course)

    // --- 3. Interface, audio, rendu -------------------------------------------
    this.mettreAJourHud(course)
    const j = course.joueur
    const enJeu = course.etat === ETATS.COURSE || course.etat === ETATS.DECOMPTE
    this.audio.mettreAJour(j, enJeu)
    const cible = Math.max(j.horsPiste * Math.min(1, Math.abs(j.vx) / 30) * 0.6, Math.min(1, j.choc * 0.2), j.contactMur, j.vibration * 0.5)
    this.secousse += (cible - this.secousse) * 0.2
    const vitesseNorm = course.etat === ETATS.COURSE ? Math.min(1, Math.abs(j.vx) / 85) : 0
    this.rendu.rendre(this.temps, vitesseNorm * vitesseNorm, course.etat === ETATS.COURSE ? Math.min(1, j.contactMur) : 0)
    if ((this.image & 1) === 0 && this.minimap) this.minimap.dessiner(course.vehicules, course.fantome)

    this.mesurerPerformance(brut)
  }

  /** Pose chaque voiture à sa position interpolée et émet fumée / traces / poussière. */
  synchroniserVoitures(course, alpha, dt) {
    const c = course.circuit
    const enMouvement = course.etat !== ETATS.PAUSE
    for (let k = 0; k < course.vehicules.length; k++) {
      const v = course.vehicules[k], m = this.voitures[k]
      const x = v.xPrec + (v.x - v.xPrec) * alpha
      const y = v.yPrec + (v.y - v.yPrec) * alpha
      const z = v.zPrec + (v.z - v.zPrec) * alpha
      const lacet = v.lacetPrec + (v.lacet - v.lacetPrec) * alpha
      const sinL = Math.sin(lacet), cosL = Math.cos(lacet)
      m.groupe.position.set(x, y, z)
      m.groupe.rotation.y = lacet
      // Inclinaison selon la pente de la piste, projetée sur l'axe du véhicule.
      const alignement = -sinL * c.nz[v.idx] + cosL * c.nx[v.idx]
      m.groupe.rotation.x = -Math.atan(c.pente[v.idx] * alignement)
      // Roulis et tangage de caisse issus des accélérations simulées (suspensions).
      const lissage = Math.min(1, 10 * dt)
      const souplesse = v.spec.hauteurCG * 0.09 // une F1 (CdG bas, très raide) bouge peu
      const roulisVise = Math.max(-0.08, Math.min(0.08, -v.ay * souplesse))
      const tangageVise = Math.max(-0.05, Math.min(0.05, v.ax * souplesse * 0.6))
      this.roulis[k] += (roulisVise - this.roulis[k]) * lissage
      this.tangage[k] += (tangageVise - this.tangage[k]) * lissage
      // Vibreurs : petite trépidation de caisse.
      const trepidation = v.vibration > 0.05 ? (Math.random() - 0.5) * v.vibration * 0.012 : 0
      m.animer(v.roueAngle, v.angleRoues, v.cmdFrein > 0.1 || v.cmdFam, this.roulis[k] + trepidation, this.tangage[k])

      if (!enMouvement) continue
      // --- Effets aux roues arrière (gauche = +cos, −sin) ---
      const vAbs = Math.abs(v.vx)
      const glisse = Math.max(v.glisse, v.cmdFam && vAbs > 5 ? 0.9 : 0)
      const ax = x + sinL * m.arriere.z, az = z + cosL * m.arriere.z
      for (let cote = -1; cote <= 1; cote += 2) {
        const roue = cote > 0 ? 2 : 3
        const surface = v.contacts[roue]
        const terre = (surface === 2 || surface === 3) && vAbs > 4 // herbe, gravier
        const rx = ax + cosL * m.arriere.x * cote, rz = az - sinL * m.arriere.x * cote
        this.traces.poser(k * 2 + (cote > 0 ? 0 : 1), rx, y + 0.03, rz, cosL, -sinL, glisse > 0.3 && !terre ? glisse : terre ? 0.35 : 0)
        if ((glisse > 0.35 || terre) && ((this.image + k) & 1) === 0) {
          // Fumée blanche de gomme, ou poussière / terre projetée.
          const gris = 0.82
          const r = terre ? (surface === 3 ? 0.62 : 0.42) : gris, g = terre ? (surface === 3 ? 0.56 : 0.38) : gris, b = terre ? (surface === 3 ? 0.48 : 0.3) : gris + 0.04
          this.fumee.emettre(
            rx, y + 0.25, rz,
            (Math.random() - 0.5) * 1.5 - sinL * v.vx * 0.08, 0.9 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5 - cosL * v.vx * 0.08,
            r, g, b, terre ? 1.4 : 0.9 + glisse * 0.8, 0.7 + Math.random() * 0.6
          )
        }
      }
    }
    // --- Fantôme ---
    const f = course.fantome, mf = this.voitureFantome
    mf.groupe.visible = f.visible
    if (f.visible) {
      mf.groupe.position.set(f.x, f.y, f.z)
      mf.groupe.rotation.y = f.lacet
    }
  }

  /** Choix du plan de caméra selon l'état de la machine à états et le mode choisi. */
  mettreAJourCamera(course, alpha, dt) {
    const etat = course.etat
    if (etat === ETATS.PAUSE) return
    const j = course.joueur
    const x = j.xPrec + (j.x - j.xPrec) * alpha
    const y = j.yPrec + (j.y - j.yPrec) * alpha
    const z = j.zPrec + (j.z - j.zPrec) * alpha
    const lacet = j.lacetPrec + (j.lacet - j.lacetPrec) * alpha
    if (etat === ETATS.COURSE) {
      const mode = CAMERAS[this.modeCamera]
      if (mode === 'capot' || mode === 'embarquee') {
        // Caméra solidaire de la caisse (pente, roulis et tangage compris).
        const groupe = this.voitures[0].groupe, caisse = this.voitures[0].caisse
        const pdv = POINTS_DE_VUE[j.modele][mode]
        groupe.updateMatrixWorld(true)
        _pos.set(pdv[0], pdv[1], pdv[2]).applyMatrix4(caisse.matrixWorld)
        _vise.set(pdv[0], pdv[1] - 0.35, pdv[2] + 25).applyMatrix4(caisse.matrixWorld)
        this.camera.embarquer(dt, _pos, _vise, Math.abs(j.vx), this.secousse)
      } else {
        const derive = Math.abs(j.vx) > 4 ? Math.atan2(j.vy, Math.abs(j.vx)) : 0
        this.camera.poursuivre(dt, x, y, z, lacet, j.vx, derive, this.secousse, mode === 'proche' ? 0.72 : 1)
      }
    } else if (etat === ETATS.DECOMPTE) {
      // Travelling circulaire : part de trois-quarts face et finit derrière la voiture.
      const p = Math.max(0, Math.min(1, course.decompte / 3.2))
      const doux = p * p * (3 - 2 * p)
      this.camera.definirAngle(lacet + Math.PI + doux * 2.4)
      this.camera.orbiter(dt, x, y + 0.6, z, 6.4 + doux * 3, 2.0 + doux * 1.2, 0)
    } else if (etat === ETATS.MENU) {
      if (this.circuit.urbain) {
        // Entre les murs, pas d'orbite complète : trois-quarts avant qui oscille.
        this.camera.definirAngle(lacet + 0.55 + Math.sin(this.temps * 0.35) * 0.35)
        this.camera.orbiter(dt, x, y, z, 6.2, 2.2, 0)
      } else this.camera.orbiter(dt, x, y, z, 8.5, 2.4, 0.3)
    } else {
      this.camera.orbiter(dt, x, y, z, 9.5, 3.2, 0.35)
    }
    this.rendu.suivre(x, y, z)
    this.cadrer(etat === ETATS.MENU && window.innerWidth > 760 ? 0.22 : 0, dt)
  }

  /** Nuit : les projecteurs réels sont placés sur les mâts les plus proches du joueur. */
  placerProjecteurs() {
    const f = this.rendu.facteurNuit
    if (f === 0 || !this.decor || (this.image % 6) !== 0) return
    const j = this.course.joueur, poteaux = this.decor.poteaux
    // Mâts répartis régulièrement : on part de celui qui précède le joueur.
    const pasMats = this.circuit.n / poteaux.length
    const base = Math.floor(j.idx / pasMats)
    const c = this.circuit
    for (let k = 0; k < NB_PROJECTEURS; k++) {
      const p = poteaux[(base - 1 + k + poteaux.length) % poteaux.length]
      const l = this.projecteurs[k]
      // Source placée au-dessus du bord de piste (les projecteurs visent la piste).
      const d = p.cote * (c.demiLargeur + 1)
      l.position.set(c.px[p.i] + c.nx[p.i] * d, p.y + p.h, c.pz[p.i] + c.nz[p.i] * d)
      l.intensity = (c.urbain ? 50 : 80) * f
    }
  }

  /**
   * Cadrage : au menu, la voiture présentée est décalée vers la droite de
   * l'écran (le panneau occupe la gauche). Transition douce vers le centre.
   */
  cadrer(cible, dt) {
    const avant = this.cadrage
    this.cadrage += (cible - this.cadrage) * Math.min(1, 4 * dt)
    if (Math.abs(this.cadrage - cible) < 0.002) this.cadrage = cible
    if (this.cadrage === avant && !this.cadrageARefaire) return
    this.cadrageARefaire = false
    const cam = this.rendu.camera, l = window.innerWidth, h = window.innerHeight
    if (this.cadrage > 0) cam.setViewOffset(l, h, -this.cadrage * l, 0, l, h)
    else cam.clearViewOffset()
  }

  /**
   * Feux de départ comme en F1 : les cinq rouges s'allument un à un, puis
   * s'éteignent tous ensemble — c'est le départ. Bips et sons d'impact.
   */
  mettreAJourFeux(course) {
    let etape = 0, chiffre = -1
    if (course.etat === ETATS.DECOMPTE) {
      chiffre = Math.min(3, Math.ceil(course.decompte))
      etape = Math.min(5, Math.floor((3.2 - course.decompte) / 0.6) + 1)
    } else if (course.etat === ETATS.COURSE && course.tempsCourse < 1.6) {
      chiffre = 0
    }
    if (chiffre !== this.decomptePrec) {
      this.decomptePrec = chiffre
      if (chiffre > 0) this.audio.bip(440, 0.18)
      else if (chiffre === 0) this.audio.bip(880, 0.55)
    }
    this.decor.feuxDepart(etape)
    this.hud.decompte = chiffre
    this.hud.depart = chiffre === 0
    const j = course.joueur
    if (j.choc > 2.5 && this.image - (this.imageChoc || 0) > 20) { this.imageChoc = this.image; this.audio.choc(j.choc) }
  }

  /** Recopie l'état de la course dans l'objet réactif lu par l'interface. */
  mettreAJourHud(course) {
    const hud = this.hud, j = course.joueur, s = j.spec
    hud.etat = course.etat
    hud.vitesse = Math.round(Math.hypot(j.vx, j.vy) * 3.6)
    hud.rapport = j.rapport
    hud.regimeTr = Math.round(j.regime / 50) * 50
    const r = j.regime / s.moteur.regimeMax
    hud.regime = Math.max(0, Math.min(1, r))
    // Témoins de passage (10 LED) : de 72 % à 98 % du régime maxi.
    hud.feuxShift = Math.max(0, Math.min(10, Math.floor((r - 0.72) / 0.026)))
    hud.rupteur = r > 0.975
    hud.fantome = course.fantome.visible
    hud.contresens = course.contresens
    hud.horsPiste = j.horsPiste > 0.4

    // Événements ponctuels.
    if (course.evtMeilleurTour !== this.vuRecord) {
      this.vuRecord = course.evtMeilleurTour
      hud.tempsRecord = formaterTemps(course.meilleurSession)
      hud.flashRecord++
      this.audio.bip(1320, 0.3)
    }
    // Rafraîchissement basse fréquence (≈ 20 Hz chronos et télémétrie).
    if (this.image % 3 === 0) {
      hud.tempsCourse = formaterTemps(j.fini ? j.tempsFin : course.tempsCourse)
      const fige = j.fini || course.etat === ETATS.MENU
      hud.tempsTour = j.tourMax >= 0 && !fige ? formaterTemps(course.tempsCourse - j.tempsDebutTour) : j.fini ? formaterTemps(j.dernierTour) : '0:00.00'
      const t = hud.tele
      t.gLat = Math.round(j.ay * 100) / 100
      t.gLong = Math.round(j.ax * 100) / 100
      t.repartAv = Math.round((100 * j.chargeAv) / Math.max(1, j.chargeAv + j.chargeAr))
      t.appuiKg = Math.round(j.appui / 9.81)
      t.usageAv = Math.round(Math.min(1.2, j.usageAv) * 100)
      t.usageAr = Math.round(Math.min(1.2, j.usageAr) * 100)
      t.abs = j.absActif === 1; t.tc = j.tcActif === 1
      t.patinage = j.patinage === 1; t.blocage = j.blocage === 1
      t.surfaces = NOMS_SURFACES[Math.max(j.contacts[0], j.contacts[1], j.contacts[2], j.contacts[3])]
    }
    if (this.image % 9 !== 0 && course.etat === this.etatPrec) return
    this.etatPrec = course.etat
    hud.tour = course.tourJoueur
    hud.tours = course.tours
    hud.position = course.positionJoueur
    hud.total = course.vehicules.length
    hud.meilleurTour = formaterTemps(course.meilleurSession)
    hud.dernierTour = formaterTemps(j.dernierTour)
    const premier = course.vehicules[course.ordre[0]]
    for (let i = 0; i < course.ordre.length; i++) {
      const veh = course.vehicules[course.ordre[i]], ligne = hud.classement[i]
      ligne.nom = veh.nom
      ligne.couleur = '#' + veh.couleur.toString(16).padStart(6, '0')
      ligne.joueur = veh.estJoueur
      ligne.fini = veh.fini
      ligne.tour = Math.min(course.tours, Math.max(1, veh.tourMax + 1))
      ligne.meilleur = formaterTemps(veh.meilleurTour)
      if (i === 0) ligne.ecart = veh.fini ? formaterTemps(veh.tempsFin) : 'LEADER'
      else if (veh.fini && premier.fini) ligne.ecart = '+' + (veh.tempsFin - premier.tempsFin).toFixed(2)
      else {
        // Écart estimé : distance au leader / vitesse (bornée) du poursuivant.
        const ecart = (premier.progression - veh.progression) / Math.max(18, Math.abs(veh.vx))
        ligne.ecart = '+' + ecart.toFixed(1)
      }
    }
  }

  /** Suivi de la cadence et adaptation de la résolution de rendu. */
  mesurerPerformance(dtBrut) {
    this.cumulMs += dtBrut * 1000
    this.nbImages++
    if (this.nbImages < 45) return
    const moyenne = this.cumulMs / this.nbImages
    this.hud.ips = Math.round(1000 / moyenne)
    this.cumulMs = 0; this.nbImages = 0
    // Plus de 20 ms par image (< 50 i/s) de façon répétée → on réduit le pixel ratio.
    if (moyenne > 20) this.lenteurs++
    else this.lenteurs = 0
    if (this.lenteurs >= 2 && this.ratio > 0.6) {
      this.ratio = Math.max(0.6, this.ratio - 0.2)
      this.lenteurs = 0
      this.redimensionner()
    }
  }

  /** Arrêt complet et libération des ressources (démontage du composant). */
  liberer() {
    this.actif = false
    cancelAnimationFrame(this.idAnimation)
    window.removeEventListener('resize', this._redim)
    document.removeEventListener('visibilitychange', this._visibilite)
    this.entrees.liberer()
    this.audio.liberer()
    if (this.decor) this.decor.liberer()
    this.fumee.liberer(); this.traces.liberer()
    this.rendu.liberer()
  }
}
