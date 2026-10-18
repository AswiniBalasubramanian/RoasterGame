import { useEffect, useMemo, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Cold-gas vapour from the lift modules: soft, turbulent puffs that pour out, billow, slow down,
 * roll outward across the ground and dissipate. Simulated in world space so the cloud stays
 * behind when the car moves. One Points draw call; each point is a rotated, noise-textured blob.
 */

let smokeTex: THREE.Texture | null = null
function smoke() {
  if (smokeTex) return smokeTex
  const n = 128
  const c = document.createElement('canvas'); c.width = c.height = n
  const x = c.getContext('2d')!
  const img = x.createImageData(n, n)
  // value noise, a few octaves, shaped by a soft radial falloff -> cauliflower edge, dense core
  const h = (i: number, j: number) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s) }
  const vn = (u: number, v: number) => {
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j
    const a = h(i, j), b = h(i + 1, j), c2 = h(i, j + 1), d = h(i + 1, j + 1)
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv)
    return a + (b - a) * su + (c2 - a) * sv + (a - b - c2 + d) * su * sv
  }
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    const u = px / n, v = py / n
    let f = 0, amp = 0.5, fr = 4
    for (let o = 0; o < 5; o++) { f += amp * vn(u * fr + 7, v * fr + 3); amp *= 0.5; fr *= 2 }
    const r = Math.hypot(u - 0.5, v - 0.5) * 2
    const a = Math.max(0, Math.min(1, (1 - r) * 1.6 - (1 - f) * 0.9))
    const k = (py * n + px) * 4
    const shade = 200 + f * 55
    img.data[k] = img.data[k + 1] = img.data[k + 2] = shade
    img.data[k + 3] = Math.pow(a, 1.3) * 255
  }
  x.putImageData(img, 0, 0)
  smokeTex = new THREE.CanvasTexture(c)
  smokeTex.colorSpace = THREE.SRGBColorSpace
  return smokeTex
}

const vert = /* glsl */ `
  attribute float aSize; attribute float aAlpha; attribute float aRot; attribute float aLight;
  varying float vAlpha; varying float vRot; varying float vLight;
  uniform float uScale;
  void main(){
    vAlpha = aAlpha; vRot = aRot; vLight = aLight;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`
const frag = /* glsl */ `
  uniform sampler2D uMap; uniform vec3 uCool; uniform vec3 uShadow;
  varying float vAlpha; varying float vRot; varying float vLight;
  void main(){
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    vec2 uv = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    vec4 t = texture2D(uMap, uv);
    // lit from the emitter above: bright cool top, denser darker underside
    float top = clamp(0.5 - p.y, 0.0, 1.0);
    vec3 col = mix(uShadow, uCool, clamp(vLight * (0.55 + top * 0.6), 0.0, 1.0)) * (0.75 + t.r * 0.35);
    gl_FragColor = vec4(col, t.a * vAlpha);
    #include <colorspace_fragment>
  }`

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; rot: number; spin: number; alive: boolean }

