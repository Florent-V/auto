// =============================================================================
// MODULE : Textures procédurales (canvas 2D)
// -----------------------------------------------------------------------------
// Toutes les surfaces sont dessinées par le code : aucun fichier image.
// Les textures sont mises en cache et partagées entre circuits.
// =============================================================================
import * as THREE from 'three'
import { creerRng } from '../core/rng.js'

const cache = new Map()

function canvas(l, h) {
  const cv = document.createElement('canvas')
  cv.width = l; cv.height = h
  return cv
}

function versTexture(cv, { srgb = true, repeter = true, anisotropie = 8 } = {}) {
  const t = new THREE.CanvasTexture(cv)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = repeter ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  t.anisotropy = anisotropie
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

function memo(cle, fabrique) {
  if (!cache.has(cle)) cache.set(cle, fabrique())
  return cache.get(cle)
}

/** Champ de bruit de valeur périodique (tuile sans couture), valeurs 0..1. */
function bruitPeriodique(taille, cellules, rng) {
  const g = new Float32Array(cellules * cellules)
  for (let i = 0; i < g.length; i++) g[i] = rng()
  const sortie = new Float32Array(taille * taille)
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const fx = (x / taille) * cellules, fy = (y / taille) * cellules
      const x0 = Math.floor(fx), y0 = Math.floor(fy)
      const tx = fx - x0, ty = fy - y0
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const a = g[(y0 % cellules) * cellules + (x0 % cellules)], b = g[(y0 % cellules) * cellules + ((x0 + 1) % cellules)]
      const c = g[((y0 + 1) % cellules) * cellules + (x0 % cellules)], d = g[((y0 + 1) % cellules) * cellules + ((x0 + 1) % cellules)]
      sortie[y * taille + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    }
  }
  return sortie
}

/** Somme d'octaves de bruit périodique. */
function fbm(taille, rng, octaves = [[4, 0.5], [8, 0.25], [16, 0.15], [64, 0.1]]) {
  const total = new Float32Array(taille * taille)
  for (const [cel, poids] of octaves) {
    const b = bruitPeriodique(taille, cel, rng)
    for (let i = 0; i < total.length; i++) total[i] += b[i] * poids
  }
  return total
}

/** Carte de normales (espace tangent) à partir d'un champ de hauteur périodique. */
function normalesDepuisHauteur(h, taille, force) {
  const cv = canvas(taille, taille), ctx = cv.getContext('2d')
  const img = ctx.createImageData(taille, taille)
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const g = h[y * taille + ((x - 1 + taille) % taille)], d = h[y * taille + ((x + 1) % taille)]
      const hHaut = h[((y - 1 + taille) % taille) * taille + x], b = h[((y + 1) % taille) * taille + x]
      let nx = (g - d) * force, ny = (hHaut - b) * force, nz = 1
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l
      const o = (y * taille + x) * 4
      img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz * 0.5 + 0.5) * 255; img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return versTexture(cv, { srgb: false })
}

/** Remplit une texture couleur depuis un champ et une fonction (v, x, y) → [r, g, b]. */
function peindre(taille, champ, couleur) {
  const cv = canvas(taille, taille), ctx = cv.getContext('2d')
  const img = ctx.createImageData(taille, taille)
  for (let i = 0; i < taille * taille; i++) {
    const [r, g, b] = couleur(champ[i], i % taille, (i / taille) | 0)
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

// -----------------------------------------------------------------------------
// Surfaces
// -----------------------------------------------------------------------------
/** Asphalte (tuile de 6 m) : granulats clairs, liant sombre, micro-relief. */
export function texturesAsphalte() {
  return memo('asphalte', () => {
    const rng = creerRng(11), T = 512
    const h = fbm(T, rng, [[8, 0.35], [32, 0.25], [128, 0.25], [256, 0.15]])
    const grains = new Float32Array(T * T)
    for (let i = 0; i < 26000; i++) {
      const x = (rng() * T) | 0, y = (rng() * T) | 0, r = rng() < 0.8 ? 1 : 2, v = 0.25 + rng() * 0.75
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) grains[(((y + dy + T) % T) * T) + ((x + dx + T) % T)] = Math.max(grains[(((y + dy + T) % T) * T) + ((x + dx + T) % T)], v)
    }
    const carte = peindre(T, h, (v, x, y) => {
      const gr = grains[y * T + x]
      const base = 58 + v * 26 + gr * 34
      return [base, base, base * 1.02 + 2]
    })
    const relief = new Float32Array(T * T)
    for (let i = 0; i < relief.length; i++) relief[i] = h[i] * 0.4 + grains[i] * 0.6
    return { map: versTexture(carte), normalMap: normalesDepuisHauteur(relief, T, 2.2) }
  })
}

/** Herbe tondue (tuile de 12 m) : brins + bandes de tonte alternées. */
export function textureHerbeTondue() {
  return memo('herbeTondue', () => {
    const rng = creerRng(21), T = 512
    const h = fbm(T, rng, [[4, 0.3], [16, 0.3], [64, 0.2], [256, 0.2]])
    const cv = peindre(T, h, (v, x, y) => {
      const bande = ((y / T) * 2) | 0 // deux bandes de 6 m le long de la piste
      const clair = bande === 0 ? 1.1 : 0.9
      return [(46 + v * 34) * clair, (92 + v * 52) * clair, (34 + v * 22) * clair]
    })
    return versTexture(cv)
  })
}

/** Herbe naturelle du terrain (tuile de 16 m), sans bandes. */
export function textureHerbeTerrain() {
  return memo('herbeTerrain', () => {
    const rng = creerRng(22), T = 512
    const h = fbm(T, rng, [[4, 0.35], [16, 0.3], [64, 0.2], [256, 0.15]])
    const cv = peindre(T, h, (v) => [70 + v * 70, 92 + v * 66, 48 + v * 34])
    return versTexture(cv)
  })
}

/** Gravier (tuile de 4 m) : cailloux beige-gris. */
export function texturesGravier() {
  return memo('gravier', () => {
    const rng = creerRng(31), T = 512
    const h = new Float32Array(T * T)
    const cv = canvas(T, T), ctx = cv.getContext('2d')
    ctx.fillStyle = '#9c8f7c'; ctx.fillRect(0, 0, T, T)
    for (let i = 0; i < 9000; i++) {
      const x = rng() * T, y = rng() * T, r = 1.2 + rng() * 3.2, t = 140 + rng() * 80
      ctx.fillStyle = `rgb(${t},${t * 0.93},${t * 0.82})`
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + rng() * 0.4), rng() * 3, 0, 6.3); ctx.fill()
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const px = (((x + dx) | 0) + T) % T, py = (((y + dy) | 0) + T) % T
        if (dx * dx + dy * dy <= r * r) h[py * T + px] = Math.max(h[py * T + px], 1 - (dx * dx + dy * dy) / (r * r))
      }
    }
    return { map: versTexture(cv), normalMap: normalesDepuisHauteur(h, T, 3) }
  })
}

