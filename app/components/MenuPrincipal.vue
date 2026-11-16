<script setup>
// Menu principal : choix de la seed, du nombre de tours et de la difficulté.
// Derrière lui, les six voitures tournent en démonstration sur le circuit.
const props = defineProps({ seed: { type: String, default: '' }, longueur: { type: Number, default: 0 }, echelle: { type: Number, default: 1 } })
const emit = defineEmits(['demarrer', 'charger', 'aleatoire', 'copier'])
const tours = defineModel('tours', { type: Number })
const difficulte = defineModel('difficulte', { type: String })
const musique = defineModel('musique', { type: Boolean })
const autopilote = defineModel('autopilote', { type: Boolean })
const modele = defineModel('modele', { type: String })

const saisie = ref(props.seed)
watch(() => props.seed, (v) => { saisie.value = v })

const choixModeles = [
  { valeur: 'f1', libelle: 'Monoplace', detail: 'Roues découvertes, ailerons, halo', icone: 'i-lucide-rocket' },
  { valeur: 'hypercar', libelle: 'Hypercar', detail: 'Moteur central, aileron, diffuseur', icone: 'i-lucide-zap' },
  { valeur: 'sportive', libelle: 'Sportive', detail: 'Coupé GT, long capot, bandes', icone: 'i-lucide-car-front' }
]
const choixTours = [1, 3, 5, 8]
const choixDifficulte = [
  { valeur: 'facile', libelle: 'Facile' },
  { valeur: 'normal', libelle: 'Normal' },
  { valeur: 'difficile', libelle: 'Difficile' }
]
</script>

<template>
  <div class="absolute inset-0 flex overflow-y-auto bg-gradient-to-r from-[#07060f]/90 via-[#07060f]/45 to-transparent p-4 sm:p-10">
    <div class="m-auto w-full max-w-xl sm:mx-0 sm:ml-[4vw]" :style="{ zoom: echelle }">
      <div class="text-sm uppercase tracking-[0.5em] text-cyan-200/80">Course procédurale</div>
      <h1 class="titre-neon text-6xl leading-none sm:text-8xl">NEON<br>APEX</h1>
      <p class="mt-3 max-w-md text-lg text-slate-300">
        Chaque seed engendre un circuit unique. Battez cinq pilotes IA, puis votre propre fantôme.
      </p>

      <div class="panneau mt-6 space-y-5 p-5">
        <!-- Seed -->
        <div>
          <div class="mb-1.5 flex items-center justify-between text-xs uppercase tracking-[0.25em] text-slate-400">
            <span>Seed du circuit</span>
            <span class="text-cyan-200/80">{{ longueur }} m</span>
          </div>
          <form class="flex gap-2" @submit.prevent="emit('charger', saisie)">
            <UInput v-model="saisie" size="xl" class="flex-1" icon="i-lucide-hash" placeholder="1234 ou un mot" :ui="{ base: 'chiffres' }" maxlength="24" />
            <UButton type="submit" size="xl" color="neutral" variant="subtle" icon="i-lucide-refresh-cw" aria-label="Générer ce circuit" :disabled="saisie === seed" />
            <UButton size="xl" color="neutral" variant="subtle" icon="i-lucide-dices" aria-label="Circuit aléatoire" @click="emit('aleatoire')" />
            <UButton size="xl" color="neutral" variant="subtle" icon="i-lucide-link" aria-label="Copier le lien du circuit" @click="emit('copier')" />
          </form>
        </div>

        <!-- Modèle de voiture : l'aperçu 3D derrière le menu change en direct -->
        <div>
          <div class="mb-1.5 text-xs uppercase tracking-[0.25em] text-slate-400">Votre voiture</div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="m in choixModeles" :key="m.valeur" type="button"
              class="rounded-xl border px-3 py-2.5 text-left transition"
              :class="modele === m.valeur
                ? 'border-cyan-300/80 bg-cyan-400/15 shadow-[0_0_18px_rgba(24,214,255,0.25)]'
                : 'border-white/10 bg-white/5 hover:border-white/30'"
              :aria-pressed="modele === m.valeur"
              @click="modele = m.valeur"
            >
              <UIcon :name="m.icone" class="size-5" :class="modele === m.valeur ? 'text-cyan-200' : 'text-slate-400'" />
              <div class="font-display text-sm font-bold tracking-wide" :class="modele === m.valeur ? 'text-white' : 'text-slate-200'">{{ m.libelle }}</div>
              <div class="hidden text-xs leading-tight text-slate-400 sm:block">{{ m.detail }}</div>
            </button>
          </div>
        </div>

        <div class="grid gap-5 sm:grid-cols-2">
          <div>
            <div class="mb-1.5 text-xs uppercase tracking-[0.25em] text-slate-400">Tours</div>
            <div class="flex gap-2">
              <UButton
                v-for="n in choixTours" :key="n" :label="String(n)" size="lg" class="chiffres flex-1 justify-center"
                :color="tours === n ? 'primary' : 'neutral'" :variant="tours === n ? 'solid' : 'subtle'" @click="tours = n"
              />
            </div>
          </div>
          <div>
            <div class="mb-1.5 text-xs uppercase tracking-[0.25em] text-slate-400">Adversaires</div>
            <div class="flex gap-2">
              <UButton
                v-for="d in choixDifficulte" :key="d.valeur" :label="d.libelle" size="lg" class="flex-1 justify-center"
                :color="difficulte === d.valeur ? 'primary' : 'neutral'" :variant="difficulte === d.valeur ? 'solid' : 'subtle'" @click="difficulte = d.valeur"
              />
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-slate-200">
          <USwitch v-model="musique" label="Musique" />
          <USwitch v-model="autopilote" label="Pilote automatique (démo)" />
        </div>

        <UButton size="xl" block icon="i-lucide-flag" label="Démarrer la course" class="py-4 font-display text-lg tracking-widest" @click="emit('demarrer')" />
      </div>

      <!-- Commandes -->
      <div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-300">
        <span><UKbd>↑</UKbd> <UKbd>W</UKbd> accélérer</span>
        <span><UKbd>↓</UKbd> <UKbd>S</UKbd> freiner / reculer</span>
        <span><UKbd>←</UKbd> <UKbd>→</UKbd> <UKbd>A</UKbd> <UKbd>D</UKbd> diriger</span>
        <span><UKbd>Espace</UKbd> frein à main</span>
        <span><UKbd>P</UKbd> pause</span>
        <span><UKbd>R</UKbd> replacer</span>
        <span><UKbd>M</UKbd> muet</span>
      </div>
    </div>
  </div>
</template>
