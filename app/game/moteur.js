// =============================================================================
// MODULE : Moteur — boucle de jeu et liaison simulation ↔ rendu ↔ interface
// -----------------------------------------------------------------------------
// - Simulation à pas FIXE (120 Hz) alimentée par un accumulateur ; le rendu
//   interpole entre les deux derniers états → mouvement fluide quelle que soit
//   la fréquence de l'écran, et physique déterministe.
// - Boucle sans allocation : vecteurs, tampons et objets sont créés une fois.
// - L'interface (Vue) ne reçoit que des valeurs primitives écrites dans un
//   objet réactif `hud` ; les libellés du classement sont rafraîchis à 10 Hz.
// - Résolution dynamique : si la machine peine, le pixel ratio est abaissé.
// =============================================================================
import * as THREE from 'three'
import { genererCircuit } from './core/circuit.js'
import { normaliserSeed } from './core/rng.js'
import { Course, ETATS } from './core/course.js'
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
/** Vitesses (m/s) de passage des rapports : uniquement pour le son et l'affichage. */
const RAPPORTS = [0, 15, 27, 39, 51, 63, 400]

/** Formate un temps en m:ss.cc (appelé à faible fréquence, hors physique). */
export function formaterTemps(t) {
  if (!Number.isFinite(t) || t <= 0) return '–:––.––'
  const m = Math.floor(t / 60), s = t - m * 60
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2)
}