export function Gas({
  root, emitters, lift, groundY, count = 420,
}: {
  /** the car group: emitters are in its local space */
  root: MutableRefObject<THREE.Group | null>
  emitters: [number, number, number][]
  lift: () => number
  /** world height of the ground for the roll-out; omit in open space */
  groundY?: MutableRefObject<number>
  count?: number
}) {
  const { scene, size } = useThree()
  const parts = useMemo<P[]>(() => Array.from({ length: count }, () => ({ x: 0, y: -1e5, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0, rot: 0, spin: 0, alive: false })), [count])
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1))
    g.setAttribute('aRot', new THREE.BufferAttribute(new Float32Array(count), 1))
    g.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(count), 1))
    return g
  }, [count])
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      uniforms: { uMap: { value: smoke() }, uScale: { value: 400 }, uCool: { value: new THREE.Color('#dfe9f5') }, uShadow: { value: new THREE.Color('#3b3f47') } },
    }),
    [],
  )
  const points = useMemo(() => { const p = new THREE.Points(geo, mat); p.frustumCulled = false; p.renderOrder = 2; return p }, [geo, mat])
  const reduce = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const v = useMemo(() => new THREE.Vector3(), [])
  const acc = useMemo(() => ({ t: 0, next: 0 }), [])

  useEffect(() => {
    scene.add(points)
    return () => { scene.remove(points); geo.dispose(); mat.dispose() }
  }, [scene, points, geo, mat])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    mat.uniforms.uScale.value = size.height * 0.9
    const L = lift()
    const g = root.current
    // emission: a steady pour proportional to lift output
    if (g && L > 0.03) {
      g.updateMatrixWorld()
      acc.t += dt * L * (reduce ? 20 : 52)
      while (acc.t >= 1) {
        acc.t -= 1
        const p = parts[acc.next]
        acc.next = (acc.next + 1) % count
        const e = emitters[Math.floor(Math.random() * emitters.length)]
        v.set(e[0] + (Math.random() - 0.5) * 0.12, e[1], e[2] + (Math.random() - 0.5) * 0.12).applyMatrix4(g.matrixWorld)
        p.x = v.x; p.y = v.y; p.z = v.z
        const sp = 4.2 + L * 2.6
        p.vx = (Math.random() - 0.5) * 0.5; p.vy = -sp * (0.8 + Math.random() * 0.4); p.vz = (Math.random() - 0.5) * 0.5
        p.age = 0; p.life = 1.6 + Math.random() * 1.2
        p.size = 0.22 + Math.random() * 0.16
        p.rot = Math.random() * Math.PI * 2; p.spin = (Math.random() - 0.5) * 0.8
        p.alive = true
      }
    }
    const pos = geo.attributes.position.array as Float32Array
    const sz = geo.attributes.aSize.array as Float32Array
    const al = geo.attributes.aAlpha.array as Float32Array
    const ro = geo.attributes.aRot.array as Float32Array
    const li = geo.attributes.aLight.array as Float32Array
    const gy = groundY?.current
    const t = performance.now() * 0.001
    for (let i = 0; i < count; i++) {
      const p = parts[i]
      if (!p.alive) { al[i] = 0; continue }
      p.age += dt
      const k = p.age / p.life
      if (k >= 1) { p.alive = false; al[i] = 0; continue }
      // drag + gentle turbulence + slight buoyancy as the gas warms
      const drag = Math.exp(-dt * 1.3)
      p.vx = p.vx * drag + Math.sin(t * 1.7 + i) * 0.7 * dt
      p.vz = p.vz * drag + Math.cos(t * 1.3 + i * 0.7) * 0.7 * dt
      p.vy = p.vy * drag + 0.5 * dt
      // hitting the ground: the downward flow rolls outward
      if (gy !== undefined && p.y < gy + 0.25 && p.vy < 0) {
        const out = -p.vy * 1.1 + 0.6
        const a = Math.atan2(p.z - (g?.position.z ?? 0), p.x - (g?.position.x ?? 0)) + (Math.random() - 0.5) * 0.6
        p.vx += Math.cos(a) * out; p.vz += Math.sin(a) * out
        p.vy = 0
        p.y = gy + 0.25
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      p.rot += p.spin * dt
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z
      sz[i] = p.size + Math.pow(k, 0.6) * 2.4
      // thin, refined wisps: low density, fades in just below the emitter and out long before it reaches full size
      al[i] = Math.min(1, k * 5) * Math.pow(1 - k, 2.2) * 0.2
      ro[i] = p.rot
      li[i] = 1 - k * 0.7
    }
    geo.attributes.position.needsUpdate = true
    geo.attributes.aSize.needsUpdate = true
    geo.attributes.aAlpha.needsUpdate = true
    geo.attributes.aRot.needsUpdate = true
    geo.attributes.aLight.needsUpdate = true
  })
  return null
}
