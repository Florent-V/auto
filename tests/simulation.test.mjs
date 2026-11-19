// =============================================================================
// Tests de jeu automatisés (Node, sans navigateur) : `npm test`
// Le cœur de simulation ne dépend pas de Three.js, on peut donc dérouler des
// courses complètes en accéléré et vérifier la checklist de façon mécanique.
// =============================================================================
import test from 'node:test'
import assert from 'node:assert/strict'
import { genererCircuit, construireCircuit, SURFACE } from '../app/game/core/circuit.js'
import { CIRCUITS_CELEBRES, construireCircuitReel, construireDepuisReference, pointsCircuitReel } from '../app/game/core/circuits-reels.js'
import { Course, ETATS, MODELES, AIDES } from '../app/game/core/course.js'
import { EnregistreurFantome } from '../app/game/core/fantome.js'
import { normaliserSeed } from '../app/game/core/rng.js'
import { SPECS, G } from '../app/game/core/modeles.js'
import { creerVehicule, placerSurCircuit, pasVehicule, contactEn, CONTACT } from '../app/game/core/vehicule.js'
import { encoderTrace, decoderTrace, evaluerTrace, simplifier } from '../app/game/core/trace-perso.js'

const DT = 1 / 120
const AUTO = { autopilote: true }
const AUCUNE = {}

function nouvelleCourse(ref, options = {}) {
  const circuit = typeof ref === 'number' ? genererCircuit(ref) : construireDepuisReference(ref)
  return new Course({ circuit, tours: 3, difficulte: 'normal', enregistreur: new EnregistreurFantome(), ...options })
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
/** Vérifie qu'une polyligne fermée décalée de `dec` ne se recoupe pas. */
function sansCroisement(c, dec, P = 4) {
  const m = Math.floor(c.n / P), X = [], Z = []
  for (let k = 0; k < m; k++) {
    const i = k * P, d = typeof dec === 'function' ? dec(i) : dec
    X.push(c.px[i] + c.nx[i] * d); Z.push(c.pz[i] + c.nz[i] * d)
  }
  for (let a = 0; a < m; a++) {
    for (let b = a + 2; b < m; b++) {
      if (a === 0 && b === m - 1) continue
      const a2 = (a + 1) % m, b2 = (b + 1) % m
      if (segmentsSeCroisent(X[a], Z[a], X[a2], Z[a2], X[b], Z[b], X[b2], Z[b2])) return false
    }
  }
  return true
}
/** Anneau plat géant (quasi ligne droite) pour les essais de physique. */
function anneau(rayon, options = {}) {
  const pts = []
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([Math.cos(a) * rayon, Math.sin(a) * rayon]) }
  return construireCircuit({ points: pts, altitude: { type: 'profil', points: [[0, 0]] }, demiLargeur: 12, tolerant: true, ...options })
}
const DROITE = anneau(6000)
function essai(modele, v0, aides = AIDES.completes) {
  const v = creerVehicule(0, 'essai', 0, true, modele)
  placerSurCircuit(v, DROITE, 0, 0, v0)
  v.aides = aides
  return v
}
const tenirCap = (v) => { v.cmdDir = Math.max(-1, Math.min(1, -(Math.sin(v.lacet - DROITE.cap[v.idx]) + v.d * 0.02) * 6)) }

// -----------------------------------------------------------------------------
// Circuits
// -----------------------------------------------------------------------------
test('génération déterministe : même seed → circuit strictement identique', () => {
  const a = genererCircuit(1234), b = genererCircuit(1234), c = genererCircuit(1235)
  assert.equal(a.n, b.n)
  assert.equal(a.longueur, b.longueur)
  for (const champ of ['px', 'py', 'pz', 'nx', 'nz', 'courbure', 'ligneIdeale', 'limG', 'limD', 'surfG', 'vibD']) {
    assert.deepEqual(Array.from(a[champ]), Array.from(b[champ]), champ)
  }
  assert.notDeepEqual(Array.from(a.px), Array.from(c.px))
  assert.equal(normaliserSeed('1234'), 1234)
  assert.equal(normaliserSeed('monaco'), normaliserSeed('monaco'))
  const r1 = construireCircuitReel('spa'), r2 = construireCircuitReel('spa')
  assert.deepEqual(Array.from(r1.py), Array.from(r2.py))
})

