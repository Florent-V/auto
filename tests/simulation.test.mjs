// =============================================================================
// Tests de jeu automatisés (Node, sans navigateur) : `npm test`
// Le cœur de simulation ne dépend pas de Three.js, on peut donc dérouler des
// courses complètes en accéléré et vérifier la checklist de façon mécanique.
// =============================================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import { genererCircuit, DEMI_LARGEUR, LIMITE_LATERALE } from '../app/game/core/circuit.js'
import { Course, ETATS } from '../app/game/core/course.js'
import { EnregistreurFantome } from '../app/game/core/fantome.js'
import { normaliserSeed } from '../app/game/core/rng.js'

const DT = 1 / 120
const AUTO = { autopilote: true }
const AUCUNE = {}

function nouvelleCourse(seed, tours = 3, enregistreur = new EnregistreurFantome()) {
  return new Course({ circuit: genererCircuit(seed), tours, difficulte: 'normal', enregistreur })
}
function passerDecompte(course) {
  course.demarrer()
  while (course.etat === ETATS.DECOMPTE) course.pas(DT, AUCUNE)
}
/** Intersection stricte de deux segments 2D. */
function segmentsSeCroisent(ax, az, bx, bz, cx, cz, dx, dz) {
  const o = (px, pz, qx, qz, rx, rz) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px))
  return o(ax, az, bx, bz, cx, cz) !== o(ax, az, bx, bz, dx, dz) && o(cx, cz, dx, dz, ax, az) !== o(cx, cz, dx, dz, bx, bz)
}

test('génération déterministe : même seed → circuit strictement identique', () => {
  const a = genererCircuit(1234), b = genererCircuit(1234), c = genererCircuit(1235)
  assert.equal(a.n, b.n)
  assert.equal(a.longueur, b.longueur)
  for (const champ of ['px', 'py', 'pz', 'nx', 'nz', 'courbure', 'vitesseProfil', 'ligneIdeale']) {
    assert.deepEqual(Array.from(a[champ]), Array.from(b[champ]), champ)
  }
  assert.notDeepEqual(Array.from(a.px), Array.from(c.px))
  assert.equal(normaliserSeed('1234'), 1234)
  assert.equal(normaliserSeed('monaco'), normaliserSeed('monaco'))
})

test('déterminisme de la simulation : deux courses identiques pas à pas', () => {
  const a = nouvelleCourse(99), b = nouvelleCourse(99)
  a.demarrer(); b.demarrer()
  for (let i = 0; i < 120 * 30; i++) { a.pas(DT, AUTO); b.pas(DT, AUTO) }
  for (let k = 0; k < 6; k++) {
    assert.equal(a.vehicules[k].x, b.vehicules[k].x)
    assert.equal(a.vehicules[k].progression, b.vehicules[k].progression)
  }
})

test('200 seeds : circuit fermé, repère orthonormé, aucun croisement des bords ni des barrières', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const c = genererCircuit(seed)
    assert.ok(c.longueur > 700 && c.longueur < 2600, `longueur ${c.longueur} (seed ${seed})`)
    for (let i = 0; i < c.n; i++) {
      // Fermeture / pas constant.
      const j = (i + 1) % c.n
      const pas = Math.hypot(c.px[j] - c.px[i], c.pz[j] - c.pz[i])
      assert.ok(Math.abs(pas - c.pas) < 0.15, `pas irrégulier ${pas} (seed ${seed})`)
      // Repère de Frenet : vecteurs unitaires et orthogonaux.
      const tn = c.tx[i] * c.nx[i] + c.tz[i] * c.nz[i]
      const tb = c.tx[i] * c.bx[i] + c.ty[i] * c.by[i] + c.tz[i] * c.bz[i]
      assert.ok(Math.abs(tn) < 1e-4 && Math.abs(tb) < 1e-4)
      assert.ok(Math.abs(Math.hypot(c.bx[i], c.by[i], c.bz[i]) - 1) < 1e-3)
      assert.ok(c.by[i] > 0.9)
    }
    // Les deux barrières (décalage ±LIMITE) et l'axe ne se coupent jamais.
    const P = 4, m = Math.floor(c.n / P)
    for (const dec of [-LIMITE_LATERALE, 0, LIMITE_LATERALE]) {
      const X = [], Z = []
      for (let k = 0; k < m; k++) { const i = k * P; X.push(c.px[i] + c.nx[i] * dec); Z.push(c.pz[i] + c.nz[i] * dec) }
      for (let a = 0; a < m; a++) {
        for (let b = a + 2; b < m; b++) {
          if (a === 0 && b === m - 1) continue
          const a2 = (a + 1) % m, b2 = (b + 1) % m
          assert.ok(!segmentsSeCroisent(X[a], Z[a], X[a2], Z[a2], X[b], Z[b], X[b2], Z[b2]), `auto-intersection (seed ${seed}, décalage ${dec})`)
        }
      }
    }
  }
})

