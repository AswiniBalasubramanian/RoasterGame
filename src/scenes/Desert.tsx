import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Environment, Lightformer } from '@react-three/drei'

/** Direction (xz) of the warm glow left on the horizon after sunset. */
export const GLOW_DIR = new THREE.Vector3(-0.42, 0, 1).normalize()
export const FOG = '#120c0b'

/* ------------------------------------------------------------------ sky */

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main(){
    vDir = normalize(position);
    // rotation-only view: the dome always surrounds the camera, drawn at the far plane
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = p.xyww;
  }`

const skyFrag = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uGlowDir; uniform float uTime; uniform float uSpace;

  float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
  }
  float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.07; a*=.5; } return s; }

  float stars(vec3 d, float scale, float thresh){
    vec3 q = d * scale;
    vec3 c = floor(q);
    float r = hash(c);
    if (r < thresh) return 0.0;
    vec3 o = vec3(hash(c+1.7), hash(c+3.1), hash(c+5.3)) * 0.6 + 0.2;
    float dist = length(fract(q) - o);
    float tw = 0.75 + 0.25 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
    return smoothstep(0.16, 0.0, dist) * (r - thresh) / (1.0 - thresh) * tw;
  }

  void main(){
    vec3 d = normalize(vDir);
    float h = d.y;

    // night gradient
    vec3 zenith = vec3(0.006, 0.009, 0.022);
    vec3 horizon = vec3(0.03, 0.022, 0.03);
    vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.55, h));
    col = mix(col, vec3(0.002, 0.003, 0.008), uSpace);
    float ground = 1.0 - uSpace; // the desert horizon only exists on the ground

    // warm afterglow low on one side of the horizon
    vec2 dz = normalize(d.xz + 1e-5);
    float az = max(dot(dz, normalize(uGlowDir.xz)), 0.0);
    float lowH = exp(-max(h, 0.0) * 9.0);
    col += vec3(0.55, 0.22, 0.10) * pow(az, 5.0) * exp(-max(h, 0.0) * 14.0) * 0.42 * ground;
    col += vec3(0.30, 0.10, 0.06) * pow(az, 2.0) * exp(-max(h, 0.0) * 6.0) * 0.08 * ground;

    // milky way: a tilted band with mottled clouds and a dark dust lane
    vec3 N = normalize(vec3(0.85, 0.35, 0.4));
    float bd = dot(d, N);
    float band = exp(-bd * bd * 22.0);
    float cloud = fbm(d * 7.0 + 2.0);
    float fine = fbm(d * 24.0);
    float lane = exp(-pow(bd - 0.025 + (cloud - 0.5) * 0.05, 2.0) * 900.0);
    float mw = band * smoothstep(0.3, 0.85, cloud) * (0.5 + fine * 0.7) * (1.0 - lane * 0.8);
    col += mix(vec3(0.14, 0.14, 0.2), vec3(0.3, 0.25, 0.22), cloud) * mw * (0.22 + uSpace * 0.3) * mix(smoothstep(0.02, 0.3, h), 1.0, uSpace);

    // stars, denser inside the band
    float s = stars(d, 420.0, 0.982 - band * 0.03) * 2.2 + stars(d, 170.0, 0.993) * 3.2 + stars(d, 900.0, 0.965 - band * 0.06) * 0.9;
    col += vec3(0.95, 0.96, 1.0) * s * (1.0 + uSpace * 0.6) * mix(smoothstep(-0.01, 0.12, h), 1.0, uSpace);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`