test('200 seeds : circuit fermé, repère orthonormé, piste et barrières sans croisement', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const c = genererCircuit(seed)
    assert.equal(c.problemes.length, 0, `seed ${seed} : ${c.problemes.map(p => p.message)}`)
    assert.ok(c.longueur > 700 && c.longueur < 2600, `longueur ${c.longueur} (seed ${seed})`)
    for (let i = 0; i < c.n; i++) {
      const j = (i + 1) % c.n
      const pas = Math.hypot(c.px[j] - c.px[i], c.pz[j] - c.pz[i])
      assert.ok(Math.abs(pas - c.pas) < 0.15, `pas irrégulier ${pas} (seed ${seed})`)
      const tn = c.tx[i] * c.nx[i] + c.tz[i] * c.nz[i]
      const tb = c.tx[i] * c.bx[i] + c.ty[i] * c.by[i] + c.tz[i] * c.bz[i]
      assert.ok(Math.abs(tn) < 1e-4 && Math.abs(tb) < 1e-4)
      assert.ok(Math.abs(Math.hypot(c.bx[i], c.by[i], c.bz[i]) - 1) < 1e-3)
    }
    for (const dec of [0, c.demiLargeur, -c.demiLargeur]) assert.ok(sansCroisement(c, dec), `bord ${dec} (seed ${seed})`)
    assert.ok(sansCroisement(c, (i) => c.limG[i]), `barrière gauche (seed ${seed})`)
    assert.ok(sansCroisement(c, (i) => -c.limD[i]), `barrière droite (seed ${seed})`)
  }
})

test('circuits célèbres : longueur fidèle, sens, relief, habillage cohérent', () => {
  assert.ok(CIRCUITS_CELEBRES.length >= 9)
  for (const { id, longueurReelle } of CIRCUITS_CELEBRES) {
    const c = construireCircuitReel(id)
    // La longueur après lissage reste à ±3 % du tracé officiel.
    assert.ok(Math.abs(c.longueur - longueurReelle) / longueurReelle < 0.03, `${id} : ${c.longueur} m / ${longueurReelle} m`)
    for (const dec of [c.demiLargeur, -c.demiLargeur]) assert.ok(sansCroisement(c, dec, 2), `${id} : bord ${dec}`)
    for (let i = 0; i < c.n; i++) {
      assert.ok(c.limG[i] >= c.demiLargeur + 1 && c.limD[i] >= c.demiLargeur + 1, `${id} : barrière trop proche`)
      assert.ok(Math.abs(c.ligneIdeale[i]) <= c.demiLargeur - 0.55, `${id} : trajectoire hors piste`)
      assert.ok(Math.abs(c.pente[i]) < 0.2, `${id} : pente irréaliste ${c.pente[i]}`)
    }
  }
  // Repères de réalisme : Spa ≈ 100 m de dénivelé, Monaco urbain (murs), Monza plat.
  const spa = construireCircuitReel('spa'), monaco = construireCircuitReel('monaco'), monza = construireCircuitReel('monza')
  assert.ok(spa.bornes.maxY - spa.bornes.minY > 80)
  assert.ok(monza.bornes.maxY - monza.bornes.minY < 10)
  assert.ok(monaco.urbain && Math.max(...monaco.limG) < monaco.demiLargeur + 2)
  // Surfaces : herbe, gravier et dégagements asphaltés existent sur un circuit permanent.
  const surfaces = new Set([...spa.surfG, ...spa.surfD])
  assert.ok(surfaces.has(SURFACE.HERBE) && surfaces.has(SURFACE.ASPHALTE))
})

