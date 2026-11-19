<script setup>
// Écran de fin de course : podium, temps, meilleurs tours. Le tableau continue
// de se mettre à jour tant que des IA n'ont pas franchi la ligne.
const props = defineProps({ hud: { type: Object, required: true }, echelle: { type: Number, default: 1 } })
const emit = defineEmits(['rejouer', 'nouveau', 'menu', 'copier'])
const titre = computed(() => {
  const p = props.hud.position
  return p === 1 ? 'VICTOIRE' : p <= 3 ? 'PODIUM' : 'ARRIVÉE'
})
const MEDAILLES = ['text-amber-300', 'text-slate-300', 'text-orange-400']
</script>

<template>
  <div class="absolute inset-0 flex overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px]">
    <div class="panneau m-auto w-[min(94vw,40rem)] p-6 sm:p-8" :style="{ zoom: echelle }">
      <div class="flex items-end justify-between gap-4">
        <div>
          <div class="text-sm uppercase tracking-[0.4em] text-cyan-200/80">{{ hud.circuit.nom }}</div>
          <h2 class="titre-neon text-5xl sm:text-6xl">{{ titre }}</h2>
        </div>
        <div class="text-right">
          <div class="chiffres text-6xl font-black leading-none">{{ hud.position }}<span class="text-2xl text-slate-400">/{{ hud.total }}</span></div>
          <div class="text-xs uppercase tracking-[0.3em] text-slate-400">Position finale</div>
        </div>
      </div>

      <div class="mt-5 overflow-hidden rounded-xl border border-white/10">
        <div class="grid grid-cols-[2.5rem_1fr_6.5rem_6.5rem] bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-slate-400">
          <span>#</span><span>Pilote</span><span class="text-right">Temps</span><span class="text-right">Meilleur tour</span>
        </div>
        <div
          v-for="(l, i) in hud.classement" :key="l.nom"
          class="grid grid-cols-[2.5rem_1fr_6.5rem_6.5rem] items-center border-t border-white/5 px-3 py-2"
          :class="l.joueur ? 'bg-cyan-400/15' : ''"
        >
          <span class="chiffres text-lg font-black" :class="MEDAILLES[i] ?? 'text-slate-500'">{{ i + 1 }}</span>
          <span class="flex items-center gap-2 text-lg font-semibold">
            <span class="size-3 rounded-full" :style="{ background: l.couleur, boxShadow: `0 0 10px ${l.couleur}` }" />
            {{ l.nom }}
          </span>
          <span class="chiffres text-right text-sm" :class="l.fini ? 'text-white' : 'text-slate-500'">
            {{ l.fini ? l.ecart : `tour ${l.tour}/${hud.tours}` }}
          </span>
          <span class="chiffres text-right text-sm text-fuchsia-300">{{ l.meilleur }}</span>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-slate-300">
        <span>Votre meilleur tour : <b class="chiffres text-fuchsia-300">{{ hud.meilleurTour }}</b></span>
        <span class="text-sm text-slate-400">Rejouez ce circuit : votre fantôme partira avec vous.</span>
      </div>

      <div class="mt-6 grid gap-3 sm:grid-cols-2">
        <UButton size="xl" block icon="i-lucide-rotate-ccw" label="Rejouer ce circuit" @click="emit('rejouer')" />
        <UButton size="xl" block color="secondary" variant="subtle" icon="i-lucide-dices" label="Changer de circuit" @click="emit('nouveau')" />
        <UButton size="lg" block color="neutral" variant="subtle" icon="i-lucide-link" label="Copier le lien" @click="emit('copier')" />
        <UButton size="lg" block color="neutral" variant="ghost" icon="i-lucide-house" label="Menu" @click="emit('menu')" />
      </div>
    </div>
  </div>
</template>
