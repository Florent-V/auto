// =============================================================================
// MODULE : Décor — maillages du circuit et de son environnement
// -----------------------------------------------------------------------------
// Tout est extrudé le long de la spline à l'aide du repère (T, N, B) et de
// l'habillage calculé par le circuit (barrières, surfaces, vibreurs) :
//   piste (gomme sur la trajectoire, poussière aux bords), lignes blanches,
//   vibreurs en relief, dégagements (herbe tondue, gravier, asphalte),
//   barrières (rails + poteaux, murs de pneus, grillage ; murs en béton en
//   ville), talus, terrain, grille de départ, portique, stands, tribunes,
//   panneaux, mâts d'éclairage, arbres ou immeubles selon le paysage.
// Éclairage de nuit : l'apport des mâts est précalculé par sommet (attribut
// « aLumiere ») et ajouté au rendu par une petite injection de shader ; seuls
// 4 projecteurs réels suivent la caméra pour éclairer les voitures.
// Construit une seule fois par circuit (hors boucle de jeu).
// =============================================================================
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LARGEUR_VIBREUR, SURFACE } from '../core/circuit.js'
import { positionGrille } from '../core/course.js'
import { creerRng } from '../core/rng.js'
import * as TX from './textures.js'

/** Uniforme partagé : intensité de l'éclairage artificiel (0 de jour, 1 de nuit). */
export const ECLAIRAGE = { value: 0 }
const COULEUR_LAMPES = new THREE.Color(1.0, 0.92, 0.8)

/** Ajoute l'éclairage nocturne précalculé (attribut aLumiere) à un matériau standard. */
function eclairable(materiau) {
  materiau.onBeforeCompile = (shader) => {
    shader.uniforms.uEclairage = ECLAIRAGE
    shader.uniforms.uCouleurLampes = { value: COULEUR_LAMPES }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute float aLumiere;\nvarying float vLumiere;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLumiere = aLumiere;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'uniform float uEclairage;\nuniform vec3 uCouleurLampes;\nvarying float vLumiere;\n#include <common>')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uCouleurLampes * vLumiere * uEclairage * 0.9;')
  }
  materiau.customProgramCacheKey = () => 'eclairable'
  return materiau
}

// -----------------------------------------------------------------------------
// Ruban extrudé le long de la spline
// -----------------------------------------------------------------------------
/**
 * @param {object} c circuit
 * @param {object} o
 *   debut, nb      plage d'échantillons (nb segments ; nb = c.n pour un tour)
 *   d0(i), d1(i)   décalages latéraux des deux bords (d0 = bord « gauche » du ruban)
 *   h0(i), h1(i)   hauteurs au-dessus de la piste
 *   lat            subdivisions transversales
 *   profil(t)      hauteur additionnelle en travers (t ∈ [0, 1])
 *   periodeV       longueur (m) d'une répétition de texture le long de la piste
 *   largeurU       largeur (m) d'une répétition en travers (sinon u ∈ [0, 1])
 *   couleur(i, d)  → [r, g, b] (couleurs de sommets)
 *   lumiere        fonction d'éclairage nocturne (x, y, z, i) → intensité
 */