test('circuits personnels : encodage compact, aller-retour et validation', () => {
  const def = { nom: 'Mon anneau ✓', points: [[0, 0], [300, 20], [420, 260], [180, 420], [-120, 300]], demiLargeur: 6, relief: 9, paysage: 'foret' }
  const texte = encoderTrace(def)
  assert.ok(/^[A-Za-z0-9_-]+$/.test(texte) && texte.length < 120, texte)
  const retour = decoderTrace(texte)
  assert.equal(retour.nom, def.nom)
  assert.equal(retour.demiLargeur, 6); assert.equal(retour.relief, 9); assert.equal(retour.paysage, 'foret')
  assert.deepEqual(retour.points, def.points)
  const ok = evaluerTrace(retour)
  assert.equal(ok.problemes.length, 0, ok.problemes.map(p => p.message).join())
  assert.ok(ok.circuit.longueur > 1000)
  // Un tracé qui se croise est refusé avec un message clair.
  const huit = evaluerTrace({ points: [[0, 0], [400, 400], [400, 0], [0, 400]], demiLargeur: 6 })
  assert.ok(huit.problemes.some(p => p.type === 'croisement'))
  assert.throws(() => decoderTrace('n%importe-quoi'))
  // Un circuit célèbre simplifié reste un point de départ valide pour l'éditeur.
  const base = simplifier(pointsCircuitReel('silverstone'), 6)
  assert.ok(base.length >= 20 && base.length < 140)
  assert.equal(evaluerTrace({ points: base, demiLargeur: 6.5 }).problemes.length, 0)
})

// -----------------------------------------------------------------------------
// Physique
// -----------------------------------------------------------------------------
test('physique : performances réalistes et hiérarchie F1 > hypercar > sportive', () => {
  const perf = {}
  for (const modele of MODELES) {
    const v = essai(modele, 0)
    let t = 0, t100 = 0
    while (t < 90) {
      v.cmdGaz = 1; tenirCap(v); pasVehicule(v, DROITE, DT); t += DT
      if (!t100 && v.vx >= 100 / 3.6) t100 = t
    }
    perf[modele] = { t100, vmax: v.vx * 3.6, rapport: v.rapport }
    // Freinage 100 → 0 avec ABS.
    const f = essai(modele, 100 / 3.6); f.rapport = 3
    let d = 0
    while (f.vx > 0.1) { f.cmdFrein = 1; tenirCap(f); pasVehicule(f, DROITE, DT); d += f.vx * DT }
    perf[modele].frein100 = d
  }
  // Fourchettes issues de valeurs publiques (F1, hypercars, GT de route).
  assert.ok(perf.f1.t100 > 2.2 && perf.f1.t100 < 3.3, `F1 0-100 ${perf.f1.t100}`)
  assert.ok(perf.sportive.t100 > 3.2 && perf.sportive.t100 < 5, `GT 0-100 ${perf.sportive.t100}`)
  assert.ok(perf.f1.vmax > 320 && perf.f1.vmax < 360, `F1 vmax ${perf.f1.vmax}`)
  assert.ok(perf.hypercar.vmax > 330 && perf.hypercar.vmax < 390, `hypercar vmax ${perf.hypercar.vmax}`)
  assert.ok(perf.sportive.vmax > 290 && perf.sportive.vmax < 340, `GT vmax ${perf.sportive.vmax}`)
  assert.ok(perf.f1.frein100 < perf.hypercar.frein100 && perf.hypercar.frein100 < perf.sportive.frein100)
  assert.ok(perf.sportive.frein100 > 28 && perf.sportive.frein100 < 40, `GT 100-0 ${perf.sportive.frein100}`)
  for (const m of MODELES) assert.equal(perf[m].rapport, SPECS[m].boite.rapports.length, `${m} : dernier rapport engagé`)
})

