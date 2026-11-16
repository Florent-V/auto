// =============================================================================
// MODULE : Scène 3D — moteur de rendu, ciel, lumières, post-traitement
// -----------------------------------------------------------------------------
// Ambiance « crépuscule néon » : ciel en dégradé calculé par shader, soleil
// rayé à l'horizon, étoiles, brouillard, bloom sur tout ce qui est émissif
// (phares, feux, barrières lumineuses) et une passe finale vignettage +
// aberration chromatique proportionnelle à la vitesse.
// =============================================================================
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'

/** Direction du soleil visible dans le ciel (bas sur l'horizon). */
export const DIRECTION_SOLEIL = new THREE.Vector3(-0.55, 0.11, -0.83).normalize()
/** Direction de l'éclairage (un peu plus haute pour des ombres lisibles). */
const DIRECTION_LUMIERE = new THREE.Vector3(-0.55, 0.42, -0.83).normalize()
const COULEUR_BRUME = 0x3a1a4e

// --- Shader du ciel ----------------------------------------------------------
const CIEL_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // toujours au fond de la scène
  }`
const CIEL_FRAGMENT = /* glsl */ `
  uniform vec3 uSoleil;
  uniform float uTemps;
  varying vec3 vDir;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Dégradé vertical : horizon orangé → magenta → indigo profond.
    vec3 horizon = vec3(1.0, 0.42, 0.22);
    vec3 milieu = vec3(0.62, 0.12, 0.48);
    vec3 zenith = vec3(0.035, 0.03, 0.14);
    vec3 col = mix(horizon, milieu, smoothstep(-0.02, 0.16, h));
    col = mix(col, zenith, smoothstep(0.1, 0.62, h));
    // Sous l'horizon : brume sombre (raccord avec le brouillard de la scène).
    col = mix(col, vec3(0.23, 0.10, 0.31), smoothstep(0.0, -0.08, h));
    // Halo et disque solaire avec bandes horizontales façon « synthwave ».
    float cosA = dot(d, normalize(uSoleil));
    col += vec3(1.0, 0.45, 0.25) * pow(max(cosA, 0.0), 14.0) * 0.55;
    float disque = smoothstep(0.9871, 0.9884, cosA);
    float bandes = smoothstep(0.35, 0.5, abs(fract((d.y - uSoleil.y) * 34.0 - 0.15) - 0.5) * 2.0);
    float masque = mix(1.0, bandes, smoothstep(0.035, -0.06, d.y - uSoleil.y));
    vec3 solaire = mix(vec3(1.9, 0.4, 0.55), vec3(2.3, 1.6, 0.6), smoothstep(-0.1, 0.12, d.y - uSoleil.y));
    col = mix(col, solaire, disque * masque * step(0.0, h));
    // Étoiles scintillantes en altitude.
    vec3 g = floor(d * 190.0);
    float e = step(0.9972, hash(g));
    float scint = 0.6 + 0.4 * sin(uTemps * 2.0 + hash(g + 3.0) * 40.0);
    col += vec3(0.9, 0.95, 1.4) * e * scint * smoothstep(0.12, 0.5, h) * 1.6;
    gl_FragColor = vec4(col, 1.0);
  }`

// --- Passe finale : vignettage + aberration chromatique liée à la vitesse ----
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
      vec2 dec = c * r2 * (0.012 + 0.05 * uVitesse + 0.08 * uChoc);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + dec).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - dec).b;
      col *= 1.0 - r2 * (0.75 + 0.5 * uVitesse);
      col += vec3(0.5, 0.05, 0.1) * uChoc * r2;
      gl_FragColor = vec4(col, 1.0);
    }`
}

/**
 * Crée le moteur de rendu complet.
 * @param {HTMLCanvasElement} canvas
 */
export function creerScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(COULEUR_BRUME, 0.0021)
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000)

  // --- Ciel -----------------------------------------------------------------
  const matCiel = new THREE.ShaderMaterial({
    uniforms: { uSoleil: { value: DIRECTION_SOLEIL }, uTemps: { value: 0 } },
    vertexShader: CIEL_VERTEX, fragmentShader: CIEL_FRAGMENT,
    side: THREE.BackSide, depthWrite: false, fog: false
  })
  const ciel = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), matCiel)
  ciel.frustumCulled = false
  ciel.renderOrder = -10
  scene.add(ciel)

  // Carte d'environnement dérivée du ciel : reflets sur les carrosseries.
  const pmrem = new THREE.PMREMGenerator(renderer)
  const sceneCiel = new THREE.Scene()
  sceneCiel.add(new THREE.Mesh(ciel.geometry, matCiel))
  const cibleEnv = pmrem.fromScene(sceneCiel, 0.02)
  scene.environment = cibleEnv.texture
  scene.environmentIntensity = 0.55
  pmrem.dispose()

  // --- Lumières ---------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x9a7cff, 0x24122e, 1.3))
  const soleil = new THREE.DirectionalLight(0xffa573, 2.0)
  soleil.castShadow = true
  soleil.shadow.mapSize.set(2048, 2048)
  const oc = soleil.shadow.camera
  oc.left = -55; oc.right = 55; oc.top = 55; oc.bottom = -55; oc.near = 1; oc.far = 320
  soleil.shadow.bias = -0.0006
  soleil.shadow.normalBias = 0.04
  scene.add(soleil, soleil.target)

  // --- Post-traitement --------------------------------------------------------
  const cible = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, cible)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.6, 0.7, 1.2)
  composer.addPass(bloom)
  const finale = new ShaderPass(PASSE_FINALE)
  composer.addPass(finale)
  composer.addPass(new OutputPass())

  let largeur = 1, hauteur = 1, ratio = 1

  return {
    renderer, scene, camera, soleil, finale,
    /** Adapte le rendu à la taille de la fenêtre et au pixel ratio demandé. */
    redimensionner(l, h, pixelRatio) {
      largeur = l; hauteur = h; ratio = pixelRatio
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(l, h, false)
      composer.setPixelRatio(pixelRatio)
      composer.setSize(l, h)
      camera.aspect = l / h
      camera.updateProjectionMatrix()
    },
    get pixelRatio() { return ratio },
    /** L'ombre portée suit le point d'intérêt (frustum d'ombre réduit = net). */
    suivre(x, y, z) {
      soleil.target.position.set(x, y, z)
      soleil.position.set(x + DIRECTION_LUMIERE.x * 150, y + DIRECTION_LUMIERE.y * 150, z + DIRECTION_LUMIERE.z * 150)
    },
    rendre(temps, vitesseNorm, choc) {
      ciel.position.copy(camera.position)
      matCiel.uniforms.uTemps.value = temps
      finale.uniforms.uVitesse.value = vitesseNorm
      finale.uniforms.uChoc.value = choc
      composer.render()
    },
    liberer() {
      composer.dispose(); cible.dispose(); cibleEnv.dispose()
      ciel.geometry.dispose(); matCiel.dispose()
      renderer.dispose()
    }
  }
}
