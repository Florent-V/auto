// =============================================================================
// MODULE : Roues
// -----------------------------------------------------------------------------
// Pneu au profil arrondi (surface de révolution), jante à bâtons ou flasque
// plein, disque et étrier de frein. La face extérieure de la roue construite
// regarde vers +X ; les roues du côté droit sont simplement retournées.
// =============================================================================
import * as THREE from 'three'
import { Atelier } from './outils.js'

/**
 * @param {object} o
 * @param {number} o.rayon   rayon extérieur du pneu
 * @param {number} o.largeur largeur du pneu
 * @param {'batons'|'turbine'|'flasque'} o.style dessin de la jante
 * @returns {{ tournant: Map, fixe: Map }} pièces en rotation / pièces fixes (étrier)
 */
export function construireRoue({ rayon, largeur, style }) {
  const R = rayon, w = largeur
  const rJ = style === 'flasque' ? R * 0.62 : R * 0.72 // rayon de jante (flanc haut en monoplace)
  const a = new Atelier()

  // --- Pneu : profil (rayon, position axiale) tourné autour de l'axe ---------
  const e = 0.045 // rayon des épaules
  const profil = [
    [rJ, -w / 2 + 0.01], [R - e * 1.6, -w / 2], [R - e * 0.5, -w / 2 + e * 0.35], [R, -w / 2 + e * 1.3],
    [R, w / 2 - e * 1.3], [R - e * 0.5, w / 2 - e * 0.35], [R - e * 1.6, w / 2], [rJ, w / 2 - 0.01]
  ].map(([r, x]) => new THREE.Vector2(r, x))
  const pneu = new THREE.LatheGeometry(profil, 36)
  pneu.rotateZ(-Math.PI / 2) // axe de révolution Y → X
  a.ajouter('pneu', pneu)

  // --- Fond de jante, disque de frein ----------------------------------------
  a.cylindre('pneu', rJ * 0.98, rJ * 0.98, 0.02, -w * 0.05, 0, 0, 'x', 24)
  a.cylindre('disque', rJ * 0.78, rJ * 0.78, 0.025, w * 0.12, 0, 0, 'x', 24)
  const xFace = w / 2 - 0.035 // plan de la face visible de la jante

  if (style === 'flasque') {
    // Monoplace : flasque plein, liseré de couleur, écrou central, bande de gomme.
    a.cylindre('carbone', rJ, rJ * 0.97, 0.03, xFace, 0, 0, 'x', 32)
    a.cylindre('carbone', rJ * 0.55, rJ * 0.6, 0.02, xFace + 0.022, 0, 0, 'x', 24)
    a.tore('accent', rJ * 0.9, 0.009, xFace + 0.016, 0, 0)
    a.cylindre('disque', 0.045, 0.055, 0.05, xFace + 0.035, 0, 0, 'x', 6)
    a.tore('flanc', R - 0.07, 0.011, w / 2 - 0.004, 0, 0)
    a.tore('flanc', R - 0.07, 0.011, -w / 2 + 0.004, 0, 0)
  } else {
    // Voile de jante creusé + lèvre extérieure.
    a.cylindre('jante', rJ, rJ, w * 0.55, w * 0.2, 0, 0, 'x', 28, true)
    a.tore('jante', rJ - 0.004, 0.014, w / 2 - 0.012, 0, 0)
    a.cylindre('jante', 0.07, 0.085, 0.06, xFace - 0.01, 0, 0, 'x', 12)
    a.cylindre('disque', 0.03, 0.04, 0.03, xFace + 0.03, 0, 0, 'x', 6)
    const nb = style === 'turbine' ? 10 : 5
    for (let k = 0; k < nb; k++) {
      const angle = (k / nb) * Math.PI * 2
      if (style === 'turbine') {
        // Dix bâtons fins légèrement vrillés.
        const g = new THREE.BoxGeometry(0.03, rJ - 0.06, 0.03)
        g.translate(0, (rJ + 0.05) / 2, 0)
        g.rotateY(0.25)
        g.rotateX(angle)
        a.ajouter('jante', g, xFace - 0.005, 0, 0)
      } else {
        // Cinq branches en Y : deux bâtons qui s'écartent vers la jante.
        for (const cote of [-1, 1]) {
          const g = new THREE.BoxGeometry(0.035, rJ - 0.05, 0.034)
          g.translate(0, (rJ + 0.04) / 2, 0)
          g.rotateX(cote * 0.2)
          g.rotateX(angle)
          a.ajouter('jante', g, xFace - 0.005, 0, 0)
        }
      }
    }
  }

  // --- Pièce fixe : étrier de frein (ne tourne pas avec la roue) -------------
  // (les monoplaces cachent le leur derrière le flasque)
  const fixe = new Atelier()
  if (style !== 'flasque') {
    const etrier = new THREE.TorusGeometry(rJ * 0.72, 0.035, 6, 8, 1.0)
    etrier.rotateY(Math.PI / 2)        // anneau d'axe X
    etrier.rotateX(-Math.PI / 2 - 0.5) // placé en haut, côté arrière de la roue
    fixe.ajouter('etrier', etrier, w * 0.12, 0, 0)
  }
  return { tournant: a.finaliser(), fixe: fixe.finaliser(), rayon: R, largeur: w }
}
