<script setup>
// HUD affiché pendant la course : position, tours, chronos, classement en
// direct, compteur de vitesse, alertes. Purement déclaratif : il lit l'objet
// réactif `hud` alimenté par le moteur.
const props = defineProps({ hud: { type: Object, required: true } })

// Arc du compteur : 270° sur un cercle de rayon 84.
const LONGUEUR_ARC = 2 * Math.PI * 84 * 0.75
const arcVitesse = computed(() => LONGUEUR_ARC * Math.min(1, props.hud.vitesse / 300))
const arcRegime = computed(() => 2 * Math.PI * 70 * 0.75 * props.hud.regime)

// Bandeau « record » : visible quelques secondes après chaque meilleur tour.
const recordVisible = ref(false)
let minuterie = null
watch(() => props.hud.flashRecord, () => {
  recordVisible.value = true
  clearTimeout(minuterie)
  minuterie = setTimeout(() => { recordVisible.value = false }, 3200)
})
onBeforeUnmount(() => clearTimeout(minuterie))
</script>

<template>
  <div class="pointer-events-none absolute inset-0">
    <!-- Position + tour -->
    <div class="panneau absolute left-4 top-4 flex items-stretch gap-4 px-5 py-3">
      <div>
        <div class="text-[11px] uppercase tracking-[0.3em] text-slate-400">Position</div>
        <div class="chiffres text-5xl font-black leading-none text-white">
          {{ hud.position }}<span class="text-xl text-slate-400">/{{ hud.total }}</span>
        </div>
      </div>
      <div class="w-px bg-white/10" />
      <div>
        <div class="text-[11px] uppercase tracking-[0.3em] text-slate-400">Tour</div>
        <div class="chiffres text-5xl font-black leading-none text-cyan-300">
          {{ hud.tour }}<span class="text-xl text-slate-400">/{{ hud.tours }}</span>
        </div>
      </div>
    </div>

    <!-- Chronos -->
    <div class="panneau absolute left-1/2 top-4 -translate-x-1/2 px-6 py-2.5 text-center">
      <div class="text-[11px] uppercase tracking-[0.3em] text-slate-400">Chrono</div>
      <div class="chiffres text-4xl font-bold leading-tight">{{ hud.tempsCourse }}</div>
      <div class="mt-1 grid grid-cols-3 gap-4 text-left">
        <div>
          <div class="text-[10px] uppercase tracking-[0.2em] text-slate-400">Tour en cours</div>
          <div class="chiffres text-base text-cyan-200">{{ hud.tempsTour }}</div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-[0.2em] text-slate-400">Dernier</div>
          <div class="chiffres text-base text-slate-200">{{ hud.dernierTour }}</div>
        </div>
        <div>
          <div class="text-[10px] uppercase tracking-[0.2em] text-slate-400">Meilleur</div>
          <div class="chiffres text-base text-fuchsia-300">{{ hud.meilleurTour }}</div>
        </div>
      </div>
    </div>

    <!-- Classement en direct -->
    <div class="panneau absolute right-4 top-4 w-56 p-2">
      <div class="px-2 pb-1 text-[11px] uppercase tracking-[0.3em] text-slate-400">Classement</div>
      <TransitionGroup name="fondu" tag="div">
        <div
          v-for="(l, i) in hud.classement" :key="l.nom"
          class="flex items-center gap-2 rounded-lg px-2 py-1 text-[15px]"
          :class="l.joueur ? 'bg-cyan-400/15 ring-1 ring-cyan-300/40' : ''"
        >
          <span class="chiffres w-4 text-sm text-slate-400">{{ i + 1 }}</span>
          <span class="size-2.5 rounded-full" :style="{ background: l.couleur, boxShadow: `0 0 8px ${l.couleur}` }" />
          <span class="flex-1 truncate font-semibold" :class="l.joueur ? 'text-cyan-100' : 'text-slate-100'">{{ l.nom }}</span>
          <UIcon v-if="l.fini" name="i-lucide-flag" class="size-3.5 text-emerald-300" />
          <span class="chiffres text-xs text-slate-300">{{ l.ecart }}</span>
        </div>
      </TransitionGroup>
    </div>

    <!-- Alertes centrales -->
    <div class="absolute inset-x-0 top-36 flex flex-col items-center gap-2">
      <Transition name="fondu">
        <div v-if="recordVisible" class="panneau border-fuchsia-400/50 px-6 py-2 text-center">
          <div class="text-xs uppercase tracking-[0.35em] text-fuchsia-300">Meilleur tour</div>
          <div class="chiffres text-3xl font-black text-white">{{ hud.tempsRecord }}</div>
          <div class="text-xs text-slate-300">Votre fantôme vous attend au prochain tour</div>
        </div>
      </Transition>
      <div v-if="hud.contresens" class="clignote rounded-lg bg-red-600/85 px-5 py-1.5 font-display text-xl font-black tracking-widest">
        CONTRESENS
      </div>
      <div v-else-if="hud.horsPiste && hud.etat === 'course'" class="rounded-lg bg-amber-500/80 px-4 py-1 font-display text-sm font-bold tracking-widest text-black">
        HORS PISTE — ADHÉRENCE RÉDUITE
      </div>
    </div>

    <!-- Indicateurs -->
    <div class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
      <UBadge v-if="hud.fantome" color="primary" variant="subtle" icon="i-lucide-ghost" label="Fantôme actif" />
      <UBadge v-if="hud.autopilote" color="secondary" variant="subtle" icon="i-lucide-bot" label="Pilote automatique" />
      <UBadge v-if="hud.muet" color="neutral" variant="subtle" icon="i-lucide-volume-x" label="Muet" />
      <UBadge color="neutral" variant="subtle" :label="`${hud.ips} i/s`" class="chiffres" />
    </div>

    <!-- Compteur de vitesse -->
    <div class="absolute bottom-4 right-4 size-56">
      <svg viewBox="0 0 200 200" class="size-full -rotate-[225deg]">
        <defs>
          <linearGradient id="degrade-vitesse" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#18d6ff" /><stop offset="1" stop-color="#ff2a8a" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="92" fill="rgba(10,8,24,0.62)" stroke="rgba(24,214,255,0.2)" />
        <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="9" stroke-linecap="round" :stroke-dasharray="`${LONGUEUR_ARC} 1000`" />
        <circle cx="100" cy="100" r="84" fill="none" stroke="url(#degrade-vitesse)" stroke-width="9" stroke-linecap="round" :stroke-dasharray="`${arcVitesse} 1000`" style="filter: drop-shadow(0 0 6px #18d6ff)" />
        <circle cx="100" cy="100" r="70" fill="none" :stroke="hud.regime > 0.9 ? '#ff4d6d' : 'rgba(255,255,255,0.55)'" stroke-width="2.5" :stroke-dasharray="`${arcRegime} 1000`" />
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <div class="chiffres text-6xl font-black leading-none">{{ hud.vitesse }}</div>
        <div class="text-xs uppercase tracking-[0.35em] text-slate-400">km/h</div>
        <div class="chiffres mt-1 rounded-md bg-white/10 px-2.5 text-lg font-bold text-cyan-200">
          {{ hud.rapport === 0 ? 'R' : hud.rapport }}
        </div>
      </div>
    </div>
  </div>
</template>