test('physique : ABS, antipatinage, appui aérodynamique et charge verticale', () => {
  // Sans ABS, un freinage brutal bloque les roues et rallonge la distance.
  const sans = essai('sportive', 30, AIDES.aucune), avec = essai('sportive', 30)
  let bloque = false, dSans = 0, dAvec = 0
  while (sans.vx > 0.5) { sans.cmdFrein = 1; tenirCap(sans); pasVehicule(sans, DROITE, DT); dSans += sans.vx * DT; bloque ||= sans.blocage === 1 }
  while (avec.vx > 0.5) { avec.cmdFrein = 1; tenirCap(avec); pasVehicule(avec, DROITE, DT); dAvec += avec.vx * DT; assert.equal(avec.blocage, 0) }
  assert.ok(bloque, 'roues bloquées sans ABS')
  assert.ok(dAvec < dSans, `ABS plus court (${dAvec.toFixed(1)} < ${dSans.toFixed(1)} m)`)
  // Sans antipatinage, la F1 patine au départ ; avec, jamais.
  const tcOff = essai('f1', 3, AIDES.aucune), tcOn = essai('f1', 3)
  let patine = false
  for (let k = 0; k < 240; k++) {
    tcOff.cmdGaz = tcOn.cmdGaz = 1; tenirCap(tcOff); tenirCap(tcOn)
    pasVehicule(tcOff, DROITE, DT); pasVehicule(tcOn, DROITE, DT)
    patine ||= tcOff.patinage === 1
    assert.equal(tcOn.patinage, 0)
  }
  assert.ok(patine, 'patinage sans antipatinage')
  // L'appui croît avec v² : à 300 km/h une F1 « pèse » plus de deux fois son poids.
  const f1 = essai('f1', 300 / 3.6); pasVehicule(f1, DROITE, DT)
  assert.ok((f1.chargeAv + f1.chargeAr) / (SPECS.f1.masse * G) > 2, `charge ${(f1.chargeAv + f1.chargeAr) / (SPECS.f1.masse * G)}`)
  const lente = essai('f1', 100 / 3.6); pasVehicule(lente, DROITE, DT)
  assert.ok(f1.appui > lente.appui * 8)
  // Relief : la compression d'Eau Rouge plaque la voiture plus qu'une ligne droite plate.
  const spa = construireCircuitReel('spa')
  let iComp = 0
  for (let i = 0; i < spa.n; i++) if (spa.courbureVerticale[i] > spa.courbureVerticale[iComp]) iComp = i
  const v = creerVehicule(0, 'e', 0, true, 'sportive')
  placerSurCircuit(v, spa, iComp * spa.pas, 0, 50); pasVehicule(v, spa, DT)
  const plat = essai('sportive', 50); pasVehicule(plat, DROITE, DT)
  assert.ok(v.chargeAv + v.chargeAr > (plat.chargeAv + plat.chargeAr) * 1.1, 'compression')
})

test('physique : surfaces (vibreur, herbe, gravier) sous chaque roue', () => {
  const c = construireCircuitReel('spa')
  // Premier bac à graviers (côté gauche : d > 0, côté droit : d < 0).
  let i = 0, cote = 0
  for (; i < c.n && !cote; i++) cote = c.surfG[i] === SURFACE.GRAVIER ? 1 : c.surfD[i] === SURFACE.GRAVIER ? -1 : 0
  i--
  assert.ok(cote !== 0, 'Spa possède un bac à graviers')
  assert.equal(contactEn(c, i, 0), CONTACT.PISTE)
  assert.equal(contactEn(c, i, cote * (c.demiLargeur + 3)), CONTACT.GRAVIER)
  let k = 0
  while (k < c.n && !c.vibD[k]) k++
  assert.equal(contactEn(c, k, -(c.demiLargeur + 0.3)), CONTACT.VIBREUR)
  // Le gravier freine beaucoup plus que la piste (roue libre, 100 km/h).
  const glisser = (d) => {
    const v = creerVehicule(0, 'e', 0, true, 'sportive')
    placerSurCircuit(v, c, i * c.pas, d, 100 / 3.6)
    for (let n = 0; n < 120; n++) { v.cmdDir = 0; pasVehicule(v, c, DT) }
    return v.vx
  }
  assert.ok(glisser(cote * (c.demiLargeur + 4)) < glisser(0) - 5, 'le gravier ralentit')
})

