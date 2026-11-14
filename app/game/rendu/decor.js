// =============================================================================
// MODULE : Décor — maillages du circuit et de son environnement
// -----------------------------------------------------------------------------
// Tout est extrudé le long de la spline à l'aide du repère (T, N, B) :
//   piste, vibreurs, dégagements (gravier puis herbe), barrières lumineuses,
//   ligne de départ, portique, arches, puis un terrain vallonné et une forêt
//   instanciée. Construit une seule fois par circuit (hors boucle de jeu).
// =============================================================================
import * as THREE from 'three'
import { DEMI_LARGEUR, LARGEUR_VIBREUR, LIMITE_LATERALE } from '../core/circuit.js'
import { creerRng } from '../core/rng.js'

const DIST_BARRIERE = LIMITE_LATERALE + 1.1

// --- Textures procédurales (canvas 2D) ---------------------------------------
function texture(l, h, dessiner, repeterU = false) {
  const cv = document.createElement('canvas')
  cv.width = l; cv.height = h
  dessiner(cv.getContext('2d'), l, h)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = repeterU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}
function grain(ctx, l, h, rng, nb, clair, sombre) {
  for (let i = 0; i < nb; i++) {
    const v = rng()
    ctx.fillStyle = v > 0.5 ? clair : sombre
    ctx.globalAlpha = 0.05 + rng() * 0.12
    ctx.fillRect(rng() * l, rng() * h, 1 + rng() * 2.5, 1 + rng() * 2.5)
  }
  ctx.globalAlpha = 1
}
function textureAsphalte(rng) {
  return texture(512, 512, (ctx, l, h) => {
    ctx.fillStyle = '#23232b'; ctx.fillRect(0, 0, l, h)
    grain(ctx, l, h, rng, 9000, '#3c3c48', '#131318')
    // Trace de gomme plus sombre au centre des trajectoires.
    const g = ctx.createLinearGradient(0, 0, l, 0)
    g.addColorStop(0.15, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(0.85, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, l, h)
    // Lignes de rive continues + ligne médiane discontinue.
    ctx.fillStyle = '#f4f4ff'
    ctx.fillRect(l * 0.03, 0, l * 0.016, h); ctx.fillRect(l * 0.954, 0, l * 0.016, h)
    ctx.fillStyle = 'rgba(244,244,255,0.85)'
    ctx.fillRect(l * 0.494, 0, l * 0.012, h * 0.42)
  })
}
function textureVibreur() {
  return texture(64, 128, (ctx, l, h) => {
    ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, l, h)
    ctx.fillStyle = '#ff2a55'; ctx.fillRect(0, 0, l, h / 2)
  })
}
function textureDegagement(rng) {
  return texture(256, 256, (ctx, l, h) => {
    // u = 0 côté piste : bande de gravier, puis herbe.
    const g = ctx.createLinearGradient(0, 0, l, 0)
    g.addColorStop(0, '#6b5a66'); g.addColorStop(0.3, '#5b4d5c')
    g.addColorStop(0.42, '#1f4a43'); g.addColorStop(1, '#173a3a')
    ctx.fillStyle = g; ctx.fillRect(0, 0, l, h)
    grain(ctx, l * 0.36, h, rng, 2600, '#a08c96', '#2c2430')
    ctx.save(); ctx.translate(l * 0.36, 0)
    grain(ctx, l * 0.64, h, rng, 2600, '#2f7a62', '#0c2424')
    ctx.restore()
  })
}
function textureDamier() {
  return texture(256, 64, (ctx, l, h) => {
    const c = h / 4
    for (let i = 0; i < l / c; i++) for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#f5f5f5' : '#101014'
      ctx.fillRect(i * c, j * c, c, c)
    }
  })
}
function texturePanneau(seed) {
  return texture(1024, 128, (ctx, l, h) => {
    ctx.fillStyle = '#07060f'; ctx.fillRect(0, 0, l, h)
    ctx.font = '900 76px Orbitron, Arial Black, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.shadowColor = '#18d6ff'; ctx.shadowBlur = 24
    ctx.fillStyle = '#9af1ff'
    ctx.fillText('NEON APEX', l * 0.36, h / 2 + 4)
    ctx.shadowColor = '#ff2a8a'; ctx.fillStyle = '#ff9ccb'
    ctx.font = '700 54px Orbitron, Arial, sans-serif'
    ctx.fillText('#' + seed, l * 0.8, h / 2 + 4)
  })
}

// --- Bruit de valeur (relief du terrain) --------------------------------------
function creerBruit(seed) {
  const h = (x, z) => {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed
    n = Math.imul(n ^ (n >>> 13), 1274126177)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
  const lisse = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z)
    const fx = x - xi, fz = z - zi
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz)
    const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return (x, z) => lisse(x, z) * 0.55 + lisse(x * 2.1 + 7, z * 2.1 + 3) * 0.3 + lisse(x * 4.3 + 1, z * 4.3 + 9) * 0.15
}

