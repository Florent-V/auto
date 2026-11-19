<script setup>
// HUD affiché pendant la course : position, tours, chronos, classement en
// direct, compteur de vitesse, alertes. Purement déclaratif : il lit l'objet
// réactif `hud` alimenté par le moteur.
const props = defineProps({ hud: { type: Object, required: true } })

// Arc du compteur : 270° sur un cercle de rayon 84.
const LONGUEUR_ARC = 2 * Math.PI * 84 * 0.75
const arcVitesse = computed(() => LONGUEUR_ARC * Math.min(1, props.hud.vitesse / 360))
const NOMS_CAMERAS = { poursuite: 'Poursuite', proche: 'Poursuite proche', capot: 'Capot', embarquee: 'Embarquée' }
const echelleG = 9 // pixels par g (≈ 5 g en bord de cercle)
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
    <div class="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2">
      <UBadge v-if="hud.fantome" color="primary" variant="subtle" icon="i-lucide-ghost" label="Fantôme" />
      <UBadge v-if="hud.autopilote" color="secondary" variant="subtle" icon="i-lucide-bot" label="Pilote auto" />
      <UBadge color="neutral" variant="subtle" icon="i-lucide-video" :label="NOMS_CAMERAS[hud.camera]" />
      <UBadge v-if="hud.manette" color="neutral" variant="subtle" icon="i-lucide-gamepad-2" label="Manette" />
      <UBadge v-if="hud.muet" color="neutral" variant="subtle" icon="i-lucide-volume-x" label="Muet" />
      <UBadge color="neutral" variant="subtle" :label="`${hud.ips} i/s`" class="chiffres" />
    </div>

    <!-- Télémétrie (touche T) -->
    <Transition name="fondu">
      <div v-if="hud.telemetrie" class="panneau absolute bottom-4 right-64 w-64 p-3 text-xs">
        <div class="mb-2 flex items-center justify-between">
          <span class="uppercase tracking-[0.25em] text-slate-400">Télémétrie</span>
          <span class="text-slate-400">{{ hud.tele.surfaces }}</span>
        </div>
        <div class="flex gap-3">
          <!-- Diagramme g-g : accélérations latérale et longitudinale. -->
          <svg viewBox="-50 -50 100 100" class="size-24 shrink-0">
            <circle r="48" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.15)" />
            <circle r="24" fill="none" stroke="rgba(255,255,255,0.1)" />
            <line x1="-48" x2="48" stroke="rgba(255,255,255,0.1)" /><line y1="-48" y2="48" stroke="rgba(255,255,255,0.1)" />
            <circle :cx="Math.max(-46, Math.min(46, -hud.tele.gLat * echelleG))" :cy="Math.max(-46, Math.min(46, -hud.tele.gLong * echelleG))" r="4.5" fill="#18d6ff" />
            <text x="-46" y="46" fill="rgba(255,255,255,0.4)" font-size="8">{{ (48 / echelleG).toFixed(0) }} g</text>
          </svg>
          <dl class="flex-1 space-y-0.5">
            <div class="flex justify-between"><dt class="text-slate-400">Latéral</dt><dd class="chiffres">{{ Math.abs(hud.tele.gLat).toFixed(2) }} g</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Longit.</dt><dd class="chiffres">{{ hud.tele.gLong.toFixed(2) }} g</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Appui</dt><dd class="chiffres">{{ hud.tele.appuiKg }} kg</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Charge AV</dt><dd class="chiffres">{{ hud.tele.repartAv }} %</dd></div>
            <div class="flex justify-between"><dt class="text-slate-400">Régime</dt><dd class="chiffres">{{ hud.regimeTr }}</dd></div>
          </dl>
        </div>
        <div class="mt-2 space-y-1">
          <div v-for="[nom, val] in [['Adhérence AV', hud.tele.usageAv], ['Adhérence AR', hud.tele.usageAr]]" :key="nom">
            <div class="flex justify-between text-slate-400"><span>{{ nom }}</span><span class="chiffres">{{ val }} %</span></div>
            <div class="h-1.5 overflow-hidden rounded bg-white/10">
              <div class="h-full rounded" :style="{ width: Math.min(100, val) + '%', background: val > 97 ? '#ff4d6d' : val > 85 ? '#f5b82e' : '#35e06f' }" />
            </div>
          </div>
        </div>
        <div class="mt-2 flex gap-1">
          <span v-for="t in [['ABS', hud.tele.abs], ['TC', hud.tele.tc], ['BLOCAGE', hud.tele.blocage], ['PATINAGE', hud.tele.patinage]]" :key="t[0]"
            class="rounded px-1.5 py-0.5 font-bold" :class="t[1] ? 'bg-amber-400 text-black' : 'bg-white/5 text-slate-500'">{{ t[0] }}</span>
        </div>
      </div>
    </Transition>

    <!-- Compte-tours : témoins de passage façon F1, régime -->
    <div class="absolute bottom-[15.5rem] right-4 flex w-56 justify-center gap-1">
      <span v-for="k in 10" :key="k" class="size-3 rounded-full transition-colors duration-75"
        :class="hud.rupteur ? 'animate-pulse bg-blue-400' : k <= hud.feuxShift ? (k <= 4 ? 'bg-emerald-400' : k <= 7 ? 'bg-red-500' : 'bg-violet-400') : 'bg-white/10'" />
    </div>

    <!-- Compteur de vitesse -->
    <div class="absolute bottom-4 right-4 size-56">
      <svg viewBox="0 0 200 200" class="size-full -rotate-[225deg]">
        <defs>
          <linearGradient id="degrade-vitesse" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#18d6ff" /><stop offset="1" stop-color="#ff2a8a" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="92" fill="rgba(8,9,14,0.66)" stroke="rgba(255,255,255,0.12)" />
        <circle cx="100" cy="100" r="84" fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="9" stroke-linecap="round" :stroke-dasharray="`${LONGUEUR_ARC} 1000`" />
        <circle cx="100" cy="100" r="84" fill="none" stroke="url(#degrade-vitesse)" stroke-width="9" stroke-linecap="round" :stroke-dasharray="`${arcVitesse} 1000`" />
        <circle cx="100" cy="100" r="70" fill="none" :stroke="hud.regime > 0.95 ? '#ff4d6d' : 'rgba(255,255,255,0.6)'" stroke-width="3" :stroke-dasharray="`${arcRegime} 1000`" />
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <div class="chiffres text-6xl font-black leading-none">{{ hud.vitesse }}</div>
        <div class="text-xs uppercase tracking-[0.35em] text-slate-400">km/h</div>
        <div class="chiffres mt-1 rounded-md px-2.5 text-2xl font-black" :class="hud.rupteur ? 'bg-red-500 text-white' : 'bg-white/10 text-cyan-200'">
          {{ hud.rapport < 0 ? 'R' : hud.rapport }}
        </div>
        <div class="chiffres mt-0.5 text-[11px] text-slate-400">{{ hud.regimeTr }} tr/min{{ hud.boiteAuto ? '' : ' · M' }}</div>
      </div>
    </div>
  </div>
</template>
