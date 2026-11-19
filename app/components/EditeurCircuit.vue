<script setup>
// =============================================================================
// ÉDITEUR DE CIRCUIT
// Vue de dessus (canvas 2D) : on place des points de passage, la piste est
// reconstruite en direct par le même moteur que le jeu (spline, largeur,
// vibreurs) et validée (virages trop serrés, portions qui se touchent).
//   - glisser un point : le déplacer ; glisser le fond : se déplacer ;
//   - clic sur la piste ou à côté : insérer un point dans le segment le plus proche ;
//   - double-clic / clic droit sur un point : le supprimer ; molette : zoom.
// =============================================================================
import { evaluerTrace, simplifier, PAYSAGES, LARGEURS } from '~/game/core/trace-perso.js'
import { CIRCUITS_CELEBRES, pointsCircuitReel } from '~/game/core/circuits-reels.js'
import { creerRng } from '~/game/core/rng.js'

const props = defineProps({ initial: { type: Object, default: null } })
const emit = defineEmits(['fermer', 'rouler', 'enregistrer', 'partager'])

/** Circuit de départ : ovale irrégulier de ~2,5 km. */
function traceAleatoire(graine = Math.floor(Math.random() * 1e6)) {
  const rng = creerRng(graine), nb = 9 + Math.floor(rng() * 5), points = []
  for (let i = 0; i < nb; i++) {
    const a = ((i + (rng() - 0.5) * 0.5) / nb) * Math.PI * 2
    const r = 380 * (0.72 + rng() * 0.5)
    points.push([Math.round(Math.cos(a) * r * 1.3), Math.round(Math.sin(a) * r)])
  }
  return points
}

const def = reactive(props.initial
  ? JSON.parse(JSON.stringify(props.initial))
  : { nom: 'Mon circuit', points: traceAleatoire(), demiLargeur: 6.5, relief: 8, paysage: 'foret' })
const evaluation = shallowRef({ circuit: null, problemes: [] })
const canvas = ref(null)
const conteneur = ref(null)
const modele = ref(null)
const vue = reactive({ cx: 0, cz: 0, zoom: 0.5 })
let largeur = 800, hauteur = 600, dpr = 1
let glisse = null // { type: 'point', index } | { type: 'vue', x, y, cx, cz }
let evalEnAttente = null

const longueur = computed(() => evaluation.value.circuit ? evaluation.value.circuit.longueur : 0)
const valide = computed(() => evaluation.value.circuit && evaluation.value.problemes.length === 0)
const choixLargeurs = LARGEURS.map((d) => ({ label: `${d * 2} m`, value: d }))
const choixPaysages = PAYSAGES.map((p) => ({ label: { plaine: 'Plaine', foret: 'Forêt', dunes: 'Dunes', montagne: 'Montagne', ville: 'Ville' }[p], value: p }))
const choixModeles = CIRCUITS_CELEBRES.map((c) => ({ label: c.nom, value: c.id }))

// --- Évaluation (moteur du jeu), différée pour rester fluide pendant le glisser ---
function evaluer() {
  evaluation.value = evaluerTrace(def)
  dessiner()
}
function evaluerBientot(delai = 120) {
  clearTimeout(evalEnAttente)
  evalEnAttente = setTimeout(evaluer, delai)
}
watch(() => [def.demiLargeur, def.relief], () => evaluerBientot(0))

// --- Repère écran ↔ monde ------------------------------------------------------
const versEcran = (x, z) => [(x - vue.cx) * vue.zoom + largeur / 2, (z - vue.cz) * vue.zoom + hauteur / 2]
const versMonde = (sx, sy) => [(sx - largeur / 2) / vue.zoom + vue.cx, (sy - hauteur / 2) / vue.zoom + vue.cz]

function cadrer() {
  const pts = def.points
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) }
  vue.cx = (minX + maxX) / 2; vue.cz = (minZ + maxZ) / 2
  vue.zoom = Math.min((largeur - 120) / Math.max(200, maxX - minX), (hauteur - 120) / Math.max(200, maxZ - minZ))
}

