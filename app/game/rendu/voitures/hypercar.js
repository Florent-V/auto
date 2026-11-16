// =============================================================================
// MODÈLE : Hypercar — moteur central arrière
// -----------------------------------------------------------------------------
// Nez plongeant très bas, ailes avant hautes encadrant un capot creusé, bulle
// vitrée avancée en goutte d'eau, taille pincée puis hanches très larges,
// capot moteur à persiennes, grand aileron sur cols de cygne, bandeau de feux
// pleine largeur et diffuseur à ailettes.
// =============================================================================
import { Atelier, coque } from './outils.js'
import { construireRoue } from './roues.js'

export function construireHypercar() {
  const a = new Atelier()
  const R = 0.35
  const zAv = 1.25, zAr = -1.35
  const arches = [{ z: zAv, y: R, r: R + 0.055, xi: 0.66 }, { z: zAr, y: R, r: R + 0.065, xi: 0.6 }]

  // --- Caisse ------------------------------------------------------------------
  const caisse = coque(a, [
    { z: 2.36, l: 0.60, bas: 0.15, taille: 0.235, haut: 0.285, nH: 2.4, nB: 3 },
    { z: 2.26, l: 0.82, bas: 0.12, taille: 0.26, haut: 0.35 },
    { z: 1.98, l: 0.95, bas: 0.10, taille: 0.33, haut: 0.51, nH: 3, nB: 5, creux: 0.04 },
    { z: zAv, l: 1.0, bas: 0.10, taille: 0.46, haut: 0.80, nH: 3.4, creux: 0.14 },
    { z: 0.75, l: 0.985, taille: 0.50, haut: 0.775, creux: 0.08 },
    { z: 0.10, l: 0.95, taille: 0.52, haut: 0.76, creux: 0.03 },
    { z: -0.60, l: 0.99, taille: 0.56, haut: 0.82, creux: 0 },
    { z: zAr, l: 1.035, taille: 0.60, haut: 0.885, nH: 3.6, creux: 0.05 },
    { z: -1.90, l: 1.0, bas: 0.18, taille: 0.62, haut: 0.86, nH: 4.5, creux: 0.02 },
    { z: -2.20, l: 0.96, bas: 0.30, taille: 0.62, haut: 0.80, nH: 5, creux: 0 },
    { z: -2.26, l: 0.93, bas: 0.34, taille: 0.62, haut: 0.775 }
  ], {
    arches,
    mat(i) {
      if (i.bout) return 'noir'
      if (!i.dessus && i.y < 0.3) return 'carbone'                              // bas de caisse
      const c = Math.abs(i.col)
      // Prises d'air latérales devant les roues arrière (découpe nette suivant les lignes de caisse).
      if (i.z < -0.36 && i.z > -0.93 && ((!i.dessus && c === 5) || (i.dessus && c === 12))) return 'noir'
      // Filet d'accent le long de l'épaule.
      if (i.dessus && Math.abs(i.col) === 10 && i.z < 1.9 && i.z > -2.1) return 'accent'
      return 'peinture'
    }
  })

  // --- Bulle vitrée + capot moteur à persiennes ---------------------------------
  coque(a, [
    { z: 1.32, l: 0.72, bas: 0.46, taille: 0.56, haut: 0.63, nH: 2.6, nB: 8 },
    { z: 0.90, l: 0.71, bas: 0.46, taille: 0.60, haut: 0.87 },
    { z: 0.45, l: 0.67, bas: 0.46, taille: 0.62, haut: 1.07, nH: 2.8 },
    { z: 0.05, l: 0.63, bas: 0.46, taille: 0.64, haut: 1.135 },
    { z: -0.40, l: 0.59, bas: 0.5, taille: 0.67, haut: 1.10 },
    { z: -0.90, l: 0.52, bas: 0.55, taille: 0.72, haut: 1.0, nH: 3 },
    { z: -1.50, l: 0.44, bas: 0.6, taille: 0.77, haut: 0.92 },
    { z: -2.0, l: 0.36, bas: 0.66, taille: 0.78, haut: 0.845 }
  ], {
    kBas: 2, pas: 0.05,
    mat(i) {
      if (i.bout || !i.dessus) return 'peinture'
      const c = Math.abs(i.col)
      if (i.z > -0.5) return c >= 11 ? 'peinture' : c === 7 && i.z < 0.5 ? 'carbone' : 'vitre'
      // Capot moteur : épine dorsale en carbone, persiennes alternées de part et d'autre.
      if (c <= 1) return 'carbone'
      if (c <= 6 && i.z > -1.75) return Math.floor(-i.z * 11) % 2 === 0 ? 'noir' : 'peinture'
      return 'peinture'
    }
  })
  a.galet('carbone', 0.24, 0.1, 0.62, 0, 1.115, -0.52, 0.045, 0.09)        // prise d'air de toit
  a.galet('noir', 0.19, 0.06, 0.03, 0, 1.14, -0.215, 0.012, 0.09)

  // --- Face avant ----------------------------------------------------------------
  // Lame avant épousant le contour du nez.
  a.profil('carbone', [[-0.6, 2.43], [0.6, 2.43], [0.9, 2.26], [0.97, 1.9], [-0.97, 1.9], [-0.9, 2.26]], 0.03, 'xz', 0, 0.105, 0)
  a.galet('noir', 0.86, 0.085, 0.07, 0, 0.215, 2.325, 0.03)                // bouche centrale
  for (const c of [-1, 1]) {
    a.galet('noir', 0.34, 0.11, 0.1, c * 0.7, 0.21, 2.2, 0.035, 0, c * -0.45, 0) // écopes
    // Feux à lames : trois traits de LED qui remontent sur l'aile.
    for (let k = 0; k < 3; k++) {
      const z = 2.0 - k * 0.09, x = 0.62 + k * 0.07
      a.boite('phare', 0.2, 0.016, 0.045, c * x, caisse.yDessus(z, x) + 0.004, z, 0.3, c * 0.5, 0)
    }
    a.boite('carbone', 0.2, 0.012, 0.16, c * 0.95, 0.34, 2.02, 0.2, 0, c * 0.25)   // canards
    a.boite('carbone', 0.16, 0.012, 0.14, c * 0.97, 0.44, 1.93, 0.25, 0, c * 0.25)
    // Rétroviseurs perchés sur une lame de carbone.
    a.ellipsoide('carbone', 0.075, 0.05, 0.11, c * 1.0, 0.9, 0.6)
    a.boite('carbone', 0.36, 0.016, 0.07, c * 0.83, 0.87, 0.6, 0, 0, c * 0.12)
    a.galet('carbone', 0.05, 0.05, 1.6, c * (caisse.xFlanc(0, 0.13) + 0.005), 0.125, -0.05, 0.02) // jupes
  }

  // --- Face arrière ----------------------------------------------------------------
  a.galet('noir', 1.74, 0.3, 0.05, 0, 0.5, -2.25, 0.04)                    // grille
  for (let k = 0; k < 4; k++) a.boite('carbone', 1.66, 0.012, 0.03, 0, 0.4 + k * 0.065, -2.275)
  a.boite('feu', 1.72, 0.034, 0.03, 0, 0.7, -2.272)                        // bandeau lumineux
  for (const c of [-1, 1]) {
    a.boite('feu', 0.034, 0.12, 0.03, c * 0.845, 0.645, -2.272)
    a.cylindre('chrome', 0.075, 0.075, 0.12, c * 0.105, 0.5, -2.28, 'z', 6, true) // sorties hexagonales
    a.cylindre('noir', 0.066, 0.066, 0.02, c * 0.105, 0.5, -2.25, 'z', 6)
    // Cols de cygne de l'aileron.
    a.profil('carbone', [[-1.55, 0.84], [-1.78, 0.84], [-2.05, 1.19], [-1.93, 1.19], [-1.72, 0.96]], 0.028, 'zy', c * 0.42)
    a.profil('peinture', [[-1.82, 1.06], [-2.24, 1.08], [-2.24, 1.2], [-1.86, 1.19]], 0.02, 'zy', c * 0.93)
  }
  a.aile('carbone', 1.86, 0.38, 0.045, 0, 1.15, -2.03, 0.13, 0.08)         // plan principal
  a.boite('feuFixe', 0.5, 0.012, 0.012, 0, 1.118, -2.215)
  // Diffuseur : plan incliné + ailettes verticales.
  a.profil('carbone', [[-1.7, 0.09], [-2.36, 0.09], [-2.36, 0.33], [-1.7, 0.14]], 1.56, 'zy')
  for (let k = -3; k <= 3; k++) a.profil('carbone', [[-1.75, 0.06], [-2.42, 0.06], [-2.42, 0.36], [-1.75, 0.18]], 0.018, 'zy', k * 0.22)

  // --- Soubassement et doublures de passages de roue ---------------------------
  a.boite('noir', 1.18, 0.5, 4.0, 0, 0.36, 0)
  for (const ar of arches) {
    for (const c of [-1, 1]) a.doublure('noir', ar.r + 0.004, c * ar.xi, c * 0.97, R, ar.z)
  }

  return {
    pieces: a.finaliser(),
    roueAv: construireRoue({ rayon: R, largeur: 0.27, style: 'turbine' }),
    roueAr: construireRoue({ rayon: R, largeur: 0.34, style: 'turbine' }),
    essieux: { zAv, zAr, xAv: 0.835, xAr: 0.83, y: R },
    halo: { largeur: 3.9, longueur: 6.6 },
    phares: { y: 0.5, z: 2.0 }
  }
}
