// =============================================================================
// MODULE : Course — machine à états, tours, chrono, classement, fantôme
// -----------------------------------------------------------------------------
// Orchestration de la simulation, indépendante du rendu (testable sous Node).
//
// Machine à états :
//
//   MENU ──► DECOMPTE ──► COURSE ──► FIN
//     ▲         │ ▲          │ ▲       │
//     │         ▼ │          ▼ │       │
//     ├──────── PAUSE ◄────────┘       │
//     └────────────────────────────────┘   (FIN ──► DECOMPTE pour rejouer)
//
// Validation des tours : chaque véhicule possède une « progression » cumulée
// et signée le long de la spline (négative sur la grille, derrière la ligne).
// Un passage de ligne est compté quand floor(progression / longueur) dépasse
// le maximum déjà atteint : un tour ne peut donc être validé qu'UNE fois et
// uniquement dans le sens de la course (reculer fait décroître la progression).
// =============================================================================
import { normaliserAngle } from './circuit.js'
import { creerRng } from './rng.js'
import { creerVehicule, definirModele, placerSurCircuit, pasVehicule } from './vehicule.js'
import { piloterIA } from './ia.js'
import { resoudreCollisions } from './collisions.js'

export const ETATS = Object.freeze({
  MENU: 'menu', DECOMPTE: 'decompte', COURSE: 'course', FIN: 'fin', PAUSE: 'pause'
})

/** Transitions autorisées de la machine à états. */
const TRANSITIONS = {
  menu: ['decompte'],
  decompte: ['course', 'pause', 'menu'],
  course: ['fin', 'pause', 'menu'],
  pause: ['decompte', 'course', 'menu'],
  fin: ['menu', 'decompte']
}

export const DUREE_DECOMPTE = 3.2
export const NB_IA = 5
/** Niveau des IA : fraction du profil de vitesse limite qu'elles exploitent. */
const DIFFICULTES = { facile: 0.93, normal: 0.97, difficile: 1.0 }
/** Adversaires : nom, livrée (couleur + accent) et modèle en plateau mixte. */
const PILOTES = [
  { nom: 'Véga', couleur: 0xe8112d, accent: 0xffffff, modele: 'f1' },
  { nom: 'Orion', couleur: 0xff9d0a, accent: 0x15161b, modele: 'hypercar' },
  { nom: 'Lyra', couleur: 0x7c3aed, accent: 0xf2f2f2, modele: 'sportive' },
  { nom: 'Nova', couleur: 0x22c55e, accent: 0xfde047, modele: 'f1' },
  { nom: 'Altaïr', couleur: 0xeef0f4, accent: 0xe11d48, modele: 'hypercar' }
]
export const COULEUR_JOUEUR = 0x18d6ff
export const ACCENT_JOUEUR = 0xff2a8a
export const MODELES = ['f1', 'hypercar', 'sportive']
/** Préréglages d'aides au pilotage. */
export const AIDES = {
  completes: { abs: true, antipatinage: true, stabilite: 2, contreBraquage: true },
  partielles: { abs: true, antipatinage: true, stabilite: 1, contreBraquage: true },
  aucune: { abs: false, antipatinage: false, stabilite: 0, contreBraquage: false },
  // Pilotes IA : toutes les aides.
  ia: { abs: true, antipatinage: true, stabilite: 2, contreBraquage: true }
}

/**
 * Emplacement sur la grille de départ (rang 0 = pole position), comme en F1 :
 * 8 m entre deux voitures, en quinconce, derrière la ligne.
 */
export function positionGrille(circuit, rang) {
  return { s: -(10 + rang * 8), d: (rang % 2 === 0 ? 1 : -1) * Math.min(2.6, circuit.demiLargeur * 0.42) }
}