// --- Dessin ------------------------------------------------------------------------
function dessiner() {
  const cv = canvas.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#10131a'; ctx.fillRect(0, 0, largeur, hauteur)
  // Quadrillage de 100 m.
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1
  const [x0, z0] = versMonde(0, 0), [x1, z1] = versMonde(largeur, hauteur)
  for (let x = Math.floor(x0 / 100) * 100; x <= x1; x += 100) { const [sx] = versEcran(x, 0); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, hauteur); ctx.stroke() }
  for (let z = Math.floor(z0 / 100) * 100; z <= z1; z += 100) { const [, sy] = versEcran(0, z); ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(largeur, sy); ctx.stroke() }
  // Échelle.
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '12px sans-serif'
  const l100 = 100 * vue.zoom
  ctx.fillRect(16, hauteur - 22, l100, 3); ctx.fillText('100 m', 16, hauteur - 28)

  const c = evaluation.value.circuit
  if (c) {
    const trace = (dec, couleur, epaisseur) => {
      ctx.beginPath()
      for (let i = 0; i <= c.n; i++) {
        const k = i % c.n
        const [sx, sy] = versEcran(c.px[k] + c.nx[k] * dec, c.pz[k] + c.nz[k] * dec)
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy)
      }
      ctx.strokeStyle = couleur; ctx.lineWidth = epaisseur; ctx.stroke()
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    // Dégagements, piste, vibreurs.
    trace(0, 'rgba(70,110,60,0.35)', Math.max(2, (c.demiLargeur + 9) * 2 * vue.zoom))
    trace(0, '#3b3f47', Math.max(2, c.demiLargeur * 2 * vue.zoom))
    for (const [s, masque] of [[1, c.vibG], [-1, c.vibD]]) {
      ctx.lineWidth = Math.max(1.5, 1.2 * vue.zoom)
      for (let i = 0; i < c.n; i += 1) {
        if (!masque[i]) continue
        const j = (i + 1) % c.n, d = s * (c.demiLargeur + 0.3)
        const [ax, ay] = versEcran(c.px[i] + c.nx[i] * d, c.pz[i] + c.nz[i] * d)
        const [bx, by] = versEcran(c.px[j] + c.nx[j] * d, c.pz[j] + c.nz[j] * d)
        ctx.strokeStyle = (i >> 1) % 2 ? '#e8e8e8' : '#d4192c'
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      }
    }
    // Ligne de départ + flèche de sens.
    const d = c.demiLargeur
    const [la, lb] = [versEcran(c.px[0] + c.nx[0] * d, c.pz[0] + c.nz[0] * d), versEcran(c.px[0] - c.nx[0] * d, c.pz[0] - c.nz[0] * d)]
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(...la); ctx.lineTo(...lb); ctx.stroke()
    const k = Math.min(c.n - 1, Math.round(60 / c.pas))
    const [fx, fy] = versEcran(c.px[k], c.pz[k]), [gx, gy] = versEcran(c.px[k + 4 < c.n ? k + 4 : 0], c.pz[k + 4 < c.n ? k + 4 : 0])
    const ang = Math.atan2(gy - fy, gx - fx)
    ctx.fillStyle = '#18d6ff'; ctx.beginPath()
    ctx.moveTo(fx + Math.cos(ang) * 12, fy + Math.sin(ang) * 12)
    ctx.lineTo(fx + Math.cos(ang + 2.5) * 9, fy + Math.sin(ang + 2.5) * 9)
    ctx.lineTo(fx + Math.cos(ang - 2.5) * 9, fy + Math.sin(ang - 2.5) * 9)
    ctx.fill()
    // Problèmes.
    for (const p of evaluation.value.problemes) {
      if (p.x === undefined) continue
      const [sx, sy] = versEcran(p.x, p.z)
      ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(sx, sy, 16, 0, Math.PI * 2); ctx.stroke()
    }
  }
  // Polygone de contrôle et points.
  ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(24,214,255,0.35)'; ctx.lineWidth = 1
  ctx.beginPath()
  def.points.forEach(([x, z], i) => { const [sx, sy] = versEcran(x, z); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy) })
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([])
  def.points.forEach(([x, z], i) => {
    const [sx, sy] = versEcran(x, z)
    ctx.beginPath(); ctx.arc(sx, sy, i === 0 ? 8 : 6.5, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? '#ffffff' : '#18d6ff'; ctx.fill()
    ctx.strokeStyle = '#0b0d12'; ctx.lineWidth = 2; ctx.stroke()
  })
}

