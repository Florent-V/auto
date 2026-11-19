// =============================================================================
// MODULE : Caractéristiques physiques des voitures
// -----------------------------------------------------------------------------
// Ordres de grandeur réalistes (sources publiques : règlements techniques,
// fiches constructeurs, mesures de presse), arrondis :
//
//                      Monoplace F1      Hypercar          Sportive GT
//  Masse (pilote)      800 kg            1350 kg           1480 kg
//  Puissance           735 kW (≈1000 ch) 650 kW (≈880 ch)  420 kW (≈570 ch)
//  Régime maxi         12 500 tr/min     8 600 tr/min      7 600 tr/min
//  Rapports            8                 7                 6
//  SCx (traînée)       1,25 m²           0,88 m²           0,74 m²
//  SCz (appui)         5,0 m²            1,15 m²           0,25 m²
//  Pneus (μ pic)       1,9 (slicks)       1,45 (semi-slick) 1,22 (route sport)
//  Hauteur du CdG      0,28 m            0,40 m            0,48 m
//
// SCx/SCz = coefficient × surface de référence : F = ½·ρ·SC·v².
// La géométrie (empattement, voies, rayon de roue) correspond aux modèles 3D.
// =============================================================================

/** Masse volumique de l'air (kg/m³). */
export const RHO = 1.225
export const G = 9.81

/**
 * Courbe de puissance normalisée (modèle polynomial classique) :
 * P(x) = Pmax·(x + x² − x³), x = régime / régime de puissance maxi.
 * Couple maxi vers x = 0,5 (25 % au-dessus du couple au régime de puissance).
 */
export function puissanceNormalisee(x) {
  return Math.max(0, x + x * x - x * x * x)
}

export const SPECS = {
  f1: {
    nom: 'Monoplace',
    masse: 800, inertieLacet: 1050,
    empattement: 2.92, repartitionMasseAv: 0.45, hauteurCG: 0.28, voie: 1.6, demiLargeurCaisse: 1.0,
    rayonRoue: 0.36,
    moteur: { puissanceMax: 735e3, regimePuissance: 11500, regimeMax: 12500, ralenti: 4500, frein: 0.16, cylindres: 6 },
    boite: { rapports: [4.3, 3.5, 2.86, 2.36, 1.95, 1.62, 1.3, 1.0], pont: 4.96, rendement: 0.92, tempsPassage: 0.03, marcheArriere: 4.0 },
    aero: { SCx: 1.25, SCz: 5.0, equilibreAv: 0.43 },
    pneus: { mu: 1.9, sensibilite: 0.09, rigidite: 23, forme: 1.42, glissement: 0.78 },
    freins: { forceMax: 42000, repartitionAv: 0.58 },
    direction: { angleMax: 0.36, vitesse: 2.8 },
    antiroulisAv: 0.52, roulement: 0.012
  },
  hypercar: {
    nom: 'Hypercar',
    masse: 1350, inertieLacet: 1900,
    empattement: 2.6, repartitionMasseAv: 0.42, hauteurCG: 0.4, voie: 1.67, demiLargeurCaisse: 1.02,
    rayonRoue: 0.35,
    moteur: { puissanceMax: 650e3, regimePuissance: 7900, regimeMax: 8600, ralenti: 1100, frein: 0.12, cylindres: 12 },
    boite: { rapports: [3.62, 2.65, 2.05, 1.65, 1.37, 1.16, 1.0], pont: 3.06, rendement: 0.9, tempsPassage: 0.07, marcheArriere: 3.4 },
    aero: { SCx: 0.88, SCz: 1.15, equilibreAv: 0.42 },
    pneus: { mu: 1.45, sensibilite: 0.11, rigidite: 19, forme: 1.42, glissement: 0.8 },
    freins: { forceMax: 26000, repartitionAv: 0.62 },
    direction: { angleMax: 0.52, vitesse: 2.4 },
    antiroulisAv: 0.55, roulement: 0.013
  },
  sportive: {
    nom: 'Sportive',
    masse: 1480, inertieLacet: 2250,
    empattement: 2.6, repartitionMasseAv: 0.51, hauteurCG: 0.48, voie: 1.6, demiLargeurCaisse: 0.98,
    rayonRoue: 0.345,
    moteur: { puissanceMax: 420e3, regimePuissance: 7000, regimeMax: 7600, ralenti: 900, frein: 0.11, cylindres: 8 },
    boite: { rapports: [4.6, 3.0, 2.15, 1.65, 1.29, 1.0], pont: 3.05, rendement: 0.88, tempsPassage: 0.14, marcheArriere: 3.8 },
    aero: { SCx: 0.74, SCz: 0.25, equilibreAv: 0.45 },
    pneus: { mu: 1.22, sensibilite: 0.1, rigidite: 16, forme: 1.45, glissement: 0.82 },
    freins: { forceMax: 20000, repartitionAv: 0.64 },
    direction: { angleMax: 0.6, vitesse: 2.3 },
    antiroulisAv: 0.58, roulement: 0.014
  }
}

// Grandeurs dérivées (calculées une fois).
for (const s of Object.values(SPECS)) {
  s.distAv = s.empattement * (1 - s.repartitionMasseAv) // CdG → essieu avant
  s.distAr = s.empattement * s.repartitionMasseAv       // CdG → essieu arrière
  s.chargeNominale = (s.masse * G) / 4                   // charge statique d'une roue
  const m = s.moteur
  m.omegaPuissance = (m.regimePuissance * Math.PI) / 30
  m.coupleRef = m.puissanceMax / m.omegaPuissance        // couple au régime de puissance
  s.rapportsTotaux = s.boite.rapports.map((r) => r * s.boite.pont)
}

/** Couple moteur (N·m) à un régime donné, pleine charge. */
export function coupleMoteur(spec, regime) {
  const m = spec.moteur
  const x = Math.max(regime, m.ralenti) / m.regimePuissance
  const omega = (Math.max(regime, m.ralenti) * Math.PI) / 30
  return (m.puissanceMax * puissanceNormalisee(x)) / omega
}

/** Vitesse (m/s) atteinte au régime maxi sur un rapport donné. */
export function vitesseAuRupteur(spec, rapport) {
  return ((spec.moteur.regimeMax * Math.PI) / 30) * spec.rayonRoue / spec.rapportsTotaux[rapport]
}
