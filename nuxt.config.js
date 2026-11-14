// Configuration Nuxt : application 100 % cliente (le jeu vit dans un canvas
// WebGL), servie par le serveur Nitro embarqué dans l'image Docker.
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  ssr: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  colorMode: { preference: 'dark', fallback: 'dark' },
  // Polices et icônes embarquées dans le bundle : aucune requête externe à
  // l'exécution ni pendant le build Docker (fonctionne hors ligne).
  ui: { fonts: false },
  icon: { clientBundle: { scan: true }, fallbackToApi: false },
  app: {
    head: {
      title: 'NEON APEX — course procédurale',
      htmlAttrs: { lang: 'fr', class: 'dark' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Jeu de course procédural : circuit généré par seed, IA, fantôme, physique maison.' },
        { name: 'theme-color', content: '#07060f' }
      ]
    }
  },
  vite: {
    // Three.js est volumineux : on le pré-bundle pour un démarrage rapide en dev.
    optimizeDeps: { include: ['three'] }
  }
})
