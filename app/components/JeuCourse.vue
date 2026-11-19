<script setup>
// =============================================================================
// COMPOSANT RACINE DU JEU
// Monte le moteur (Three.js + simulation) sur le canvas et superpose
// l'interface Nuxt UI correspondant à l'état courant de la machine à états.
// URL partageable : ?circuit=spa | ?seed=1234 | ?trace=<tracé encodé>,
// plus ?voiture=f1 et ?ambiance=nuit.
// =============================================================================
import { Moteur, creerEtatHud } from '~/game/moteur.js'
import { seedAleatoire } from '~/game/core/rng.js'
import { CIRCUITS_CELEBRES, pointsCircuitReel } from '~/game/core/circuits-reels.js'
import { encoderTrace, decoderTrace, evaluerTrace } from '~/game/core/trace-perso.js'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const canvas = ref(null)
const canvasCarte = ref(null)
const hud = reactive(creerEtatHud())
const options = reactive({
  tours: 3, difficulte: 'normal', musique: true, modele: 'hypercar', plateau: 'monotype',
  aides: 'completes', boiteAuto: true, ambiance: 'jour'
})
const reference = ref({ type: 'reel', id: 'spa' })
const circuits = CIRCUITS_CELEBRES.map((c) => ({ ...c, points: pointsCircuitReel(c.id) }))
const mesCircuits = ref([])
const editeur = reactive({ ouvert: false, initial: null, index: -1 })
const erreur = ref('')
let moteur = null

// Mise à l'échelle du HUD sur les petits écrans (propriété CSS `zoom`).
const echelle = ref(1)
const calculerEchelle = () => { echelle.value = Math.max(0.45, Math.min(1, window.innerWidth / 1180, window.innerHeight / 660)) }
const enCourse = computed(() => ['course', 'decompte', 'pause'].includes(hud.etat))

// --- Circuits personnels (navigateur) -------------------------------------------
const CLE_STOCKAGE = 'neon-apex:circuits'
function lireMesCircuits() {
  try { mesCircuits.value = JSON.parse(localStorage.getItem(CLE_STOCKAGE) || '[]') } catch { mesCircuits.value = [] }
}
function ecrireMesCircuits() {
  try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify(mesCircuits.value)) } catch { /* stockage indisponible */ }
}

// --- Chargement d'un circuit ------------------------------------------------------
/** Paramètres d'URL correspondant à une référence de circuit. */
function requetePour(ref) {
  const q = { ...route.query }
  delete q.circuit; delete q.seed; delete q.trace
  if (ref.type === 'reel') q.circuit = ref.id
  else if (ref.type === 'seed') q.seed = String(ref.seed)
  else q.trace = encoderTrace(ref.definition)
  return q
}
/**
 * Construit le circuit (quelques centaines de ms pour un grand circuit réel) :
 * on laisse d'abord l'interface afficher l'indicateur de chargement.
 */
function choisirCircuit(ref) {
  if (ref.type === 'perso' && !ref.definition) ref = { ...ref, definition: mesCircuits.value[ref.index] }
  hud.chargement = true
  requestAnimationFrame(() => setTimeout(() => {
    try {
      moteur.retourMenu()
      moteur.chargerCircuit(ref)
      reference.value = ref
      router.replace({ query: requetePour(ref) })
    } catch (e) {
      console.error(e)
      toast.add({ title: 'Circuit inutilisable', description: e.message, color: 'error', icon: 'i-lucide-triangle-alert' })
    } finally {
      hud.chargement = false
    }
  }, 30))
}

function demarrer() {
  moteur.audio.definirMusique(options.musique)
  moteur.lancer({ ...options })
}
async function copierLien() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.add({ title: 'Lien copié', description: `${hud.circuit.nom} : le circuit sera identique chez vos amis.`, icon: 'i-lucide-link', color: 'primary' })
  } catch {
    toast.add({ title: 'Copie impossible', description: window.location.href, color: 'warning' })
  }
}

