// =============================================================================
// MODULE : Outils de carrosserie
// -----------------------------------------------------------------------------
// Deux briques servent à modeler toutes les voitures :
//
// 1. `coque()` — une carrosserie « lissée par sections », comme une maquette en
//    argile : on décrit quelques sections clés le long de la voiture (largeur,
//    hauteur de caisse, ligne de ceinture, hauteur du dessus, galbe...) ; elles
//    sont interpolées, puis reliées en une surface continue aux normales
//    lissées. Chaque section est une super-ellipse : dessus arrondi, dessous
//    plus carré. Les passages de roue sont découpés dans le bas de caisse.
//
// 2. `Atelier` — un collecteur de pièces rangées par matériau (peinture,
//    carbone, vitrage...). À la fin, toutes les pièces d'un même matériau sont
//    fusionnées : une voiture complète ne coûte qu'une poignée d'appels de
//    dessin, et la géométrie est partagée entre voitures du même modèle.
//
// Repère : Z vers l'avant, Y vers le haut, X vers la gauche, sol à Y = 0.
// Tout ceci s'exécute une seule fois par modèle, hors boucle de jeu.
// =============================================================================
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler()
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1)
const AXE_Y = new THREE.Vector3(0, 1, 0)

/** Ne garde que position + normale et supprime l'index (requis pour fusionner). */
function normaliser(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo
  if (!g.attributes.normal) g.computeVertexNormals()
  for (const nom of Object.keys(g.attributes)) {
    if (nom !== 'position' && nom !== 'normal') g.deleteAttribute(nom)
  }
  return g
}

// -----------------------------------------------------------------------------
// Atelier : collecte des pièces par matériau
// -----------------------------------------------------------------------------
export class Atelier {
  constructor() {
    /** @type {Map<string, THREE.BufferGeometry[]>} */
    this.lots = new Map()
  }

