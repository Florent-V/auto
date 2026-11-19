// =============================================================================
// MODULE : Scène 3D — moteur de rendu, ciel, ambiances, post-traitement
// -----------------------------------------------------------------------------
// Trois ambiances :
//  - jour       : ciel physique (diffusion de Rayleigh / Mie, modèle de
//                 Preetham) avec nuages, soleil haut, ombres franches ;
//  - crepuscule : soleil rasant, lumière orangée, longues ombres ;
//  - nuit       : ciel étoilé et lune, éclairage par les mâts d'éclairage du
//                 circuit (voir decor.js), phares des voitures.
// L'environnement (reflets des carrosseries) est recalculé à partir du ciel à
// chaque changement d'ambiance (PMREM). Post-traitement : bloom (lumières),
// vignettage léger, tonemapping ACES.
// =============================================================================
import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/** Réglages de chaque ambiance (couleurs en sRGB). */
export const AMBIANCES = {
  jour: {
    soleil: { elevation: 48, azimut: 145, couleur: 0xfff1dc, intensite: 2.6 },
    ciel: { turbidity: 2.4, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.8, cloudCoverage: 0.32 },
    hemi: { ciel: 0xb4c8e6, sol: 0x4a5236, intensite: 0.55 },
    brouillard: { couleur: 0xa9bdd4, densite: 0.00026 },
    exposition: 0.5, bloom: 0, seuilBloom: 8, environnement: 0.28, nuit: 0
  },
  crepuscule: {
    soleil: { elevation: 4.5, azimut: 250, couleur: 0xffa463, intensite: 2.4 },
    ciel: { turbidity: 5.5, rayleigh: 2.6, mieCoefficient: 0.006, mieDirectionalG: 0.86, cloudCoverage: 0.42 },
    hemi: { ciel: 0x9a8cc4, sol: 0x3a2e28, intensite: 0.75 },
    brouillard: { couleur: 0xc79a86, densite: 0.00045 },
    exposition: 0.56, bloom: 0.18, seuilBloom: 6, environnement: 0.4, nuit: 0.35
  },
  nuit: {
    soleil: { elevation: 38, azimut: 210, couleur: 0x9fb6ff, intensite: 0.32 }, // clair de lune
    ciel: null,
    hemi: { ciel: 0x2a3a5c, sol: 0x0b0d10, intensite: 0.38 },
    brouillard: { couleur: 0x0d121d, densite: 0.0009 },
    exposition: 0.9, bloom: 0.45, seuilBloom: 1.5, environnement: 0.3, nuit: 1
  }
}

// --- Ciel de nuit : dégradé, étoiles, lune, halo urbain à l'horizon ----------
const NUIT_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w;
  }`
const NUIT_FRAGMENT = /* glsl */ `
  uniform vec3 uLune;
  uniform float uTemps;
  varying vec3 vDir;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(vec3(0.045, 0.06, 0.1), vec3(0.006, 0.01, 0.025), smoothstep(0.0, 0.55, h));
    // Halo des villes voisines à l'horizon.
    col += vec3(0.12, 0.08, 0.05) * pow(1.0 - abs(h), 14.0) * 0.6;
    col = mix(col, vec3(0.02, 0.025, 0.035), smoothstep(0.0, -0.1, h));
    // Étoiles (densité et éclat variables) + Voie lactée discrète.
    vec3 g = floor(d * 260.0);
    float e = step(0.9968, hash(g));
    float eclat = hash(g + 7.0);
    float scint = 0.75 + 0.25 * sin(uTemps * 3.0 + hash(g + 3.0) * 40.0);
    col += vec3(0.85, 0.9, 1.0) * e * eclat * scint * smoothstep(0.02, 0.3, h) * 1.4;
    float voie = exp(-pow(dot(d, normalize(vec3(0.3, 0.5, -0.8))) * 3.2, 2.0));
    col += vec3(0.05, 0.055, 0.07) * voie * smoothstep(0.05, 0.4, h);
    // Lune : disque + halo.
    float c = dot(d, normalize(uLune));
    col += vec3(0.5, 0.55, 0.65) * pow(max(c, 0.0), 220.0) * 0.4;
    col = mix(col, vec3(1.6, 1.6, 1.5), smoothstep(0.99955, 0.9997, c));
    gl_FragColor = vec4(col, 1.0);
  }`

// --- Passe finale : vignettage + légère aberration (vitesse, chocs) ----------
const PASSE_FINALE = {
  uniforms: { tDiffuse: { value: null }, uVitesse: { value: 0 }, uChoc: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVitesse;
    uniform float uChoc;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 dec = c * r2 * (0.004 + 0.012 * uVitesse + 0.05 * uChoc);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dec).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dec).b;
      col *= 1.0 - r2 * (0.42 + 0.25 * uVitesse);
      gl_FragColor = vec4(col, 1.0);
    }`
}

const _dir = new THREE.Vector3()

/**
 * Crée le moteur de rendu complet.
 * @param {HTMLCanvasElement} canvas
 */