/** Dégagement asphalté (tuile de 6 m) : plus clair, poussiéreux. */
export function textureDegagement() {
  return memo('degagement', () => {
    const rng = creerRng(41), T = 256
    const h = fbm(T, rng, [[8, 0.4], [32, 0.3], [128, 0.3]])
    return versTexture(peindre(T, h, (v) => { const b = 82 + v * 30; return [b, b * 1.02, b * 1.06] }))
  })
}

/** Sable de dune (tuile de 10 m). */
export function textureSable() {
  return memo('sable', () => {
    const rng = creerRng(51), T = 256
    const h = fbm(T, rng)
    return versTexture(peindre(T, h, (v) => [180 + v * 50, 160 + v * 45, 120 + v * 35]))
  })
}

/** Vibreur : blocs rouges et blancs de 1 m (u = travers, v = longueur 2 m). */
export function textureVibreur() {
  return memo('vibreur', () => {
    const cv = canvas(64, 128), ctx = cv.getContext('2d')
    ctx.fillStyle = '#efefef'; ctx.fillRect(0, 0, 64, 128)
    ctx.fillStyle = '#d4192c'; ctx.fillRect(0, 0, 64, 64)
    // Usure : traces de gomme.
    const rng = creerRng(61)
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(20,20,20,${rng() * 0.12})`; ctx.fillRect(rng() * 64, rng() * 128, 2 + rng() * 6, 1 + rng() * 3) }
    return versTexture(cv)
  })
}

/** Damier de la ligne d'arrivée. */
export function textureDamier() {
  return memo('damier', () => {
    const cv = canvas(256, 64), ctx = cv.getContext('2d')
    const c = 16
    for (let i = 0; i < 256 / c; i++) for (let j = 0; j < 4; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#f1f1f1' : '#141416'
      ctx.fillRect(i * c, j * c, c, c)
    }
    return versTexture(cv, { repeter: false })
  })
}

/** Béton (murs, muret des stands). */
export function textureBeton() {
  return memo('beton', () => {
    const rng = creerRng(71), T = 256
    const h = fbm(T, rng, [[8, 0.4], [32, 0.3], [128, 0.3]])
    return versTexture(peindre(T, h, (v) => { const b = 150 + v * 50; return [b, b, b * 0.98] }))
  })
}

/** Bande rouge et blanche peinte sur le haut des murs (u = longueur 4 m). */
export function textureBandeMur() {
  return memo('bandeMur', () => {
    const cv = canvas(128, 16), ctx = cv.getContext('2d')
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, 128, 16)
    ctx.fillStyle = '#c8202f'; ctx.fillRect(0, 0, 64, 16)
    return versTexture(cv)
  })
}

/** Grillage de sécurité (alpha) : maille losange de 5 cm, tuile de 1 m. */
export function textureGrillage() {
  return memo('grillage', () => {
    const cv = canvas(128, 128), ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, 128, 128)
    ctx.strokeStyle = 'rgba(200,205,210,1)'; ctx.lineWidth = 1.6
    for (let i = -128; i < 256; i += 16) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 128, 128); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(i + 128, 0); ctx.lineTo(i, 128); ctx.stroke()
    }
    ctx.fillStyle = 'rgba(200,205,210,1)'; ctx.fillRect(0, 0, 128, 3)
    return versTexture(cv)
  })
}

/** Foule colorée pour les gradins (tuile de 10 places × 4 rangs). */
export function textureFoule() {
  return memo('foule', () => {
    const rng = creerRng(81), cv = canvas(256, 128), ctx = cv.getContext('2d')
    ctx.fillStyle = '#2c2f36'; ctx.fillRect(0, 0, 256, 128)
    const teintes = ['#d93838', '#f1f1f1', '#2457c5', '#f2c230', '#1d1d1f', '#3aa357', '#e8743b', '#9b9ea6']
    for (let r = 0; r < 4; r++) for (let p = 0; p < 10; p++) {
      if (rng() < 0.12) continue // places vides
      const x = p * 25.6 + 4 + rng() * 6, y = r * 32 + 6
      ctx.fillStyle = teintes[(rng() * teintes.length) | 0]
      ctx.fillRect(x, y + 9, 15, 17) // buste
      ctx.fillStyle = ['#e0b089', '#b67b52', '#7a4d2e', '#f0c9a4'][(rng() * 4) | 0]
      ctx.beginPath(); ctx.arc(x + 7.5, y + 5, 5, 0, 6.3); ctx.fill() // tête
    }
    return versTexture(cv)
  })
}

/** Façade des stands : portes de garage numérotées, bandeau vitré. */
export function textureStands() {
  return memo('stands', () => {
    const cv = canvas(512, 128), ctx = cv.getContext('2d')
    ctx.fillStyle = '#d9dce2'; ctx.fillRect(0, 0, 512, 128)
    ctx.fillStyle = '#1b2533'; ctx.fillRect(0, 0, 512, 34) // bandeau vitré
    for (let i = 0; i < 4; i++) {
      const x = i * 128 + 12
      ctx.fillStyle = '#3b4250'; ctx.fillRect(x, 50, 104, 78)
      ctx.fillStyle = '#4a5262'
      for (let k = 0; k < 8; k++) ctx.fillRect(x, 52 + k * 9.5, 104, 2)
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(String(i + 1), x + 46, 46)
    }
    return versTexture(cv)
  })
}

/** Fenêtres d'immeubles (couleur + carte d'émission pour la nuit). */
export function texturesFacade() {
  return memo('facade', () => {
    const rng = creerRng(91)
    const coul = canvas(256, 256), em = canvas(256, 256)
    const c = coul.getContext('2d'), e = em.getContext('2d')
    c.fillStyle = '#c9c2b4'; c.fillRect(0, 0, 256, 256)
    e.fillStyle = '#000'; e.fillRect(0, 0, 256, 256)
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const px = x * 32 + 6, py = y * 32 + 7
      c.fillStyle = '#3a4656'; c.fillRect(px, py, 20, 18)
      c.fillStyle = '#9aa6b2'; c.fillRect(px, py + 18, 20, 2)
      if (rng() < 0.45) { e.fillStyle = ['#ffd9a0', '#ffe8c2', '#cfe2ff'][(rng() * 3) | 0]; e.fillRect(px, py, 20, 18) }
    }
    return { map: versTexture(coul), emissiveMap: versTexture(em) }
  })
}

/** Panneaux publicitaires (marques fictives). */
export function texturePublicite(indice) {
  const marques = [
    ['APEX OIL', '#0f2d6b', '#ffd23f'], ['NOVA TYRES', '#111111', '#f2f2f2'], ['VELOCE', '#b3121f', '#ffffff'],
    ['KAIROS WATCHES', '#f2f2f2', '#14213d'], ['MERIDIAN FUEL', '#0b6e4f', '#ffffff'], ['ORBIT TELECOM', '#5b2a86', '#f2f2f2']
  ]
  const [texte, fond, encre] = marques[indice % marques.length]
  return memo('pub' + (indice % marques.length), () => {
    const cv = canvas(512, 64), ctx = cv.getContext('2d')
    ctx.fillStyle = fond; ctx.fillRect(0, 0, 512, 64)
    ctx.fillStyle = encre; ctx.font = 'bold 40px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(texte, 256, 34)
    return versTexture(cv)
  })
}

/** Panneau du portique de départ (nom du circuit). */
export function texturePortique(nom) {
  const cv = canvas(1024, 128), ctx = cv.getContext('2d')
  ctx.fillStyle = '#121418'; ctx.fillRect(0, 0, 1024, 128)
  ctx.fillStyle = '#ffffff'; ctx.font = '700 64px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(nom.toUpperCase().slice(0, 26), 512, 66)
  return versTexture(cv, { repeter: false })
}

/** Dégradé radial (ombre de contact, flaques de lumière). */
export function textureRadiale() {
  return memo('radiale', () => {
    const cv = canvas(128, 128), ctx = cv.getContext('2d')
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128)
    return versTexture(cv, { srgb: false, repeter: false })
  })
}