  /** Ajoute une géométrie (déjà positionnée, ou transformée par x/y/z + rotation). */
  ajouter(cle, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = normaliser(geo)
    if (x || y || z || rx || ry || rz) {
      _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s)
      g.applyMatrix4(_m)
    }
    if (!this.lots.has(cle)) this.lots.set(cle, [])
    this.lots.get(cle).push(g)
    return this
  }

  /** Ajoute des triangles bruts (positions + normales déjà calculées). */
  ajouterBrut(cle, positions, normales) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normales, 3))
    if (!this.lots.has(cle)) this.lots.set(cle, [])
    this.lots.get(cle).push(g)
    return this
  }

  /** Pavé à arêtes vives (plaques fines, lames). */
  boite(cle, lx, ly, lz, x, y, z, rx = 0, ry = 0, rz = 0) {
    return this.ajouter(cle, new THREE.BoxGeometry(lx, ly, lz), x, y, z, rx, ry, rz)
  }

  /** Pavé aux arêtes adoucies (pièces de carrosserie rapportées). */
  galet(cle, lx, ly, lz, x, y, z, rayon = 0.03, rx = 0, ry = 0, rz = 0) {
    const r = Math.min(rayon, lx / 2 - 0.001, ly / 2 - 0.001, lz / 2 - 0.001)
    return this.ajouter(cle, new RoundedBoxGeometry(lx, ly, lz, 3, r), x, y, z, rx, ry, rz)
  }

  /** Cylindre d'axe 'x', 'y' ou 'z' (r1 = rayon côté positif de l'axe). */
  cylindre(cle, r1, r2, longueur, x, y, z, axe = 'y', segments = 18, ouvert = false) {
    const g = new THREE.CylinderGeometry(r1, r2, longueur, segments, 1, ouvert)
    if (axe === 'x') g.rotateZ(-Math.PI / 2)
    else if (axe === 'z') g.rotateX(Math.PI / 2)
    return this.ajouter(cle, g, x, y, z)
  }

  /**
   * Doublure de passage de roue : demi-tube d'axe X visible de l'INTÉRIEUR
   * (faces retournées), qui masque le dessous de la carrosserie au-dessus du pneu.
   */
  doublure(cle, rayon, x0, x1, y, z) {
    const g = new THREE.CylinderGeometry(rayon, rayon, Math.abs(x1 - x0), 18, 1, true, Math.PI, Math.PI)
    g.rotateZ(-Math.PI / 2)
    const n = normaliser(g)
    // Inversion de l'ordre des sommets de chaque triangle + normales vers l'axe.
    const pp = n.attributes.position.array, nn = n.attributes.normal.array
    for (let i = 0; i < pp.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = pp[i + 3 + k]; pp[i + 3 + k] = pp[i + 6 + k]; pp[i + 6 + k] = t
      }
    }
    for (let i = 0; i < nn.length; i++) nn[i] = -nn[i]
    n.translate((x0 + x1) / 2, y, z)
    if (!this.lots.has(cle)) this.lots.set(cle, [])
    this.lots.get(cle).push(n)
    return this
  }

  /** Ellipsoïde (rétroviseurs, casque, optiques...). */
  ellipsoide(cle, rx, ry, rz, x, y, z, rotX = 0, rotY = 0, rotZ = 0) {
    const g = new THREE.SphereGeometry(1, 20, 14)
    g.scale(rx, ry, rz)
    return this.ajouter(cle, g, x, y, z, rotX, rotY, rotZ)
  }

  /** Tige cylindrique reliant deux points (triangles de suspension, haubans). */
  barre(cle, a, b, rayon, segments = 8) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b)
    const dir = vb.clone().sub(va)
    const g = new THREE.CylinderGeometry(rayon, rayon, dir.length(), segments)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(AXE_Y, dir.normalize()))
    const milieu = va.add(vb).multiplyScalar(0.5)
    return this.ajouter(cle, g, milieu.x, milieu.y, milieu.z)
  }

  /** Anneau torique d'axe X (lèvres de jante, bandes de flanc) ou partiel (halo). */
  tore(cle, rayon, tube, x, y, z, axe = 'x', arc = Math.PI * 2, segments = 24) {
    const g = new THREE.TorusGeometry(rayon, tube, 6, segments, arc)
    if (axe === 'x') g.rotateY(Math.PI / 2)
    else if (axe === 'y') g.rotateX(-Math.PI / 2)
    return this.ajouter(cle, g, x, y, z)
  }

  /**
   * Profil 2D extrudé.
   *  plan 'zy' : profil vu de côté (points = [z, y]), épaisseur selon X.
   *  plan 'xz' : profil vu de dessus (points = [x, z]), épaisseur selon Y.
   * La pièce est centrée sur son épaisseur puis déplacée de (x, y, z).
   */
  profil(cle, points, epaisseur, plan = 'zy', x = 0, y = 0, z = 0, biseau = 0) {
    const forme = new THREE.Shape()
    forme.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) forme.lineTo(points[i][0], points[i][1])
    forme.closePath()
    const g = new THREE.ExtrudeGeometry(forme, {
      depth: epaisseur - biseau * 2, bevelEnabled: biseau > 0, bevelThickness: biseau, bevelSize: biseau, bevelSegments: 2
    })
    if (plan === 'zy') { g.rotateY(-Math.PI / 2); g.translate(epaisseur / 2 - biseau, 0, 0) }
    else { g.rotateX(Math.PI / 2); g.translate(0, epaisseur / 2 - biseau, 0) }
    return this.ajouter(cle, g, x, y, z)
  }

  /**
   * Aile profilée inversée (creuse sur le dessus, comme un aileron d'appui),
   * envergure selon X.
   * @param {number} corde longueur du profil ; bord d'attaque vers +Z
   * @param {number} incidence angle en radians (> 0 : bord de fuite relevé)
   */
  aile(cle, envergure, corde, epaisseur, x, y, z, incidence = 0, cambrure = 0.06) {
    const N = 10, pts = []
    // Extrados puis intrados d'un profil simple (bord d'attaque arrondi).
    for (let i = 0; i <= N; i++) {
      const t = i / N, c = 4 * t * (1 - t)
      pts.push([(0.5 - t) * corde, epaisseur * 0.5 * Math.pow(c, 0.6) * (1.25 - 0.5 * t) - cambrure * corde * c])
    }
    for (let i = N - 1; i >= 1; i--) {
      const t = i / N, c = 4 * t * (1 - t)
      pts.push([(0.5 - t) * corde, -epaisseur * 0.5 * Math.pow(c, 0.6) * (1.25 - 0.5 * t) - cambrure * corde * c])
    }
    const forme = new THREE.Shape()
    forme.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) forme.lineTo(pts[i][0], pts[i][1])
    forme.closePath()
    const g = new THREE.ExtrudeGeometry(forme, { depth: envergure, bevelEnabled: false })
    g.rotateY(-Math.PI / 2)
    g.translate(envergure / 2, 0, 0)
    return this.ajouter(cle, g, x, y, z, incidence, 0, 0)
  }

  /** Fusionne les pièces : renvoie Map(clé de matériau → géométrie unique). */
  finaliser() {
    const sortie = new Map()
    for (const [cle, liste] of this.lots) {
      const g = liste.length === 1 ? liste[0] : mergeGeometries(liste, false)
      for (const piece of liste) if (piece !== g) piece.dispose()
      g.computeBoundingSphere()
      sortie.set(cle, g)
    }
    return sortie
  }
}