test('boîte : passages automatiques, boîte manuelle et marche arrière', () => {
  const v = essai('hypercar', 0)
  let precedent = 1
  for (let k = 0; k < 120 * 20; k++) {
    v.cmdGaz = 1; tenirCap(v); pasVehicule(v, DROITE, DT)
    assert.ok(v.rapport >= precedent, 'jamais de rétrogradage en pleine accélération')
    assert.ok(v.regime <= SPECS.hypercar.moteur.regimeMax + 1)
    precedent = v.rapport
  }
  assert.ok(v.rapport >= 5)
  const m = essai('sportive', 0); m.boiteAuto = false
  for (let k = 0; k < 120 * 4; k++) { m.cmdGaz = 1; tenirCap(m); pasVehicule(m, DROITE, DT) }
  assert.equal(m.rapport, 1, 'la boîte manuelle reste sur le rapport choisi')
  m.demandePassage = 1; pasVehicule(m, DROITE, DT)
  assert.equal(m.rapport, 2)
  const r = essai('sportive', 0)
  for (let k = 0; k < 120 * 2; k++) { r.cmdFrein = 1; tenirCap(r); pasVehicule(r, DROITE, DT) }
  assert.equal(r.rapport, -1)
  assert.ok(r.vx < -1, 'marche arrière')
})

// -----------------------------------------------------------------------------
// Course
// -----------------------------------------------------------------------------
test('déterminisme de la simulation : deux courses identiques pas à pas', () => {
  const a = nouvelleCourse(99), b = nouvelleCourse(99)
  a.demarrer(); b.demarrer()
  for (let i = 0; i < 120 * 30; i++) { a.pas(DT, AUTO); b.pas(DT, AUTO) }
  for (let k = 0; k < 6; k++) {
    assert.equal(a.vehicules[k].x, b.vehicules[k].x)
    assert.equal(a.vehicules[k].progression, b.vehicules[k].progression)
  }
})

test('course complète : les 5 IA et le pilote auto terminent, tours comptés exactement', () => {
  const cas = [[7, 'hypercar'], [1234, 'f1'], [{ type: 'reel', id: 'monaco' }, 'sportive'], [{ type: 'reel', id: 'spielberg' }, 'f1']]
  for (const [ref, modele] of cas) {
    const course = nouvelleCourse(ref, { modeleJoueur: modele, tours: 2 })
    const c = course.circuit
    passerDecompte(course)
    assert.equal(course.etat, ETATS.COURSE)
    let pas = 0, pasHorsPisteIA = 0, pasIA = 0
    const lent = course.vehicules.map(() => 0); let lentMax = 0
    const tourPrec = course.vehicules.map(() => -1)
    while (!course.vehicules.every(v => v.fini) && pas < 120 * 900) {
      course.pas(DT, AUTO); pas++
      course.vehicules.forEach((v, k) => {
        assert.ok(Number.isFinite(v.x) && Number.isFinite(v.vx), 'état numérique fini')
        // La carrosserie ne traverse jamais les barrières.
        const lim = v.d > 0 ? c.limG[v.idx] : c.limD[v.idx]
        assert.ok(Math.abs(v.d) <= lim - v.spec.demiLargeurCaisse + 0.05, `barrière franchie (${c.id})`)
        lent[k] = !v.fini && course.tempsCourse > 3 && v.vx < 4 ? lent[k] + DT : 0
        lentMax = Math.max(lentMax, lent[k])
        if (v.tourMax !== tourPrec[k]) { assert.equal(v.tourMax, tourPrec[k] + 1); tourPrec[k] = v.tourMax }
        if (k > 0 && !v.fini) { pasIA++; if (v.horsPiste > 0.4) pasHorsPisteIA++ }
      })
    }
    assert.ok(course.vehicules.every(v => v.fini), `tous à l'arrivée (${c.id})`)
    assert.equal(course.etat, ETATS.FIN)
    assert.ok(lentMax < 3, `véhicule bloqué ${lentMax.toFixed(1)} s (${c.id})`)
    assert.ok(pasHorsPisteIA / pasIA < 0.03, `IA hors piste ${(100 * pasHorsPisteIA / pasIA).toFixed(2)} % (${c.id})`)
    const temps = Array.from(course.ordre).map(i => course.vehicules[i].tempsFin)
    for (let i = 1; i < temps.length; i++) assert.ok(temps[i] >= temps[i - 1])
    assert.equal(new Set(temps).size, temps.length)
  }
})

