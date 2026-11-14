// =============================================================================
// MODULE : Mini-carte 2D
// -----------------------------------------------------------------------------
// Le tracé est dessiné une fois dans un canvas hors écran ; à chaque image on
// le recopie puis on ajoute les pastilles des véhicules (et du fantôme).
// =============================================================================
export function creerMinimap(canvas, c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const taille = 208
  canvas.width = canvas.height = taille * dpr
  const ctx = canvas.getContext('2d')
  const fond = document.createElement('canvas')
  fond.width = fond.height = taille * dpr
  const fx = fond.getContext('2d')

  // Transformation monde (x, z) → pixels, avec marge. Nord (−Z) en haut.
  const { minX, maxX, minZ, maxZ } = c.bornes
  const marge = 18 * dpr
  const echelle = (taille * dpr - marge * 2) / Math.max(maxX - minX, maxZ - minZ)
  const ox = (taille * dpr - (maxX - minX) * echelle) / 2 - minX * echelle
  const oz = (taille * dpr - (maxZ - minZ) * echelle) / 2 - minZ * echelle
  const X = (x) => x * echelle + ox, Z = (z) => z * echelle + oz

  // --- Tracé statique ---
  fx.lineJoin = 'round'
  const tracer = () => {
    fx.beginPath()
    for (let i = 0; i < c.n; i += 2) {
      if (i === 0) fx.moveTo(X(c.px[i]), Z(c.pz[i])); else fx.lineTo(X(c.px[i]), Z(c.pz[i]))
    }
    fx.closePath(); fx.stroke()
  }
  fx.shadowColor = '#18d6ff'; fx.shadowBlur = 10 * dpr
  fx.strokeStyle = 'rgba(24,214,255,0.55)'; fx.lineWidth = 7 * dpr; tracer()
  fx.shadowBlur = 0
  fx.strokeStyle = '#0b0a16'; fx.lineWidth = 4.6 * dpr; tracer()
  fx.strokeStyle = 'rgba(255,255,255,0.22)'; fx.lineWidth = 0.8 * dpr; tracer()
  // Ligne de départ : petit trait perpendiculaire (le long de N).
  fx.strokeStyle = '#ffffff'; fx.lineWidth = 2 * dpr
  fx.beginPath()
  fx.moveTo(X(c.px[0] + c.nx[0] * 16), Z(c.pz[0] + c.nz[0] * 16))
  fx.lineTo(X(c.px[0] - c.nx[0] * 16), Z(c.pz[0] - c.nz[0] * 16))
  fx.stroke()

  const couleursCss = []
  return {
    /** Redessine la carte. `couleurs` : tableau de chaînes CSS pré-calculées. */
    dessiner(vehicules, fantome) {
      if (couleursCss.length === 0) {
        for (const v of vehicules) couleursCss.push('#' + v.couleur.toString(16).padStart(6, '0'))
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(fond, 0, 0)
      if (fantome.visible) {
        ctx.fillStyle = 'rgba(111,243,255,0.45)'
        ctx.beginPath(); ctx.arc(X(fantome.x), Z(fantome.z), 3.4 * dpr, 0, 6.2832); ctx.fill()
      }
      // IA d'abord, joueur en dernier (au-dessus), avec un contour blanc.
      for (let k = vehicules.length - 1; k >= 0; k--) {
        const v = vehicules[k]
        ctx.fillStyle = couleursCss[k]
        ctx.beginPath(); ctx.arc(X(v.x), Z(v.z), (k === 0 ? 4.6 : 3.4) * dpr, 0, 6.2832); ctx.fill()
        if (k === 0) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 * dpr; ctx.stroke() }
      }
    }
  }
}
