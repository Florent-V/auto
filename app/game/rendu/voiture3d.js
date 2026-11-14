// =============================================================================
// MODULE : Modèle 3D des voitures (entièrement procédural)
// -----------------------------------------------------------------------------
// Carrosserie extrudée à partir d'un profil latéral, habitacle vitré, aileron,
// roues qui tournent et braquent, phares / feux émissifs (amplifiés par le
// bloom) et halo néon sous le châssis. Le modèle regarde vers +Z : la rotation
// Y du groupe est directement le lacet de la simulation.
// Géométries et textures sont partagées entre toutes les voitures.
// =============================================================================
import * as THREE from 'three'

let partage = null

/** Extrude un profil (z, y) sur une largeur donnée, centré sur l'axe X. */
function extruderProfil(points, largeur, biseau) {
  const forme = new THREE.Shape()
  forme.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) forme.lineTo(points[i][0], points[i][1])
  forme.closePath()
  const g = new THREE.ExtrudeGeometry(forme, {
    depth: largeur - biseau * 2, bevelEnabled: true, bevelThickness: biseau, bevelSize: biseau, bevelSegments: 2
  })
  // x_forme → Z voiture ; profondeur d'extrusion → X voiture.
  g.rotateY(-Math.PI / 2)
  g.translate(largeur / 2 - biseau, 0, 0)
  return g
}

function ressourcesPartagees() {
  if (partage) return partage
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const ctx = cv.getContext('2d')
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.3)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128)
  const gRoue = new THREE.CylinderGeometry(0.34, 0.34, 0.27, 20)
  gRoue.rotateZ(Math.PI / 2)
  const gJante = new THREE.CylinderGeometry(0.2, 0.2, 0.29, 10)
  gJante.rotateZ(Math.PI / 2)
  partage = {
    carrosserie: extruderProfil([
      [-2.12, 0.24], [-2.16, 0.74], [-1.7, 0.84], [-1.2, 0.86], [0.75, 0.78],
      [1.75, 0.58], [2.14, 0.44], [2.16, 0.26], [1.6, 0.2], [-1.6, 0.2]
    ], 1.86, 0.07),
    habitacle: extruderProfil([[-1.45, 0.82], [-0.95, 1.2], [0.05, 1.22], [0.95, 0.8]], 1.46, 0.05),
    roue: gRoue, jante: gJante,
    rayon: new THREE.BoxGeometry(0.3, 0.06, 0.36),
    aileron: new THREE.BoxGeometry(1.78, 0.05, 0.36),
    support: new THREE.BoxGeometry(0.06, 0.26, 0.16),
    phare: new THREE.BoxGeometry(0.42, 0.09, 0.06),
    feu: new THREE.BoxGeometry(1.62, 0.07, 0.05),
    halo: new THREE.PlaneGeometry(3.6, 6.2),
    textureHalo: new THREE.CanvasTexture(cv),
    matVitre: new THREE.MeshStandardMaterial({ color: 0x05060c, roughness: 0.08, metalness: 0.95 }),
    matPneu: new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.85 }),
    matJante: new THREE.MeshStandardMaterial({ color: 0xb8bcc8, roughness: 0.3, metalness: 0.9 }),
    matPhare: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.0, 2.4) })
  }
  return partage
}

const POSITIONS_ROUES = [[0.9, 1.25], [-0.9, 1.25], [0.9, -1.35], [-0.9, -1.35]] // (x, z) AV-G, AV-D, AR-G, AR-D

/**
 * @param {number} couleur teinte de la carrosserie
 * @param {boolean} fantome rendu holographique semi-transparent
 */
export function creerVoiture3D(couleur, fantome = false) {
  const r = ressourcesPartagees()
  const groupe = new THREE.Group()
  groupe.rotation.order = 'YXZ'
  const caisse = new THREE.Group() // roulis / tangage indépendants des roues
  groupe.add(caisse)

  const matFantome = fantome
    ? new THREE.MeshBasicMaterial({ color: 0x2aa9c9, transparent: true, opacity: 0.34, depthWrite: false })
    : null
  const matCaisse = fantome ? matFantome : new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.28, metalness: 0.65 })
  const matFeu = fantome ? matFantome : new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.05, 0.1) })
  const m = (geo, mat, x = 0, y = 0, z = 0, parent = caisse) => {
    const mesh = new THREE.Mesh(geo, fantome ? matFantome : mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = !fantome
    parent.add(mesh)
    return mesh
  }
  m(r.carrosserie, matCaisse)
  m(r.habitacle, r.matVitre)
  m(r.aileron, matCaisse, 0, 1.1, -1.92)
  m(r.support, matCaisse, 0.6, 0.97, -1.92)
  m(r.support, matCaisse, -0.6, 0.97, -1.92)
  m(r.phare, r.matPhare, 0.62, 0.52, 2.13).castShadow = false
  m(r.phare, r.matPhare, -0.62, 0.52, 2.13).castShadow = false
  m(r.feu, matFeu, 0, 0.7, -2.16).castShadow = false

  // Roues : pivot (braquage, axe Y) → roue (rotation, axe X).
  const roues = [], pivots = []
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group()
    pivot.position.set(POSITIONS_ROUES[i][0], 0.34, POSITIONS_ROUES[i][1])
    const roue = new THREE.Group()
    m(r.roue, r.matPneu, 0, 0, 0, roue)
    m(r.jante, r.matJante, 0, 0, 0, roue)
    m(r.rayon, r.matPneu, 0, 0, 0, roue)
    pivot.add(roue)
    groupe.add(pivot)
    roues.push(roue); pivots.push(pivot)
  }

  // Halo néon au sol, de la couleur de la voiture.
  if (!fantome) {
    const halo = new THREE.Mesh(r.halo, new THREE.MeshBasicMaterial({
      map: r.textureHalo, color: new THREE.Color(couleur).multiplyScalar(0.9), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    }))
    halo.rotation.x = -Math.PI / 2
    halo.position.y = 0.05
    halo.renderOrder = 2
    groupe.add(halo)
  }

  const FEU_REPOS = new THREE.Color(1.6, 0.05, 0.1), FEU_STOP = new THREE.Color(6, 0.3, 0.3)
  return {
    groupe, caisse,
    /** Met à jour roues, feux stop et attitude de caisse. Aucune allocation. */
    animer(angleRoue, braquage, freinage, roulis, tangage) {
      for (let i = 0; i < 4; i++) roues[i].rotation.x = angleRoue
      pivots[0].rotation.y = braquage
      pivots[1].rotation.y = braquage
      if (!fantome) matFeu.color.copy(freinage ? FEU_STOP : FEU_REPOS)
      caisse.rotation.z = roulis
      caisse.rotation.x = tangage
    }
  }
}