function ruban(c, o) {
  const debut = o.debut ?? 0, nb = o.nb ?? c.n, lat = o.lat ?? 1
  const nbS = nb + 1, nbL = lat + 1
  const pos = new Float32Array(nbS * nbL * 3), uv = new Float32Array(nbS * nbL * 2)
  const col = o.couleur ? new Float32Array(nbS * nbL * 3) : null
  const lum = new Float32Array(nbS * nbL)
  const periode = o.periodeV ?? 10
  const repetitions = nb === c.n ? Math.max(1, Math.round(c.longueur / periode)) : 0
  for (let k = 0; k < nbS; k++) {
    const i = (debut + k) % c.n
    const v = repetitions ? (k / c.n) * repetitions : ((debut + k) * c.pas) / periode
    const d0 = o.d0(i), d1 = o.d1(i), h0 = o.h0 ? o.h0(i) : 0, h1 = o.h1 ? o.h1(i) : 0
    for (let j = 0; j < nbL; j++) {
      const t = j / lat
      const d = d0 + (d1 - d0) * t
      const h = h0 + (h1 - h0) * t + (o.profil ? o.profil(t) : 0)
      const p = (k * nbL + j)
      const x = c.px[i] + c.nx[i] * d, y = c.py[i] + h, z = c.pz[i] + c.nz[i] * d
      pos[p * 3] = x; pos[p * 3 + 1] = y; pos[p * 3 + 2] = z
      uv[p * 2] = o.largeurU ? d / o.largeurU : t
      uv[p * 2 + 1] = v
      if (col) { const rgb = o.couleur(i, d); col[p * 3] = rgb[0]; col[p * 3 + 1] = rgb[1]; col[p * 3 + 2] = rgb[2] }
      if (o.lumiere) lum[p] = o.lumiere(x, y, z, i)
    }
  }
  const idx = new Uint32Array(nb * lat * 6)
  let q = 0
  for (let k = 0; k < nb; k++) for (let j = 0; j < lat; j++) {
    const a = k * nbL + j, b = a + 1, a2 = a + nbL, b2 = b + nbL
    idx[q++] = a; idx[q++] = b; idx[q++] = a2; idx[q++] = b; idx[q++] = b2; idx[q++] = a2
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aLumiere', new THREE.BufferAttribute(lum, 1))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  return g
}

/** Découpe un masque circulaire en plages contiguës [debut, nb]. */
function plages(n, predicat) {
  const sortie = []
  let k0 = 0
  while (k0 < n && predicat(k0)) k0++
  if (k0 === n) return [[0, n]]
  for (let k = 0; k < n; k++) {
    const i = (k0 + k) % n
    if (predicat(i) && (k === 0 || !predicat((i - 1 + n) % n))) {
      let l = 0
      while (l < n && predicat((i + l) % n)) l++
      sortie.push([i, l])
    }
  }
  return sortie
}

/** Bruit de valeur 2D (relief du terrain). */
function creerBruit(seed) {
  const h = (x, z) => {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
  const lisse = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
    const a = h(xi, zi), b = h(xi + 1, zi), cc = h(xi, zi + 1), d = h(xi + 1, zi + 1)
    return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v
  }
  return (x, z) => lisse(x, z) * 0.55 + lisse(x * 2.1 + 7, z * 2.1 + 3) * 0.3 + lisse(x * 4.3 + 1, z * 4.3 + 9) * 0.15
}

/** Pose une instance orientée (rotation Y) dans un InstancedMesh. */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _axe = new THREE.Vector3(0, 1, 0)
function poser(mesh, k, x, y, z, rotY, sx = 1, sy = 1, sz = 1) {
  _p.set(x, y, z); _q.setFromAxisAngle(_axe, rotY); _s.set(sx, sy, sz)
  _m.compose(_p, _q, _s)
  mesh.setMatrixAt(k, _m)
}

// -----------------------------------------------------------------------------
// Construction
// -----------------------------------------------------------------------------
/**
 * Construit tout le décor d'un circuit et l'ajoute à la scène.
 * @returns {{ groupe, feuxDepart(etape), poteaux, appliquerNuit(f), liberer() }}
 */
export function creerDecor(scene, c) {
  const rng = creerRng((c.seed ^ 0xdec0de) >>> 0)
  const groupe = new THREE.Group()
  const jetables = []
  const suivi = (o) => { jetables.push(o); return o }
  const ajouter = (geo, mat, { recoit = true, porte = false, ordre = 0 } = {}) => {
    const m = new THREE.Mesh(suivi(geo), mat)
    m.receiveShadow = recoit; m.castShadow = porte; m.renderOrder = ordre
    groupe.add(m)
    return m
  }
  const n = c.n, dl = c.demiLargeur
  const paysage = c.paysage

  // --- Mâts d'éclairage : positions (alternées de part et d'autre) ------------
  const espacement = c.urbain ? 16 : 24 // échantillons (32 / 48 m)
  const poteaux = []
  for (let k = 0; k < n; k += espacement) {
    const cote = (k / espacement) % 2 === 0 ? 1 : -1
    const lim = cote > 0 ? c.limG[k] : c.limD[k]
    const d = cote * (lim + (c.urbain ? 0.6 : 2.5))
    poteaux.push({ i: k, cote, x: c.px[k] + c.nx[k] * d, y: c.py[k], z: c.pz[k] + c.nz[k] * d, h: c.urbain ? 9 : 14 })
  }
  const parIndice = new Int32Array(n).fill(-1)
  poteaux.forEach((p, j) => { parIndice[p.i] = j })
  /** Éclairement nocturne d'un point (somme des mâts proches). */
  const lumiere = (x, y, z, i) => {
    let total = 0
    for (let k = -espacement * 3; k <= espacement * 3; k += 1) {
      const j = parIndice[(i + k + n) % n]
      if (j < 0) continue
      const p = poteaux[j]
      const dx = x - p.x, dz = z - p.z, dy = p.y + p.h - y
      const dh2 = dx * dx + dz * dz
      const d = Math.sqrt(dh2 + dy * dy)
      total += (dy / d) / (1 + dh2 / (p.h * p.h * 2.6))
    }
    return Math.min(1.25, total * (c.urbain ? 0.7 : 1))
  }

  // --- Piste : gomme sur la trajectoire, poussière sur les bords --------------
  const { map: asphalte, normalMap: asphalteN } = TX.texturesAsphalte()
  const matPiste = suivi(eclairable(new THREE.MeshStandardMaterial({
    map: asphalte, normalMap: asphalteN, normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.82, metalness: 0, vertexColors: true
  })))
  const taches = creerBruit(c.seed ^ 77)
  ajouter(ruban(c, {
    d0: () => dl, d1: () => -dl, lat: 12, periodeV: 6, largeurU: 6, lumiere,
    couleur: (i, d) => {
      const ecart = d - c.ligneIdeale[i]
      const gomme = 0.32 * Math.exp(-(ecart * ecart) / 2.2)
      const bord = Math.max(0, (Math.abs(d) - (dl - 1.2)) / 1.2) * 0.14
      const reparation = taches(i * c.pas * 0.012, d * 0.05) > 0.8 ? -0.08 : 0
      const v = 1 - gomme + bord + reparation
      return [v, v, v]
    }
  }), matPiste)

  // --- Lignes blanches de bord de piste ----------------------------------------
  const matLigne = suivi(eclairable(new THREE.MeshStandardMaterial({
    color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  })))
  const lignes = []
  for (const s of [1, -1]) lignes.push(ruban(c, { d0: () => s * (dl - 0.12), d1: () => s * (dl - 0.32), h0: () => 0.005, h1: () => 0.005, lumiere }))
  ajouter(mergeGeometries(lignes), matLigne, { ordre: 1 })
  lignes.forEach((g) => g.dispose())

  // --- Vibreurs en relief ----------------------------------------------------------
  const matVibreur = suivi(eclairable(new THREE.MeshStandardMaterial({
    map: TX.textureVibreur(), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  })))
  const vibreurs = []
  for (const [s, masque] of [[1, c.vibG], [-1, c.vibD]]) {
    for (const [debut, nb] of plages(n, (i) => masque[i] === 1)) {
      vibreurs.push(ruban(c, {
        debut, nb, lat: 3, periodeV: 2, lumiere,
        d0: () => s * (dl - 0.15), d1: () => s * (dl - 0.15 + LARGEUR_VIBREUR),
        // Profil : rampe douce depuis la piste puis rebord.
        profil: (t) => (t < 0.34 ? t * 0.12 : t < 0.67 ? 0.045 : 0.06)
      }))
    }
  }
  if (vibreurs.length) { ajouter(mergeGeometries(vibreurs), matVibreur, { ordre: 2 }); vibreurs.forEach((g) => g.dispose()) }

  // --- Dégagements par surface ------------------------------------------------------
  const { map: gravier, normalMap: gravierN } = TX.texturesGravier()
  const matSurfaces = {
    [SURFACE.HERBE]: suivi(eclairable(new THREE.MeshStandardMaterial({ map: TX.textureHerbeTondue(), roughness: 0.95 }))),
    [SURFACE.GRAVIER]: suivi(eclairable(new THREE.MeshStandardMaterial({ map: gravier, normalMap: gravierN, roughness: 1 }))),
    [SURFACE.ASPHALTE]: suivi(eclairable(new THREE.MeshStandardMaterial({ map: TX.textureDegagement(), roughness: 0.88 })))
  }
  if (paysage === 'dunes') matSurfaces[SURFACE.HERBE].color.set(0xcfd8a0)
  const periodes = { [SURFACE.HERBE]: 12, [SURFACE.GRAVIER]: 4, [SURFACE.ASPHALTE]: 6 }
  const parSurface = { [SURFACE.HERBE]: [], [SURFACE.GRAVIER]: [], [SURFACE.ASPHALTE]: [] }
  for (const [s, surf, lim] of [[1, c.surfG, c.limG], [-1, c.surfD, c.limD]]) {
    for (const type of [SURFACE.HERBE, SURFACE.GRAVIER, SURFACE.ASPHALTE]) {
      for (const [debut, nb] of plages(n, (i) => surf[i] === type)) {
        // L'herbe commence au bord de piste ; gravier et dégagement après une bande d'asphalte.
        parSurface[type].push(ruban(c, {
          debut, nb: Math.min(nb + 1, n), lat: 2, periodeV: periodes[type], largeurU: periodes[type], lumiere,
          d0: () => s * (dl - 0.02), d1: (i) => s * (lim[i] + 0.35), h0: () => -0.015, h1: () => -0.04
        }))
      }
    }
  }
  for (const type of Object.keys(parSurface)) {
    if (!parSurface[type].length) continue
    ajouter(mergeGeometries(parSurface[type]), matSurfaces[type])
    parSurface[type].forEach((g) => g.dispose())
  }

  // --- Talus : du pied de la barrière jusqu'au terrain ------------------------------
  const matTalus = suivi(eclairable(new THREE.MeshStandardMaterial({
    map: paysage === 'dunes' ? TX.textureSable() : TX.textureHerbeTerrain(), roughness: 1, color: 0xd8dccf
  })))
  const talus = []
  for (const [s, lim] of [[1, c.limG], [-1, c.limD]]) {
    talus.push(ruban(c, { d0: (i) => s * (lim[i] + 0.3), d1: (i) => s * (lim[i] + 16), h0: () => -0.04, h1: () => -2.2, periodeV: 16, largeurU: 16, lat: 3, lumiere }))
  }
  ajouter(mergeGeometries(talus), matTalus)
  talus.forEach((g) => g.dispose())

  // --- Barrières ---------------------------------------------------------------------
  const matMetal = suivi(new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide }))
  const matGrillage = suivi(new THREE.MeshStandardMaterial({
    map: TX.textureGrillage(), color: 0xc9cdd3, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6
  }))
  const grillages = [], rails = []
  for (const [s, lim] of [[1, c.limG], [-1, c.limD]]) {
    if (c.urbain) {
      // Murs en béton peints (face, dessus), grillage anti-débris au-dessus.
      const matMur = suivi(eclairable(new THREE.MeshStandardMaterial({ map: TX.textureBeton(), roughness: 0.9 })))
      const matBande = suivi(eclairable(new THREE.MeshStandardMaterial({ map: TX.textureBandeMur(), roughness: 0.7 })))
      ajouter(ruban(c, { d0: (i) => s * lim[i], d1: (i) => s * lim[i], h0: () => 1.0, h1: () => -0.1, periodeV: 4, lumiere }), matMur)
      ajouter(ruban(c, { d0: (i) => s * lim[i], d1: (i) => s * lim[i], h0: () => 1.15, h1: () => 1.0, periodeV: 4, lumiere }), matBande)
      ajouter(ruban(c, { d0: (i) => s * lim[i], d1: (i) => s * (lim[i] + 0.45), h0: () => 1.15, h1: () => 1.15, periodeV: 4, lumiere }), matMur)
      grillages.push(ruban(c, { d0: (i) => s * (lim[i] + 0.2), d1: (i) => s * (lim[i] + 0.2), h0: () => 4.2, h1: () => 1.15, periodeV: 1 }))
    } else {
      // Deux lisses de glissière (profil « W » simplifié) à 0,45 et 0,75 m.
      for (const hBas of [0.38, 0.68]) rails.push(ruban(c, { d0: (i) => s * lim[i], d1: (i) => s * lim[i], h0: () => hBas + 0.3, h1: () => hBas, periodeV: 4 }))
      grillages.push(ruban(c, { d0: (i) => s * (lim[i] + 0.5), d1: (i) => s * (lim[i] + 0.5), h0: () => 4.0, h1: () => 0.9, periodeV: 1 }))
    }
  }
  if (rails.length) { ajouter(mergeGeometries(rails), matMetal); rails.forEach((g) => g.dispose()) }
  ajouter(mergeGeometries(grillages), matGrillage, { recoit: false })
  grillages.forEach((g) => g.dispose())

  // Poteaux de glissière et de grillage (instanciés), tous les 4 m.
  const nbPoteaux = Math.ceil(n / 2) * 2
  const poteauxBarriere = new THREE.InstancedMesh(suivi(new THREE.BoxGeometry(0.1, 1, 0.1)), matMetal, nbPoteaux)
  let kp = 0
  for (let i = 0; i < n; i += 2) {
    for (const [s, lim] of [[1, c.limG], [-1, c.limD]]) {
      const d = s * (lim[i] + (c.urbain ? 0.2 : 0.5))
      poser(poteauxBarriere, kp++, c.px[i] + c.nx[i] * d, c.py[i] + (c.urbain ? 2.65 : 2.0), c.pz[i] + c.nz[i] * d, c.cap[i], 1, c.urbain ? 3.1 : 4.0, 1)
    }
  }
  poteauxBarriere.count = kp
  groupe.add(poteauxBarriere)

  // Murs de pneus devant la glissière, le long des bacs à graviers.
  if (!c.urbain) {
    const positions = []
    for (const [s, surf, lim] of [[1, c.surfG, c.limG], [-1, c.surfD, c.limD]]) {
      for (let i = 0; i < n; i++) {
        if (surf[i] !== SURFACE.GRAVIER || i % 1 !== 0) continue
        const d = s * (lim[i] - 0.45)
        for (let etage = 0; etage < 3; etage++) positions.push([c.px[i] + c.nx[i] * d, c.py[i] + 0.13 + etage * 0.25, c.pz[i] + c.nz[i] * d, etage])
        // Deux piles par échantillon (2 m) : décalées d'un mètre le long de la piste.
        const tx = -c.nz[i], tz = c.nx[i]
        for (let etage = 0; etage < 3; etage++) positions.push([c.px[i] + c.nx[i] * d + tx, c.py[i] + 0.13 + etage * 0.25, c.pz[i] + c.nz[i] * d + tz, etage])
      }
    }
    if (positions.length) {
      const geoPneu = suivi(new THREE.CylinderGeometry(0.31, 0.31, 0.25, 10))
      const pneus = new THREE.InstancedMesh(geoPneu, suivi(new THREE.MeshStandardMaterial({ roughness: 0.85 })), positions.length)
      const blanc = new THREE.Color(0xe6e6e6), noir = new THREE.Color(0x151515), rouge = new THREE.Color(0xc11d2a)
      positions.forEach(([x, y, z, etage], k) => {
        poser(pneus, k, x, y, z, 0)
        pneus.setColorAt(k, etage === 2 ? (k % 4 < 2 ? rouge : blanc) : noir)
      })
      pneus.receiveShadow = true
      groupe.add(pneus)
    }
  }

  // --- Ligne de départ, grille ----------------------------------------------------------
  const matDamier = suivi(eclairable(new THREE.MeshStandardMaterial({
    map: TX.textureDamier(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  })))
  const gDamier = ruban(c, { debut: n - 1, nb: 1, d0: () => dl, d1: () => -dl, h0: () => 0.006, h1: () => 0.006, lumiere })
  gDamier.attributes.uv.array.set([0, 0, 1, 0, 0, 1, 1, 1])
  ajouter(gDamier, matDamier, { ordre: 3 })
  // Emplacements de grille : équerres blanches peintes (comme en F1).
  const traits = []
  for (let rang = 0; rang < 6; rang++) {
    const { s, d } = positionGrille(c, rang)
    const i = ((Math.round((s + 2.6) / c.pas) % n) + n) % n
    traits.push(ruban(c, { debut: i, nb: 1, d0: () => d + 1.3, d1: () => d - 1.3, h0: () => 0.007, h1: () => 0.007, lumiere }))
  }
  ajouter(mergeGeometries(traits), matLigne, { ordre: 3 })
  traits.forEach((g) => g.dispose())

  // --- Portique de départ avec feux --------------------------------------------------------
  const portique = new THREE.Group()
  portique.position.set(c.px[0], c.py[0], c.pz[0])
  portique.rotation.y = c.cap[0]
  const matAcier = suivi(new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.45, metalness: 0.7 }))
  const portee = dl + 1.6
  for (const cote of [1, -1]) {
    const p = new THREE.Mesh(suivi(new THREE.BoxGeometry(0.45, 7.6, 0.45)), matAcier)
    p.position.set(cote * portee, 3.8, 0); p.castShadow = true
    portique.add(p)
  }
  const poutre = new THREE.Mesh(suivi(new THREE.BoxGeometry(portee * 2 + 0.6, 1.3, 0.6)), matAcier)
  poutre.position.y = 7.0; poutre.castShadow = true
  portique.add(poutre)
  const panneau = new THREE.Mesh(suivi(new THREE.PlaneGeometry(portee * 2 - 1, 1.0)), suivi(new THREE.MeshBasicMaterial({ map: suivi(TX.texturePortique(c.nom)) })))
  panneau.position.set(0, 7.0, -0.31); panneau.rotation.y = Math.PI
  portique.add(panneau)
  const caisson = new THREE.Mesh(suivi(new THREE.BoxGeometry(3.2, 0.7, 0.3)), matAcier)
  caisson.position.set(0, 5.95, -0.2)
  portique.add(caisson)
  const gFeu = suivi(new THREE.CircleGeometry(0.2, 16))
  const feux = []
  for (let i = 0; i < 5; i++) {
    const mat = suivi(new THREE.MeshBasicMaterial({ color: 0x1a0606 }))
    const f = new THREE.Mesh(gFeu, mat)
    f.position.set((i - 2) * 0.6, 5.95, -0.36); f.rotation.y = Math.PI
    portique.add(f)
    feux.push(mat)
  }
  groupe.add(portique)

  // --- Stands et tribunes le long de la ligne droite des stands ----------------------------
  // Côté des stands : celui où il y a le plus de place au départ.
  const coteStands = c.limG[0] >= c.limD[0] ? 1 : -1
  const placerBatiment = (iCentre, cote, recul, geo, mat, porte = true) => {
    const lim = cote > 0 ? c.limG[iCentre] : c.limD[iCentre]
    const d = cote * (lim + recul)
    const m = new THREE.Mesh(suivi(geo), mat)
    m.position.set(c.px[iCentre] + c.nx[iCentre] * d, c.py[iCentre] - 0.2, c.pz[iCentre] + c.nz[iCentre] * d)
    // Face avant (+Z local) tournée vers la piste.
    m.rotation.y = c.cap[iCentre] + (cote > 0 ? -Math.PI / 2 : Math.PI / 2)
    m.castShadow = porte; m.receiveShadow = true
    groupe.add(m)
    return m
  }
  const facadeStands = TX.textureStands()
  facadeStands.repeat.set(10, 1)
  const matStands = suivi(eclairable(new THREE.MeshStandardMaterial({ map: facadeStands, roughness: 0.6, metalness: 0.1 })))
  const matToit = suivi(new THREE.MeshStandardMaterial({ color: 0x8c939e, roughness: 0.5, metalness: 0.5 }))
  // Bâtiment long de 140 m (orienté face à la piste : +Z local vers la piste).
  const gStands = new THREE.BoxGeometry(140, 9, 14)
  gStands.translate(0, 4.5, 0)
  // Seule la face « avant » (vers la piste) porte la façade : on retouche les UV des autres.
  const bat = placerBatiment(Math.round(30 / c.pas) % n, coteStands, c.urbain ? 6 : 16, gStands, [matToit, matToit, matToit, matToit, matStands, matToit])
  bat.material = [matToit, matToit, matToit, matToit, matStands, matToit]
  if (!c.urbain) {
    // Muret des stands en béton.
    const matMuret = suivi(eclairable(new THREE.MeshStandardMaterial({ map: TX.textureBeton(), roughness: 0.9 })))
    const gMuret = new THREE.BoxGeometry(150, 1.2, 0.5)
    gMuret.translate(0, 0.6, 0)
    placerBatiment(Math.round(30 / c.pas) % n, coteStands, 6.5, gMuret, matMuret, false)
  }
  // Tribunes : en face des stands, puis aux plus beaux virages (place disponible).
  const matFoule = TX.textureFoule()
  const creerTribune = (longueur) => {
    const rangs = 14, profondeur = 0.85, hauteur = 0.5
    const geos = []
    for (let r = 0; r < rangs; r++) {
      const g = new THREE.BoxGeometry(longueur, hauteur, profondeur)
      g.translate(0, hauteur / 2 + r * hauteur, -r * profondeur)
      geos.push(g)
    }
    const gradins = mergeGeometries(geos)
    geos.forEach((g) => g.dispose())
    // UV des gradins : répétition de la texture de foule (10 places = 5 m, 4 rangs).
    const uvs = gradins.attributes.uv, pos = gradins.attributes.position
    for (let k = 0; k < uvs.count; k++) uvs.setXY(k, pos.getX(k) / 5, pos.getY(k) / (hauteur * 4))
    return gradins
  }
  const foule = matFoule.clone(); foule.wrapS = foule.wrapT = THREE.RepeatWrapping; foule.needsUpdate = true
  suivi(foule)
  const matGradins = suivi(eclairable(new THREE.MeshStandardMaterial({ map: foule, roughness: 0.9 })))
  const sitesTribunes = [[Math.round(20 / c.pas) % n, -coteStands, 120]]
  const kLarge = c.courbure
  for (let essai = 0; essai < 60 && sitesTribunes.length < 5; essai++) {
    const i = Math.floor(rng() * n)
    const cote = kLarge[i] > 0 ? -1 : 1 // extérieur du virage
    const lim = cote > 0 ? c.limG[i] : c.limD[i]
    if (Math.abs(kLarge[i]) < 1 / 150 || lim < dl + 12) continue
    if (sitesTribunes.some(([j]) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) * c.pas < 400)) continue
    sitesTribunes.push([i, cote, 60])
  }
  for (const [i, cote, longueur] of sitesTribunes) {
    if (c.urbain && cote === coteStands) continue
    placerBatiment(i, cote, c.urbain ? 3 : 7, creerTribune(longueur), matGradins)
    const toit = new THREE.BoxGeometry(longueur, 0.3, 14)
    toit.translate(0, 9.2, -5.5)
    placerBatiment(i, cote, c.urbain ? 3 : 7, toit, matToit)
  }

  // --- Panneaux publicitaires sur le grillage de la ligne droite ------------------------------
  const pubs = new THREE.Group()
  for (let k = 0; k < 10; k++) {
    const i = (Math.round((60 + k * 40) / c.pas)) % n
    const cote = -coteStands
    const lim = cote > 0 ? c.limG[i] : c.limD[i]
    const d = cote * (lim + (c.urbain ? 0.25 : 0.55))
    const m = new THREE.Mesh(suivi(new THREE.PlaneGeometry(12, 1.5)), suivi(eclairable(new THREE.MeshStandardMaterial({ map: TX.texturePublicite(k), roughness: 0.6 }))))
    m.geometry.setAttribute('aLumiere', new THREE.BufferAttribute(new Float32Array(4).fill(0.8), 1))
    m.position.set(c.px[i] + c.nx[i] * d, c.py[i] + 1.8, c.pz[i] + c.nz[i] * d)
    m.rotation.y = c.cap[i] + (cote > 0 ? -Math.PI / 2 : Math.PI / 2)
    pubs.add(m)
  }
  groupe.add(pubs)

  // --- Mâts d'éclairage (instanciés) -----------------------------------------------------------
  const matMat = suivi(new THREE.MeshStandardMaterial({ color: 0x7d838c, roughness: 0.5, metalness: 0.6 }))
  const mats = new THREE.InstancedMesh(suivi(new THREE.CylinderGeometry(0.12, 0.2, 1, 6)), matMat, poteaux.length)
  const matLampe = suivi(new THREE.MeshBasicMaterial({ color: 0x333333 }))
  const lampes = new THREE.InstancedMesh(suivi(new THREE.BoxGeometry(2.2, 0.35, 0.9)), matLampe, poteaux.length)
  poteaux.forEach((p, k) => {
    poser(mats, k, p.x, p.y + p.h / 2, p.z, 0, 1, p.h, 1)
    // Rampe de projecteurs tournée vers la piste.
    poser(lampes, k, p.x - c.nx[p.i] * p.cote * 0.8, p.y + p.h, p.z - c.nz[p.i] * p.cote * 0.8, c.cap[p.i])
  })
  groupe.add(mats, lampes)

  // --- Terrain --------------------------------------------------------------------------------
  const bruit = creerBruit(c.seed | 0)
  const lissage = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  const echantillonsLoin = []
  for (let i = 0; i < n; i += 8) echantillonsLoin.push(i)
  const proche = { i: 0, dist: 0, lateral: 0 }
  const plusProche = (x, z) => {
    let im = -1, d2min = Infinity
    const garder = (i, d2) => { if (d2 < d2min) { d2min = d2; im = i } }
    c.grille.voisins(x, z, 45, garder)
    if (im < 0) c.grille.voisins(x, z, 170, garder)
    if (im < 0) for (const i of echantillonsLoin) { const dx = x - c.px[i], dz = z - c.pz[i], d2 = dx * dx + dz * dz; if (d2 < d2min) { d2min = d2; im = i } }
    proche.i = im; proche.dist = Math.sqrt(d2min)
    proche.lateral = (x - c.px[im]) * c.nx[im] + (z - c.pz[im]) * c.nz[im]
    return proche
  }
  const ampli = { montagne: 260, foret: 120, plaine: 45, dunes: 30, ville: 25 }[paysage] ?? 80
  const hauteurTerrain = (x, z) => {
    const p = plusProche(x, z)
    const lim = p.lateral > 0 ? c.limG[p.i] : c.limD[p.i]
    const bord = lim + 16
    const collines = (bruit(x * 0.004, z * 0.004) - 0.32) * (8 + ampli * lissage(120, 1100, p.dist))
    const t = lissage(bord, bord + 60, p.dist)
    return (c.py[p.i] - 2.3) * (1 - t) + (c.py[p.i] + collines) * t
  }
  const { minX, maxX, minZ, maxZ } = c.bornes
  const marge = 1500
  const lx = maxX - minX + marge * 2, lz = maxZ - minZ + marge * 2
  const pas = Math.max(7, Math.sqrt((lx * lz) / 150000))
  const sx = Math.round(lx / pas), sz = Math.round(lz / pas)
  const gTerrain = new THREE.PlaneGeometry(lx, lz, sx, sz)
  gTerrain.rotateX(-Math.PI / 2)
  gTerrain.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  const pt = gTerrain.attributes.position, uvT = gTerrain.attributes.uv
  const couleurs = new Float32Array(pt.count * 3), lumT = new Float32Array(pt.count)
  const palette = {
    dunes: [new THREE.Color(0xb9a98a), new THREE.Color(0x8d9a62)],
    montagne: [new THREE.Color(0x5f7a45), new THREE.Color(0x8a8a86)],
    ville: [new THREE.Color(0x6f7a5c), new THREE.Color(0x7d7d78)]
  }[paysage] ?? [new THREE.Color(0x5c7a3d), new THREE.Color(0x7d8a4a)]
  const tmp = new THREE.Color()
  for (let k = 0; k < pt.count; k++) {
    const x = pt.getX(k), z = pt.getZ(k)
    const y = hauteurTerrain(x, z)
    pt.setY(k, y)
    uvT.setXY(k, x / 16, z / 16)
    const variation = bruit(x * 0.02 + 50, z * 0.02 + 50)
    tmp.copy(palette[0]).lerp(palette[1], Math.min(1, variation * 0.8 + Math.max(0, (y - c.bornes.maxY - 40) / 200)))
    // Neige sur les sommets en montagne.
    if (paysage === 'montagne' && y > c.bornes.maxY + 150) tmp.lerp(new THREE.Color(0xf2f4f8), Math.min(1, (y - c.bornes.maxY - 150) / 60))
    couleurs[k * 3] = tmp.r; couleurs[k * 3 + 1] = tmp.g; couleurs[k * 3 + 2] = tmp.b
    if (proche.dist < 80) lumT[k] = lumiere(x, y, z, proche.i) * 0.8
  }
  gTerrain.setAttribute('color', new THREE.BufferAttribute(couleurs, 3))
  gTerrain.setAttribute('aLumiere', new THREE.BufferAttribute(lumT, 1))
  gTerrain.computeVertexNormals()
  const texTerrain = paysage === 'dunes' ? TX.textureSable() : TX.textureHerbeTerrain()
  ajouter(gTerrain, suivi(eclairable(new THREE.MeshStandardMaterial({ map: texTerrain, vertexColors: true, roughness: 1 }))))

  // --- Végétation ou immeubles ------------------------------------------------------------------
  const dansDegagement = (x, z, marge2) => {
    const p = plusProche(x, z)
    const lim = p.lateral > 0 ? c.limG[p.i] : c.limD[p.i]
    return p.dist < lim + marge2
  }
  const tirerPosition = (rayonMax, marge2, essais = 12) => {
    for (let e = 0; e < essais; e++) {
      const x = minX - rayonMax + rng() * (maxX - minX + 2 * rayonMax), z = minZ - rayonMax + rng() * (maxZ - minZ + 2 * rayonMax)
      if (!dansDegagement(x, z, marge2)) return [x, z, proche.dist]
    }
    return null
  }
  const densite = { foret: 4200, montagne: 3200, plaine: 1600, dunes: 500, ville: 300 }[paysage] ?? 1500
  // Conifères (cônes étagés) et feuillus (houppiers irréguliers).
  const coniferes = mergeGeometries([
    new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5).translate(0, 0.6, 0),
    new THREE.ConeGeometry(1.0, 2.0, 7).translate(0, 1.9, 0),
    new THREE.ConeGeometry(0.8, 1.7, 7).translate(0, 2.7, 0),
    new THREE.ConeGeometry(0.55, 1.4, 7).translate(0, 3.4, 0)
  ].map((g) => (g.index ? g.toNonIndexed() : g)))
  const houppier = new THREE.IcosahedronGeometry(1, 1)
  const ph = houppier.attributes.position
  for (let k = 0; k < ph.count; k++) {
    const f = 0.85 + ((Math.sin(ph.getX(k) * 7.1) + Math.cos(ph.getZ(k) * 5.3)) * 0.08)
    ph.setXYZ(k, ph.getX(k) * f, ph.getY(k) * f * 0.85, ph.getZ(k) * f)
  }
  const feuillus = mergeGeometries([new THREE.CylinderGeometry(0.1, 0.16, 1.6, 5).translate(0, 0.8, 0).toNonIndexed(), houppier.index ? houppier.translate(0, 2.3, 0).toNonIndexed() : houppier.translate(0, 2.3, 0)])
  houppier.dispose()
  for (const g of [coniferes, feuillus]) g.computeVertexNormals()
  const matArbres = suivi(new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }))
  const partConiferes = { montagne: 0.9, foret: 0.55, plaine: 0.25, dunes: 0.1, ville: 0.2 }[paysage] ?? 0.4
  const arbres = [new THREE.InstancedMesh(suivi(coniferes), matArbres, densite), new THREE.InstancedMesh(suivi(feuillus), matArbres, densite)]
  const compte = [0, 0]
  for (let k = 0; k < densite; k++) {
    const pos = tirerPosition(500, 22)
    if (!pos) continue
    const [x, z, dist] = pos
    if (rng() < 0.75 * lissage(150, 600, dist)) continue // plus dense près du circuit
    const type = rng() < partConiferes ? 0 : 1
    const taille = type === 0 ? 3 + rng() * 4.5 : 2.4 + rng() * 2.6
    const y = hauteurTerrain(x, z) - 0.2
    poser(arbres[type], compte[type], x, y, z, rng() * 6.28, taille * (0.85 + rng() * 0.3), taille, taille * (0.85 + rng() * 0.3))
    tmp.setHSL(type === 0 ? 0.32 + rng() * 0.06 : 0.22 + rng() * 0.1, 0.45 + rng() * 0.2, 0.17 + rng() * 0.12)
    if (paysage === 'dunes') tmp.offsetHSL(-0.04, -0.1, 0.05)
    arbres[type].setColorAt(compte[type], tmp)
    compte[type]++
  }
  arbres.forEach((a, t) => { a.count = compte[t]; a.receiveShadow = true; groupe.add(a) })

  let fenetres = null
  if (paysage === 'ville') {
    // Immeubles serrés autour du tracé urbain.
    const { map, emissiveMap } = TX.texturesFacade()
    fenetres = suivi(new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.7 }))
    const nb = 900
    const immeubles = new THREE.InstancedMesh(suivi(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), fenetres, nb)
    let ki = 0
    for (let k = 0; k < nb * 3 && ki < nb; k++) {
      const pos = tirerPosition(260, 9, 4)
      if (!pos) continue
      const [x, z] = pos
      const h = 12 + rng() * rng() * 45
      poser(immeubles, ki, x, hauteurTerrain(x, z) - 0.5, z, rng() * 6.28, 14 + rng() * 16, h, 12 + rng() * 14)
      tmp.setHSL(0.08 + rng() * 0.05, 0.25, 0.65 + rng() * 0.25)
      immeubles.setColorAt(ki, tmp)
      ki++
    }
    immeubles.count = ki
    immeubles.castShadow = true; immeubles.receiveShadow = true
    groupe.add(immeubles)
  }

  scene.add(groupe)

  const ETEINT = new THREE.Color(0x1a0606), ROUGE = new THREE.Color(4, 0.12, 0.12)
  return {
    groupe, poteaux,
    /** etape : 0 = éteints, 1..5 = nombre de feux rouges allumés, 6 = extinction (départ). */
    feuxDepart(etape) {
      for (let i = 0; i < 5; i++) feux[i].color.copy(etape >= 1 && etape <= 5 && i < etape ? ROUGE : ETEINT)
    },
    /** Allume l'éclairage artificiel (0 = jour, 1 = nuit). */
    appliquerNuit(f) {
      ECLAIRAGE.value = f
      matLampe.color.setRGB(0.25 + 5 * f, 0.25 + 4.6 * f, 0.25 + 4 * f)
      if (fenetres) fenetres.emissiveIntensity = 1.4 * f
    },
    liberer() {
      scene.remove(groupe)
      groupe.traverse((o) => { if (o.isInstancedMesh) o.dispose() })
      for (const o of jetables) o.dispose()
    }
  }
}
