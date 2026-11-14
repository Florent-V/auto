// =============================================================================
// MODULE : Entrées clavier
// -----------------------------------------------------------------------------
// On lit `event.code` (position physique des touches) : WASD fonctionne donc
// tel quel sur un clavier AZERTY (ZQSD). Flèches et WASD sont équivalents.
// =============================================================================
const TOUCHES = {
  ArrowUp: 'gaz', KeyW: 'gaz',
  ArrowDown: 'frein', KeyS: 'frein',
  ArrowLeft: 'gauche', KeyA: 'gauche',
  ArrowRight: 'droite', KeyD: 'droite',
  Space: 'fam'
}
const ACTIONS = { KeyP: 'pause', Escape: 'pause', KeyR: 'replacer', KeyM: 'muet', Enter: 'valider', KeyC: 'camera' }

/**
 * @param {(action: string) => void} surAction appelé pour les touches ponctuelles
 */
export function creerEntrees(surAction) {
  const etat = { gaz: false, frein: false, gauche: false, droite: false, fam: false, autopilote: false, replacer: false }
  const dansChampDeSaisie = (e) => {
    const t = e.target
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  }
  const surAppui = (e) => {
    if (dansChampDeSaisie(e)) return
    const commande = TOUCHES[e.code]
    if (commande) { etat[commande] = true; e.preventDefault(); return }
    const action = ACTIONS[e.code]
    if (action && !e.repeat) {
      // Entrée sur un bouton focalisé : on laisse le navigateur gérer le clic.
      if (action === 'valider' && e.target && e.target.tagName === 'BUTTON') return
      surAction(action)
    }
  }
  const surRelache = (e) => {
    const commande = TOUCHES[e.code]
    if (commande) etat[commande] = false
  }
  const toutRelacher = () => { etat.gaz = etat.frein = etat.gauche = etat.droite = etat.fam = false }
  window.addEventListener('keydown', surAppui)
  window.addEventListener('keyup', surRelache)
  window.addEventListener('blur', toutRelacher)
  return {
    etat,
    liberer() {
      window.removeEventListener('keydown', surAppui)
      window.removeEventListener('keyup', surRelache)
      window.removeEventListener('blur', toutRelacher)
    }
  }
}