// -----------------------------------------------------------------------------
// Interpolation monotone (PCHIP) : pas de dépassement entre deux sections clés
// -----------------------------------------------------------------------------
function interpolateur(xs, ys) {
  const n = xs.length
  if (n === 1) return () => ys[0]
  const d = new Array(n - 1), m = new Array(n)
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])
  m[0] = d[0]; m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0
    else {
      const borne = 3 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]))
      m[i] = Math.max(-borne, Math.min(borne, (d[i - 1] + d[i]) / 2))
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
  }
}

/**
 * Quart de super-ellipse |x|^n + |y|^n = 1, de (1, 0) à (0, 1), ré-échantillonné
 * en K segments de longueur égale (une fois mis à l'échelle a × b) : le
 * maillage reste régulier quelle que soit la « carrure » de la section.
 */
function quartSuperEllipse(n, K, a, b) {
  const D = 96, xs = new Float64Array(D + 1), ys = new Float64Array(D + 1), cumul = new Float64Array(D + 1)
  for (let i = 0; i <= D; i++) {
    const phi = (i / D) * Math.PI / 2
    xs[i] = Math.pow(Math.cos(phi), 2 / n); ys[i] = Math.pow(Math.sin(phi), 2 / n)
    if (i === 0) { xs[0] = 1; ys[0] = 0 }
    if (i === D) { xs[D] = 0; ys[D] = 1 }
    if (i > 0) cumul[i] = cumul[i - 1] + Math.hypot((xs[i] - xs[i - 1]) * a, (ys[i] - ys[i - 1]) * b)
  }
  const pts = []
  let k = 0
  for (let j = 0; j <= K; j++) {
    const cible = (j / K) * cumul[D]
    while (k < D - 1 && cumul[k + 1] < cible) k++
    const f = cumul[k + 1] > cumul[k] ? (cible - cumul[k]) / (cumul[k + 1] - cumul[k]) : 0
    pts.push([xs[k] + (xs[k + 1] - xs[k]) * f, ys[k] + (ys[k + 1] - ys[k]) * f])
  }
  pts[0] = [1, 0]; pts[K] = [0, 1]
  return pts
}

const CHAMPS = ['l', 'bas', 'taille', 'haut', 'nH', 'nB', 'creux', 'cx']
const DEFAUTS = { l: 0.5, bas: 0.15, taille: 0.5, haut: 0.8, nH: 3, nB: 6, creux: 0, cx: 0 }

/**
 * Carrosserie lissée par sections.
 *
 * @param {Atelier} atelier
 * @param {object[]} cles sections clés, chacune :
 *   z      position longitudinale
 *   l      demi-largeur
 *   bas    hauteur du dessous
 *   taille hauteur du point le plus large (ligne de ceinture)
 *   haut   hauteur du dessus sur l'axe
 *   nH/nB  exposants de super-ellipse du dessus / du dessous (2 = rond, 8 = carré)
 *   creux  creusement du dessus sur l'axe (capot entre deux ailes ; < 0 = bosse)
 *   cx     décalage latéral de la section (pontons)
 *   Un champ omis reprend la valeur de la section précédente.
 * @param {object} o
 *   pas        espacement des sections interpolées (m)
 *   kHaut/kBas nombre de facettes par quart de section
 *   arches     passages de roue [{ z, y, r, xi }] : centre, rayon et face
 *              intérieure de la roue ; découpés dans le flanc de la caisse
 *   mat        (info) → clé de matériau, par facette. info = { z, x, y, dessus,
 *              col, bout } où col est le rang de la facette compté depuis l'axe
 *              (signé : > 0 côté gauche) et bout vaut 'avant' / 'arriere' sur
 *              les faces de fermeture.
 */
