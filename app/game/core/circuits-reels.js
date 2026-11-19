// =============================================================================
// MODULE : Catalogue des circuits
// -----------------------------------------------------------------------------
// Circuits « célèbres » (tracés réels, voir donnees-circuits.js) + habillage :
// largeur, relief, type (permanent / urbain) et paysage. Les profils d'altitude
// sont des approximations réalisées à partir des repères connus de chaque
// circuit (montée du Raidillon à Spa, Casino à Monaco, etc.), exprimées en
// fraction du tour depuis la ligne de départ → hauteur relative en mètres.
// =============================================================================
import { DONNEES_CIRCUITS } from './donnees-circuits.js'
import { construireCircuit, genererCircuit } from './circuit.js'
import { normaliserSeed } from './rng.js'

const HABILLAGE = {
  monza: {
    demiLargeur: 6.5, paysage: 'foret', ordre: 1,
    altitude: [[0, 0], [0.3, -3], [0.6, -6], [0.85, -2]]
  },
  spa: {
    demiLargeur: 6.5, paysage: 'foret', ordre: 2,
    altitude: [[0, 0], [0.04, 3], [0.085, -26], [0.125, 6], [0.2, 22], [0.3, 35], [0.4, 10], [0.5, -15],
      [0.56, -25], [0.64, -35], [0.7, -60], [0.8, -48], [0.88, -25], [0.95, -8]]
  },
  silverstone: {
    demiLargeur: 7, paysage: 'plaine', ordre: 3,
    altitude: [[0, 0], [0.25, 4], [0.5, 8], [0.75, 3]]
  },
  monaco: {
    demiLargeur: 4.8, paysage: 'ville', urbain: true, ordre: 4, lissage: 4,
    // Le tracé réel se replie sur lui-même entre Mirabeau et l'épingle (des
    // immeubles séparent les deux chaussées) : on tolère des voies proches.
    exigences: { separationMin: 2 * 4.8 + 1.2 },
    altitude: [[0, 0], [0.04, 2], [0.09, 22], [0.14, 40], [0.17, 33], [0.2, 22], [0.24, 6], [0.28, 3],
      [0.32, -2], [0.6, -2], [0.9, -1]]
  },
  interlagos: {
    demiLargeur: 6, paysage: 'plaine', ordre: 5,
    altitude: [[0, 0], [0.05, -8], [0.1, -18], [0.16, -22], [0.25, -28], [0.33, -34], [0.42, -28], [0.5, -20],
      [0.6, -14], [0.66, -12], [0.7, -16], [0.75, -26], [0.8, -30], [0.88, -16], [0.95, -6]]
  },
  spielberg: {
    demiLargeur: 6.5, paysage: 'montagne', ordre: 6,
    altitude: [[0, 0], [0.07, 10], [0.18, 30], [0.28, 52], [0.32, 55], [0.45, 45], [0.52, 38], [0.62, 25],
      [0.72, 15], [0.85, 6], [0.92, 2]]
  },
  zandvoort: {
    demiLargeur: 6, paysage: 'dunes', ordre: 7,
    altitude: [[0, 0], [0.1, 2], [0.2, 8], [0.3, 12], [0.4, 6], [0.5, 10], [0.6, 4], [0.7, 9], [0.8, 3], [0.9, 5]]
  },
  imola: {
    demiLargeur: 6, paysage: 'foret', ordre: 8,
    altitude: [[0, 0], [0.1, -5], [0.2, -8], [0.27, -6], [0.35, 10], [0.4, 18], [0.47, 4], [0.55, 12], [0.6, 20],
      [0.7, 8], [0.78, -6], [0.88, -4]]
  },
  hungaroring: {
    demiLargeur: 6, paysage: 'plaine', ordre: 9,
    altitude: [[0, 0], [0.08, -10], [0.2, -20], [0.3, -10], [0.4, 5], [0.5, 12], [0.6, 8], [0.7, -2], [0.8, -8], [0.9, -4]]
  }
}

/** Liste des circuits célèbres (pour le menu), dans l'ordre d'affichage. */
export const CIRCUITS_CELEBRES = Object.entries(DONNEES_CIRCUITS)
  .map(([id, d]) => ({
    id, nom: d.nom, pays: d.pays, description: d.description, longueurReelle: d.longueurReelle,
    urbain: !!HABILLAGE[id].urbain, ordre: HABILLAGE[id].ordre,
    denivele: Math.round(Math.max(...HABILLAGE[id].altitude.map((p) => p[1])) - Math.min(...HABILLAGE[id].altitude.map((p) => p[1])))
  }))
  .sort((a, b) => a.ordre - b.ordre)

/** Points du tracé réel en mètres (aussi utilisés comme modèle par l'éditeur). */
export function pointsCircuitReel(id) {
  const t = DONNEES_CIRCUITS[id].trace, pts = []
  for (let i = 0; i < t.length; i += 2) pts.push([t[i] / 10, t[i + 1] / 10])
  return pts
}

/** Construit un circuit célèbre. */
export function construireCircuitReel(id) {
  const d = DONNEES_CIRCUITS[id], h = HABILLAGE[id]
  if (!d) throw new Error(`Circuit inconnu : ${id}`)
  return construireCircuit({
    points: pointsCircuitReel(id), id, nom: d.nom, source: 'reel',
    seed: normaliserSeed(id), demiLargeur: h.demiLargeur, urbain: h.urbain, paysage: h.paysage,
    // Lissage du tracé : gomme le bruit de numérisation (points GPS irréguliers,
    // qui créeraient de faux virages serrés) ; plus léger en ville, où les
    // épingles sont réelles. Longueur conservée à mieux que 1,5 %.
    altitude: { type: 'profil', points: h.altitude }, lissage: h.lissage ?? 9, exigences: h.exigences
  })
}

/**
 * Point d'entrée unique : construit le circuit décrit par une « référence »
 * { type: 'reel', id } | { type: 'seed', seed } | { type: 'perso', definition }.
 */
export function construireDepuisReference(ref) {
  if (ref.type === 'reel') return construireCircuitReel(ref.id)
  if (ref.type === 'perso') {
    const d = ref.definition
    return construireCircuit({
      points: d.points, id: 'perso', nom: d.nom || 'Mon circuit', source: 'perso',
      seed: normaliserSeed(d.nom || 'perso'), demiLargeur: d.demiLargeur, paysage: d.paysage || 'plaine',
      altitude: { type: 'sinus', amplitude: d.relief ?? 6 }
    })
  }
  const c = genererCircuit(normaliserSeed(ref.seed))
  c.nom = `Circuit #${ref.seed}`
  return c
}
