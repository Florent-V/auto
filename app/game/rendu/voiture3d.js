// =============================================================================
// MODULE : Voitures 3D — assemblage des modèles
// -----------------------------------------------------------------------------
// Trois modèles entièrement procéduraux : 'f1' (monoplace), 'hypercar' et
// 'sportive' (voir le dossier voitures/). La géométrie d'un modèle est
// construite une seule fois puis partagée ; chaque voiture ne possède en propre
// que ses matériaux de livrée (peinture, accent, feux).
// Le modèle regarde vers +Z : la rotation Y du groupe est le lacet simulé.
// =============================================================================
import * as THREE from 'three'
import { construireSportive } from './voitures/sportive.js'
import { construireHypercar } from './voitures/hypercar.js'
import { construireFormule1 } from './voitures/formule1.js'

export const MODELES = ['f1', 'hypercar', 'sportive']
const CONSTRUCTEURS = { f1: construireFormule1, hypercar: construireHypercar, sportive: construireSportive }
const COULEUR_JANTE = { f1: 0x202228, hypercar: 0x2b2e35, sportive: 0xc9ced6 }

const cacheModeles = new Map()
let communs = null

function modele(type) {
  if (!cacheModeles.has(type)) cacheModeles.set(type, (CONSTRUCTEURS[type] ?? construireHypercar)())
  return cacheModeles.get(type)
}

/** Matériaux identiques pour toutes les voitures (créés une seule fois). */
function materiauxCommuns() {
  if (communs) return communs
  const cv = document.createElement('canvas')
  cv.width = cv.height = 128
  const ctx = cv.getContext('2d')
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.3)'); grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128)
  communs = {
    carbone: new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.5, metalness: 0.4 }),
    noir: new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.92 }),
    vitre: new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 0.32, metalness: 0.8, envMapIntensity: 1.8 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.3, metalness: 1 }),
    pneu: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.86 }),
    disque: new THREE.MeshStandardMaterial({ color: 0x7c8089, roughness: 0.4, metalness: 0.85 }),
    plaque: new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.6 }),
    phare: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.2, 1.9) }),
    feuFixe: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.06, 0.1) }),
    jantes: {},
    halo: new THREE.PlaneGeometry(1, 1),
    textureHalo: new THREE.CanvasTexture(cv)
  }
  communs.matOmbre = new THREE.MeshBasicMaterial({
    map: communs.textureHalo, color: 0x000000, transparent: true, opacity: 0.72, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  })
  communs.matPhareSol = new THREE.MeshBasicMaterial({
    map: communs.textureHalo, color: new THREE.Color(0.22, 0.21, 0.18), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5
  })
  for (const [type, couleur] of Object.entries(COULEUR_JANTE)) {
    communs.jantes[type] = new THREE.MeshStandardMaterial({ color: couleur, roughness: 0.28, metalness: 0.9 })
  }
  return communs
}

// Seules les pièces volumineuses projettent une ombre (moitié moins d'appels de dessin).
const PORTE_OMBRE = new Set(['peinture', 'accent', 'carbone', 'vitre', 'pneu'])
const FEU_REPOS = new THREE.Color(1.5, 0.05, 0.1), FEU_STOP = new THREE.Color(7, 0.35, 0.35)

/**
 * @param {object} o
 * @param {'f1'|'hypercar'|'sportive'} o.type
 * @param {number} o.couleur teinte principale
 * @param {number} o.accent  teinte secondaire (bandes, étriers, détails)
 * @param {boolean} o.fantome rendu holographique semi-transparent
 */
