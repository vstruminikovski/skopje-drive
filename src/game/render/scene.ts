// Renderer, camera, sky and light for the MapNG level.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  resize(): void;
  sky: THREE.Mesh;
}

export function createScene(canvasHost: HTMLElement): SceneKit {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  // Shadows are the costliest pass on phone GPUs: off on touch screens, on elsewhere.
  const touch = matchMedia('(pointer: coarse)').matches;
  renderer.shadowMap.enabled = !touch;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  canvasHost.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Late-afternoon sky gradient (the level's HDR cubemaps are not browser-readable).
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(600, 24, 12), // inside the far plane; follows the camera
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x6fa3d8) }, horizon: { value: new THREE.Color(0xf3dcb4) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float t = pow(clamp(vP.y*1.6,0.,1.),0.6); gl_FragColor = vec4(mix(horizon, top, t),1.); }',
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xe9dcc4, 260, 620); // distant haze hides the view edge
  // soft image-based light so glass and wet asphalt pick up reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x5b5040, 1.1));
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
  sun.position.set(-120, 160, 80);
  sun.castShadow = !touch;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 10;
  sc.far = 500;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03; // removes shadow acne on the flat asphalt
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 640); // the map is 1 km; nothing past ~600 m is drawn
  const resize = () => {
    const w = canvasHost.clientWidth || window.innerWidth;
    const h = canvasHost.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera, sun, resize, sky };
}

/** Shadow map texel size in metres (frustum 140 m over 2048 texels). */
const TEXEL = 140 / 2048;

/**
 * Keep the shadow frustum centred on the car, snapped to whole shadow texels so the
 * shadow edges don't shimmer as the car moves.
 */
export function followSun(sun: THREE.DirectionalLight, target: THREE.Vector3) {
  const x = Math.round(target.x / TEXEL) * TEXEL;
  const z = Math.round(target.z / TEXEL) * TEXEL;
  sun.target.position.set(x, target.y, z);
  sun.position.set(x - 120, target.y + 160, z + 80);
}
