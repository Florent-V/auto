// =============================================================================
// Banc d'essai de la physique : `npm run banc`
// Mesures normalisées sur un anneau plat géant (quasi ligne droite) et sur un
// cercle de rayon constant (skidpad). Sortie : tableau Markdown.
// =============================================================================
import { construireCircuit } from '../app/game/core/circuit.js'
import { SPECS, G } from '../app/game/core/modeles.js'
import { creerVehicule, placerSurCircuit, pasVehicule, braquageMax } from '../app/game/core/vehicule.js'

const DT = 1 / 120
function anneau(rayon) {
  const pts = []
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; pts.push([Math.cos(a) * rayon, Math.sin(a) * rayon]) }
  return construireCircuit({ points: pts, altitude: { type: 'profil', points: [[0, 0]] }, demiLargeur: 12, tolerant: true })
}
const droite = anneau(6000)
const vehicule = (modele, circuit, v0 = 0, aides = true) => {
  const v = creerVehicule(0, 'banc', 0, true, modele)
  placerSurCircuit(v, circuit, 0, 0, v0)
  if (!aides) v.aides = { abs: false, antipatinage: false, stabilite: 0, contreBraquage: false }
  return v
}
// Maintient la voiture au centre (petit correcteur de cap), sans interférer.
const tenirCap = (v, c, decalage = 0) => {
  const e = Math.sin(v.lacet - c.cap[v.idx]) + (v.d - decalage) * 0.02
  v.cmdDir = Math.max(-1, Math.min(1, -e * 6))
}

export function mesurer(modele) {
  const r = { modele: SPECS[modele].nom }
  // Accélération départ arrêté + vitesse de pointe.
  let v = vehicule(modele, droite), t = 0
  while (v.vx < 400 / 3.6 && t < 120) {
    v.cmdGaz = 1; tenirCap(v, droite); pasVehicule(v, droite, DT); t += DT
    if (!r.t100 && v.vx >= 100 / 3.6) r.t100 = t
    if (!r.t200 && v.vx >= 200 / 3.6) r.t200 = t
    if (!r.t300 && v.vx >= 300 / 3.6) r.t300 = t
    // Plafond atteint : moins de 0,1 km/h gagné en 3 s (hors passages de rapport).
    if (Math.round(t / DT) % 360 === 0) { if (t > 6 && v.vx - (r.vmaxPrec ?? 0) < 0.03) break; r.vmaxPrec = v.vx }
  }
  r.vmax = v.vx * 3.6
  r.rapportFinal = v.rapport
  // Freinage 100 → 0 et 200 → 0 (ABS).
  for (const v0 of [100, 200]) {
    v = vehicule(modele, droite, v0 / 3.6); v.rapport = 3
    let d = 0, decelMax = 0
    while (v.vx > 0.2) { v.cmdFrein = 1; tenirCap(v, droite); const avant = v.vx; pasVehicule(v, droite, DT); d += v.vx * DT; decelMax = Math.max(decelMax, (avant - v.vx) / DT / G) }
    r['frein' + v0] = d
    if (v0 === 200) r.decelMax = decelMax
  }
  // Accélération latérale maximale en régime quasi stationnaire : vitesse
  // augmentée lentement (0,25 m/s par seconde) sur un cercle, direction
  // asservie à la vitesse de lacet visée r* = v·κ (correcteur PI). On retient
  // la plus forte accélération v·r tenue 1 s avec un lacet stable (±4 %).
  for (const [rayon, cle] of [[60, 'lat60'], [250, 'lat250']]) {
    const cercle = anneau(rayon)
    const spec = SPECS[modele]
    v = vehicule(modele, cercle, Math.sqrt(0.3 * G * rayon))
    v.aides.contreBraquage = false
    let vitesse = v.vx, integrale = 0, tenue = 0, meilleur = 0
    for (let k = 0; k < 120 * 400 && vitesse < 110; k++) {
      vitesse += 0.25 * DT
      const e = vitesse - v.vx
      v.cmdGaz = Math.max(0, Math.min(1, e * 0.8)); v.cmdFrein = Math.max(0, Math.min(1, -e * 0.3))
      const kappa = cercle.courbure[v.idx]
      const rVise = v.vx * kappa
      const erreur = rVise - v.r
      const gain = (0.6 * spec.empattement) / Math.max(v.vx, 5)
      integrale += erreur * gain * 2.5 * DT
      const delta = spec.empattement * kappa + erreur * gain + integrale
      v.cmdDir = Math.max(-1, Math.min(1, delta / braquageMax(spec, v.vx)))
      pasVehicule(v, cercle, DT)
      if (Math.abs(erreur) < Math.abs(rVise) * 0.04 && Math.abs(v.d) < 10) {
        tenue += DT
        if (tenue > 1) meilleur = Math.max(meilleur, Math.abs(v.vx * v.r) / G)
      } else tenue = 0
      if (Math.abs(v.d) > 11 || (meilleur > 0 && Math.abs(v.vx * v.r) / G < meilleur * 0.7)) break
    }
    r[cle] = meilleur
  }
  delete r.vmaxPrec
  return r
}

const lignes = Object.keys(SPECS).map(mesurer)
const f = (x, n = 1) => (x === undefined ? '—' : x.toFixed(n))
console.log('| Voiture | 0-100 km/h | 0-200 km/h | 0-300 km/h | V. max | 100-0 | 200-0 | Décél. max | Latéral R60 | Latéral R250 |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of lignes) {
  console.log(`| ${r.modele} | ${f(r.t100, 2)} s | ${f(r.t200, 2)} s | ${f(r.t300, 1)} s | ${f(r.vmax, 0)} km/h (R${r.rapportFinal}) | ${f(r.frein100, 1)} m | ${f(r.frein200, 1)} m | ${f(r.decelMax, 2)} g | ${f(r.lat60, 2)} g | ${f(r.lat250, 2)} g |`)
}