export function creerVoiture3D({ type = 'hypercar', couleur = 0x18d6ff, accent = 0xffffff, fantome = false } = {}) {
  const def = modele(type)
  const c = materiauxCommuns()
  const groupe = new THREE.Group()
  groupe.rotation.order = 'YXZ'
  const caisse = new THREE.Group() // roulis / tangage indépendants des roues
  groupe.add(caisse)

  // --- Matériaux propres à cette voiture ------------------------------------
  const propres = []
  const creer = (m) => { propres.push(m); return m }
  const matFantome = fantome ? creer(new THREE.MeshBasicMaterial({ color: 0x2aa9c9, transparent: true, opacity: 0.3, depthWrite: false })) : null
  const laque = (teinte) => creer(new THREE.MeshPhysicalMaterial({
    color: teinte, roughness: 0.5, metalness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.32, envMapIntensity: 1.35
  }))
  const matFeu = fantome ? matFantome : creer(new THREE.MeshBasicMaterial({ color: FEU_REPOS.clone() }))
  const mats = fantome ? null : {
    ...c, peinture: laque(couleur), accent: laque(accent), casque: laque(accent),
    etrier: creer(new THREE.MeshStandardMaterial({ color: accent, roughness: 0.45, metalness: 0.3 })),
    flanc: creer(new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 })),
    jante: c.jantes[type], feu: matFeu
  }
  const mat = (cle) => (fantome ? matFantome : mats[cle] ?? mats.carbone)
  const poser = (pieces, parent) => {
    for (const [cle, geo] of pieces) {
      const mesh = new THREE.Mesh(geo, mat(cle))
      mesh.castShadow = !fantome && PORTE_OMBRE.has(cle)
      parent.add(mesh)
    }
  }
  poser(def.pieces, caisse)

  // --- Roues : pivot (braquage, axe Y) → roue (rotation, axe X) ----------------
  const { zAv, zAr, xAv, xAr, y } = def.essieux
  const emplacements = [[xAv, zAv, def.roueAv], [-xAv, zAv, def.roueAv], [xAr, zAr, def.roueAr], [-xAr, zAr, def.roueAr]]
  const roues = [], pivots = []
  for (const [x, z, roueDef] of emplacements) {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, z)
    const roue = new THREE.Group()
    // Les roues droites sont retournées : face extérieure vers −X.
    const sens = new THREE.Group(), sensFixe = new THREE.Group()
    if (x < 0) { sens.rotation.y = Math.PI; sensFixe.rotation.y = Math.PI }
    poser(roueDef.tournant, sens)
    poser(roueDef.fixe, sensFixe)
    roue.add(sens)
    pivot.add(roue, sensFixe)
    groupe.add(pivot)
    roues.push(roue); pivots.push(pivot)
  }

  // --- Ombre de contact (occlusion ambiante sous la caisse) ---------------------
  // Assombrit le sol juste sous la voiture : elle « pose » sur la piste même
  // hors de la zone couverte par l'ombre portée du soleil.
  let lumierePhares = null
  if (!fantome) {
    const ombre = new THREE.Mesh(c.halo, c.matOmbre)
    ombre.rotation.x = -Math.PI / 2
    ombre.scale.set(def.halo.largeur * 0.62, def.halo.longueur * 0.78, 1)
    ombre.position.y = 0.03
    ombre.renderOrder = 2
    groupe.add(ombre)
    // Tache de lumière des phares sur la piste (visible la nuit seulement).
    lumierePhares = new THREE.Mesh(c.halo, c.matPhareSol)
    lumierePhares.rotation.x = -Math.PI / 2
    lumierePhares.scale.set(7, 16, 1)
    lumierePhares.position.set(0, 0.04, def.phares.z + 8.5)
    lumierePhares.renderOrder = 3
    lumierePhares.visible = false
    groupe.add(lumierePhares)
  }

  return {
    groupe, caisse, type,
    /** Position des roues arrière (fumée, traces) et des phares. */
    arriere: { x: xAr, z: zAr },
    phares: def.phares,
    /** Met à jour roues, feux stop et attitude de caisse. Aucune allocation. */
    animer(angleRoue, braquage, freinage, roulis, tangage) {
      for (let i = 0; i < 4; i++) roues[i].rotation.x = angleRoue
      pivots[0].rotation.y = braquage
      pivots[1].rotation.y = braquage
      if (!fantome) matFeu.color.copy(freinage ? FEU_STOP : FEU_REPOS)
      caisse.rotation.z = roulis
      caisse.rotation.x = tangage
    },
    /** Nuit : allume la tache de lumière des phares. */
    definirNuit(nuit) { if (lumierePhares) lumierePhares.visible = nuit },
    /** Libère les matériaux propres (la géométrie, partagée, est conservée). */
    liberer() {
      groupe.removeFromParent()
      for (const m of propres) m.dispose()
    }
  }
}