// --- Éditeur ---------------------------------------------------------------------------
function ouvrirEditeur(index) {
  editeur.index = index ?? -1
  editeur.initial = index !== null && index !== undefined ? mesCircuits.value[index] : (reference.value.type === 'perso' ? reference.value.definition : null)
  editeur.ouvert = true
}
function enregistrerTrace(def) {
  if (editeur.index >= 0) mesCircuits.value[editeur.index] = def
  else { mesCircuits.value.unshift(def); editeur.index = 0 }
  ecrireMesCircuits()
  toast.add({ title: 'Circuit enregistré', description: def.nom, icon: 'i-lucide-save', color: 'primary' })
  return editeur.index
}
function roulerTrace(def) {
  const index = enregistrerTrace(def)
  editeur.ouvert = false
  choisirCircuit({ type: 'perso', index, definition: def })
}
async function partagerTrace(def) {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('trace', encoderTrace(def))
  try {
    await navigator.clipboard.writeText(url.toString())
    toast.add({ title: 'Lien du circuit copié', description: 'Il contient tout le tracé : aucun compte nécessaire.', icon: 'i-lucide-share-2', color: 'primary' })
  } catch {
    toast.add({ title: 'Lien', description: url.toString(), color: 'warning' })
  }
}
function supprimerTrace(index) {
  mesCircuits.value.splice(index, 1)
  ecrireMesCircuits()
}

watch(() => options.musique, (v) => moteur && moteur.audio.definirMusique(v))
watch(() => options.modele, (v) => moteur && moteur.definirModeleJoueur(v))
watch(() => options.ambiance, (v) => {
  if (!moteur) return
  moteur.appliquerAmbiance(v)
  router.replace({ query: { ...route.query, ambiance: v === 'jour' ? undefined : v } })
})

/** Référence de circuit décrite par l'URL (ou le circuit par défaut). */
function referenceDepuisUrl() {
  const q = route.query
  if (q.trace) {
    try {
      const definition = decoderTrace(q.trace)
      if (evaluerTrace(definition).circuit) return { type: 'perso', index: -1, definition }
    } catch { toast.add({ title: 'Lien de circuit invalide', color: 'warning' }) }
  }
  if (q.seed) return { type: 'seed', seed: String(q.seed).slice(0, 24) }
  if (q.circuit && circuits.some((c) => c.id === q.circuit)) return { type: 'reel', id: q.circuit }
  return { type: 'reel', id: 'spa' }
}