/** `space` 0..1 fades the desert dusk into open space (no horizon glow, more stars). */
export function Sky({ space }: { space?: MutableRefObject<number> }) {
  const uniforms = useMemo(() => ({ uGlowDir: { value: GLOW_DIR.clone() }, uTime: { value: 0 }, uSpace: { value: 0 } }), [])
  useFrame((_, dt) => {
    uniforms.uTime.value += dt
    uniforms.uSpace.value = space?.current ?? 0
  })
  return (
    <mesh frustumCulled={false} renderOrder={-10}>
      <sphereGeometry args={[1, 64, 32]} />
      <shaderMaterial vertexShader={skyVert} fragmentShader={skyFrag} uniforms={uniforms} side={THREE.BackSide} depthWrite={false} fog={false} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ ground */

function noiseTexture(size: number, rough: number) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const x = c.getContext('2d')!
  const img = x.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (Math.random() - 0.5) * 255 * rough
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  x.putImageData(img, 0, 0)
  // a few soft blotches so the dust isn't uniform
  for (let k = 0; k < 40; k++) {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 1)
    const a = Math.random() * 0.12
    g.addColorStop(0, `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.save()
    x.translate(Math.random() * size, Math.random() * size)
    x.scale(20 + Math.random() * 60, 20 + Math.random() * 60)
    x.fillStyle = g
    x.fillRect(-1, -1, 2, 2)
    x.restore()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  return t
}

export function Ground() {
  const { map, bump } = useMemo(() => {
    const map = noiseTexture(512, 0.35)
    map.colorSpace = THREE.SRGBColorSpace
    map.repeat.set(70, 70)
    const bump = noiseTexture(256, 1)
    bump.repeat.set(260, 260)
    return { map, bump }
  }, [])
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[900, 96]} />
      <meshStandardMaterial color="#2c2724" map={map} bumpMap={bump} bumpScale={0.5} roughness={1} metalness={0} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ mountains */

function ridge(radius: number, height: number, seed: number, segs = 320) {
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const n =
      Math.sin(a * 3 + seed) * 0.35 + Math.sin(a * 7.3 + seed * 2.1) * 0.25 + Math.sin(a * 17.1 + seed * 0.7) * 0.12 +
      Math.sin(a * 41 + seed * 3.3) * 0.05
    const hgt = Math.max(0.08, 0.5 + n) * height
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius
    pos.push(x, -2, z, x, hgt, z)
    if (i < segs) {
      const b = i * 2
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

export function Mountains() {
  const layers = useMemo(
    () => [
      { g: ridge(520, 46, 1.3), c: '#0e0b0c' },
      { g: ridge(380, 30, 4.1), c: '#0a0809' },
      { g: ridge(260, 16, 7.7), c: '#070606' },
    ],
    [],
  )
  return (
    <group>
      {layers.map((l, i) => (
        <mesh key={i} geometry={l.g}>
          <meshBasicMaterial color={l.c} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ dust */

/** Fine dust hanging in the air around the car, drifting with a light breeze. */
let dotTex: THREE.Texture | null = null
function dot() {
  if (dotTex) return dotTex
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, '#fff'); g.addColorStop(0.35, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 64, 64)
  dotTex = new THREE.CanvasTexture(c)
  return dotTex
}

export function AirDust({ count = 900 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null)
  const geo = useMemo(() => {
    const p = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 40
      p[i * 3 + 1] = Math.random() * 6
      p[i * 3 + 2] = (Math.random() - 0.5) * 40
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(p, 3))
    return g
  }, [count])
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const a = geo.attributes.position as THREE.BufferAttribute
    const arr = a.array as Float32Array
    for (let i = 0; i < count; i++) {
      arr[i * 3] += dt * 0.35
      arr[i * 3 + 1] += Math.sin(performance.now() * 0.0004 + i) * dt * 0.05
      if (arr[i * 3] > 20) arr[i * 3] = -20
    }
    a.needsUpdate = true
  })
  return (
    <points ref={ref} geometry={geo} frustumCulled={false}>
      <pointsMaterial size={0.05} map={dot()} sizeAttenuation color="#d9b89a" transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

/** Dust blown outward along the ground by the downward thrusters. `strength` 0..1, `origin` follows the car. */
export function ThrustDust({ strength, origin, count = 420 }: { strength: MutableRefObject<number>; origin: MutableRefObject<THREE.Vector3>; count?: number }) {
  const data = useMemo(
    () => Array.from({ length: count }, () => ({ a: Math.random() * Math.PI * 2, life: Math.random(), speed: 0.35 + Math.random() * 0.6, up: 0.15 + Math.random() * 0.6 })),
    [count],
  )
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    return g
  }, [count])
  const base = useMemo(() => new THREE.Color('#c9a888'), [])
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const s = strength.current
    const o = origin.current
    const pos = geo.attributes.position.array as Float32Array
    const col = geo.attributes.color.array as Float32Array
    data.forEach((d, i) => {
      d.life += dt * d.speed * (0.4 + s)
      if (d.life > 1) { d.life = 0; d.a = Math.random() * Math.PI * 2 }
      const r = 1.1 + d.life * 4.2
      pos[i * 3] = o.x + Math.cos(d.a) * r * 0.75
      pos[i * 3 + 1] = 0.04 + d.life * d.up
      pos[i * 3 + 2] = o.z + Math.sin(d.a) * r * 1.2
      const k = Math.sin(d.life * Math.PI) * s * 0.9
      col[i * 3] = base.r * k; col[i * 3 + 1] = base.g * k; col[i * 3 + 2] = base.b * k
    })
    geo.attributes.position.needsUpdate = true
    geo.attributes.color.needsUpdate = true
  })
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial size={0.2} map={dot()} sizeAttenuation vertexColors transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  )
}

/* ------------------------------------------------------------------ reflections */

/**
 * Environment map for the paint: the real night sky and warm horizon, plus the large soft sources
 * an automotive stage would use, so highlights run as long continuous bands along the body.
 * Rendered once; the dark ground disc keeps the lower body from mirroring a fake bright floor.
 */
export function DesertReflections({ intensity = 1 }: { intensity?: number }) {
  return (
    <Environment resolution={512} frames={1} environmentIntensity={intensity}>
      <Sky />
      {/* key: broad soft box overhead and slightly forward -> long hood and roof highlights */}
      <Lightformer form="rect" intensity={2.2} color="#dfe6ff" position={[2, 9, 4]} scale={[16, 6, 1]} rotation-x={Math.PI / 2} />
      {/* two long high strips -> the shoulder line highlight down each flank */}
      {[-1, 1].map((sx) => (
        <Lightformer key={sx} form="rect" intensity={1.1} color="#e8ecff" position={[sx * 9, 3.2, 0]} scale={[22, 0.9, 1]} rotation-y={sx * -Math.PI / 2} />
      ))}
      {/* warm horizon band where the sun went down */}
      <Lightformer form="rect" intensity={1.5} color="#ff9a5c" position={[GLOW_DIR.x * 14, 0.5, GLOW_DIR.z * 14]} scale={[26, 1.2, 1]} onUpdate={(o) => o.lookAt(0, 0.5, 0)} />
      <Lightformer form="rect" intensity={0.35} color="#ff7a4a" position={[-GLOW_DIR.x * 14, 0.4, -GLOW_DIR.z * 14]} scale={[30, 0.8, 1]} onUpdate={(o) => o.lookAt(0, 0.4, 0)} />
      {/* desert floor: dark warm, slightly lifted so the underbody isn't crushed to black */}
      <Lightformer form="circle" intensity={0.18} color="#3a2a22" position={[0, -1.5, 0]} scale={30} rotation-x={-Math.PI / 2} />
    </Environment>
  )
}
