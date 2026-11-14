// =============================================================================
// MODULE : Effets — fumée de pneus / poussière et traces de gomme
// -----------------------------------------------------------------------------
// Deux réserves pré-allouées et recyclées en anneau : aucune allocation en
// cours de jeu, un seul appel de dessin par système.
// =============================================================================
import * as THREE from 'three'

// --- Particules (fumée, poussière) --------------------------------------------
const NB_PARTICULES = 700

export function creerFumee(scene) {
  const pos = new Float32Array(NB_PARTICULES * 3)
  const couleur = new Float32Array(NB_PARTICULES * 3)
  const etat = new Float32Array(NB_PARTICULES * 2) // (opacité, taille)
  const vit = new Float32Array(NB_PARTICULES * 3)
  const vie = new Float32Array(NB_PARTICULES), vieMax = new Float32Array(NB_PARTICULES)
  const tailleBase = new Float32Array(NB_PARTICULES)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('color', new THREE.BufferAttribute(couleur, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('aEtat', new THREE.BufferAttribute(etat, 2).setUsage(THREE.DynamicDrawUsage))
  const mat = new THREE.ShaderMaterial({
    uniforms: { uEchelle: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec2 aEtat;
      attribute vec3 color;
      uniform float uEchelle;
      varying vec4 vCol;
      void main() {
        vCol = vec4(color, aEtat.x);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aEtat.y * uEchelle / max(0.1, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vCol;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.2, d) * vCol.a;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vCol.rgb, a);
      }`,
    transparent: true, depthWrite: false
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = 5
  scene.add(points)
  let curseur = 0

  return {
    /** Émet une particule (recycle la plus ancienne). */
    emettre(x, y, z, vx, vy, vz, r, g, b, taille, duree) {
      const i = curseur
      curseur = (curseur + 1) % NB_PARTICULES
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z
      vit[i * 3] = vx; vit[i * 3 + 1] = vy; vit[i * 3 + 2] = vz
      couleur[i * 3] = r; couleur[i * 3 + 1] = g; couleur[i * 3 + 2] = b
      vie[i] = duree; vieMax[i] = duree; tailleBase[i] = taille
    },
    mettreAJour(dt, hauteurEcran) {
      mat.uniforms.uEchelle.value = hauteurEcran * 0.9
      for (let i = 0; i < NB_PARTICULES; i++) {
        if (vie[i] <= 0) { etat[i * 2] = 0; continue }
        vie[i] -= dt
        const k = 1 - vie[i] / vieMax[i] // 0 → 1 au fil de la vie
        pos[i * 3] += vit[i * 3] * dt
        pos[i * 3 + 1] += vit[i * 3 + 1] * dt
        pos[i * 3 + 2] += vit[i * 3 + 2] * dt
        vit[i * 3] *= 0.97; vit[i * 3 + 2] *= 0.97
        etat[i * 2] = vie[i] > 0 ? 0.42 * (1 - k) * Math.min(1, k * 8) : 0
        etat[i * 2 + 1] = tailleBase[i] * (1 + k * 2.6)
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
      geo.attributes.aEtat.needsUpdate = true
    },
    vider() { vie.fill(0) },
    liberer() { scene.remove(points); geo.dispose(); mat.dispose() }
  }
}

// --- Traces de pneus -----------------------------------------------------------
const NB_QUADS = 3000
const DEMI_LARGEUR_TRACE = 0.14

/**
 * @param {number} nbPistes nombre de roues suivies (2 roues arrière par voiture)
 */
export function creerTraces(scene, nbPistes) {
  const pos = new Float32Array(NB_QUADS * 12)
  const col = new Float32Array(NB_QUADS * 16) // RGBA par sommet (alpha = intensité)
  const idx = new Uint32Array(NB_QUADS * 6)
  for (let q = 0; q < NB_QUADS; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 1, q * 4 + 3, q * 4 + 2], q * 6)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  scene.add(mesh)
  // État par piste : dernier bord gauche / droit posé + intensité.
  const dernier = new Float32Array(nbPistes * 7)
  const actif = new Uint8Array(nbPistes)
  let curseur = 0, modifie = false

  return {
    /**
     * Prolonge la trace d'une roue. (px, pz) = perpendiculaire unitaire à la
     * trajectoire. intensite ≤ 0 interrompt la trace.
     */
    poser(piste, x, y, z, px, pz, intensite) {
      const o = piste * 7
      if (intensite <= 0.02) { actif[piste] = 0; return }
      const gx = x + px * DEMI_LARGEUR_TRACE, gz = z + pz * DEMI_LARGEUR_TRACE
      const dx = x - px * DEMI_LARGEUR_TRACE, dz = z - pz * DEMI_LARGEUR_TRACE
      if (actif[piste]) {
        const ex = gx - dernier[o], ez = gz - dernier[o + 2]
        const d2 = ex * ex + ez * ez
        if (d2 < 0.2) return // trop proche du dernier point : on attend
        if (d2 < 64) {
          const q = curseur
          curseur = (curseur + 1) % NB_QUADS
          const p = q * 12, c4 = q * 16
          pos[p] = dernier[o]; pos[p + 1] = dernier[o + 1]; pos[p + 2] = dernier[o + 2]
          pos[p + 3] = dernier[o + 3]; pos[p + 4] = dernier[o + 4]; pos[p + 5] = dernier[o + 5]
          pos[p + 6] = gx; pos[p + 7] = y; pos[p + 8] = gz
          pos[p + 9] = dx; pos[p + 10] = y; pos[p + 11] = dz
          const a0 = dernier[o + 6] * 0.7, a1 = intensite * 0.7
          col[c4 + 3] = a0; col[c4 + 7] = a0; col[c4 + 11] = a1; col[c4 + 15] = a1
          modifie = true
        }
      }
      dernier[o] = gx; dernier[o + 1] = y; dernier[o + 2] = gz
      dernier[o + 3] = dx; dernier[o + 4] = y; dernier[o + 5] = dz
      dernier[o + 6] = intensite
      actif[piste] = 1
    },
    valider() {
      if (!modifie) return
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
      modifie = false
    },
    vider() {
      pos.fill(0); col.fill(0); actif.fill(0); modifie = true
    },
    liberer() { scene.remove(mesh); geo.dispose(); mat.dispose() }
  }
}
