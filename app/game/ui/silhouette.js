// =============================================================================
// Silhouette SVG d'un tracé (menu, éditeur) : courbe fermée lissée
// (Catmull-Rom uniforme convertie en courbes de Bézier cubiques).
// =============================================================================

/**
 * @param {number[][]} points  points [x, z] du tracé (boucle fermée)
 * @param {number} taille      côté du carré SVG
 * @param {number} marge       marge intérieure
 * @returns {string} attribut `d` d'un chemin SVG
 */
export function cheminSilhouette(points, taille = 100, marge = 8) {
  if (!points || points.length < 3) return ''
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const e = (taille - 2 * marge) / Math.max(maxX - minX, maxZ - minZ, 1)
  const ox = (taille - (maxX - minX) * e) / 2, oz = (taille - (maxZ - minZ) * e) / 2
  const P = points.map(([x, z]) => [(x - minX) * e + ox, (z - minZ) * e + oz])
  const n = P.length, f = (v) => v.toFixed(1)
  let d = `M${f(P[0][0])} ${f(P[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`
  }
  return d + 'Z'
}
