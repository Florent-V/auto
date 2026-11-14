// =============================================================================
// MODULE : Caméra
// -----------------------------------------------------------------------------
// - Poursuite : placée derrière le véhicule, lissée par amortissement
//   exponentiel (indépendant de la fréquence d'affichage) ; elle recule,
//   s'élève et élargit son champ à mesure que la vitesse augmente.
// - Orbite : plans de présentation (menu, décompte, fin de course).
// Tous les vecteurs de travail sont pré-alloués.
// =============================================================================
import * as THREE from 'three'

const _cible = new THREE.Vector3()
const _regard = new THREE.Vector3()

export function creerCamera(camera) {
  let lacetCam = 0, initialise = false, fov = 62, angleOrbite = 0
  let enOrbite = false, tauxOrbite = 2
  const regardLisse = new THREE.Vector3()

  const amortir = (taux, dt) => 1 - Math.exp(-taux * dt)

  return {
    /** Recale immédiatement la caméra (changement de circuit, nouveau départ). */
    recaler() { initialise = false },

    /**
     * Caméra de poursuite.
     * @param {number} x,y,z,lacet pose interpolée du véhicule
     * @param {number} vitesse m/s
     * @param {number} derive angle de dérive (la caméra suit en partie la trajectoire réelle)
     * @param {number} secousse intensité 0..1 (hors-piste, chocs)
     */
    poursuivre(dt, x, y, z, lacet, vitesse, derive, secousse) {
      enOrbite = false
      const v = Math.max(0, vitesse)
      const lacetVise = lacet + derive * 0.45
      if (!initialise) { lacetCam = lacetVise }
      let ecart = lacetVise - lacetCam
      while (ecart > Math.PI) ecart -= 2 * Math.PI
      while (ecart < -Math.PI) ecart += 2 * Math.PI
      lacetCam += ecart * amortir(4.5, dt)
      // Recul et hauteur croissants avec la vitesse.
      const recul = 6.2 + v * 0.05
      const hauteur = 2.5 + v * 0.012
      _cible.set(x - Math.sin(lacetCam) * recul, y + hauteur, z - Math.cos(lacetCam) * recul)
      _regard.set(x + Math.sin(lacet) * (3 + v * 0.06), y + 1.1, z + Math.cos(lacet) * (3 + v * 0.06))
      if (!initialise) {
        camera.position.copy(_cible); regardLisse.copy(_regard); initialise = true
      } else {
        camera.position.lerp(_cible, amortir(9, dt))
        regardLisse.lerp(_regard, amortir(12, dt))
      }
      if (secousse > 0.01) {
        camera.position.x += (Math.random() - 0.5) * secousse * 0.18
        camera.position.y += (Math.random() - 0.5) * secousse * 0.14
      }
      camera.lookAt(regardLisse)
      // Champ de vision : effet de vitesse.
      const rapport = Math.min(1, v / 72)
      const fovVise = 60 + 24 * rapport * rapport
      fov += (fovVise - fov) * amortir(3, dt)
      if (Math.abs(camera.fov - fov) > 0.02) { camera.fov = fov; camera.updateProjectionMatrix() }
    },

    /**
     * Orbite autour d'un sujet (plans de présentation). Le sujet pouvant rouler
     * vite, la caméra lui est liée rigidement ; seul le raccord avec le plan
     * précédent est adouci (taux de rattrapage qui croît rapidement).
     */
    orbiter(dt, x, y, z, rayon, hauteur, vitesseAngulaire) {
      if (!enOrbite) { enOrbite = true; tauxOrbite = 2 }
      tauxOrbite = Math.min(60, tauxOrbite + 25 * dt)
      angleOrbite += vitesseAngulaire * dt
      _cible.set(x + Math.sin(angleOrbite) * rayon, y + hauteur, z + Math.cos(angleOrbite) * rayon)
      _regard.set(x, y + 0.8, z)
      if (!initialise) {
        camera.position.copy(_cible); regardLisse.copy(_regard); initialise = true
      } else {
        camera.position.lerp(_cible, amortir(tauxOrbite, dt))
        regardLisse.lerp(_regard, amortir(tauxOrbite * 1.5, dt))
      }
      camera.lookAt(regardLisse)
      fov += (52 - fov) * amortir(3, dt)
      if (Math.abs(camera.fov - fov) > 0.02) { camera.fov = fov; camera.updateProjectionMatrix() }
      lacetCam = Math.atan2(x - camera.position.x, z - camera.position.z)
    },
    /** Place l'angle d'orbite (ex. face au véhicule au début du décompte). */
    definirAngle(a) { angleOrbite = a }
  }
}