export function creerScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0xbccbdc, 0.0003)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 9000)

  // --- Ciels ------------------------------------------------------------------
  const ciel = new Sky()
  ciel.scale.setScalar(8000)
  ciel.frustumCulled = false
  const matNuit = new THREE.ShaderMaterial({
    uniforms: { uLune: { value: new THREE.Vector3(0, 1, 0) }, uTemps: { value: 0 } },
    vertexShader: NUIT_VERTEX, fragmentShader: NUIT_FRAGMENT,
    side: THREE.BackSide, depthWrite: false, fog: false
  })
  const cielNuit = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), matNuit)
  cielNuit.frustumCulled = false
  cielNuit.renderOrder = -10
  scene.add(ciel, cielNuit)

  // --- Lumières ---------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xc4dcff, 0x55603f, 1)
  const soleil = new THREE.DirectionalLight(0xffffff, 3)
  soleil.castShadow = true
  soleil.shadow.mapSize.set(2048, 2048)
  const oc = soleil.shadow.camera
  oc.left = -70; oc.right = 70; oc.top = 70; oc.bottom = -70; oc.near = 1; oc.far = 500
  soleil.shadow.bias = -0.0004
  soleil.shadow.normalBias = 0.05
  scene.add(hemi, soleil, soleil.target)

  // --- Post-traitement --------------------------------------------------------
  const cible = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, cible)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.2, 0.6, 1.2)
  composer.addPass(bloom)
  const finale = new ShaderPass(PASSE_FINALE)
  composer.addPass(finale)
  composer.addPass(new OutputPass())

  // --- Environnement (reflets) recalculé par ambiance ---------------------------
  const pmrem = new THREE.PMREMGenerator(renderer)
  let cibleEnv = null
  function recalculerEnvironnement(nuit) {
    const sceneEnv = new THREE.Scene()
    if (nuit) sceneEnv.add(new THREE.Mesh(cielNuit.geometry, matNuit))
    else {
      const copie = new Sky()
      copie.scale.setScalar(80)
      copie.material.uniforms = THREE.UniformsUtils.clone(ciel.material.uniforms)
      copie.material.uniforms.cloudCoverage.value = 0 // pas de nuages dans les reflets (bruit)
      sceneEnv.add(copie)
      // Sol neutre sous l'horizon : reflets réalistes du bas de caisse.
      const sol = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0x3d4434 }))
      sol.rotation.x = -Math.PI / 2; sol.position.y = -2
      sceneEnv.add(sol)
    }
    const nouvelle = pmrem.fromScene(sceneEnv, 0.03)
    if (cibleEnv) cibleEnv.dispose()
    cibleEnv = nouvelle
    scene.environment = cibleEnv.texture
    sceneEnv.traverse((o) => { if (o.material && o !== cielNuit && o.material !== matNuit) o.material.dispose() })
  }

  let ambianceCourante = null
  const directionLumiere = new THREE.Vector3(0, 1, 0)

  const rendu = {
    renderer, scene, camera, soleil, hemi, finale,
    get ambiance() { return ambianceCourante },
    get facteurNuit() { return AMBIANCES[ambianceCourante]?.nuit ?? 0 },

    /** Applique une ambiance : ciel, lumières, brouillard, exposition, bloom. */
    appliquerAmbiance(nom) {
      const a = AMBIANCES[nom] ?? AMBIANCES.jour
      ambianceCourante = AMBIANCES[nom] ? nom : 'jour'
      const elev = THREE.MathUtils.degToRad(a.soleil.elevation)
      const azim = THREE.MathUtils.degToRad(a.soleil.azimut)
      _dir.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim))
      directionLumiere.copy(_dir)
      const nuit = !a.ciel
      ciel.visible = !nuit
      cielNuit.visible = nuit
      if (nuit) matNuit.uniforms.uLune.value.copy(_dir)
      else {
        const u = ciel.material.uniforms
        for (const [cle, valeur] of Object.entries(a.ciel)) u[cle].value = valeur
        u.sunPosition.value.copy(_dir)
      }
      soleil.color.set(a.soleil.couleur)
      soleil.intensity = a.soleil.intensite
      soleil.shadow.intensity = nuit ? 0.5 : 1
      hemi.color.set(a.hemi.ciel)
      hemi.groundColor.set(a.hemi.sol)
      hemi.intensity = a.hemi.intensite
      scene.fog.color.set(a.brouillard.couleur)
      scene.fog.density = a.brouillard.densite
      renderer.toneMappingExposure = a.exposition
      // Le ciel physique est très lumineux (HDR) : sans seuil élevé, le bloom
      // l'étalerait sur toute l'image. De jour, il est donc coupé.
      bloom.enabled = a.bloom > 0
      bloom.strength = a.bloom
      bloom.threshold = a.seuilBloom
      scene.environmentIntensity = a.environnement
      recalculerEnvironnement(nuit)
      return a
    },

    /** Adapte le rendu à la taille de la fenêtre et au pixel ratio demandé. */
    redimensionner(l, h, pixelRatio) {
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(l, h, false)
      composer.setPixelRatio(pixelRatio)
      composer.setSize(l, h)
      camera.aspect = l / h
      camera.updateProjectionMatrix()
    },

    /** L'ombre portée suit le point d'intérêt (frustum d'ombre réduit = net). */
    suivre(x, y, z) {
      soleil.target.position.set(x, y, z)
      soleil.position.set(x + directionLumiere.x * 250, y + directionLumiere.y * 250, z + directionLumiere.z * 250)
    },

    rendre(temps, vitesseNorm, choc) {
      cielNuit.position.copy(camera.position)
      ciel.position.copy(camera.position)
      matNuit.uniforms.uTemps.value = temps
      ciel.material.uniforms.time.value = temps
      finale.uniforms.uVitesse.value = vitesseNorm
      finale.uniforms.uChoc.value = choc
      composer.render()
    },

    liberer() {
      composer.dispose(); cible.dispose()
      if (cibleEnv) cibleEnv.dispose()
      pmrem.dispose()
      ciel.geometry.dispose(); ciel.material.dispose()
      cielNuit.geometry.dispose(); matNuit.dispose()
      renderer.dispose()
    }
  }
  rendu.appliquerAmbiance('jour')
  return rendu
}
