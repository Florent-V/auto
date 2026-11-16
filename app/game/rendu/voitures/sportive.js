// =============================================================================
// MODÈLE : Sportive — coupé GT à moteur avant
// -----------------------------------------------------------------------------
// Long capot nervuré entre deux ailes galbées, habitacle reculé, pavillon
// fuyant (fastback) terminé par un becquet intégré, hanches arrière larges.
// Signature : doubles bandes de course, quatre feux ronds, double sortie
// d'échappement de chaque côté.
// =============================================================================
import { Atelier, coque } from './outils.js'
import { construireRoue } from './roues.js'

export function construireSportive() {
  const a = new Atelier()
  const R = 0.345
  const zAv = 1.25, zAr = -1.35, voie = 0.8
  const arches = [{ z: zAv, y: R, r: R + 0.055, xi: 0.64 }, { z: zAr, y: R, r: R + 0.06, xi: 0.62 }]

  // --- Caisse ------------------------------------------------------------------
  const caisse = coque(a, [
    { z: 2.26, l: 0.60, bas: 0.24, taille: 0.42, haut: 0.50, nH: 2.6, nB: 3.5 },
    { z: 2.18, l: 0.78, bas: 0.19, taille: 0.44, haut: 0.58, nH: 3 },
    { z: 1.95, l: 0.90, bas: 0.15, taille: 0.48, haut: 0.68, nH: 3.4, nB: 5, creux: 0.02 },
    { z: zAv, l: 0.955, bas: 0.15, taille: 0.54, haut: 0.80, nH: 3.6, creux: 0.07 },
    { z: 0.80, l: 0.94, taille: 0.58, haut: 0.845, creux: 0.035 },
    { z: 0.20, l: 0.925, taille: 0.60, haut: 0.85, nH: 4.5, creux: 0 },
    { z: -0.60, l: 0.94, taille: 0.61, haut: 0.86 },
    { z: zAr, l: 0.985, taille: 0.62, haut: 0.89, nH: 3.8 },
    { z: -1.85, l: 0.95, bas: 0.19, taille: 0.62, haut: 0.91, nH: 4.5 },
    { z: -2.14, l: 0.90, bas: 0.25, taille: 0.61, haut: 0.935, nH: 6 },
    { z: -2.20, l: 0.87, bas: 0.28, taille: 0.60, haut: 0.915, nH: 6 }
  ], {
    arches,
    mat(i) {
      if (i.bout === 'arriere') return 'noir'
      if (i.bout === 'avant') return 'noir'
      // Bas de caisse et boucliers en noir satiné.
      if (!i.dessus && i.y < 0.3) return 'carbone'
      // Doubles bandes de course du nez au becquet.
      if (i.dessus && (Math.abs(i.col) === 2 || Math.abs(i.col) === 3)) return 'accent'
      return 'peinture'
    }
  })

  // --- Pavillon : pare-brise, toit peint, vitres latérales, lunette fastback --
  const zToitAv = 0.12, zToitAr = -0.72
  coque(a, [
    { z: 1.02, l: 0.80, bas: 0.70, taille: 0.76, haut: 0.83, nH: 3, nB: 8 },
    { z: 0.70, l: 0.79, bas: 0.70, taille: 0.78, haut: 0.98 },
    { z: 0.30, l: 0.755, bas: 0.70, taille: 0.80, haut: 1.185, nH: 3.2 },
    { z: -0.15, l: 0.735, bas: 0.70, taille: 0.81, haut: 1.25 },
    { z: -0.60, l: 0.735, bas: 0.70, taille: 0.82, haut: 1.235 },
    { z: -1.10, l: 0.76, bas: 0.72, taille: 0.83, haut: 1.12, nH: 3.4 },
    { z: -1.60, l: 0.78, bas: 0.74, taille: 0.84, haut: 0.985, nH: 4 },
    { z: -1.98, l: 0.76, bas: 0.78, taille: 0.86, haut: 0.93, nH: 5 }
  ], {
    kHaut: 12, kBas: 2, pas: 0.06,
    mat(i) {
      if (i.bout || !i.dessus) return 'peinture'
      const c = Math.abs(i.col)
      if (i.z > zToitAv) return c <= 10 && c !== 7 && i.z < 0.93 ? 'vitre' : 'peinture' // pare-brise + montants
      if (i.z < zToitAr) return c <= 7 && i.z > -1.72 ? 'vitre' : c === 2 || c === 3 ? 'accent' : 'peinture' // lunette + custodes
      if (c <= 5) return c === 2 || c === 3 ? 'accent' : 'peinture'                 // toit
      if (c >= 12) return 'peinture'                                               // ceinture de caisse
      return Math.abs(i.z + 0.28) < 0.035 ? 'noir' : 'vitre'                        // vitres + montant central
    }
  })

  // --- Face avant ----------------------------------------------------------------
  a.galet('noir', 1.02, 0.17, 0.08, 0, 0.345, 2.235, 0.05)                 // calandre
  a.boite('chrome', 0.94, 0.012, 0.02, 0, 0.345, 2.278)
  a.profil('carbone', [[-0.6, 2.32], [0.6, 2.32], [0.82, 2.2], [0.9, 1.95], [-0.9, 1.95], [-0.82, 2.2]], 0.03, 'xz', 0, 0.175, 0) // lame avant
  for (const c of [-1, 1]) {
    // Optiques ovales inclinées, posées sur l'aile + feu de jour.
    a.ellipsoide('vitre', 0.15, 0.06, 0.2, c * 0.66, caisse.yDessus(1.96, 0.66) - 0.04, 1.97, 0.32, c * 0.25, 0)
    a.ellipsoide('phare', 0.07, 0.035, 0.06, c * 0.66, caisse.yDessus(2.06, 0.66) - 0.012, 2.07, 0.32, c * 0.25, 0)
    a.galet('noir', 0.24, 0.07, 0.07, c * 0.66, 0.34, 2.20, 0.03, 0, c * -0.3, 0) // écope de frein
    a.boite('phare', 0.2, 0.014, 0.02, c * 0.66, 0.39, 2.225, 0, c * -0.3, 0)
    // Ouïes de capot.
    a.boite('noir', 0.2, 0.012, 0.34, c * 0.42, caisse.yDessus(1.3, 0.42) + 0.004, 1.3, -0.07, 0, c * -0.1)
    // Rétroviseurs sur pied.
    a.ellipsoide('peinture', 0.07, 0.055, 0.1, c * 0.97, 0.93, 0.62)
    a.boite('noir', 0.12, 0.02, 0.05, c * 0.9, 0.9, 0.62)
    // Jupes latérales et écopes derrière les roues avant.
    a.galet('carbone', 0.05, 0.05, 1.5, c * (caisse.xFlanc(0, 0.17) + 0.005), 0.165, -0.05, 0.02)
    for (let k = 0; k < 3; k++) {
      const z = 0.78 - k * 0.07
      a.boite('noir', 0.012, 0.15, 0.03, c * (caisse.xFlanc(z, 0.5) + 0.002), 0.5, z, 0.35)
    }
    // Poignées de porte.
    a.boite('chrome', 0.012, 0.022, 0.13, c * (caisse.xFlanc(-0.42, 0.7) + 0.004), 0.7, -0.42)
  }

  // --- Face arrière ----------------------------------------------------------------
  a.galet('noir', 1.6, 0.2, 0.05, 0, 0.7, -2.2, 0.04)                      // bandeau
  for (const c of [-1, 1]) {
    for (const x of [0.36, 0.60]) {
      a.cylindre('feu', 0.072, 0.072, 0.04, c * x, 0.7, -2.225, 'z', 20)
      a.tore('chrome', 0.075, 0.008, c * x, 0.7, -2.243, 'z')
    }
    // Doubles sorties d'échappement.
    for (const x of [0.5, 0.62]) {
      a.cylindre('chrome', 0.045, 0.045, 0.14, c * x, 0.3, -2.2, 'z', 14, true)
      a.cylindre('noir', 0.04, 0.04, 0.02, c * x, 0.3, -2.17, 'z', 14)
    }
  }
  a.boite('plaque', 0.34, 0.085, 0.01, 0, 0.7, -2.228)
  a.galet('carbone', 1.5, 0.2, 0.2, 0, 0.3, -2.13, 0.04)                   // bouclier / diffuseur
  for (let k = -2; k <= 2; k++) a.boite('carbone', 0.02, 0.13, 0.26, k * 0.15, 0.24, -2.14)
  a.boite('feuFixe', 0.3, 0.014, 0.012, 0, 0.955, -2.165)                  // troisième feu stop

  // --- Soubassement et doublures de passages de roue ---------------------------
  a.boite('noir', 1.26, 0.5, 3.9, 0, 0.4, 0)
  for (const ar of arches) {
    for (const c of [-1, 1]) a.doublure('noir', ar.r + 0.004, c * ar.xi, c * 0.93, R, ar.z)
  }

  return {
    pieces: a.finaliser(),
    roueAv: construireRoue({ rayon: R, largeur: 0.26, style: 'batons' }),
    roueAr: construireRoue({ rayon: R, largeur: 0.3, style: 'batons' }),
    essieux: { zAv, zAr, xAv: voie, xAr: voie + 0.005, y: R },
    halo: { largeur: 3.7, longueur: 6.3 },
    phares: { y: 0.6, z: 2.0 }
  }
}