/** Valeurs initiales de l'objet HUD (à rendre réactif côté Vue). */
export function creerEtatHud() {
  return {
    pret: false, etat: ETATS.MENU, seed: '', longueur: 0,
    vitesse: 0, rapport: 1, regime: 0,
    tour: 1, tours: 3, position: 6, total: 6,
    tempsCourse: '0:00.00', tempsTour: '0:00.00', meilleurTour: '–:––.––', dernierTour: '–:––.––',
    decompte: 3, depart: false, contresens: false, horsPiste: false, fantome: false,
    flashRecord: 0, tempsRecord: '', muet: false, autopilote: false, ips: 60,
    classement: Array.from({ length: 6 }, () => ({ nom: '', couleur: '#fff', joueur: false, ecart: '', meilleur: '', fini: false, tour: 0 }))
  }
}

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
    this.options = { tours: 3, difficulte: 'normal' }
    this.course = null
    this.decor = null
    this.minimap = null

    // --- Objets 3D créés une fois pour toutes --------------------------------
    this.fumee = creerFumee(this.rendu.scene)
    this.traces = creerTraces(this.rendu.scene, 12)
    this.voitures = []
    this.voitureFantome = creerVoiture3D(0x6ff3ff, true)
    this.voitureFantome.groupe.visible = false
    this.rendu.scene.add(this.voitureFantome.groupe)
    // Phares du joueur : un seul projecteur dynamique.
    this.phares = new THREE.SpotLight(0xfff1d6, 260, 85, 0.5, 0.7, 1.6)
    this.phares.position.set(0, 0.9, 1.6)
    this.phares.target.position.set(0, -0.6, 14)

    // --- État de la boucle ----------------------------------------------------
    this.accumulateur = 0
    this.tempsPrec = 0
    this.temps = 0
    this.image = 0
    this.roulis = new Float32Array(6)
    this.tangage = new Float32Array(6)
    this.secousse = 0
    this.vuTour = 0; this.vuRecord = 0; this.decomptePrec = -1
    this.etatPrec = ''
    // Mesure de performance / résolution dynamique.
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
  // Gestion du circuit et de la course
  // ---------------------------------------------------------------------------
  /** Génère et affiche le circuit correspondant à la seed (texte ou nombre). */
  chargerCircuit(seedTexte) {
    const seed = normaliserSeed(seedTexte)
    const circuit = genererCircuit(seed)
    if (this.decor) this.decor.liberer()
    this.decor = creerDecor(this.rendu.scene, circuit, String(seedTexte))
    this.minimap = creerMinimap(this.canvasCarte, circuit)
    this.enregistreur.reinitialiser() // nouveau circuit → nouveaux records
    this.hud.seed = String(seedTexte)
    this.hud.longueur = Math.round(circuit.longueur)
    this.circuit = circuit
    this.creerCourse()
    this.hud.pret = true
  }

  /** (Re)crée la course sur le circuit courant avec les options choisies. */
  creerCourse() {
    this.course = new Course({
      circuit: this.circuit, tours: this.options.tours,
      difficulte: this.options.difficulte, enregistreur: this.enregistreur
    })
    // Voitures 3D : créées à la première course, réutilisées ensuite.
    if (this.voitures.length === 0) {
      for (const v of this.course.vehicules) {
        const modele = creerVoiture3D(v.couleur)
        this.rendu.scene.add(modele.groupe)
        this.voitures.push(modele)
      }
      this.voitures[0].groupe.add(this.phares, this.phares.target)
    }
    this.vuTour = 0; this.vuRecord = 0; this.decomptePrec = -1
    this.reinitialiserVisuels()
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
    if (!this.course) return
    if (this.course.etat === ETATS.MENU) return
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
    else if (action === 'valider' && (etat === ETATS.MENU || etat === ETATS.FIN)) this.lancer()
  }

  redimensionner() {
    const l = window.innerWidth, h = window.innerHeight
    this.ratioMax = Math.min(window.devicePixelRatio || 1, 2)
    if (this.ratio > this.ratioMax) this.ratio = this.ratioMax
    this.rendu.redimensionner(l, h, this.ratio)
    // Redimensionner efface le canvas : on redessine aussitôt (pas d'image noire).
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

    // --- 1. Simulation à pas fixe ---------------------------------------------
    const entrees = this.entrees.etat
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
    const alpha = course.etat === ETATS.PAUSE ? 1 : this.accumulateur / PAS_FIXE

    // --- 2. Synchronisation des objets 3D -------------------------------------
    this.synchroniserVoitures(course, alpha, dt)
    this.mettreAJourCamera(course, alpha, dt)
    if (course.etat !== ETATS.PAUSE) {
      this.fumee.mettreAJour(dt, this.canvas.height)
      this.traces.valider()
    }
    this.mettreAJourFeux(course)

    // --- 3. Interface, audio, rendu -------------------------------------------
    this.mettreAJourHud(course)
    const j = course.joueur
    const enJeu = course.etat === ETATS.COURSE || course.etat === ETATS.DECOMPTE
    this.audio.mettreAJour(this.hud.regime, enJeu && course.etat === ETATS.COURSE ? j.cmdGaz : 0, j.vx, j.glisse, j.horsPiste, enJeu)
    this.secousse += (Math.max(j.horsPiste * Math.min(1, Math.abs(j.vx) / 30) * 0.6, Math.min(1, j.choc * 0.25), j.contactMur) - this.secousse) * 0.2
    const vitesseNorm = course.etat === ETATS.COURSE ? Math.min(1, Math.abs(j.vx) / 75) : 0
    this.rendu.rendre(this.temps, vitesseNorm * vitesseNorm, course.etat === ETATS.COURSE ? Math.min(1, this.secousse) : 0)
    if ((this.image & 1) === 0 && this.minimap) this.minimap.dessiner(course.vehicules, course.fantome)

    this.mesurerPerformance(brut)
  }

  /** Pose chaque voiture à sa position interpolée et émet fumée / traces. */
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
      // Roulis en virage, tangage à l'accélération / au freinage (lissés).
      const lissage = Math.min(1, 8 * dt)
      const roulisVise = Math.max(-0.075, Math.min(0.075, v.vx * v.r * 0.0038))
      const tangageVise = v.cmdFrein > 0.1 && v.vx > 2 ? 0.028 : -0.022 * v.cmdGaz
      this.roulis[k] += (roulisVise - this.roulis[k]) * lissage
      this.tangage[k] += (tangageVise - this.tangage[k]) * lissage
      m.animer(v.roueAngle, v.estJoueur && !v.assistance ? v.angleRoues : v.braquage, v.cmdFrein > 0.1 || v.cmdFam, this.roulis[k], this.tangage[k])

      if (!enMouvement) continue
      // --- Effets aux roues arrière (gauche = +cos, −sin) ---
      const vAbs = Math.abs(v.vx)
      const glisse = Math.max(v.glisse, v.cmdFam && vAbs > 5 ? 0.9 : 0)
      const poussiere = v.horsPiste > 0.5 && vAbs > 6
      const ax = x - sinL * 1.35, az = z - cosL * 1.35
      for (let cote = -1; cote <= 1; cote += 2) {
        const rx = ax + cosL * 0.9 * cote, rz = az - sinL * 0.9 * cote
        this.traces.poser(k * 2 + (cote > 0 ? 0 : 1), rx, y + 0.03, rz, cosL, -sinL, glisse > 0.3 ? glisse * (poussiere ? 0.5 : 1) : 0)
        if ((glisse > 0.35 || poussiere) && ((this.image + k) & 1) === 0) {
          const gris = poussiere ? 0 : 0.78
          this.fumee.emettre(
            rx, y + 0.25, rz,
            (Math.random() - 0.5) * 1.5 - sinL * v.vx * 0.08, 0.9 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5 - cosL * v.vx * 0.08,
            poussiere ? 0.5 : gris, poussiere ? 0.4 : gris, poussiere ? 0.42 : gris + 0.06,
            poussiere ? 1.3 : 0.9 + glisse * 0.8, 0.7 + Math.random() * 0.6
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

  /** Choix du plan de caméra selon l'état de la machine à états. */
  mettreAJourCamera(course, alpha, dt) {
    const etat = course.etat
    if (etat === ETATS.PAUSE) return
    const j = course.joueur
    // Sujet filmé : le joueur, sauf au menu où l'on suit une voiture de la démo.
    const sujet = etat === ETATS.MENU ? course.vehicules[3] : j
    const x = sujet.xPrec + (sujet.x - sujet.xPrec) * alpha
    const y = sujet.yPrec + (sujet.y - sujet.yPrec) * alpha
    const z = sujet.zPrec + (sujet.z - sujet.zPrec) * alpha
    const lacet = sujet.lacetPrec + (sujet.lacet - sujet.lacetPrec) * alpha
    if (etat === ETATS.COURSE) {
      const derive = Math.abs(j.vx) > 4 ? Math.atan2(j.vy, Math.abs(j.vx)) : 0
      this.camera.poursuivre(dt, x, y, z, lacet, j.vx, derive, this.secousse)
    } else if (etat === ETATS.DECOMPTE) {
      // Travelling circulaire : part de trois-quarts face et finit derrière la voiture.
      const p = Math.max(0, Math.min(1, course.decompte / 3.2))
      const doux = p * p * (3 - 2 * p)
      this.camera.definirAngle(lacet + Math.PI + doux * 2.4)
      this.camera.orbiter(dt, x, y + 0.6, z, 6.4 + doux * 3, 2.0 + doux * 1.2, 0)
    } else if (etat === ETATS.MENU) {
      this.camera.orbiter(dt, x, y, z, 13, 4.5, 0.25)
    } else {
      this.camera.orbiter(dt, x, y, z, 9.5, 3.2, 0.35)
    }
    this.rendu.suivre(x, y, z)
  }

  /** Feux du portique + bips du décompte + sons d'impact. */
  mettreAJourFeux(course) {
    let etape = 0, chiffre = -1
    if (course.etat === ETATS.DECOMPTE) {
      chiffre = Math.min(3, Math.ceil(course.decompte))
      etape = 4 - chiffre
    } else if (course.etat === ETATS.COURSE && course.tempsCourse < 1.6) {
      etape = 4; chiffre = 0
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
    const hud = this.hud, j = course.joueur
    hud.etat = course.etat
    const v = Math.abs(j.vx)
    hud.vitesse = Math.round(Math.hypot(j.vx, j.vy) * 3.6)
    // Boîte de vitesses simulée (affichage + hauteur du son moteur).
    let r = 1
    while (r < 6 && v >= RAPPORTS[r]) r++
    hud.rapport = j.vx < -0.5 ? 0 : r
    const bas = RAPPORTS[r - 1] * 0.55
    hud.regime = Math.max(0.08, Math.min(1, (v - bas) / (RAPPORTS[r] - bas)))
    hud.fantome = course.fantome.visible
    hud.contresens = course.contresens
    hud.horsPiste = j.horsPiste > 0.5

    // Événements ponctuels.
    if (course.evtMeilleurTour !== this.vuRecord) {
      this.vuRecord = course.evtMeilleurTour
      hud.tempsRecord = formaterTemps(course.meilleurSession)
      hud.flashRecord++
      this.audio.bip(1320, 0.3)
    }
    // Rafraîchissement basse fréquence (≈ 20 Hz chronos, ≈ 7 Hz classement).
    if (this.image % 3 === 0) {
      hud.tempsCourse = formaterTemps(j.fini ? j.tempsFin : course.tempsCourse)
      const fige = j.fini || course.etat === ETATS.MENU
      hud.tempsTour = j.tourMax >= 0 && !fige ? formaterTemps(course.tempsCourse - j.tempsDebutTour) : j.fini ? formaterTemps(j.dernierTour) : '0:00.00'
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