onMounted(() => {
  calculerEchelle()
  window.addEventListener('resize', calculerEchelle)
  lireMesCircuits()
  try {
    moteur = new Moteur({ canvas: canvas.value, canvasCarte: canvasCarte.value, hud })
    if (['f1', 'hypercar', 'sportive'].includes(route.query.voiture)) options.modele = route.query.voiture
    if (['jour', 'crepuscule', 'nuit'].includes(route.query.ambiance)) options.ambiance = route.query.ambiance
    Object.assign(moteur.options, options)
    hud.autopilote = route.query.autopilot === '1'
    const ref = referenceDepuisUrl()
    moteur.chargerCircuit(ref)
    reference.value = ref
    window.__neonApex = moteur // accès console / tests automatisés
  } catch (e) {
    console.error(e)
    erreur.value = 'WebGL 2 est indisponible sur cet appareil : impossible de lancer le rendu 3D.'
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', calculerEchelle)
  if (moteur) moteur.liberer()
})
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#07070b] text-white select-none">
    <canvas ref="canvas" class="absolute inset-0 block size-full" />

    <!-- HUD de course -->
    <Transition name="fondu">
      <HudCourse v-show="enCourse" :hud="hud" :style="{ zoom: echelle }" />
    </Transition>

    <!-- Mini-carte (canvas 2D piloté par le moteur) -->
    <div
      v-show="hud.pret && hud.etat !== 'fin' && !editeur.ouvert"
      class="panneau absolute bottom-4 left-4 p-1 transition-opacity duration-300"
      :class="hud.etat === 'menu' ? 'pointer-events-none opacity-0 xl:opacity-100' : ''"
      :style="{ zoom: echelle }"
    >
      <canvas ref="canvasCarte" class="block size-[208px]" />
      <div class="absolute left-3 top-2 max-w-[180px] truncate text-[11px] uppercase tracking-[0.2em] text-cyan-200/70">
        {{ hud.circuit.nom }} · {{ (hud.circuit.longueur / 1000).toFixed(2) }} km
      </div>
    </div>

    <!-- Compte à rebours -->
    <div v-if="hud.decompte >= 0 && hud.etat !== 'pause'" class="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center">
      <Transition name="compte" mode="out-in">
        <div
          :key="hud.decompte"
          class="chiffres text-[7rem] font-black leading-none sm:text-[10rem]"
          :class="hud.depart ? 'text-emerald-300' : 'text-white'"
          :style="{ textShadow: hud.depart ? '0 0 50px rgba(52,211,153,.8)' : '0 6px 40px rgba(0,0,0,.6)' }"
        >
          {{ hud.depart ? 'GO' : hud.decompte }}
        </div>
      </Transition>
    </div>

    <Transition name="fondu">
      <MenuPrincipal
        v-if="hud.pret && hud.etat === 'menu' && !editeur.ouvert"
        v-model:options="options"
        v-model:autopilote="hud.autopilote"
        :circuits="circuits"
        :mes-circuits="mesCircuits"
        :reference="reference"
        :circuit="hud.circuit"
        :chargement="hud.chargement"
        :echelle="Math.max(echelle, 0.7)"
        @choisir="choisirCircuit"
        @aleatoire="choisirCircuit({ type: 'seed', seed: String(seedAleatoire()) })"
        @editer="ouvrirEditeur"
        @supprimer="supprimerTrace"
        @demarrer="demarrer"
        @copier="copierLien"
      />
    </Transition>

    <EditeurCircuit
      v-if="editeur.ouvert"
      :initial="editeur.initial"
      @fermer="editeur.ouvert = false"
      @rouler="roulerTrace"
      @enregistrer="enregistrerTrace"
      @partager="partagerTrace"
    />

    <!-- Chargement d'un circuit -->
    <div v-if="hud.chargement" class="absolute inset-0 z-30 flex items-center justify-center bg-black/40">
      <div class="panneau flex items-center gap-3 px-6 py-4">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-cyan-300" />
        <span>Construction du circuit…</span>
      </div>
    </div>

    <!-- Pause -->
    <Transition name="fondu">
      <div v-if="hud.etat === 'pause'" class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
        <div class="panneau w-[min(92vw,26rem)] p-8 text-center">
          <div class="titre-neon text-5xl">PAUSE</div>
          <p class="mt-2 text-slate-300">{{ hud.circuit.nom }} — la course est figée.</p>
          <div class="mt-5 grid grid-cols-3 gap-2">
            <UButton v-for="a in [['jour', 'Jour', 'i-lucide-sun'], ['crepuscule', 'Crépuscule', 'i-lucide-sunset'], ['nuit', 'Nuit', 'i-lucide-moon-star']]" :key="a[0]"
              :icon="a[2]" :label="a[1]" size="sm" class="justify-center" :color="options.ambiance === a[0] ? 'primary' : 'neutral'"
              :variant="options.ambiance === a[0] ? 'solid' : 'subtle'" @click="options.ambiance = a[0]" />
          </div>
          <div class="mt-4 flex flex-col gap-3">
            <UButton size="xl" block icon="i-lucide-play" label="Reprendre" @click="moteur.basculerPause()" />
            <UButton size="lg" block color="neutral" variant="subtle" icon="i-lucide-rotate-ccw" label="Recommencer la course" @click="demarrer" />
            <UButton size="lg" block color="neutral" variant="ghost" icon="i-lucide-house" label="Retour au menu" @click="moteur.retourMenu()" />
          </div>
          <div class="mt-5 text-sm text-slate-400"><UKbd>P</UKbd> ou <UKbd>Échap</UKbd> pour reprendre</div>
        </div>
      </div>
    </Transition>

    <Transition name="fondu">
      <EcranFin
        v-if="hud.etat === 'fin'"
        :hud="hud"
        :echelle="Math.max(echelle, 0.7)"
        @rejouer="demarrer"
        @nouveau="moteur.retourMenu()"
        @menu="moteur.retourMenu()"
        @copier="copierLien"
      />
    </Transition>

    <div v-if="erreur" class="absolute inset-0 flex items-center justify-center p-6">
      <UAlert color="error" variant="subtle" icon="i-lucide-triangle-alert" title="Rendu 3D indisponible" :description="erreur" class="max-w-lg" />
    </div>
  </div>
</template>