export class Course {
  /**
   * @param {object} options
   * @param {object} options.circuit      circuit généré par `genererCircuit`
   * @param {number} options.tours        nombre de tours à boucler
   * @param {string} options.difficulte   'facile' | 'normal' | 'difficile'
   * @param {object} options.enregistreur EnregistreurFantome (conservé d'une course à l'autre)
   * @param {string} options.modeleJoueur 'f1' | 'hypercar' | 'sportive'
   * @param {string} options.plateau      'monotype' (tous la même voiture) | 'mixte'
   * @param {string} options.aides        'completes' | 'partielles' | 'aucune'
   * @param {boolean} options.boiteAuto
   */
  constructor({ circuit, tours = 3, difficulte = 'normal', enregistreur, modeleJoueur = 'hypercar',
    plateau = 'monotype', aides = 'completes', boiteAuto = true }) {
    this.circuit = circuit
    this.tours = tours
    this.difficulte = difficulte
    this.enregistreur = enregistreur
    this.etat = ETATS.MENU
    this.etatAvantPause = ETATS.COURSE
    this.tempsCourse = 0
    this.decompte = DUREE_DECOMPTE
    this.compteurPas = 0

    // --- Véhicules : indice 0 = joueur, 1..5 = IA ---------------------------
    const modele = MODELES.includes(modeleJoueur) ? modeleJoueur : 'hypercar'
    this.plateau = plateau
    this.aidesJoueur = AIDES[aides] ?? AIDES.completes
    this.boiteAutoJoueur = boiteAuto
    this.joueur = creerVehicule(0, 'Vous', COULEUR_JOUEUR, true, modele)
    this.joueur.accent = ACCENT_JOUEUR
    this.vehicules = [this.joueur]
    for (let i = 0; i < NB_IA; i++) {
      const v = creerVehicule(i + 1, PILOTES[i].nom, PILOTES[i].couleur, false, plateau === 'mixte' ? PILOTES[i].modele : modele)
      v.accent = PILOTES[i].accent
      this.vehicules.push(v)
    }
    /** Classement : indices de véhicules triés du premier au dernier. */
    this.ordre = new Int8Array(this.vehicules.length)
    this.positionJoueur = this.vehicules.length

    // --- Fantôme et retours pour l'interface --------------------------------
    this.meilleurSession = enregistreur && enregistreur.disponible ? enregistreur.dureeMeilleur : Infinity
    this.fantome = { visible: false, x: 0, y: 0, z: 0, lacet: 0 }
    this.contresens = false
    // Compteurs d'événements (l'interface compare avec sa dernière valeur lue).
    this.evtTour = 0
    this.evtMeilleurTour = 0

    this.reinitialiserGrille()
  }

  // ---------------------------------------------------------------------------
  // Machine à états
  // ---------------------------------------------------------------------------
  /** Tente une transition ; renvoie false (sans effet) si elle est interdite. */
  transition(vers) {
    if (!TRANSITIONS[this.etat].includes(vers)) return false
    if (vers === ETATS.PAUSE) this.etatAvantPause = this.etat
    this.etat = vers
    return true
  }

  /** Menu ou fin de course → nouvelle course (grille + compte à rebours). */
  demarrer() {
    if (!this.transition(ETATS.DECOMPTE)) return false
    this.reinitialiserGrille()
    return true
  }

  /** Touche P : bascule pause ↔ état précédent (décompte ou course). */
  basculerPause() {
    if (this.etat === ETATS.PAUSE) return this.transition(this.etatAvantPause)
    return this.transition(ETATS.PAUSE)
  }

  /** Retour au menu : les voitures tournent en mode démonstration. */
  retourMenu() {
    if (!this.transition(ETATS.MENU)) return false
    this.reinitialiserGrille()
    return true
  }