// --- Interaction -----------------------------------------------------------------------
function pointSous(sx, sy) {
  let meilleur = -1, d2min = 14 * 14
  def.points.forEach(([x, z], i) => {
    const [px, py] = versEcran(x, z)
    const d2 = (px - sx) ** 2 + (py - sy) ** 2
    if (d2 < d2min) { d2min = d2; meilleur = i }
  })
  return meilleur
}
/** Insère un point dans le segment du polygone de contrôle le plus proche. */
function inserer(x, z) {
  const P = def.points
  let meilleur = 0, dmin = Infinity
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length]
    const lx = bx - ax, lz = bz - az, l2 = lx * lx + lz * lz || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * lx + (z - az) * lz) / l2))
    const d = Math.hypot(x - (ax + lx * t), z - (az + lz * t))
    if (d < dmin) { dmin = d; meilleur = i }
  }
  P.splice(meilleur + 1, 0, [Math.round(x), Math.round(z)])
}
function position(e) {
  const r = canvas.value.getBoundingClientRect()
  return [e.clientX - r.left, e.clientY - r.top]
}
function surAppui(e) {
  const [sx, sy] = position(e)
  const i = pointSous(sx, sy)
  canvas.value.setPointerCapture(e.pointerId)
  if (e.button === 2) { if (i >= 0) supprimer(i); return }
  glisse = i >= 0 ? { type: 'point', index: i, bouge: false } : { type: 'vue', x: sx, y: sy, cx: vue.cx, cz: vue.cz, bouge: false }
}
function surMouvement(e) {
  if (!glisse) return
  const [sx, sy] = position(e)
  if (glisse.type === 'point') {
    const [x, z] = versMonde(sx, sy)
    def.points[glisse.index] = [Math.round(x), Math.round(z)]
    glisse.bouge = true
    dessiner(); evaluerBientot(90)
  } else {
    if (Math.hypot(sx - glisse.x, sy - glisse.y) > 4) glisse.bouge = true
    vue.cx = glisse.cx - (sx - glisse.x) / vue.zoom
    vue.cz = glisse.cz - (sy - glisse.y) / vue.zoom
    dessiner()
  }
}
function surRelache(e) {
  if (glisse && glisse.type === 'vue' && !glisse.bouge) {
    const [x, z] = versMonde(...position(e))
    inserer(x, z)
    evaluer()
  } else if (glisse && glisse.type === 'point') evaluer()
  glisse = null
}
function surDoubleClic(e) {
  const i = pointSous(...position(e))
  if (i >= 0) supprimer(i)
}
function supprimer(i) {
  if (def.points.length <= 4) return
  def.points.splice(i, 1)
  evaluer()
}
function surMolette(e) {
  e.preventDefault()
  const [sx, sy] = position(e)
  const [x, z] = versMonde(sx, sy)
  vue.zoom = Math.max(0.03, Math.min(6, vue.zoom * Math.exp(-e.deltaY * 0.0015)))
  // Zoom centré sur le pointeur.
  vue.cx = x - (sx - largeur / 2) / vue.zoom
  vue.cz = z - (sy - hauteur / 2) / vue.zoom
  dessiner()
}

// --- Outils --------------------------------------------------------------------------------
function aleatoire() { def.points = traceAleatoire(); cadrer(); evaluer() }
function inverser() { def.points.reverse(); evaluer() }
function lisser() {
  const P = def.points, n = P.length
  def.points = P.map((p, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n]
    return [Math.round(p[0] * 0.5 + (a[0] + b[0]) * 0.25), Math.round(p[1] * 0.5 + (a[1] + b[1]) * 0.25)]
  })
  evaluer()
}
watch(modele, (id) => {
  if (!id) return
  def.points = simplifier(pointsCircuitReel(id), 6).map(([x, z]) => [Math.round(x), Math.round(z)])
  def.nom = `Mon ${CIRCUITS_CELEBRES.find((c) => c.id === id).nom}`
  cadrer(); evaluer()
  modele.value = null
})

// --- Cycle de vie ----------------------------------------------------------------------------
function redimensionner() {
  const r = conteneur.value.getBoundingClientRect()
  dpr = Math.min(window.devicePixelRatio || 1, 2)
  largeur = r.width; hauteur = r.height
  canvas.value.width = largeur * dpr; canvas.value.height = hauteur * dpr
  canvas.value.style.width = largeur + 'px'; canvas.value.style.height = hauteur + 'px'
  dessiner()
}
let observateur = null
onMounted(() => {
  observateur = new ResizeObserver(redimensionner)
  observateur.observe(conteneur.value)
  redimensionner(); cadrer(); evaluer()
})
onBeforeUnmount(() => { observateur?.disconnect(); clearTimeout(evalEnAttente) })
const copie = () => JSON.parse(JSON.stringify(def))
</script>

