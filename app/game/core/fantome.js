// =============================================================================
// MODULE : Fantôme (enregistrement et relecture du meilleur tour)
// -----------------------------------------------------------------------------
// Deux tampons pré-alloués : le tour en cours et le meilleur tour. Quand un
// nouveau record tombe, on ÉCHANGE simplement les références : aucune copie,
// aucune allocation pendant la course.
// Échantillon = [temps, x, y, z, lacet] (5 flottants).
// =============================================================================
const CHAMPS = 5

export class EnregistreurFantome {
  /** @param {number} capacite nombre maximal d'échantillons par tour */
  constructor(capacite = 36000) {
    this.capacite = capacite
    this.courant = new Float32Array(capacite * CHAMPS)
    this.meilleur = new Float32Array(capacite * CHAMPS)
    this.nbCourant = 0
    this.nbMeilleur = 0
    this.dureeMeilleur = Infinity
    this.curseur = 0 // indice de lecture mémorisé (le temps est monotone)
  }

  /** Oublie tout (changement de circuit). */
  reinitialiser() {
    this.nbCourant = 0
    this.nbMeilleur = 0
    this.dureeMeilleur = Infinity
    this.curseur = 0
  }

  /** Démarre l'enregistrement d'un nouveau tour. */
  debuterTour() {
    this.nbCourant = 0
  }

  /** Ajoute un échantillon au tour en cours (ignoré si le tampon est plein). */
  echantillonner(t, x, y, z, lacet) {
    if (this.nbCourant >= this.capacite) return
    const o = this.nbCourant * CHAMPS
    const buf = this.courant
    // Lacet « déroulé » : continu par rapport à l'échantillon précédent, pour
    // que l'interpolation ne fasse jamais un tour complet sur elle-même.
    if (this.nbCourant > 0) {
      const prec = buf[o - 1]
      while (lacet - prec > Math.PI) lacet -= 2 * Math.PI
      while (lacet - prec < -Math.PI) lacet += 2 * Math.PI
    }
    buf[o] = t; buf[o + 1] = x; buf[o + 2] = y; buf[o + 3] = z; buf[o + 4] = lacet
    this.nbCourant++
  }

  /** Le tour en cours devient le meilleur tour : échange des tampons. */
  validerCommeMeilleur(duree) {
    const tmp = this.meilleur
    this.meilleur = this.courant
    this.courant = tmp
    this.nbMeilleur = this.nbCourant
    this.nbCourant = 0
    this.dureeMeilleur = duree
    this.curseur = 0
  }

  get disponible() {
    return this.nbMeilleur > 1
  }

  /** Remet la lecture au début (nouveau tour du joueur). */
  rembobiner() {
    this.curseur = 0
  }

  /**
   * Lit la pose du fantôme au temps `t` (secondes depuis le début du tour),
   * interpolée linéairement entre les deux échantillons qui l'encadrent.
   * @returns {boolean} false si le fantôme a terminé son tour (à masquer)
   */
  lire(t, sortie) {
    const n = this.nbMeilleur
    if (n < 2) return false
    const buf = this.meilleur
    if (t > buf[(n - 1) * CHAMPS] + 0.25) return false
    let i = this.curseur
    if (i > n - 2 || buf[i * CHAMPS] > t) i = 0
    while (i < n - 2 && buf[(i + 1) * CHAMPS] <= t) i++
    this.curseur = i
    const o = i * CHAMPS
    const t0 = buf[o], t1 = buf[o + CHAMPS]
    let f = t1 > t0 ? (t - t0) / (t1 - t0) : 0
    f = f < 0 ? 0 : f > 1 ? 1 : f
    sortie.x = buf[o + 1] + (buf[o + 6] - buf[o + 1]) * f
    sortie.y = buf[o + 2] + (buf[o + 7] - buf[o + 2]) * f
    sortie.z = buf[o + 3] + (buf[o + 8] - buf[o + 3]) * f
    sortie.lacet = buf[o + 4] + (buf[o + 9] - buf[o + 4]) * f
    return true
  }
}
