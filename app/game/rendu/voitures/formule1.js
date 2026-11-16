// =============================================================================
// MODÈLE : Monoplace — type Formule 1
// -----------------------------------------------------------------------------
// Roues découvertes, nez effilé plongeant vers un aileron avant à trois plans,
// coque étroite avec halo et casque du pilote, prise d'air au-dessus de la
// tête, pontons en « bouteille de Coca », fond plat, aileron arrière à deux
// éléments entre de hautes dérives, triangles de suspension apparents.
// =============================================================================
import * as THREE from 'three'
import { Atelier, coque } from './outils.js'
import { construireRoue } from './roues.js'

export function construireFormule1() {
  const a = new Atelier()
  const R = 0.36
  const zAv = 1.5, zAr = -1.42, xAv = 0.8, xAr = 0.77

  // --- Nez, coque et capot moteur -------------------------------------------------
  coque(a, [
    { z: 2.36, l: 0.07, bas: 0.20, taille: 0.235, haut: 0.27, nH: 2.2, nB: 2.2 },
    { z: 2.0, l: 0.115, bas: 0.20, taille: 0.275, haut: 0.35 },
    { z: 1.5, l: 0.185, bas: 0.22, taille: 0.36, haut: 0.50, nH: 2.6, nB: 3 },
    { z: 1.0, l: 0.26, bas: 0.16, taille: 0.44, haut: 0.62, nH: 3, nB: 4 },
    { z: 0.55, l: 0.31, bas: 0.09, taille: 0.46, haut: 0.66 },
    { z: 0.0, l: 0.32, bas: 0.08, taille: 0.47, haut: 0.70 },
    { z: -0.25, l: 0.25, taille: 0.52, haut: 0.99, nH: 2.2 },
    { z: -0.7, l: 0.22, taille: 0.47, haut: 0.92 },
    { z: -1.2, l: 0.17, bas: 0.10, taille: 0.40, haut: 0.70, nH: 2 },
    { z: -1.7, l: 0.11, bas: 0.16, taille: 0.33, haut: 0.48 },
    { z: -2.02, l: 0.07, bas: 0.22, taille: 0.29, haut: 0.36 }
  ], {
    kHaut: 8, kBas: 4, pas: 0.06,
    mat(i) {
      if (i.bout) return 'carbone'
      const c = Math.abs(i.col)
      // Ouverture du cockpit.
      if (i.dessus && c <= 4 && i.z > 0.08 && i.z < 0.66) return 'noir'
      if (!i.dessus && i.z < 1.1) return 'carbone'
      // Bande d'accent sur le nez et l'arête du capot moteur.
      if (i.dessus && c <= 2 && (i.z > 0.7 || i.z < -0.3)) return 'accent'
      return 'peinture'
    }
  })
  // Prise d'air moteur, aileron de requin, caméra embarquée.
  a.ellipsoide('noir', 0.105, 0.075, 0.03, 0, 0.9, -0.135, -0.5)
  a.profil('peinture', [[-0.5, 0.9], [-1.74, 0.46], [-1.74, 0.82], [-1.3, 0.92]], 0.018, 'zy')
  a.galet('noir', 0.2, 0.03, 0.07, 0, 1.0, -0.32, 0.012)
  // Pilote : casque et visière.
  a.ellipsoide('casque', 0.118, 0.125, 0.135, 0, 0.72, 0.27)
  a.ellipsoide('noir', 0.105, 0.04, 0.08, 0, 0.735, 0.345)
  a.galet('noir', 0.3, 0.1, 0.12, 0, 0.72, 0.06, 0.04)                     // appuie-tête

  // --- Halo : arceau en titane autour du cockpit --------------------------------
  const arceau = new THREE.TorusGeometry(0.265, 0.026, 8, 22, Math.PI)
  arceau.rotateX(Math.PI / 2) // arc horizontal de +X à −X en passant par l'avant
  arceau.scale(1, 1, 1.75)
  a.ajouter('carbone', arceau, 0, 0.815, 0.2)
  a.barre('carbone', [0, 0.815, 0.665], [0, 0.62, 0.98], 0.028)
  for (const c of [-1, 1]) a.barre('carbone', [c * 0.265, 0.815, 0.2], [c * 0.29, 0.69, -0.08], 0.026)

  // --- Pontons ------------------------------------------------------------------
  for (const c of [-1, 1]) {
    coque(a, [
      { z: 0.74, cx: c * 0.5, l: 0.2, bas: 0.30, taille: 0.46, haut: 0.61, nH: 3, nB: 3 },
      { z: 0.4, cx: c * 0.52, l: 0.255, bas: 0.16, taille: 0.42, haut: 0.62 },
      { z: -0.2, cx: c * 0.5, l: 0.27, bas: 0.09, taille: 0.36, haut: 0.58 },
      { z: -0.8, cx: c * 0.42, l: 0.24, bas: 0.08, taille: 0.30, haut: 0.46 },
      { z: -1.3, cx: c * 0.3, l: 0.17, bas: 0.08, taille: 0.24, haut: 0.34 },
      { z: -1.62, cx: c * 0.2, l: 0.1, bas: 0.1, taille: 0.2, haut: 0.26 }
    ], {
      kHaut: 7, kBas: 3, pas: 0.08,
      mat(i) {
        if (i.bout === 'avant') return 'noir'                                  // entrée d'air
        if (!i.dessus) return 'carbone'
        return i.col * c >= 5 ? 'accent' : 'peinture'                          // flanc extérieur
      }
    })
    a.barre('carbone', [c * 0.3, 0.6, 0.62], [c * 0.47, 0.68, 0.62], 0.012)    // rétroviseurs
    a.galet('peinture', 0.13, 0.055, 0.05, c * 0.5, 0.69, 0.62, 0.02)
    a.profil('carbone', [[0.95, 0.09], [0.55, 0.09], [0.6, 0.42], [0.9, 0.3]], 0.014, 'zy', c * 0.72) // déflecteur
  }

  // --- Fond plat, planche et diffuseur ------------------------------------------
  a.profil('carbone', [
    [0.3, 1.08], [0.74, 0.78], [0.78, -0.95], [0.56, -1.04], [0.56, -1.8],
    [-0.56, -1.8], [-0.56, -1.04], [-0.78, -0.95], [-0.74, 0.78], [-0.3, 1.08]
  ], 0.035, 'xz', 0, 0.085, 0)
  a.boite('noir', 0.3, 0.02, 2.7, 0, 0.055, -0.3)
  a.profil('carbone', [[-1.25, 0.07], [-1.84, 0.07], [-1.84, 0.3], [-1.25, 0.1]], 1.0, 'zy')
  for (let k = -2; k <= 2; k++) a.profil('carbone', [[-1.3, 0.05], [-1.9, 0.05], [-1.9, 0.33], [-1.3, 0.12]], 0.014, 'zy', k * 0.24)

  // --- Aileron avant : plan principal + deux volets + dérives -------------------
  a.aile('carbone', 1.86, 0.32, 0.03, 0, 0.115, 2.17, 0.07, 0.05)
  for (const c of [-1, 1]) {
    a.aile('peinture', 0.8, 0.2, 0.02, c * 0.535, 0.19, 2.02, 0.32, 0.08)
    a.aile('accent', 0.8, 0.15, 0.018, c * 0.535, 0.265, 1.92, 0.55, 0.08)
    a.profil('peinture', [[2.36, 0.05], [1.82, 0.05], [1.82, 0.36], [2.08, 0.3], [2.36, 0.15]], 0.018, 'zy', c * 0.94)
    a.boite('carbone', 0.2, 0.012, 0.14, c * 1.03, 0.06, 2.0)                 // patin de dérive
    a.boite('carbone', 0.022, 0.11, 0.22, c * 0.09, 0.165, 2.16)              // pylônes du nez
  }

  // --- Aileron arrière : dérives, plan principal, volet mobile, plan inférieur ---
  for (const c of [-1, 1]) {
    a.profil('peinture', [[-1.7, 0.34], [-2.3, 0.34], [-2.32, 1.01], [-1.9, 1.01], [-1.7, 0.72]], 0.018, 'zy', c * 0.5)
    a.profil('accent', [[-1.95, 0.9], [-2.31, 0.9], [-2.32, 1.012], [-1.91, 1.012]], 0.022, 'zy', c * 0.5)
    a.boite('feuFixe', 0.014, 0.26, 0.014, c * 0.5, 0.6, -2.312)
  }
  a.aile('carbone', 0.98, 0.34, 0.035, 0, 0.85, -2.05, 0.2, 0.1)
  a.aile('accent', 0.98, 0.17, 0.02, 0, 0.965, -2.2, 0.6, 0.1)
  a.aile('carbone', 0.98, 0.16, 0.02, 0, 0.5, -2.06, 0.25, 0.08)
  a.profil('carbone', [[-1.72, 0.42], [-1.95, 0.42], [-2.1, 0.84], [-1.97, 0.84]], 0.03, 'zy')
  // Structure d'impact et feu de pluie.
  a.galet('carbone', 0.15, 0.13, 0.34, 0, 0.33, -1.97, 0.03)
  a.galet('feu', 0.085, 0.11, 0.03, 0, 0.33, -2.145, 0.012)
  a.cylindre('chrome', 0.05, 0.05, 0.16, 0, 0.46, -1.98, 'z', 12, true)      // échappement

  // --- Suspensions apparentes ---------------------------------------------------
  const r = 0.013
  for (const c of [-1, 1]) {
    // Avant : deux triangles, poussant, biellette de direction.
    a.barre('carbone', [c * 0.17, 0.46, 1.74], [c * 0.66, 0.47, zAv], r)
    a.barre('carbone', [c * 0.2, 0.5, 1.28], [c * 0.66, 0.47, zAv], r)
    a.barre('carbone', [c * 0.13, 0.25, 1.74], [c * 0.66, 0.22, zAv], r)
    a.barre('carbone', [c * 0.19, 0.2, 1.28], [c * 0.66, 0.22, zAv], r)
    a.barre('carbone', [c * 0.18, 0.47, zAv], [c * 0.62, 0.24, zAv], r)
    a.barre('carbone', [c * 0.16, 0.4, 1.63], [c * 0.66, 0.38, 1.61], 0.01)
    a.galet('carbone', 0.05, 0.34, 0.34, c * 0.635, R, zAv, 0.02)           // écope de frein
    // Arrière : triangles + arbre de transmission.
    a.barre('carbone', [c * 0.14, 0.42, -1.18], [c * 0.6, 0.47, zAr], r)
    a.barre('carbone', [c * 0.1, 0.4, -1.68], [c * 0.6, 0.47, zAr], r)
    a.barre('carbone', [c * 0.15, 0.17, -1.18], [c * 0.6, 0.2, zAr], r)
    a.barre('carbone', [c * 0.1, 0.2, -1.68], [c * 0.6, 0.2, zAr], r)
    a.barre('chrome', [c * 0.1, 0.31, zAr], [c * 0.6, 0.36, zAr], 0.02)
    a.galet('carbone', 0.05, 0.36, 0.36, c * 0.57, R, zAr, 0.02)
  }

  return {
    pieces: a.finaliser(),
    roueAv: construireRoue({ rayon: R, largeur: 0.3, style: 'flasque' }),
    roueAr: construireRoue({ rayon: R, largeur: 0.38, style: 'flasque' }),
    essieux: { zAv, zAr, xAv, xAr, y: R },
    halo: { largeur: 3.7, longueur: 6.6 },
    phares: { y: 0.42, z: 1.9 }
  }
}