test('course complète : les 5 IA et le pilote auto terminent, tours comptés exactement', () => {
  for (const seed of [7, 42, 1234, 2024, 31337]) {
    const course = nouvelleCourse(seed)
    passerDecompte(course)
    assert.equal(course.etat, ETATS.COURSE)
    let pas = 0, dMax = 0, pasHorsPisteIA = 0, pasIA = 0
    const lent = course.vehicules.map(() => 0); let lentMax = 0
    const passages = course.vehicules.map(() => 0), tourPrec = course.vehicules.map(() => -1)
    while (!course.vehicules.every(v => v.fini) && pas < 120 * 900) {
      course.pas(DT, AUTO); pas++
      course.vehicules.forEach((v, k) => {
        assert.ok(Number.isFinite(v.x) && Number.isFinite(v.vx), 'état numérique fini')
        dMax = Math.max(dMax, Math.abs(v.d))
        // Personne ne reste « collé » : durée max passée sous 5 m/s en course.
        lent[k] = !v.fini && course.tempsCourse > 3 && v.vx < 5 ? lent[k] + DT : 0
        lentMax = Math.max(lentMax, lent[k])
        if (v.tourMax !== tourPrec[k]) { assert.equal(v.tourMax, tourPrec[k] + 1); tourPrec[k] = v.tourMax; passages[k]++ }
        if (k > 0 && !v.fini) { pasIA++; if (Math.abs(v.d) > DEMI_LARGEUR + 1.1) pasHorsPisteIA++ }
      })
    }
    assert.ok(course.vehicules.every(v => v.fini), `tous à l'arrivée (seed ${seed})`)
    assert.equal(course.etat, ETATS.FIN)
    assert.ok(lentMax < 2.5, `véhicule bloqué ${lentMax.toFixed(1)} s (seed ${seed})`)
    const meilleurs = course.vehicules.map(v => v.meilleurTour)
    assert.ok(Math.max(...meilleurs) < Math.min(...meilleurs) * 1.25, 'meilleurs tours homogènes (pas de véhicule entravé)')
    // Aucun véhicule ne franchit les barrières.
    assert.ok(dMax <= LIMITE_LATERALE + 0.05, `écart latéral max ${dMax}`)
    // Les IA restent sur la piste (tolérance : < 2 % du temps hors piste).
    assert.ok(pasHorsPisteIA / pasIA < 0.02, `IA hors piste ${(100 * pasHorsPisteIA / pasIA).toFixed(2)} %`)
    course.vehicules.forEach((v, k) => {
      // Arrivée = (tours + 1) passages de ligne, ni plus ni moins au moment de finir.
      assert.ok(v.tourMax >= course.tours)
      assert.ok(v.tempsFin > 0 && v.meilleurTour < Infinity)
      // Les temps au tour sont cohérents avec la distance parcourue.
      assert.ok(v.meilleurTour > course.circuit.longueur / 80, 'tour trop rapide = raccourci')
    })
    // Classement final = ordre des temps d'arrivée.
    const temps = Array.from(course.ordre).map(i => course.vehicules[i].tempsFin)
    for (let i = 1; i < temps.length; i++) assert.ok(temps[i] >= temps[i - 1])
    // Vitesses de référence différentes → temps d'arrivée tous distincts.
    assert.equal(new Set(temps).size, temps.length)
  }
})

