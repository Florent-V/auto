<script setup>
// =============================================================================
// COMPOSANT RACINE DU JEU
// Monte le moteur (Three.js + simulation) sur le canvas et superpose
// l'interface Nuxt UI correspondant à l'état courant de la machine à états.
// =============================================================================
import { Moteur, creerEtatHud } from '~/game/moteur.js'
import { seedAleatoire } from '~/game/core/rng.js'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const canvas = ref(null)
const canvasCarte = ref(null)
const hud = reactive(creerEtatHud())
const options = reactive({ tours: 3, difficulte: 'normal', musique: true, modele: 'hypercar' })
const erreur = ref('')
let moteur = null

// Mise à l'échelle du HUD sur les petits écrans (propriété CSS `zoom`).
const echelle = ref(1)
const calculerEchelle = () => { echelle.value = Math.max(0.45, Math.min(1, window.innerWidth / 1180, window.innerHeight / 660)) }

const enCourse = computed(() => ['course', 'decompte', 'pause'].includes(hud.etat))

/** Charge un circuit et synchronise l'URL (?seed=…) pour pouvoir le partager. */
function chargerSeed(seed) {
  const texte = String(seed).trim().slice(0, 24) || String(seedAleatoire())
  moteur.chargerCircuit(texte)
  if (route.query.seed !== texte) router.replace({ query: { ...route.query, seed: texte } })
}
function demarrer() {
  moteur.audio.definirMusique(options.musique)
  moteur.lancer({ tours: options.tours, difficulte: options.difficulte })
}
function nouveauCircuit() {
  moteur.retourMenu()
  chargerSeed(seedAleatoire())
}
async function copierLien() {
  try {
    await navigator.clipboard.writeText(window.location.href)
    toast.add({ title: 'Lien copié', description: `Circuit #${hud.seed} prêt à être partagé.`, icon: 'i-lucide-link', color: 'primary' })
  } catch {
    toast.add({ title: 'Copie impossible', description: window.location.href, color: 'warning' })
  }
}

watch(() => options.musique, (v) => moteur && moteur.audio.definirMusique(v))
// Changer de modèle remplace immédiatement la voiture présentée derrière le menu.
watch(() => options.modele, (v) => moteur && moteur.definirModeleJoueur(v))

onMounted(() => {
  calculerEchelle()
  window.addEventListener('resize', calculerEchelle)
  try {
    moteur = new Moteur({ canvas: canvas.value, canvasCarte: canvasCarte.value, hud })
    if (['f1', 'hypercar', 'sportive'].includes(route.query.voiture)) options.modele = route.query.voiture
    moteur.options.modele = options.modele
    hud.autopilote = route.query.autopilot === '1'
    chargerSeed(route.query.seed ?? seedAleatoire())
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
  <div class="fixed inset-0 overflow-hidden bg-[#07060f] text-white select-none">
    <canvas ref="canvas" class="absolute inset-0 block size-full" />

    <!-- HUD de course -->
    <Transition name="fondu">
      <HudCourse v-show="enCourse" :hud="hud" :style="{ zoom: echelle }" />
    </Transition>

    <!-- Mini-carte (canvas 2D piloté par le moteur) -->
    <div
      v-show="hud.pret && hud.etat !== 'fin'"
      class="panneau absolute bottom-4 left-4 p-1 transition-opacity duration-300"
      :class="hud.etat === 'menu' ? 'opacity-0 pointer-events-none xl:opacity-100' : ''"
      :style="{ zoom: echelle }"
    >
      <canvas ref="canvasCarte" class="block size-[208px]" />
      <div class="absolute left-3 top-2 text-[11px] uppercase tracking-[0.2em] text-cyan-200/70">
        #{{ hud.seed }} · {{ hud.longueur }} m
      </div>
    </div>

    <!-- Compte à rebours 3-2-1 / GO -->
    <div v-if="hud.decompte >= 0 && hud.etat !== 'pause'" class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <Transition name="compte" mode="out-in">
        <div
          :key="hud.decompte"
          class="chiffres text-[9rem] font-black leading-none sm:text-[13rem]"
          :class="hud.depart ? 'text-emerald-300' : 'text-white'"
          :style="{ textShadow: hud.depart ? '0 0 60px rgba(52,211,153,.9)' : '0 0 60px rgba(255,42,138,.9)' }"
        >
          {{ hud.depart ? 'GO' : hud.decompte }}
        </div>
      </Transition>
    </div>

    <Transition name="fondu">
      <MenuPrincipal
        v-if="hud.pret && hud.etat === 'menu'"
        v-model:tours="options.tours"
        v-model:difficulte="options.difficulte"
        v-model:musique="options.musique"
        v-model:modele="options.modele"
        v-model:autopilote="hud.autopilote"
        :seed="hud.seed"
        :longueur="hud.longueur"
        :echelle="Math.max(echelle, 0.7)"
        @demarrer="demarrer"
        @charger="chargerSeed"
        @aleatoire="chargerSeed(seedAleatoire())"
        @copier="copierLien"
      />
    </Transition>

    <!-- Pause -->
    <Transition name="fondu">
      <div v-if="hud.etat === 'pause'" class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
        <div class="panneau w-[min(92vw,26rem)] p-8 text-center">
          <div class="titre-neon text-5xl">PAUSE</div>
          <p class="mt-2 text-slate-300">La course est figée. Reprenez quand vous voulez.</p>
          <div class="mt-6 flex flex-col gap-3">
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
        @nouveau="nouveauCircuit"
        @menu="moteur.retourMenu()"
        @copier="copierLien"
      />
    </Transition>

    <div v-if="erreur" class="absolute inset-0 flex items-center justify-center p-6">
      <UAlert color="error" variant="subtle" icon="i-lucide-triangle-alert" title="Rendu 3D indisponible" :description="erreur" class="max-w-lg" />
    </div>
  </div>
</template>
