// =============================================================================
// MODULE : Générateur pseudo-aléatoire déterministe
// -----------------------------------------------------------------------------
// Toute la génération procédurale (circuit, décor, niveaux des IA) passe par ce
// générateur : une même seed produit donc toujours exactement le même monde.
// =============================================================================

/**
 * Convertit une seed quelconque (nombre ou texte) en entier non signé 32 bits.
 * Un texte est haché (variante de xmur3) afin d'accepter `?seed=monaco`.
 */
export function normaliserSeed(valeur) {
  const texte = String(valeur ?? '').trim()
  if (/^\d{1,10}$/.test(texte)) return Number(texte) >>> 0
  let h = 1779033703 ^ texte.length
  for (let i = 0; i < texte.length; i++) {
    h = Math.imul(h ^ texte.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

/** Générateur mulberry32 : rapide, bonne qualité statistique, état de 32 bits. */
export function creerRng(seed) {
  let a = seed >>> 0
  return function rng() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Tire une seed « lisible » (6 chiffres) pour un nouveau circuit. */
export function seedAleatoire() {
  return 100000 + Math.floor(Math.random() * 900000)
}