test("un tour n'est validé qu'une fois, et seulement dans le sens de la course", () => {
  const course = nouvelleCourse(5)
  passerDecompte(course)
  const j = course.joueur
  while (j.tourMax < 0) course.pas(DT, { gaz: true })
  assert.equal(j.tourMax, 0); assert.equal(course.evtTour, 0)
  for (let essaiN = 0; essaiN < 3; essaiN++) {
    let garde = 0
    while (j.progression > -6 && garde++ < 120 * 60) course.pas(DT, { frein: true })
    assert.ok(j.progression <= -6, 'le véhicule a reculé derrière la ligne')
    while (j.progression < 6 && garde++ < 120 * 120) course.pas(DT, { gaz: true })
    assert.equal(j.tourMax, 0, 're-franchir la ligne ne valide rien')
    assert.equal(course.evtTour, 0)
  }
  while (course.evtTour === 0) course.pas(DT, AUTO)
  assert.equal(j.tourMax, 1); assert.equal(course.evtTour, 1)
  for (let i = 0; i < 240; i++) course.pas(DT, AUTO)
  assert.equal(course.evtTour, 1)
})

test('fantôme : enregistré au meilleur tour, rejoué et interpolé au tour suivant', () => {
  const enr = new EnregistreurFantome()
  const circuit = genererCircuit(2024)
  const course = new Course({ circuit, tours: 3, enregistreur: enr })
  passerDecompte(course)
  const j = course.joueur
  let visibleAvantRecord = false, pasVisibles = 0, sautMax = 0, px = 0, pz = 0, avait = false, records = 0
  while (course.etat === ETATS.COURSE) {
    course.pas(DT, AUTO)
    if (course.evtMeilleurTour !== records) { records = course.evtMeilleurTour; avait = false }
    if (course.evtMeilleurTour === 0 && course.fantome.visible) visibleAvantRecord = true
    if (course.fantome.visible) {
      pasVisibles++
      if (avait) sautMax = Math.max(sautMax, Math.hypot(course.fantome.x - px, course.fantome.z - pz))
      px = course.fantome.x; pz = course.fantome.z; avait = true
    } else avait = false
  }
  assert.equal(visibleAvantRecord, false, 'pas de fantôme avant le premier tour bouclé')
  assert.ok(course.evtMeilleurTour >= 1)
  assert.ok(pasVisibles > 120 * 15, 'le fantôme est rejoué pendant les tours suivants')
  assert.ok(sautMax < 100 * DT * 1.5, `fantôme fluide (saut max ${sautMax.toFixed(3)} m)`)
  assert.ok(Math.abs(enr.dureeMeilleur - course.meilleurSession) < 1e-9)
  assert.ok(Math.abs(course.meilleurSession - j.meilleurTour) < 1e-9)
  const o = { x: 0, y: 0, z: 0, lacet: 0 }
  assert.ok(enr.lire(0, o))
  assert.ok(Math.hypot(o.x - circuit.px[0], o.z - circuit.pz[0]) < circuit.demiLargeur + 2)
  assert.equal(enr.lire(enr.dureeMeilleur + 5, o), false, 'le fantôme disparaît une fois son tour fini')
  const t0 = enr.meilleur[50 * 5], t1 = enr.meilleur[51 * 5]
  enr.lire((t0 + t1) / 2, o)
  assert.ok(Math.abs(o.x - (enr.meilleur[50 * 5 + 1] + enr.meilleur[51 * 5 + 1]) / 2) < 1e-3)
  const suivante = new Course({ circuit, tours: 1, enregistreur: enr })
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
  const c2 = nouvelleCourse(11, { tours: 2 })
  passerDecompte(c2)
  for (let i = 0; i < 120 * 150 && !c2.vehicules.slice(1).every(v => v.fini); i++) c2.pas(DT, AUCUNE)
  assert.ok(c2.vehicules.slice(1).every(v => v.fini), 'les IA finissent malgré un joueur immobile sur la grille')
  const c3 = nouvelleCourse(11)
  passerDecompte(c3)
  const j = c3.joueur, ia = c3.vehicules[1]
  j.x = ia.x - Math.sin(ia.lacet) * 4; j.z = ia.z - Math.cos(ia.lacet) * 4; j.lacet = ia.lacet; j.vx = 30
  let chocVu = 0
  for (let i = 0; i < 60; i++) { c3.pas(DT, AUCUNE); chocVu = Math.max(chocVu, j.choc) }
  assert.ok(chocVu > 0, 'choc détecté')
  assert.ok(j.vx < 30 && ia.vx > 0, "le joueur est ralenti, l'IA est poussée")
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
  assert.equal(course.etat, ETATS.DECOMPTE)
  for (let i = 0; i < 100; i++) course.pas(DT, { gaz: true })
  assert.equal(course.joueur.x, x, 'immobile pendant le décompte')
  while (course.etat === ETATS.DECOMPTE) course.pas(DT, AUCUNE)
  assert.equal(course.etat, ETATS.COURSE)
  course.basculerPause()
  const t = course.tempsCourse
  course.pas(DT, AUCUNE)
  assert.equal(course.tempsCourse, t, 'la pause fige le chrono')
  course.basculerPause()
  assert.equal(course.retourMenu(), true)
  assert.equal(course.etat, ETATS.MENU)
})