  // ---------------------------------------------------------------------------
  // Mise en place
  // ---------------------------------------------------------------------------
  /** Replace tout le monde sur la grille et remet les compteurs à zéro. */
  reinitialiserGrille() {
    const c = this.circuit
    // Les niveaux des IA dépendent de la seed du circuit : même seed, même course.
    const rng = creerRng((c.seed ^ 0x51ed270b) >>> 0)
    const facteur = DIFFICULTES[this.difficulte] ?? DIFFICULTES.normal
    const niveaux = [0.965, 0.974, 0.983, 0.992, 1.0]
    for (let i = niveaux.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const t = niveaux[i]; niveaux[i] = niveaux[j]; niveaux[j] = t
    }
    this.tempsCourse = 0
    this.decompte = DUREE_DECOMPTE
    this.compteurPas = 0
    this.contresens = false
    this.fantome.visible = false
    for (let k = 0; k < this.vehicules.length; k++) {
      const v = this.vehicules[k]
      // Grille en quinconce derrière la ligne ; le joueur part dernier.
      const rang = v.estJoueur ? NB_IA : k - 1
      const { s, d } = positionGrille(c, rang)
      placerSurCircuit(v, c, s, d)
      v.progression = s
      v.tourMax = -1
      v.tempsDebutTour = 0; v.dernierTour = 0; v.meilleurTour = Infinity
      v.fini = false; v.tempsFin = 0
      v.cmdGaz = 0; v.cmdFrein = 0; v.cmdDir = 0; v.cmdFam = false
      v.choc = 0; v.contactMur = 0
      const niveauBase = v.estJoueur ? 0.97 : niveaux[k - 1]
      v.ia.niveau = niveauBase * facteur * (0.997 + rng() * 0.006)
      v.ia.decalagePerso = (rng() - 0.5) * Math.min(2.2, c.demiLargeur * 0.3)
      v.ia.lat = d
      v.ia.bloque = 0
      v.aides = AIDES.ia
      v.boiteAuto = true
    }
    if (this.enregistreur) {
      this.enregistreur.debuterTour()
      this.enregistreur.rembobiner()
    }
    this.calculerClassement()
  }

  // ---------------------------------------------------------------------------
  // Boucle de simulation (pas de temps fixe)
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt pas de temps fixe (secondes)
   * @param {object} entrees { gaz, frein (0..1 ou booléens), direction (-1..1) ou
   *   gauche/droite, fam, passage (+1 / -1, consommé), autopilote, replacer }
   */
  pas(dt, entrees) {
    const etat = this.etat
    if (etat === ETATS.PAUSE) return
    const vehicules = this.vehicules, c = this.circuit

    if (etat === ETATS.DECOMPTE) {
      // Véhicules immobiles ; on fige aussi l'état précédent (interpolation).
      for (let k = 0; k < vehicules.length; k++) {
        const v = vehicules[k]
        v.xPrec = v.x; v.yPrec = v.y; v.zPrec = v.z; v.lacetPrec = v.lacet
      }
      this.decompte -= dt
      if (this.decompte <= 0) this.transition(ETATS.COURSE)
      return
    }

    const enCourse = etat === ETATS.COURSE || etat === ETATS.FIN
    if (enCourse) this.tempsCourse += dt
    this.compteurPas++

    // --- 1. Commandes --------------------------------------------------------
    const joueur = this.joueur
    // Le joueur ne conduit (avec SES réglages) qu'en course et sans pilote auto.
    const manuel = etat === ETATS.COURSE && !entrees.autopilote
    joueur.aides = manuel ? this.aidesJoueur : AIDES.ia
    joueur.boiteAuto = manuel ? this.boiteAutoJoueur : true
    for (let k = 0; k < vehicules.length; k++) {
      const v = vehicules[k]
      v.choc *= 0.9
      if (v.estJoueur && manuel) {
        v.cmdGaz = Math.min(1, Math.max(0, +entrees.gaz || 0))
        v.cmdFrein = Math.min(1, Math.max(0, +entrees.frein || 0))
        v.cmdDir = entrees.direction !== undefined ? Math.max(-1, Math.min(1, entrees.direction)) : (entrees.gauche ? 1 : 0) - (entrees.droite ? 1 : 0)
        v.cmdFam = !!entrees.fam
        if (entrees.passage) { v.demandePassage = entrees.passage; entrees.passage = 0 }
        if (entrees.replacer) this.replacerJoueur()
      } else {
        // IA, mode démo du menu, ou tour d'honneur après l'arrivée.
        const plafond = v.fini ? 26 : etat === ETATS.MENU ? 55 : Infinity
        piloterIA(v, vehicules, c, dt, plafond)
      }
    }

    // --- 2. Physique + collisions -------------------------------------------
    for (let k = 0; k < vehicules.length; k++) pasVehicule(vehicules[k], c, dt)
    resoudreCollisions(vehicules)

    if (!enCourse) return

    // --- 3. Tours, chrono, fantôme, classement ------------------------------
    for (let k = 0; k < vehicules.length; k++) this.gererTours(vehicules[k], dt)

    if (etat === ETATS.COURSE) {
      const enr = this.enregistreur
      const tTour = this.tempsCourse - joueur.tempsDebutTour
      // Enregistrement du tour en cours (un pas sur deux ≈ 60 Hz).
      if (joueur.tourMax >= 0 && (this.compteurPas & 1) === 0) {
        enr.echantillonner(tTour, joueur.x, joueur.y, joueur.z, joueur.lacet)
      }
      // Relecture interpolée du meilleur tour.
      this.fantome.visible = joueur.tourMax >= 0 && enr.disponible && enr.lire(tTour, this.fantome)
      const erreurCap = Math.abs(normaliserAngle(joueur.lacet - c.cap[joueur.idx]))
      this.contresens = erreurCap > 2 && joueur.vx > 3
      if (joueur.fini) this.terminer()
    } else {
      this.fantome.visible = false
    }
    this.calculerClassement()
  }

