// =============================================================================
// MODULE : Entrées — clavier et manette
// -----------------------------------------------------------------------------
// Clavier : on lit `event.code` (position physique des touches) : WASD
// fonctionne donc tel quel sur un clavier AZERTY (ZQSD). Flèches et WASD sont
// équivalents ; les commandes sont tout-ou-rien (la physique limite la vitesse
// de braquage et l'aide au contre-braquage compense).
// Manette (API Gamepad, disposition « standard ») : gâchettes analogiques pour
// gaz / frein, stick gauche pour la direction (zone morte + courbe de
// sensibilité), A frein à main, gâchettes hautes pour les rapports, Start pause.
// `lire()` est appelé une fois par image et remplit l'objet `etat` sans allocation.
// =============================================================================
const TOUCHES = {
  ArrowUp: 'gaz', KeyW: 'gaz',
  ArrowDown: 'frein', KeyS: 'frein',
  ArrowLeft: 'gauche', KeyA: 'gauche',
  ArrowRight: 'droite', KeyD: 'droite',
  Space: 'fam'
}
const ACTIONS = {
  KeyP: 'pause', Escape: 'pause', KeyR: 'replacer', KeyM: 'muet', Enter: 'valider',
  KeyC: 'camera', KeyT: 'telemetrie', KeyE: 'rapportPlus', KeyQ: 'rapportMoins'
}
const ZONE_MORTE = 0.08
/** Boutons ponctuels de la manette (disposition standard) → action. */
const BOUTONS = [[5, 'rapportPlus'], [4, 'rapportMoins'], [9, 'pause'], [3, 'camera'], [2, 'replacer'], [8, 'telemetrie']]

/**
 * @param {(action: string) => void} surAction appelé pour les touches ponctuelles
 */
export function creerEntrees(surAction) {
  const touches = { gaz: false, frein: false, gauche: false, droite: false, fam: false }
  /** État lu par la simulation (valeurs analogiques). */
  const etat = { gaz: 0, frein: 0, direction: 0, fam: false, passage: 0, autopilote: false, replacer: false, manette: false }
  const boutonsPrec = new Uint8Array(20)
  let manetteActive = false

  const dansChampDeSaisie = (e) => {
    const t = e.target
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  }
  const action = (nom) => {
    if (nom === 'rapportPlus') etat.passage = 1
    else if (nom === 'rapportMoins') etat.passage = -1
    else surAction(nom)
  }
  const surAppui = (e) => {
    if (dansChampDeSaisie(e)) return
    const commande = TOUCHES[e.code]
    if (commande) { touches[commande] = true; manetteActive = false; e.preventDefault(); return }
    const nom = ACTIONS[e.code]
    if (nom && !e.repeat) {
      if (nom === 'valider' && e.target && e.target.tagName === 'BUTTON') return
      action(nom)
    }
  }
  const surRelache = (e) => {
    const commande = TOUCHES[e.code]
    if (commande) touches[commande] = false
  }
  const toutRelacher = () => { touches.gaz = touches.frein = touches.gauche = touches.droite = touches.fam = false }
  window.addEventListener('keydown', surAppui)
  window.addEventListener('keyup', surRelache)
  window.addEventListener('blur', toutRelacher)

  /** Courbe de sensibilité du stick : précise au centre, franche en butée. */
  const courbe = (x) => {
    const a = Math.abs(x)
    if (a < ZONE_MORTE) return 0
    const t = (a - ZONE_MORTE) / (1 - ZONE_MORTE)
    return Math.sign(x) * (0.35 * t + 0.65 * t * t * t)
  }

  return {
    etat,
    /** Fusionne clavier et manette dans `etat` (à appeler à chaque image). */
    lire() {
      let gaz = touches.gaz ? 1 : 0, frein = touches.frein ? 1 : 0
      let direction = (touches.gauche ? 1 : 0) - (touches.droite ? 1 : 0)
      let fam = touches.fam
      const manettes = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null
      const m = manettes && (manettes[0] || manettes[1] || manettes[2] || manettes[3])
      if (m && m.connected) {
        const b = m.buttons
        const val = (i) => (b[i] ? b[i].value : 0)
        const appuye = (i) => (b[i] ? b[i].pressed : false)
        const rt = val(7), lt = val(6), stick = m.axes[0] || 0
        if (rt > 0.02 || lt > 0.02 || Math.abs(stick) > ZONE_MORTE) manetteActive = true
        if (manetteActive) {
          gaz = Math.max(gaz, rt)
          frein = Math.max(frein, lt)
          if (direction === 0) direction = -courbe(stick) // stick à gauche → braquage à gauche (> 0)
          fam = fam || appuye(0)
        }
        // Boutons ponctuels (front montant).
        for (let k = 0; k < BOUTONS.length; k++) {
          const i = BOUTONS[k][0], nom = BOUTONS[k][1]
          const p = appuye(i) ? 1 : 0
          if (p && !boutonsPrec[i]) action(nom)
          boutonsPrec[i] = p
        }
      }
      etat.gaz = gaz; etat.frein = frein; etat.direction = direction; etat.fam = fam
      etat.manette = manetteActive
    },
    liberer() {
      window.removeEventListener('keydown', surAppui)
      window.removeEventListener('keyup', surRelache)
      window.removeEventListener('blur', toutRelacher)
    }
  }
}
