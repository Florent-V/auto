<script setup>
// =============================================================================
// Menu principal — quatre onglets :
//   Circuit  : circuits célèbres, procédural (seed) ou circuits personnels
//   Voiture  : monoplace, hypercar, sportive (fiches techniques)
//   Course   : tours, adversaires, plateau, ambiance (jour / crépuscule / nuit)
//   Pilotage : aides électroniques, boîte, commandes
// Derrière lui, la voiture choisie tourne en démonstration sur le circuit.
// =============================================================================
import { cheminSilhouette } from '~/game/ui/silhouette.js'
import { SPECS } from '~/game/core/modeles.js'

const props = defineProps({
  circuits: { type: Array, required: true },       // circuits célèbres
  mesCircuits: { type: Array, required: true },    // circuits personnels enregistrés
  reference: { type: Object, required: true },     // circuit actuellement chargé
  circuit: { type: Object, required: true },       // infos du circuit chargé (hud.circuit)
  chargement: { type: Boolean, default: false },
  echelle: { type: Number, default: 1 }
})
const emit = defineEmits(['choisir', 'aleatoire', 'editer', 'supprimer', 'demarrer', 'copier'])
const options = defineModel('options', { type: Object, required: true })
const autopilote = defineModel('autopilote', { type: Boolean })

const onglet = ref('circuit')
const onglets = [
  { label: 'Circuit', value: 'circuit', icon: 'i-lucide-map', slot: 'circuit' },
  { label: 'Voiture', value: 'voiture', icon: 'i-lucide-car-front', slot: 'voiture' },
  { label: 'Course', value: 'course', icon: 'i-lucide-flag', slot: 'course' },
  { label: 'Pilotage', value: 'pilotage', icon: 'i-lucide-gauge', slot: 'pilotage' }
]
const sourceCircuit = ref(props.reference.type === 'seed' ? 'seed' : props.reference.type === 'perso' ? 'perso' : 'reel')
const saisieSeed = ref(props.reference.type === 'seed' ? String(props.reference.seed) : '')
watch(() => props.reference, (r) => { if (r.type === 'seed') saisieSeed.value = String(r.seed) })

const estActif = (ref) => {
  const r = props.reference
  if (r.type !== ref.type) return false
  if (r.type === 'reel') return r.id === ref.id
  if (r.type === 'perso') return r.index === ref.index
  return true
}

const modeles = computed(() => [
  { valeur: 'f1', icone: 'i-lucide-rocket', detail: 'Roues découvertes, appui massif, freinage à 5 g' },
  { valeur: 'hypercar', icone: 'i-lucide-zap', detail: 'Moteur central V12, aileron actif, diffuseur' },
  { valeur: 'sportive', icone: 'i-lucide-car-front', detail: 'GT à moteur avant V8, propulsion, pneus route' }
].map((m) => {
  const s = SPECS[m.valeur]
  return {
    ...m, nom: s.nom,
    fiche: [
      ['Puissance', `${Math.round(s.moteur.puissanceMax / 735.5)} ch`],
      ['Masse', `${s.masse} kg`],
      ['Rapports', `${s.boite.rapports.length}`],
      ['Appui à 250 km/h', `${Math.round((0.5 * 1.225 * s.aero.SCz * (250 / 3.6) ** 2) / 9.81)} kg`]
    ]
  }
}))

const ambiances = [
  { valeur: 'jour', libelle: 'Jour', icone: 'i-lucide-sun' },
  { valeur: 'crepuscule', libelle: 'Crépuscule', icone: 'i-lucide-sunset' },
  { valeur: 'nuit', libelle: 'Nuit', icone: 'i-lucide-moon-star' }
]
const aides = [
  { valeur: 'completes', libelle: 'Complètes', detail: 'ABS, antipatinage, stabilité, aide au contre-braquage' },
  { valeur: 'partielles', libelle: 'Partielles', detail: 'ABS, antipatinage, stabilité réduite : la voiture glisse' },
  { valeur: 'aucune', libelle: 'Aucune', detail: 'Simulation pure : blocages, patinage, tête-à-queue' }
]
const choixTours = [1, 3, 5, 10]
const difficultes = [{ valeur: 'facile', libelle: 'Facile' }, { valeur: 'normal', libelle: 'Normal' }, { valeur: 'difficile', libelle: 'Difficile' }]
const resume = computed(() => {
  const amb = ambiances.find((a) => a.valeur === options.value.ambiance)?.libelle
  return `${props.circuit.nom} · ${SPECS[options.value.modele].nom} · ${amb}`
})
</script>

