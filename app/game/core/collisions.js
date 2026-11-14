// =============================================================================
// MODULE : Collisions entre véhicules
// -----------------------------------------------------------------------------
// Chaque voiture est approchée par deux cercles (avant / arrière). Pour chaque
// paire on résout le contact le plus profond : séparation des positions puis
// échange d'impulsion (masses égales) avec un léger ralentissement. Rien n'est
// jamais « collé » : la course ne peut pas se bloquer.
// =============================================================================
const RAYON = 1.0          // rayon de chaque cercle
const DECALAGE = 1.15      // distance centre du véhicule → centre d'un cercle
const RESTITUTION = 0.35
const PERTE_PAR_IMPULSION = 0.012 // fraction de vitesse perdue par m/s d'impulsion
const PERTE_MAX = 0.05            // plafond par contact

/** Résout toutes les collisions ; renvoie l'intensité max subie par le joueur. */
export function resoudreCollisions(vehicules) {
  const nb = vehicules.length
  for (let i = 0; i < nb; i++) {
    for (let j = i + 1; j < nb; j++) {
      const a = vehicules[i], b = vehicules[j]
      const dxc = b.x - a.x, dzc = b.z - a.z
      // Rejet rapide : centres trop éloignés.
      if (dxc * dxc + dzc * dzc > 25) continue
      const sa = Math.sin(a.lacet), ca = Math.cos(a.lacet)
      const sb = Math.sin(b.lacet), cb = Math.cos(b.lacet)
      // Recherche du couple de cercles le plus enfoncé.
      let penMax = 0, nxm = 0, nzm = 0, brasA = 0, brasB = 0
      for (let ka = -1; ka <= 1; ka += 2) {
        const ax = a.x + sa * DECALAGE * ka, az = a.z + ca * DECALAGE * ka
        for (let kb = -1; kb <= 1; kb += 2) {
          const bx = b.x + sb * DECALAGE * kb, bz = b.z + cb * DECALAGE * kb
          const dx = bx - ax, dz = bz - az
          const dist = Math.sqrt(dx * dx + dz * dz)
          const pen = 2 * RAYON - dist
          if (pen > penMax && dist > 1e-4) {
            penMax = pen; nxm = dx / dist; nzm = dz / dist
            brasA = ka; brasB = kb
          }
        }
      }
      if (penMax <= 0) continue

      // 1. Séparation : chaque véhicule recule de la moitié de la pénétration.
      const demi = penMax * 0.5
      a.x -= nxm * demi; a.z -= nzm * demi
      b.x += nxm * demi; b.z += nzm * demi

      // 2. Impulsion le long de la normale (vitesses exprimées dans le monde).
      let avx = a.vx * sa + a.vy * ca, avz = a.vx * ca - a.vy * sa
      let bvx = b.vx * sb + b.vy * cb, bvz = b.vx * cb - b.vy * sb
      const vRel = (bvx - avx) * nxm + (bvz - avz) * nzm
      if (vRel < 0) {
        const imp = (-(1 + RESTITUTION) * vRel) / 2
        avx -= imp * nxm; avz -= imp * nzm
        bvx += imp * nxm; bvz += imp * nzm
        // 3. Léger ralentissement PROPORTIONNEL au choc (un simple frottement
        //    prolongé entre deux voitures ne doit freiner personne), puis petit
        //    couple de lacet selon le point d'impact.
        const garde = 1 - Math.min(PERTE_MAX, imp * PERTE_PAR_IMPULSION)
        a.vx = (avx * sa + avz * ca) * garde
        a.vy = avx * ca - avz * sa
        b.vx = (bvx * sb + bvz * cb) * garde
        b.vy = bvx * cb - bvz * sb
        const couple = Math.min(imp, 6) * 0.05
        // Produit vectoriel (bras de levier × normale) → sens du couple.
        a.r += couple * brasA * (sa * nzm - ca * nxm)
        b.r -= couple * brasB * (sb * nzm - cb * nxm)
        if (imp > a.choc) a.choc = imp
        if (imp > b.choc) b.choc = imp
      }
    }
  }
}