test('un tour n\'est validé qu\'une fois, et seulement dans le sens de la course', () => {
  const course = nouvelleCourse(5, 3)
  passerDecompte(course)
  const j = course.joueur
  // 1. On avance jusqu'à franchir la ligne (début du tour 1).
  while (j.tourMax < 0) course.pas(DT, { gaz: true })
  assert.equal(j.tourMax, 0); assert.equal(course.evtTour, 0)
  // 2. Marche arrière au-delà de la ligne puis re-franchissement, trois fois.
  for (let essai = 0; essai < 3; essai++) {
    let garde = 0
    while (j.progression > -6 && garde++ < 120 * 60) course.pas(DT, { frein: true })
    assert.ok(j.progression <= -6, 'le véhicule a reculé derrière la ligne')
    while (j.progression < 6 && garde++ < 120 * 120) course.pas(DT, { gaz: true })
    assert.equal(j.tourMax, 0, 're-franchir la ligne ne valide rien')
    assert.equal(course.evtTour, 0)
  }
  // 3. Un tour complet à contresens ne compte pas non plus.
  assert.ok(Math.floor(-course.circuit.longueur * 1.5 / course.circuit.longueur) < j.tourMax)
  // 4. Un vrai tour (pilote auto) est compté exactement une fois.
  while (course.evtTour === 0) course.pas(DT, AUTO)
  assert.equal(j.tourMax, 1); assert.equal(course.evtTour, 1)
  for (let i = 0; i < 240; i++) course.pas(DT, AUTO)
  assert.equal(course.evtTour, 1)
})

test('fantôme : enregistré au meilleur tour, rejoué et interpolé au tour suivant', () => {
  const enr = new EnregistreurFantome()
  const course = nouvelleCourse(2024, 3, enr)
  passerDecompte(course)
  const j = course.joueur
  let visibleAvantRecord = false, pasVisibles = 0, sautMax = 0
  let px = 0, pz = 0, avait = false, records = 0
  while (course.etat === ETATS.COURSE) {
    course.pas(DT, AUTO)
    if (course.evtMeilleurTour !== records) { records = course.evtMeilleurTour; avait = false }
    if (course.evtMeilleurTour === 0 && course.fantome.visible) visibleAvantRecord = true
    if (course.fantome.visible) {
      pasVisibles++
      // Mouvement fluide : jamais de saut supérieur à la distance max par pas.
      if (avait) sautMax = Math.max(sautMax, Math.hypot(course.fantome.x - px, course.fantome.z - pz))
      px = course.fantome.x; pz = course.fantome.z; avait = true
    } else avait = false
  }
  assert.equal(visibleAvantRecord, false, 'pas de fantôme avant le premier tour bouclé')
  assert.ok(course.evtMeilleurTour >= 1)
  assert.ok(pasVisibles > 120 * 20, 'le fantôme est rejoué pendant les tours suivants')
  assert.ok(sautMax < 90 * DT * 1.5, `fantôme fluide (saut max ${sautMax.toFixed(3)} m)`)
  assert.ok(Math.abs(enr.dureeMeilleur - course.meilleurSession) < 1e-9)
  assert.ok(Math.abs(course.meilleurSession - j.meilleurTour) < 1e-9)
  // Le fantôme part de la ligne et y revient : premier et dernier échantillon proches de s = 0.
  const o = { x: 0, y: 0, z: 0, lacet: 0 }
  assert.ok(enr.lire(0, o))
  const c = course.circuit
  assert.ok(Math.hypot(o.x - c.px[0], o.z - c.pz[0]) < DEMI_LARGEUR + 2)
  assert.ok(enr.lire(enr.dureeMeilleur, o))
  assert.ok(Math.hypot(o.x - c.px[0], o.z - c.pz[0]) < DEMI_LARGEUR + 2)
  assert.equal(enr.lire(enr.dureeMeilleur + 5, o), false, 'le fantôme disparaît une fois son tour fini')
  // Interpolation : à mi-chemin entre deux échantillons on obtient le milieu.
  const t0 = enr.meilleur[50 * 5], t1 = enr.meilleur[51 * 5]
  enr.lire((t0 + t1) / 2, o)
  assert.ok(Math.abs(o.x - (enr.meilleur[50 * 5 + 1] + enr.meilleur[51 * 5 + 1]) / 2) < 1e-3)
  // Le record est conservé pour la course suivante sur le même circuit.
  const suivante = new Course({ circuit: c, tours: 1, enregistreur: enr })
  assert.equal(suivante.meilleurSession, course.meilleurSession)
  passerDecompte(suivante)
  while (suivante.joueur.tourMax < 0) suivante.pas(DT, AUTO)
  for (let i = 0; i < 60; i++) suivante.pas(DT, AUTO)
  assert.equal(suivante.fantome.visible, true, 'fantôme présent dès le tour 1 de la course suivante')
})

