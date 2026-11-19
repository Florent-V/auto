// =============================================================================
// MODULE : Audio procédural (Web Audio API, aucun fichier son)
// -----------------------------------------------------------------------------
// - Moteur : trois oscillateurs dont la fréquence suit le régime simulé.
// - Pneus / vent / hors-piste : un même bruit blanc filtré différemment.
// - Bips du décompte, impacts.
// - Musique : petit séquenceur synthwave (basse, arpège, kick, charleston).
// Le contexte audio n'est créé qu'après un geste de l'utilisateur.
// =============================================================================
const NOTE = (demiTons) => 55 * Math.pow(2, demiTons / 12) // référence : La1
// Progression La mineur – Fa – Do – Sol (fondamentale, tierce, quinte en demi-tons).
const ACCORDS = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]]
const DUREE_PAS = 60 / 112 / 4 // doubles-croches à 112 BPM

export function creerAudio() {
  let ctx = null, maitre = null, coupe = false
  let oscs = [], gainMoteur, filtreMoteur
  let gainCrissement, gainVent, gainHerbe
  let gainMusique, musiqueActive = true, prochainPas = 0, indexPas = 0
  let tamponBruit = null, rapportPrec = 1

  function bruit(duree) {
    const src = ctx.createBufferSource()
    src.buffer = tamponBruit
    src.loop = duree === undefined
    return src
  }

  function initialiser() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    ctx = new AC()
    maitre = ctx.createGain()
    maitre.gain.value = 0.8
    const compresseur = ctx.createDynamicsCompressor()
    maitre.connect(compresseur).connect(ctx.destination)

    tamponBruit = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const donnees = tamponBruit.getChannelData(0)
    for (let i = 0; i < donnees.length; i++) donnees[i] = Math.random() * 2 - 1

    // --- Moteur ---
    filtreMoteur = ctx.createBiquadFilter()
    filtreMoteur.type = 'lowpass'; filtreMoteur.Q.value = 2
    gainMoteur = ctx.createGain(); gainMoteur.gain.value = 0
    filtreMoteur.connect(gainMoteur).connect(maitre)
    for (const [type, vol] of [['sawtooth', 0.5], ['square', 0.3], ['sawtooth', 0.25]]) {
      const o = ctx.createOscillator(); o.type = type
      const g = ctx.createGain(); g.gain.value = vol
      o.connect(g).connect(filtreMoteur); o.start()
      oscs.push(o)
    }
    // --- Bruits filtrés ---
    const creerVoieBruit = (type, freq, q) => {
      const src = bruit()
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
      const g = ctx.createGain(); g.gain.value = 0
      src.connect(f).connect(g).connect(maitre); src.start()
      return g
    }
    gainCrissement = creerVoieBruit('bandpass', 1700, 6)
    gainVent = creerVoieBruit('lowpass', 520, 0.5)
    gainHerbe = creerVoieBruit('lowpass', 170, 1)
    // --- Musique ---
    gainMusique = ctx.createGain(); gainMusique.gain.value = 0.16
    gainMusique.connect(maitre)
    return true
  }

  /** Note courte avec enveloppe (basse, arpège, bips). */
  function note(dest, type, freq, t, duree, volume, coupure) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(volume, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree)
    if (coupure) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = coupure
      o.connect(f).connect(g)
    } else o.connect(g)
    g.connect(dest)
    o.start(t); o.stop(t + duree + 0.05)
  }

  function percussion(t, kick) {
    if (kick) {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      o.connect(g).connect(gainMusique); o.start(t); o.stop(t + 0.22)
    } else {
      const src = bruit(0.05)
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
      src.connect(f).connect(g).connect(gainMusique); src.start(t); src.stop(t + 0.06)
    }
  }

  /** Programme les prochains pas du séquenceur (avance de 150 ms sur l'horloge audio). */
  function rythmer() {
    if (!musiqueActive) { prochainPas = 0; return }
    if (prochainPas < ctx.currentTime) prochainPas = ctx.currentTime + 0.05
    while (prochainPas < ctx.currentTime + 0.15) {
      const pas = indexPas % 16, mesure = Math.floor(indexPas / 16) % 4
      const accord = ACCORDS[mesure], t = prochainPas
      if (pas % 4 === 0) percussion(t, true)
      if (pas % 4 === 2) percussion(t, false)
      if (pas % 2 === 0) note(gainMusique, 'sawtooth', NOTE(accord[0]), t, 0.2, 0.55, 420)
      const degre = accord[[0, 1, 2, 1][pas % 4]] + (pas % 8 >= 4 ? 12 : 0)
      note(gainMusique, 'square', NOTE(degre + 24), t, 0.11, 0.1, 2600)
      prochainPas += DUREE_PAS
      indexPas++
    }
  }

  return {
    /** À appeler depuis un geste utilisateur (clic sur « Démarrer »). */
    demarrer() {
      if (!ctx && !initialiser()) return
      if (ctx.state === 'suspended') ctx.resume()
    },
    get actif() { return !!ctx && ctx.state === 'running' },
    /**
     * Mise à jour continue (appelée une fois par image).
     * @param {number} regime 0..1, charge 0..1, vitesse m/s, glisse 0..1, horsPiste 0..1
     */
    /**
     * Mise à jour continue (une fois par image) à partir du véhicule écouté.
     * Moteur : la fréquence d'allumage vaut régime/60 × cylindres/2 (moteur
     * 4 temps) ; on joue le demi-ordre, l'ordre principal et un harmonique, le
     * filtre s'ouvre avec la charge. Vibreurs : grondement basse fréquence.
     */
    mettreAJour(v, enJeu) {
      if (!ctx || ctx.state !== 'running') return
      const t = ctx.currentTime
      const mo = v.spec.moteur
      const allumage = (Math.max(v.regime, mo.ralenti) / 60) * (mo.cylindres / 2)
      const charge = v.passage > 0 ? 0 : v.cmdGaz
      const regime = Math.min(1, v.regime / mo.regimeMax)
      oscs[0].frequency.setTargetAtTime(allumage * 0.5, t, 0.02)
      oscs[1].frequency.setTargetAtTime(allumage, t, 0.02)
      oscs[2].frequency.setTargetAtTime(allumage * 1.5, t, 0.02)
      filtreMoteur.frequency.setTargetAtTime(300 + regime * 2600 + charge * 1400, t, 0.04)
      gainMoteur.gain.setTargetAtTime(enJeu ? 0.05 + charge * 0.09 + regime * 0.04 : 0, t, 0.05)
      const vit = Math.min(1, Math.abs(v.vx) / 80)
      gainCrissement.gain.setTargetAtTime(enJeu ? v.glisse * (1 - v.horsPiste) * 0.16 : 0, t, 0.05)
      gainVent.gain.setTargetAtTime(enJeu ? vit * vit * 0.22 : 0, t, 0.1)
      const surface = Math.max(v.horsPiste * Math.min(1, Math.abs(v.vx) / 20) * 0.7, v.vibration * 0.55)
      gainHerbe.gain.setTargetAtTime(enJeu ? surface : 0, t, 0.04)
      // Passage de rapport : petite détonation à l'échappement.
      if (enJeu && v.rapport !== rapportPrec && v.rapport > 1 && v.rapport > rapportPrec) {
        const src = bruit(0.08), f = ctx.createBiquadFilter(), g = ctx.createGain()
        f.type = 'bandpass'; f.frequency.value = 180 + regime * 200; f.Q.value = 1.2
        g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
        src.connect(f).connect(g).connect(maitre); src.start(t); src.stop(t + 0.1)
      }
      rapportPrec = v.rapport
      rythmer()
    },
    bip(freq, duree) {
      if (!ctx || ctx.state !== 'running') return
      note(maitre, 'square', freq, ctx.currentTime, duree, 0.22, 3000)
    },
    choc(intensite) {
      if (!ctx || ctx.state !== 'running') return
      const t = ctx.currentTime
      const src = bruit(0.25)
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500
      const g = ctx.createGain()
      g.gain.setValueAtTime(Math.min(0.8, 0.15 + intensite * 0.1), t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
      src.connect(f).connect(g).connect(maitre); src.start(t); src.stop(t + 0.26)
    },
    /** Coupe / rétablit tout le son ; renvoie le nouvel état. */
    basculerMuet() {
      coupe = !coupe
      if (maitre) maitre.gain.setTargetAtTime(coupe ? 0 : 0.8, ctx.currentTime, 0.02)
      return coupe
    },
    definirMusique(active) { musiqueActive = active },
    suspendre() { if (ctx && ctx.state === 'running') ctx.suspend() },
    reprendre() { if (ctx && ctx.state === 'suspended') ctx.resume() },
    liberer() { if (ctx) ctx.close() }
  }
}