export function coque(atelier, cles, o = {}) {
  const { pas = 0.07, kHaut = 12, kBas = 5, arches = [], mat = () => 'peinture' } = o

  // --- 1. Sections clés triées de l'arrière vers l'avant, champs complétés ----
  // Les valeurs omises se propagent dans l'ordre d'écriture des sections.
  const complet = []
  let prec = { ...DEFAUTS }
  for (const c of cles) { prec = { ...prec, ...c }; complet.push(prec) }
  complet.sort((a, b) => a.z - b.z)
  const zs = complet.map((c) => c.z)
  const f = {}
  for (const champ of CHAMPS) f[champ] = interpolateur(zs, complet.map((c) => c[champ]))

  // --- 2. Positions des sections : pas régulier + clés + bords d'arches ------
  const zMin = zs[0], zMax = zs[zs.length - 1]
  const liste = new Set()
  const nbPas = Math.max(2, Math.round((zMax - zMin) / pas))
  for (let i = 0; i <= nbPas; i++) liste.add(+(zMin + ((zMax - zMin) * i) / nbPas).toFixed(4))
  for (const z of zs) liste.add(+z.toFixed(4))
  for (const a of arches) {
    for (const cote of [-1, 1]) {
      // Deux sections quasi confondues : le flanc vertical de l'arche.
      liste.add(+(a.z + cote * (a.r + 0.004)).toFixed(4))
      liste.add(+(a.z + cote * (a.r - 0.004)).toFixed(4))
    }
    // Sections supplémentaires pour un arc bien rond.
    for (let k = -5; k <= 5; k++) liste.add(+(a.z + Math.sin((k / 6) * Math.PI / 2) * a.r).toFixed(4))
  }
  const stations = [...liste].filter((z) => z >= zMin - 1e-6 && z <= zMax + 1e-6).sort((a, b) => b - a) // avant → arrière
  // Suppression des quasi-doublons (sauf les paires volontaires à 8 mm).
  for (let i = stations.length - 1; i > 0; i--) if (stations[i - 1] - stations[i] < 0.004) stations.splice(i, 1)

  // --- 3. Anneaux de sommets -------------------------------------------------
  const nbAnneau = 2 * (kHaut + kBas)
  const nbS = stations.length
  const pos = new Float32Array(nbS * nbAnneau * 3)
  const centres = []
  for (let i = 0; i < nbS; i++) {
    const z = stations[i]
    const l = Math.max(0.005, f.l(z)), cx = f.cx(z), creux = f.creux(z)
    const bas = f.bas(z)
    const taille = Math.max(f.taille(z), bas + 0.015), haut = Math.max(f.haut(z), taille + 0.015)
    // Hauteur de l'arche de roue à cette abscisse (0 hors des passages de roue).
    let yArche = 0, xArche = 0
    for (const a of arches) {
      const dz = Math.abs(z - a.z)
      if (dz < a.r) { yArche = a.y + Math.sqrt(a.r * a.r - dz * dz); xArche = a.xi }
    }
    const qH = quartSuperEllipse(Math.max(1.2, f.nH(z)), kHaut, l, haut - taille)
    const qB = quartSuperEllipse(Math.max(1.2, f.nB(z)), kBas, l, taille - bas)
    let p = i * nbAnneau * 3
    // Passage de roue : tout ce qui se trouve au-dessus du pneu (au-delà de la
    // face intérieure de la roue) est relevé jusqu'à l'arche.
    const poser = (x, y) => {
      if (yArche > 0 && Math.abs(x) > xArche && y < yArche) y = yArche
      pos[p++] = cx + x; pos[p++] = y; pos[p++] = z
    }
    const dessus = (q, signe) => {
      const X = q[0]
      poser(signe * l * X, taille + (haut - taille) * q[1] - creux * (1 - X * X) * (1 - X * X))
    }
    const dessous = (q, signe) => poser(signe * l * q[0], taille - (taille - bas) * q[1])
    // Parcours : bas-centre → flanc gauche (+X) → dessus → flanc droit → bas.
    for (let k = kBas; k >= 1; k--) dessous(qB[k], 1)
    for (let k = 0; k <= kHaut; k++) dessus(qH[k], 1)
    for (let k = kHaut - 1; k >= 0; k--) dessus(qH[k], -1)
    for (let k = 1; k <= kBas - 1; k++) dessous(qB[k], -1)
    centres.push([cx, (bas + haut) / 2, z])
  }

  // --- 4. Normales lissées sur toute la surface -------------------------------
  const indices = []
  for (let i = 0; i < nbS - 1; i++) {
    for (let j = 0; j < nbAnneau; j++) {
      const a = i * nbAnneau + j, b = i * nbAnneau + ((j + 1) % nbAnneau)
      const c = a + nbAnneau, d = b + nbAnneau
      indices.push(a, c, b, b, c, d)
    }
  }
  const surface = new THREE.BufferGeometry()
  surface.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  surface.setIndex(indices)
  surface.computeVertexNormals()
  const nor = surface.attributes.normal.array

  // --- 5. Répartition des facettes par matériau -------------------------------
  const lots = new Map()
  const lot = (cle) => {
    if (!lots.has(cle)) lots.set(cle, { p: [], n: [] })
    return lots.get(cle)
  }
  const info = { z: 0, x: 0, y: 0, dessus: false, col: 0, bout: null }
  for (let i = 0; i < nbS - 1; i++) {
    for (let j = 0; j < nbAnneau; j++) {
      const a = i * nbAnneau + j, b = i * nbAnneau + ((j + 1) % nbAnneau)
      const c = a + nbAnneau, d = b + nbAnneau
      info.z = (stations[i] + stations[i + 1]) / 2
      info.x = (pos[a * 3] + pos[b * 3] + pos[c * 3] + pos[d * 3]) / 4
      info.y = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4
      info.bout = null
      if (j < kBas) { info.dessus = false; info.col = j + 1 }
      else if (j < kBas + kHaut) { info.dessus = true; info.col = kHaut - (j - kBas) }
      else if (j < kBas + 2 * kHaut) { info.dessus = true; info.col = -(j - kBas - kHaut + 1) }
      else { info.dessus = false; info.col = -(kBas - (j - kBas - 2 * kHaut)) }
      const L = lot(mat(info))
      for (const s of [a, c, b, b, c, d]) {
        L.p.push(pos[s * 3], pos[s * 3 + 1], pos[s * 3 + 2])
        L.n.push(nor[s * 3], nor[s * 3 + 1], nor[s * 3 + 2])
      }
    }
  }
  // Faces de fermeture avant / arrière (éventails plats).
  for (const [i, nz, bout] of [[0, 1, 'avant'], [nbS - 1, -1, 'arriere']]) {
    const [cxC, cyC, czC] = centres[i]
    for (let j = 0; j < nbAnneau; j++) {
      const a = (i * nbAnneau + j) * 3, b = (i * nbAnneau + ((j + 1) % nbAnneau)) * 3
      info.z = czC; info.bout = bout; info.dessus = false; info.col = 0
      info.x = (pos[a] + pos[b] + cxC) / 3; info.y = (pos[a + 1] + pos[b + 1] + cyC) / 3
      const L = lot(mat(info))
      if (nz > 0) L.p.push(cxC, cyC, czC, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2])
      else L.p.push(cxC, cyC, czC, pos[b], pos[b + 1], pos[b + 2], pos[a], pos[a + 1], pos[a + 2])
      L.n.push(0, 0, nz, 0, 0, nz, 0, 0, nz)
    }
  }
  surface.dispose()
  for (const [cle, L] of lots) atelier.ajouterBrut(cle, L.p, L.n)
  // Fonctions de lecture de la surface : servent à poser des détails dessus.
  return {
    ...f,
    /** Hauteur du dessus de la coque à l'abscisse z et à l'écart latéral x. */
    yDessus(z, x = 0) {
      const X = Math.min(1, Math.abs(x - f.cx(z)) / Math.max(0.005, f.l(z))), n = f.nH(z)
      const Y = Math.pow(Math.max(0, 1 - Math.pow(X, n)), 1 / n)
      return f.taille(z) + (f.haut(z) - f.taille(z)) * Y - f.creux(z) * (1 - X * X) * (1 - X * X)
    },
    /** Demi-largeur de la coque à l'abscisse z et à la hauteur y. */
    xFlanc(z, y) {
      const t = f.taille(z)
      const haut = y >= t
      const Y = Math.min(1, Math.abs(y - t) / Math.max(0.005, haut ? f.haut(z) - t : t - f.bas(z)))
      const n = haut ? f.nH(z) : f.nB(z)
      return f.cx(z) + f.l(z) * Math.pow(Math.max(0, 1 - Math.pow(Y, n)), 1 / n)
    }
  }
}