/**
 * Ruban extrudé le long de la spline entre deux décalages latéraux.
 * Sommets : P + N·d + Y·h. Triangles orientés pour que la normale suive B.
 * @param {number} d0,d1 décalages latéraux (d0 = bord gauche du ruban)
 * @param {number} h0,h1 hauteurs correspondantes
 * @param {number} periodeV longueur (m) d'une répétition de texture
 */
function ruban(c, d0, d1, h0, h1, periodeV, debut = 0, nbSegments = c.n) {
  const nbS = nbSegments + 1
  const pos = new Float32Array(nbS * 6), uv = new Float32Array(nbS * 4)
  // Nombre entier de répétitions sur le tour : pas de couture visible.
  const repetitions = Math.max(1, Math.round(c.longueur / periodeV))
  for (let k = 0; k < nbS; k++) {
    const i = (debut + k) % c.n
    const v = ((debut + k) / c.n) * repetitions
    pos[k * 6] = c.px[i] + c.nx[i] * d0; pos[k * 6 + 1] = c.py[i] + h0; pos[k * 6 + 2] = c.pz[i] + c.nz[i] * d0
    pos[k * 6 + 3] = c.px[i] + c.nx[i] * d1; pos[k * 6 + 4] = c.py[i] + h1; pos[k * 6 + 5] = c.pz[i] + c.nz[i] * d1
    uv[k * 4] = 0; uv[k * 4 + 1] = v; uv[k * 4 + 2] = 1; uv[k * 4 + 3] = v
  }
  const idx = new Uint32Array(nbSegments * 6)
  for (let k = 0; k < nbSegments; k++) {
    const a = k * 2, b = a + 1, a2 = a + 2, b2 = a + 3
    idx.set([a, b, a2, b, b2, a2], k * 6)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  return g
}

/**
 * Construit tout le décor d'un circuit et l'ajoute à la scène.
 * @returns {{ groupe, feuxDepart(etape:number), liberer() }}
 */
export function creerDecor(scene, c, seedAffichee) {
  const rng = creerRng((c.seed ^ 0xdec0de) >>> 0)
  const groupe = new THREE.Group()
  const jetables = [] // géométries / matériaux / textures à libérer
  const suivi = (o) => { jetables.push(o); return o }
  const ajouter = (geo, mat, { ombre = false, ordre = 0 } = {}) => {
    const m = new THREE.Mesh(suivi(geo), mat)
    m.receiveShadow = ombre
    m.renderOrder = ordre
    groupe.add(m)
    return m
  }

  // --- Piste -----------------------------------------------------------------
  const matPiste = suivi(new THREE.MeshStandardMaterial({ map: suivi(textureAsphalte(rng)), roughness: 0.62, metalness: 0.12 }))
  ajouter(ruban(c, DEMI_LARGEUR, -DEMI_LARGEUR, 0, 0, 12), matPiste, { ombre: true })

  // --- Vibreurs (à cheval sur chaque bord) ------------------------------------
  const matVibreur = suivi(new THREE.MeshStandardMaterial({
    map: suivi(textureVibreur()), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }))
  const vInt = DEMI_LARGEUR - 0.15, vExt = DEMI_LARGEUR - 0.15 + LARGEUR_VIBREUR
  ajouter(ruban(c, vExt, vInt, 0.03, 0.05, 5), matVibreur, { ombre: true })
  ajouter(ruban(c, -vInt, -vExt, 0.05, 0.03, 5), matVibreur, { ombre: true })

  // --- Dégagements : gravier puis herbe, jusqu'aux barrières -------------------
  const matDegagement = suivi(new THREE.MeshStandardMaterial({ map: suivi(textureDegagement(rng)), roughness: 0.95 }))
  const gGauche = ruban(c, DIST_BARRIERE + 0.5, DEMI_LARGEUR, 0, 0, 14)
  const gDroite = ruban(c, -DEMI_LARGEUR, -DIST_BARRIERE - 0.5, 0, 0, 14)
  // Côté gauche : la texture doit être retournée (gravier côté piste).
  const uvG = gGauche.attributes.uv
  for (let i = 0; i < uvG.count; i++) uvG.setX(i, 1 - uvG.getX(i))
  ajouter(gGauche, matDegagement, { ombre: true })
  ajouter(gDroite, matDegagement, { ombre: true })

  // --- Barrières : muret sombre + bandeau lumineux (cyan à gauche, magenta à droite)
  const matMur = suivi(new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }))
  const neonG = suivi(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x18d6ff).multiplyScalar(2.6), side: THREE.DoubleSide }))
  const neonD = suivi(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a8a).multiplyScalar(2.6), side: THREE.DoubleSide }))
  for (const cote of [1, -1]) {
    const d = DIST_BARRIERE * cote
    ajouter(ruban(c, d, d, 0.95, -0.8, 10), matMur)
    ajouter(ruban(c, d + 0.3 * cote, d, 0.95, 0.95, 10), matMur)
    ajouter(ruban(c, d - 0.02 * cote, d - 0.02 * cote, 0.8, 0.62, 10), cote > 0 ? neonG : neonD)
  }

  // --- Ligne de départ / arrivée (damier posé sur la spline à s = 0) ----------
  const matDamier = suivi(new THREE.MeshStandardMaterial({
    map: suivi(textureDamier()), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  }))
  const gDamier = ruban(c, DEMI_LARGEUR, -DEMI_LARGEUR, 0.02, 0.02, 1, c.n - 1, 2)
  // UV dédiés : u en travers de la piste, v le long (4 cases).
  gDamier.attributes.uv.array.set([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0, 1, 1, 1])
  ajouter(gDamier, matDamier, { ombre: true })

  // --- Portique de départ avec feux -------------------------------------------
  const portique = new THREE.Group()
  portique.position.set(c.px[0], c.py[0], c.pz[0])
  portique.rotation.y = c.cap[0]
  const matAcier = suivi(new THREE.MeshStandardMaterial({ color: 0x1b1a28, roughness: 0.4, metalness: 0.8 }))
  const demiPortee = DEMI_LARGEUR + 2.2
  const gPoteau = suivi(new THREE.BoxGeometry(0.5, 7.4, 0.5))
  for (const cote of [1, -1]) {
    const p = new THREE.Mesh(gPoteau, matAcier)
    p.position.set(cote * demiPortee, 3.7, 0)
    p.castShadow = true
    portique.add(p)
  }
  const poutre = new THREE.Mesh(suivi(new THREE.BoxGeometry(demiPortee * 2 + 0.5, 1.5, 0.6)), matAcier)
  poutre.position.y = 6.9
  poutre.castShadow = true
  portique.add(poutre)
  const matPanneau = suivi(new THREE.MeshBasicMaterial({ map: suivi(texturePanneau(seedAffichee)), color: new THREE.Color(1.5, 1.5, 1.5) }))
  // Le panneau fait face aux voitures qui arrivent (côté −Z local du portique).
  const panneau = new THREE.Mesh(suivi(new THREE.PlaneGeometry(demiPortee * 2 - 1, 1.2)), matPanneau)
  panneau.position.set(0, 6.9, -0.32)
  panneau.rotation.y = Math.PI
  portique.add(panneau)
  // Trois feux : rouges pendant le décompte, verts au départ.
  const gFeu = suivi(new THREE.SphereGeometry(0.34, 16, 12))
  const feux = []
  for (let i = 0; i < 3; i++) {
    const mat = suivi(new THREE.MeshBasicMaterial({ color: 0x220a0a }))
    const f = new THREE.Mesh(gFeu, mat)
    f.position.set((i - 1) * 1.3, 5.7, -0.35)
    portique.add(f)
    feux.push(mat)
  }
  groupe.add(portique)

  // --- Arches lumineuses réparties sur le tour --------------------------------
  const NB_ARCHES = 5
  const gMontant = suivi(new THREE.BoxGeometry(0.22, 6.2, 0.22))
  const gTraverse = suivi(new THREE.BoxGeometry((DEMI_LARGEUR + 1.6) * 2, 0.22, 0.22))
  for (let a = 1; a <= NB_ARCHES; a++) {
    const i = Math.floor((a / (NB_ARCHES + 1)) * c.n)
    const arche = new THREE.Group()
    arche.position.set(c.px[i], c.py[i], c.pz[i])
    arche.rotation.y = c.cap[i]
    const mat = a % 2 ? neonG : neonD
    for (const cote of [1, -1]) {
      const m = new THREE.Mesh(gMontant, mat)
      m.position.set(cote * (DEMI_LARGEUR + 1.6), 3.1, 0)
      arche.add(m)
    }
    const t = new THREE.Mesh(gTraverse, mat)
    t.position.y = 6.2
    arche.add(t)
    groupe.add(arche)
  }

  // --- Terrain ----------------------------------------------------------------
  // Distance au tracé + altitude de la piste au plus proche (recherche brute,
  // exécutée une seule fois à la construction).
  const proche = { dist: 0, y: 0 }
  const plusProche = (x, z) => {
    let d2min = Infinity, im = 0
    for (let i = 0; i < c.n; i += 2) {
      const dx = x - c.px[i], dz = z - c.pz[i]
      const d2 = dx * dx + dz * dz
      if (d2 < d2min) { d2min = d2; im = i }
    }
    proche.dist = Math.sqrt(d2min); proche.y = c.py[im]
    return proche
  }
  const bruit = creerBruit(c.seed | 0)
  const lissage = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
  const hauteurTerrain = (x, z) => {
    const p = plusProche(x, z)
    const collines = (bruit(x * 0.006, z * 0.006) - 0.35) * (14 + 150 * lissage(90, 650, p.dist))
    const t = lissage(DIST_BARRIERE + 1, DIST_BARRIERE + 34, p.dist)
    return (p.y - 0.7) * (1 - t) + collines * t
  }
  const marge = 900, pasGrille = 7
  const { minX, maxX, minZ, maxZ } = c.bornes
  const lx = maxX - minX + marge * 2, lz = maxZ - minZ + marge * 2
  const sx = Math.round(lx / pasGrille), sz = Math.round(lz / pasGrille)
  const gTerrain = new THREE.PlaneGeometry(lx, lz, sx, sz)
  gTerrain.rotateX(-Math.PI / 2)
  gTerrain.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2)
  const pt = gTerrain.attributes.position
  const couleurs = new Float32Array(pt.count * 3)
  const cBas = new THREE.Color(0x12343a), cHaut = new THREE.Color(0x4a2a6e), cTmp = new THREE.Color()
  for (let i = 0; i < pt.count; i++) {
    const x = pt.getX(i), z = pt.getZ(i)
    const y = hauteurTerrain(x, z)
    pt.setY(i, y)
    cTmp.copy(cBas).lerp(cHaut, Math.max(0, Math.min(1, (y - 4) / 70)))
    const v = 0.82 + rng() * 0.3
    couleurs[i * 3] = cTmp.r * v; couleurs[i * 3 + 1] = cTmp.g * v; couleurs[i * 3 + 2] = cTmp.b * v
  }
  gTerrain.setAttribute('color', new THREE.BufferAttribute(couleurs, 3))
  gTerrain.computeVertexNormals()
  ajouter(gTerrain, suivi(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })))

  // --- Forêt instanciée ---------------------------------------------------------
  const NB_ARBRES = 900
  const gFeuillage = suivi(new THREE.ConeGeometry(1, 2.4, 6))
  gFeuillage.translate(0, 1.9, 0)
  const gTronc = suivi(new THREE.CylinderGeometry(0.13, 0.18, 0.9, 5))
  gTronc.translate(0, 0.4, 0)
  const feuillages = new THREE.InstancedMesh(gFeuillage, suivi(new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true })), NB_ARBRES)
  const troncs = new THREE.InstancedMesh(gTronc, suivi(new THREE.MeshStandardMaterial({ color: 0x241426, roughness: 1 })), NB_ARBRES)
  const mat4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), ech = new THREE.Vector3(), posA = new THREE.Vector3()
  const axeY = new THREE.Vector3(0, 1, 0)
  let nbPoses = 0
  for (let essai = 0; essai < NB_ARBRES * 6 && nbPoses < NB_ARBRES; essai++) {
    const x = minX - 260 + rng() * (maxX - minX + 520), z = minZ - 260 + rng() * (maxZ - minZ + 520)
    const p = plusProche(x, z)
    if (p.dist < DIST_BARRIERE + 5) continue
    // Plus dense près du circuit (là où on les voit), clairsemé au loin.
    if (rng() < lissage(40, 240, p.dist) * 0.8) continue
    const taille = 2.2 + rng() * 3.6
    posA.set(x, hauteurTerrain(x, z) - 0.2, z)
    quat.setFromAxisAngle(axeY, rng() * 6.28)
    ech.set(taille * (0.8 + rng() * 0.4), taille, taille * (0.8 + rng() * 0.4))
    mat4.compose(posA, quat, ech)
    feuillages.setMatrixAt(nbPoses, mat4)
    troncs.setMatrixAt(nbPoses, mat4)
    cTmp.setHSL(0.44 + rng() * 0.12, 0.5, 0.13 + rng() * 0.1)
    feuillages.setColorAt(nbPoses, cTmp)
    nbPoses++
  }
  feuillages.count = troncs.count = nbPoses
  feuillages.instanceMatrix.needsUpdate = true
  groupe.add(feuillages, troncs)

  scene.add(groupe)

  const ROUGE = new THREE.Color(3.2, 0.15, 0.15), VERT = new THREE.Color(0.2, 3.2, 0.5), ETEINT = new THREE.Color(0x220a0a)
  return {
    groupe,
    /** etape : 0 = éteints, 1..3 = nombre de feux rouges, 4 = tous verts. */
    feuxDepart(etape) {
      for (let i = 0; i < 3; i++) feux[i].color.copy(etape === 4 ? VERT : i < etape ? ROUGE : ETEINT)
    },
    liberer() {
      scene.remove(groupe)
      for (const o of jetables) o.dispose()
      feuillages.dispose(); troncs.dispose()
    }
  }
}