<template>
  <div class="absolute inset-0 z-20 flex flex-col bg-[#0b0d12] text-white sm:flex-row">
    <div ref="conteneur" class="relative min-h-[50vh] flex-1">
      <canvas ref="canvas" class="absolute inset-0 touch-none" @pointerdown="surAppui" @pointermove="surMouvement" @pointerup="surRelache"
        @dblclick="surDoubleClic" @wheel="surMolette" @contextmenu.prevent />
      <div class="pointer-events-none absolute left-4 top-4 rounded-lg bg-black/50 px-3 py-2 text-xs text-slate-300">
        Glisser : déplacer un point ou la vue · Clic : ajouter un point · Double-clic : supprimer · Molette : zoom
      </div>
    </div>

    <aside class="flex w-full flex-col gap-4 overflow-y-auto border-white/10 bg-[#11141b] p-4 sm:w-80 sm:border-l">
      <div class="flex items-center justify-between">
        <h2 class="font-display text-xl font-bold">Éditeur de circuit</h2>
        <UButton icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Fermer l'éditeur" @click="emit('fermer')" />
      </div>
      <UFormField label="Nom">
        <UInput v-model="def.nom" maxlength="40" class="w-full" />
      </UFormField>
      <div class="grid grid-cols-2 gap-3">
        <UFormField label="Largeur">
          <USelect v-model="def.demiLargeur" :items="choixLargeurs" class="w-full" />
        </UFormField>
        <UFormField label="Paysage">
          <USelect v-model="def.paysage" :items="choixPaysages" class="w-full" />
        </UFormField>
      </div>
      <UFormField :label="`Relief : ${def.relief} m`">
        <USlider v-model="def.relief" :min="0" :max="40" :step="1" />
      </UFormField>
      <UFormField label="Partir d'un circuit célèbre">
        <USelect v-model="modele" :items="choixModeles" placeholder="Choisir…" class="w-full" />
      </UFormField>
      <div class="grid grid-cols-3 gap-2">
        <UButton icon="i-lucide-dices" label="Hasard" size="sm" color="neutral" variant="subtle" @click="aleatoire" />
        <UButton icon="i-lucide-waves" label="Lisser" size="sm" color="neutral" variant="subtle" @click="lisser" />
        <UButton icon="i-lucide-repeat" label="Sens" size="sm" color="neutral" variant="subtle" @click="inverser" />
      </div>

      <div class="rounded-xl bg-white/[0.04] p-3 text-sm">
        <div class="flex justify-between"><span class="text-slate-400">Longueur</span><span class="chiffres">{{ (longueur / 1000).toFixed(2) }} km</span></div>
        <div class="flex justify-between"><span class="text-slate-400">Points</span><span class="chiffres">{{ def.points.length }}</span></div>
        <div class="mt-2">
          <div v-if="valide" class="flex items-center gap-2 text-emerald-300"><UIcon name="i-lucide-circle-check" /> Tracé valide</div>
          <ul v-else class="space-y-1 text-rose-300">
            <li v-for="(p, i) in evaluation.problemes.slice(0, 6)" :key="i" class="flex gap-2"><UIcon name="i-lucide-triangle-alert" class="mt-0.5 shrink-0" />{{ p.message }}</li>
          </ul>
        </div>
      </div>

      <div class="mt-auto grid gap-2">
        <UButton icon="i-lucide-flag" label="Rouler sur ce circuit" size="lg" block :disabled="!valide" @click="emit('rouler', copie())" />
        <div class="grid grid-cols-2 gap-2">
          <UButton icon="i-lucide-save" label="Enregistrer" color="neutral" variant="subtle" block :disabled="!valide" @click="emit('enregistrer', copie())" />
          <UButton icon="i-lucide-share-2" label="Partager" color="neutral" variant="subtle" block :disabled="!valide" @click="emit('partager', copie())" />
        </div>
      </div>
    </aside>
  </div>
</template>
