// =============================================================================
// Chronos de référence : `npm run chronos`
// Meilleur tour du pilote IA le plus rapide (niveau « difficile ») sur chaque
// circuit célèbre, pour chaque voiture. Sortie : tableau Markdown.
// =============================================================================
import { CIRCUITS_CELEBRES, construireCircuitReel } from '../app/game/core/circuits-reels.js'
import { Course } from '../app/game/core/course.js'
import { EnregistreurFantome } from '../app/game/core/fantome.js'
import { MODELES } from '../app/game/core/course.js'
import { SPECS } from '../app/game/core/modeles.js'

const fmt = (t) => { const c = Math.round(t * 100); return `${Math.floor(c / 6000)}:${((c % 6000) / 100).toFixed(2).padStart(5, '0')}` }
console.log(`| Circuit | ${MODELES.map((m) => SPECS[m].nom).join(' | ')} | Vitesse max (F1) |`)
console.log(`| --- | ${MODELES.map(() => '---').join(' | ')} | --- |`)
for (const { id, nom } of CIRCUITS_CELEBRES) {
  const c = construireCircuitReel(id)
  const cellules = []
  let vmax = 0
  for (const modele of MODELES) {
    const course = new Course({ circuit: c, tours: 2, modeleJoueur: modele, difficulte: 'difficile', enregistreur: new EnregistreurFantome() })
    course.demarrer()
    let pas = 0
    while (!course.vehicules.every((v) => v.fini) && pas++ < 120 * 900) {
      course.pas(1 / 120, { autopilote: true })
      if (modele === 'f1') for (const v of course.vehicules) vmax = Math.max(vmax, v.vx)
    }
    cellules.push(fmt(Math.min(...course.vehicules.map((v) => v.meilleurTour))))
  }
  console.log(`| ${nom} | ${cellules.join(' | ')} | ${Math.round(vmax * 3.6)} km/h |`)
}