test('plateau : monotype par défaut, mixte sur demande, réglages du joueur appliqués', () => {
  const circuit = genererCircuit(77)
  const mono = new Course({ circuit, enregistreur: new EnregistreurFantome(), modeleJoueur: 'f1' })
  assert.ok(mono.vehicules.every(v => v.modele === 'f1' && v.spec === SPECS.f1))
  const mixte = new Course({ circuit, enregistreur: new EnregistreurFantome(), modeleJoueur: 'sportive', plateau: 'mixte' })
  assert.deepEqual([...new Set(mixte.vehicules.slice(1).map(v => v.modele))].sort(), [...MODELES].sort())
  assert.equal(new Course({ circuit, enregistreur: new EnregistreurFantome(), modeleJoueur: 'tracteur' }).joueur.modele, 'hypercar')
  const reglee = new Course({ circuit, enregistreur: new EnregistreurFantome(), aides: 'aucune', boiteAuto: false })
  passerDecompte(reglee)
  reglee.pas(DT, { gaz: 0.5, direction: 0.3 })
  assert.equal(reglee.joueur.aides, AIDES.aucune)
  assert.equal(reglee.joueur.boiteAuto, false)
  assert.equal(reglee.joueur.cmdGaz, 0.5)
  assert.equal(reglee.joueur.cmdDir, 0.3)
  reglee.pas(DT, { gaz: 1, passage: 1 })
  assert.equal(reglee.joueur.rapport, 2, 'passage manuel')
})