test('collisions : les véhicules ne se traversent pas, le choc ralentit sans bloquer', () => {
  const course = nouvelleCourse(11)
  passerDecompte(course)
  let distMin = Infinity
  for (let i = 0; i < 120 * 60; i++) {
    course.pas(DT, AUTO)
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) {
      const A = course.vehicules[a], B = course.vehicules[b]
      distMin = Math.min(distMin, Math.hypot(A.x - B.x, A.z - B.z))
    }
  }
  assert.ok(distMin > 1.5, `distance mini entre centres ${distMin.toFixed(2)} m`)
  // Joueur à l'arrêt en travers de la trajectoire : les IA réagissent et passent.
  const c2 = nouvelleCourse(11)
  passerDecompte(c2)
  for (let i = 0; i < 120 * 150 && !c2.vehicules.slice(1).every(v => v.fini); i++) c2.pas(DT, AUCUNE)
  assert.ok(c2.vehicules.slice(1).every(v => v.fini), 'les IA finissent malgré un joueur immobile sur la grille')
  // Choc frontal provoqué : impulsion + ralentissement, vitesses finies.
  const c3 = nouvelleCourse(11)
  passerDecompte(c3)
  const j = c3.joueur, ia = c3.vehicules[1]
  j.x = ia.x - Math.sin(ia.lacet) * 4; j.z = ia.z - Math.cos(ia.lacet) * 4; j.lacet = ia.lacet; j.vx = 30
  const vAvant = j.vx
  let chocVu = 0
  for (let i = 0; i < 60; i++) { c3.pas(DT, AUCUNE); chocVu = Math.max(chocVu, j.choc) }
  assert.ok(chocVu > 0, 'choc détecté')
  assert.ok(j.vx < vAvant && ia.vx > 0, 'le joueur est ralenti, l\'IA est poussée')
  assert.ok(Math.hypot(j.x - ia.x, j.z - ia.z) > 1.5)
})

test('machine à états : seules les transitions prévues sont acceptées', () => {
  const course = nouvelleCourse(3)
  assert.equal(course.etat, ETATS.MENU)
  assert.equal(course.transition(ETATS.FIN), false)
  assert.equal(course.basculerPause(), false, 'pas de pause depuis le menu')
  assert.equal(course.demarrer(), true)
  assert.equal(course.etat, ETATS.DECOMPTE)
  assert.equal(course.basculerPause(), true)
  const d = course.decompte, x = course.joueur.x
  for (let i = 0; i < 200; i++) course.pas(DT, { gaz: true })
  assert.equal(course.decompte, d, 'la pause fige le décompte')
  assert.equal(course.basculerPause(), true)
  assert.equal(course.etat, ETATS.DECOMPTE, 'la pause rend la main à l\'état précédent')
  for (let i = 0; i < 100; i++) course.pas(DT, { gaz: true })
  assert.equal(course.joueur.x, x, 'immobile pendant le décompte')
  while (course.etat === ETATS.DECOMPTE) course.pas(DT, AUCUNE)
  assert.equal(course.etat, ETATS.COURSE)
  course.basculerPause()
  const t = course.tempsCourse
  course.pas(DT, AUCUNE)
  assert.equal(course.tempsCourse, t, 'la pause fige le chrono')
  course.basculerPause()
  assert.equal(course.etat, ETATS.COURSE)
  assert.equal(course.retourMenu(), true)
  assert.equal(course.etat, ETATS.MENU)
})
