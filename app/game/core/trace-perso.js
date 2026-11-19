// =============================================================================
// MODULE : Circuits personnels (éditeur)
// -----------------------------------------------------------------------------
// Un circuit personnel est décrit par :
//   { nom, points: [[x, z], ...], demiLargeur, relief, paysage }
// Il peut être :
//  - encodé dans une chaîne compacte (base64url) → lien partageable ?trace=… ;
//  - enregistré dans le navigateur (localStorage, côté interface) ;
//  - validé (mêmes règles que le moteur de circuit) avant de rouler.
// Format binaire v1 (petit-boutiste) :
//   u8 version | u8 demiLargeur×10 | u8 relief (m) | u8 paysage | u8 longueur du nom
//   | nom UTF-8 | u16 nombre de points | (i16 x×2, i16 z×2) par point (pas de 0,5 m)
// =============================================================================
import { construireCircuit, CircuitInvalide } from './circuit.js'

export const PAYSAGES = ['plaine', 'foret', 'dunes', 'montagne', 'ville']
export const LARGEURS = [5, 6, 6.5, 7] // demi-largeurs proposées (10 à 14 m)
const VERSION = 1

function versBase64Url(octets) {
  let bin = ''
  for (let i = 0; i < octets.length; i++) bin += String.fromCharCode(octets[i])
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function depuisBase64Url(texte) {
  const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texte.length + 3) % 4)
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary')
  const octets = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i)
  return octets
}

/** Encode une définition de circuit en chaîne compacte (pour l'URL). */
export function encoderTrace(def) {
  const nom = new TextEncoder().encode((def.nom || '').slice(0, 40))
  const pts = def.points
  const x0 = pts[0][0], z0 = pts[0][1]
  const buf = new ArrayBuffer(5 + nom.length + 2 + pts.length * 4)
  const dv = new DataView(buf)
  let o = 0
  dv.setUint8(o++, VERSION)
  dv.setUint8(o++, Math.round((def.demiLargeur ?? 6.5) * 10))
  dv.setUint8(o++, Math.max(0, Math.min(255, Math.round(def.relief ?? 6))))
  dv.setUint8(o++, Math.max(0, PAYSAGES.indexOf(def.paysage ?? 'plaine')))
  dv.setUint8(o++, nom.length)
  new Uint8Array(buf, o, nom.length).set(nom); o += nom.length
  dv.setUint16(o, pts.length, true); o += 2
  for (const [x, z] of pts) {
    dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round((x - x0) * 2))), true); o += 2
    dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round((z - z0) * 2))), true); o += 2
  }
  return versBase64Url(new Uint8Array(buf))
}

/** Décode une chaîne produite par encoderTrace ; lève une erreur si invalide. */
export function decoderTrace(texte) {
  const octets = depuisBase64Url(String(texte))
  const dv = new DataView(octets.buffer)
  let o = 0
  if (octets.length < 8 || dv.getUint8(o++) !== VERSION) throw new Error('Tracé illisible')
  const demiLargeur = dv.getUint8(o++) / 10
  const relief = dv.getUint8(o++)
  const paysage = PAYSAGES[dv.getUint8(o++)] ?? 'plaine'
  const lgNom = dv.getUint8(o++)
  const nom = new TextDecoder().decode(octets.subarray(o, o + lgNom)); o += lgNom
  const nb = dv.getUint16(o, true); o += 2
  if (nb < 4 || o + nb * 4 > octets.length) throw new Error('Tracé incomplet')
  const points = []
  for (let i = 0; i < nb; i++) {
    points.push([dv.getInt16(o, true) / 2, dv.getInt16(o + 2, true) / 2]); o += 4
  }
  return { nom, points, demiLargeur, relief, paysage }
}

/**
 * Construit le circuit d'une définition personnelle, sans lever d'erreur :
 * renvoie { circuit, problemes } (circuit = null si le tracé est inexploitable).
 */
export function evaluerTrace(def) {
  if (!def.points || def.points.length < 4) {
    return { circuit: null, problemes: [{ type: 'points', message: 'Il faut au moins 4 points' }] }
  }
  try {
    const circuit = construireCircuit({
      points: def.points, nom: def.nom, id: 'perso', source: 'perso', tolerant: true,
      demiLargeur: def.demiLargeur ?? 6.5, paysage: def.paysage ?? 'plaine',
      altitude: { type: 'sinus', amplitude: def.relief ?? 6 }, seed: 7
    })
    const problemes = circuit.problemes.slice()
    if (circuit.longueur < 600) problemes.push({ type: 'longueur', message: `Circuit trop court (${Math.round(circuit.longueur)} m, minimum 600 m)` })
    if (circuit.longueur > 12000) problemes.push({ type: 'longueur', message: 'Circuit trop long (12 km maximum)' })
    return { circuit, problemes }
  } catch (e) {
    return { circuit: null, problemes: e instanceof CircuitInvalide ? e.problemes : [{ type: 'erreur', message: e.message }] }
  }
}

/**
 * Simplifie une polyligne fermée (Douglas–Peucker) : sert à proposer un
 * circuit réel comme point de départ éditable (~30 à 60 points).
 */
export function simplifier(points, tolerance = 6) {
  const garder = new Uint8Array(points.length)
  const pile = [[0, points.length - 1]]
  garder[0] = garder[points.length - 1] = 1
  while (pile.length) {
    const [a, b] = pile.pop()
    let dmax = 0, imax = -1
    const [ax, az] = points[a], [bx, bz] = points[b]
    const lx = bx - ax, lz = bz - az, l2 = lx * lx + lz * lz || 1
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((points[i][0] - ax) * lx + (points[i][1] - az) * lz) / l2))
      const d = Math.hypot(points[i][0] - (ax + lx * t), points[i][1] - (az + lz * t))
      if (d > dmax) { dmax = d; imax = i }
    }
    if (dmax > tolerance && imax > 0) { garder[imax] = 1; pile.push([a, imax], [imax, b]) }
  }
  const sortie = points.filter((_, i) => garder[i])
  // Le dernier point peut doubler le premier (boucle fermée) : on le retire.
  const [px, pz] = sortie[0], [qx, qz] = sortie[sortie.length - 1]
  if (sortie.length > 4 && Math.hypot(px - qx, pz - qz) < 1) sortie.pop()
  return sortie
}