<template>
  <div class="absolute inset-0 flex overflow-y-auto bg-gradient-to-r from-[#07070b]/92 via-[#07070b]/55 to-transparent p-3 sm:p-8">
    <div class="m-auto w-full max-w-2xl sm:mx-0 sm:ml-[3vw]" :style="{ zoom: echelle }">
      <div class="flex items-end justify-between gap-4">
        <div>
          <div class="text-xs uppercase tracking-[0.5em] text-cyan-200/80">Simulation de course</div>
          <h1 class="titre-neon text-5xl leading-none sm:text-7xl">NEON APEX</h1>
        </div>
        <div class="hidden text-right text-sm text-slate-400 sm:block">
          <div class="font-display text-base text-white">{{ circuit.nom }}</div>
          <div class="chiffres">{{ (circuit.longueur / 1000).toFixed(2) }} km · {{ circuit.denivele }} m de dénivelé</div>
        </div>
      </div>

      <div class="panneau mt-4 p-4">
        <UTabs v-model="onglet" :items="onglets" variant="link" color="primary" class="w-full" :ui="{ list: 'mb-3', content: 'min-h-[300px]' }">
          <!-- ===================== CIRCUIT ===================== -->
          <template #circuit>
            <div class="mb-3 flex gap-2">
              <UButton v-for="s in [['reel', 'Célèbres', 'i-lucide-trophy'], ['seed', 'Procédural', 'i-lucide-dices'], ['perso', 'Mes circuits', 'i-lucide-pencil-ruler']]" :key="s[0]"
                :label="s[1]" :icon="s[2]" size="sm" :color="sourceCircuit === s[0] ? 'primary' : 'neutral'" :variant="sourceCircuit === s[0] ? 'soft' : 'ghost'"
                @click="sourceCircuit = s[0]" />
              <div class="flex-1" />
              <UButton icon="i-lucide-link" size="sm" color="neutral" variant="ghost" aria-label="Copier le lien du circuit" @click="emit('copier')" />
            </div>

            <div v-if="sourceCircuit === 'reel'" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button v-for="c in circuits" :key="c.id" type="button" :disabled="chargement"
                class="group rounded-xl border p-2 text-left transition"
                :class="estActif({ type: 'reel', id: c.id }) ? 'border-cyan-300/80 bg-cyan-400/12' : 'border-white/10 bg-white/[0.03] hover:border-white/30'"
                @click="emit('choisir', { type: 'reel', id: c.id })">
                <div class="flex items-start gap-2">
                  <svg viewBox="0 0 100 100" class="size-14 shrink-0">
                    <path :d="cheminSilhouette(c.points, 100, 8)" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"
                      :class="estActif({ type: 'reel', id: c.id }) ? 'text-cyan-300' : 'text-slate-300 group-hover:text-white'" />
                  </svg>
                  <div class="min-w-0">
                    <div class="truncate font-display text-sm font-bold text-white">{{ c.nom }}</div>
                    <div class="text-xs text-slate-400">{{ c.pays }}</div>
                    <div class="chiffres text-xs text-slate-300">{{ (c.longueurReelle / 1000).toFixed(3) }} km</div>
                  </div>
                </div>
                <div class="mt-1 line-clamp-2 text-[11px] leading-tight text-slate-400">{{ c.description }}</div>
              </button>
            </div>

            <div v-else-if="sourceCircuit === 'seed'" class="space-y-3">
              <p class="text-sm text-slate-300">Un tracé unique est généré pour chaque seed (nombre ou mot) : partagez-la, le circuit sera identique chez vos amis.</p>
              <form class="flex gap-2" @submit.prevent="emit('choisir', { type: 'seed', seed: saisieSeed || '1' })">
                <UInput v-model="saisieSeed" size="xl" class="flex-1" icon="i-lucide-hash" placeholder="1234 ou un mot" :ui="{ base: 'chiffres' }" maxlength="24" />
                <UButton type="submit" size="xl" icon="i-lucide-refresh-cw" label="Générer" :loading="chargement" />
                <UButton size="xl" color="neutral" variant="subtle" icon="i-lucide-dices" aria-label="Seed aléatoire" @click="emit('aleatoire')" />
              </form>
            </div>

            <div v-else class="space-y-2">
              <UButton icon="i-lucide-plus" label="Créer un circuit" block size="lg" @click="emit('editer', null)" />
              <p v-if="!mesCircuits.length" class="py-6 text-center text-sm text-slate-400">
                Dessinez votre propre tracé : points de passage, largeur, relief et paysage. Il est vérifié (virages, croisements) avant de rouler.
              </p>
              <div v-for="(m, i) in mesCircuits" :key="i"
                class="flex items-center gap-3 rounded-xl border p-2"
                :class="estActif({ type: 'perso', index: i }) ? 'border-cyan-300/80 bg-cyan-400/12' : 'border-white/10 bg-white/[0.03]'">
                <svg viewBox="0 0 100 100" class="size-12 shrink-0 text-slate-200">
                  <path :d="cheminSilhouette(m.points, 100, 8)" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" />
                </svg>
                <div class="min-w-0 flex-1">
                  <div class="truncate font-display text-sm font-bold">{{ m.nom || 'Sans nom' }}</div>
                  <div class="text-xs text-slate-400">{{ m.points.length }} points · largeur {{ m.demiLargeur * 2 }} m · relief {{ m.relief }} m</div>
                </div>
                <UButton icon="i-lucide-play" size="sm" aria-label="Rouler sur ce circuit" @click="emit('choisir', { type: 'perso', index: i, definition: m })" />
                <UButton icon="i-lucide-pencil" size="sm" color="neutral" variant="subtle" aria-label="Modifier" @click="emit('editer', i)" />
                <UButton icon="i-lucide-trash-2" size="sm" color="error" variant="ghost" aria-label="Supprimer" @click="emit('supprimer', i)" />
              </div>
            </div>
          </template>

          <!-- ===================== VOITURE ===================== -->
          <template #voiture>
            <div class="grid gap-2 sm:grid-cols-3">
              <button v-for="m in modeles" :key="m.valeur" type="button"
                class="rounded-xl border p-3 text-left transition"
                :class="options.modele === m.valeur ? 'border-cyan-300/80 bg-cyan-400/12' : 'border-white/10 bg-white/[0.03] hover:border-white/30'"
                :aria-pressed="options.modele === m.valeur" @click="options.modele = m.valeur">
                <div class="flex items-center gap-2">
                  <UIcon :name="m.icone" class="size-5" :class="options.modele === m.valeur ? 'text-cyan-200' : 'text-slate-400'" />
                  <span class="font-display text-base font-bold">{{ m.nom }}</span>
                </div>
                <p class="mt-1 text-xs leading-tight text-slate-400">{{ m.detail }}</p>
                <dl class="mt-2 space-y-0.5 text-xs">
                  <div v-for="[k, v] in m.fiche" :key="k" class="flex justify-between gap-2"><dt class="text-slate-400">{{ k }}</dt><dd class="chiffres text-slate-100">{{ v }}</dd></div>
                </dl>
              </button>
            </div>
            <div class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] p-3">
              <div>
                <div class="text-sm font-semibold">Plateau</div>
                <div class="text-xs text-slate-400">Monotype : tous les pilotes sur la même voiture, comme une vraie catégorie.</div>
              </div>
              <div class="flex gap-1">
                <UButton v-for="p in [['monotype', 'Monotype'], ['mixte', 'Mixte']]" :key="p[0]" :label="p[1]" size="sm"
                  :color="options.plateau === p[0] ? 'primary' : 'neutral'" :variant="options.plateau === p[0] ? 'solid' : 'subtle'" @click="options.plateau = p[0]" />
              </div>
            </div>
          </template>

          <!-- ===================== COURSE ===================== -->
          <template #course>
            <div class="space-y-4">
              <div>
                <div class="mb-1.5 text-xs uppercase tracking-[0.25em] text-slate-400">Ambiance</div>
                <div class="grid grid-cols-3 gap-2">
                  <UButton v-for="a in ambiances" :key="a.valeur" :label="a.libelle" :icon="a.icone" size="lg" class="justify-center"
                    :color="options.ambiance === a.valeur ? 'primary' : 'neutral'" :variant="options.ambiance === a.valeur ? 'solid' : 'subtle'" @click="options.ambiance = a.valeur" />
                </div>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <div class="mb-1.5 text-xs uppercase tracking-[0.25em] text-slate-400">Tours</div>
                  <div class="flex gap-2">
                    <UButton v-for="n in choixTours" :key="n" :label="String(n)" size="lg" class="chiffres flex-1 justify-center"
                      :color="options.tours === n ? 'primary' : 'neutral'" :variant="options.tours === n ? 'solid' : 'subtle'" @click="options.tours = n" />
                  </div>
                </div>
                <div>
                  <div class="mb-1.5 text-xs uppercase tracking-[0.25em] text-slate-400">Adversaires</div>
                  <div class="flex gap-2">
                    <UButton v-for="d in difficultes" :key="d.valeur" :label="d.libelle" size="lg" class="flex-1 justify-center"
                      :color="options.difficulte === d.valeur ? 'primary' : 'neutral'" :variant="options.difficulte === d.valeur ? 'solid' : 'subtle'" @click="options.difficulte = d.valeur" />
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-slate-200">
                <USwitch v-model="options.musique" label="Musique" />
                <USwitch v-model="autopilote" label="Pilote automatique (démo)" />
              </div>
            </div>
          </template>

          <!-- ===================== PILOTAGE ===================== -->
          <template #pilotage>
            <div class="space-y-4">
              <div>
                <div class="mb-1.5 text-xs uppercase tracking-[0.25em] text-slate-400">Aides au pilotage</div>
                <div class="grid gap-2 sm:grid-cols-3">
                  <button v-for="a in aides" :key="a.valeur" type="button" class="rounded-xl border p-2.5 text-left transition"
                    :class="options.aides === a.valeur ? 'border-cyan-300/80 bg-cyan-400/12' : 'border-white/10 bg-white/[0.03] hover:border-white/30'"
                    @click="options.aides = a.valeur">
                    <div class="font-display text-sm font-bold">{{ a.libelle }}</div>
                    <div class="text-xs leading-tight text-slate-400">{{ a.detail }}</div>
                  </button>
                </div>
              </div>
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold">Boîte de vitesses</div>
                  <div class="text-xs text-slate-400">Manuelle : <UKbd>E</UKbd> monter, <UKbd>Q</UKbd> (A en AZERTY) descendre, ou gâchettes hautes.</div>
                </div>
                <div class="flex gap-1">
                  <UButton label="Auto" size="sm" :color="options.boiteAuto ? 'primary' : 'neutral'" :variant="options.boiteAuto ? 'solid' : 'subtle'" @click="options.boiteAuto = true" />
                  <UButton label="Manuelle" size="sm" :color="!options.boiteAuto ? 'primary' : 'neutral'" :variant="!options.boiteAuto ? 'solid' : 'subtle'" @click="options.boiteAuto = false" />
                </div>
              </div>
              <div class="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <div class="space-y-1">
                  <div class="font-semibold text-white">Clavier</div>
                  <div><UKbd>↑</UKbd> <UKbd>W</UKbd> gaz · <UKbd>↓</UKbd> <UKbd>S</UKbd> frein / recul</div>
                  <div><UKbd>←</UKbd> <UKbd>→</UKbd> <UKbd>A</UKbd> <UKbd>D</UKbd> direction · <UKbd>Espace</UKbd> frein à main</div>
                  <div><UKbd>C</UKbd> caméra · <UKbd>T</UKbd> télémétrie · <UKbd>P</UKbd> pause · <UKbd>R</UKbd> replacer · <UKbd>M</UKbd> son</div>
                </div>
                <div class="space-y-1">
                  <div class="font-semibold text-white">Manette (recommandée)</div>
                  <div>Gâchettes : gaz et frein progressifs</div>
                  <div>Stick gauche : direction analogique</div>
                  <div>A : frein à main · Y : caméra · Start : pause</div>
                </div>
              </div>
            </div>
          </template>
        </UTabs>

        <div class="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3 sm:flex-row sm:items-center">
          <div class="flex-1 truncate text-sm text-slate-300">{{ resume }}</div>
          <UButton size="xl" icon="i-lucide-flag" label="Démarrer la course" class="justify-center px-8 font-display tracking-widest" :loading="chargement" @click="emit('demarrer')" />
        </div>
      </div>
    </div>
  </div>
</template>