  /** Détecte et valide le franchissement de la ligne pour un véhicule. */
  gererTours(v, dt) {
    const L = this.circuit.longueur
    const tourActuel = Math.floor(v.progression / L)
    if (tourActuel <= v.tourMax) return
    // Instant exact du franchissement, interpolé à l'intérieur du pas.
    const vitesseAvance = Math.max(v.vx, 0.1)
    const depassement = v.progression - tourActuel * L
    const tPassage = this.tempsCourse - Math.min(dt, depassement / vitesseAvance)
    const tourBoucle = v.tourMax >= 0 // le tout premier passage lance le tour 1
    v.tourMax = tourActuel
    if (tourBoucle && !v.fini) {
      const temps = tPassage - v.tempsDebutTour
      v.dernierTour = temps
      if (temps < v.meilleurTour) v.meilleurTour = temps
      if (v.estJoueur) {
        this.evtTour++
        if (temps < this.meilleurSession) {
          // Nouveau record : le tour enregistré devient le fantôme.
          this.meilleurSession = temps
          this.enregistreur.validerCommeMeilleur(temps)
          this.evtMeilleurTour++
        }
      }
      if (v.tourMax >= this.tours) {
        v.fini = true
        v.tempsFin = tPassage
      }
    }
    v.tempsDebutTour = tPassage
    if (v.estJoueur) {
      this.enregistreur.debuterTour()
      this.enregistreur.rembobiner()
    }
  }

  /** Le joueur a bouclé tous ses tours. */
  terminer() {
    this.transition(ETATS.FIN)
  }

  /** Touche R : remet le joueur au centre de la piste, à l'arrêt. */
  replacerJoueur() {
    const j = this.joueur
    const progression = j.progression
    const marge = this.circuit.demiLargeur - 2
    placerSurCircuit(j, this.circuit, j.s, Math.max(-marge, Math.min(marge, j.d)))
    j.progression = progression
  }

  /**
   * Classement en direct : d'abord les véhicules arrivés (par temps), puis les
   * autres par progression sur la spline. Tri par insertion, sans allocation.
   */
  calculerClassement() {
    const vs = this.vehicules, ordre = this.ordre, n = vs.length
    for (let i = 0; i < n; i++) ordre[i] = i
    for (let i = 1; i < n; i++) {
      const courant = ordre[i]
      const cle = this.cleClassement(vs[courant])
      let j = i - 1
      while (j >= 0 && this.cleClassement(vs[ordre[j]]) < cle) {
        ordre[j + 1] = ordre[j]
        j--
      }
      ordre[j + 1] = courant
    }
    for (let i = 0; i < n; i++) if (ordre[i] === 0) this.positionJoueur = i + 1
  }

  cleClassement(v) {
    return v.fini ? 1e9 - v.tempsFin : v.progression
  }

  /** Numéro du tour en cours pour le joueur (borné à [1, tours]). */
  get tourJoueur() {
    return Math.min(this.tours, Math.max(1, this.joueur.tourMax + 1))
  }
}


/** Change le modèle du joueur (et des IA en plateau monotype) sans recréer la course. */
export function changerModele(course, modele) {
  if (!MODELES.includes(modele)) return
  definirModele(course.joueur, modele)
  if (course.plateau !== 'mixte') for (const v of course.vehicules) definirModele(v, modele)
}
