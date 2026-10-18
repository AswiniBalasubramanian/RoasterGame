import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { Car, newControl } from '../car/Car'
import { AirDust, DesertReflections, FOG, GLOW_DIR, Ground, Mountains, Sky, ThrustDust } from './Desert'
import { Planet } from './Planet'
import { PAINTS, useStore } from '../store'

const ease = (t: number) => t * t * (3 - 2 * t)
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t))

interface Key { pos: THREE.Vector3; look: THREE.Vector3; fov: number; shift: number }
const K: Key[] = [
  { pos: new THREE.Vector3(8.6, 1.5, 10.2), look: new THREE.Vector3(0.0, 2.45, 0.0), fov: 26, shift: -1.55 },
  { pos: new THREE.Vector3(-7.4, 1.35, 7.4), look: new THREE.Vector3(0, 2.25, 0.1), fov: 28, shift: 1.15 },
  { pos: new THREE.Vector3(-10.4, 1.6, -8.6), look: new THREE.Vector3(0, 2.35, -0.4), fov: 26, shift: -1.9 },
]

const HOVER = 2.4
/** sill nozzle positions in car space, for the light they throw on the ground */
const NOZZLE_POS = [[0.6, 0.85], [-0.6, 0.85], [0.6, -1.0], [-0.6, -1.0]].map(([x, z]) => new THREE.Vector3(x, 0, z))

let poolTex: THREE.Texture | null = null
function poolTexture() {
  if (poolTex) return poolTex
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 128, 128)
  poolTex = new THREE.CanvasTexture(c)
  return poolTex
}
/** metres climbed by the time the garage section is reached */
const CLIMB = 260

export function SiteScene() {
  const { camera } = useThree()
  const paintId = useStore((s) => s.paintId)
  const variantId = useStore((s) => s.variantId)
  const quality = useStore((s) => s.quality)
  const paint = PAINTS.find((p) => p.id === paintId)!.hex

  const control = useRef(newControl())
  const carRef = useRef<THREE.Group>(null)
  const yaw = useRef({ cur: 0, target: 0, vel: 0 })
  const s = useRef(0)
  const t0 = useRef<number | null>(null)
  const reduce = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  // ?poster: a still, art-directed frame for social images (doors open, low rear three-quarter)
  const poster = useMemo(() => new URLSearchParams(location.search).has('poster'), [])
  // ?poster&ground: the reference photo, parked on the desert floor under the Milky Way, lift systems off
  const grounded = useMemo(() => poster && new URLSearchParams(location.search).has('ground'), [poster])
  /** Milky Way arcs up through the middle of the poster frame: band normal is perpendicular to the view, tilted */
  const band = useMemo<[number, number, number]>(() => {
    const q = new URLSearchParams(location.search)
    const n = (k: string, d: number) => (q.has(k) ? parseFloat(q.get(k)!) : d)
    const dir = new THREE.Vector3(n('lx', 0.6) - n('cx', 6.4), 0, n('lz', -0.3) - n('cz', -5.6)).normalize()
    const nrm = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
    nrm.addScaledVector(dir, 0.35).add(new THREE.Vector3(0, 0.22, 0)).normalize()
    return nrm.toArray() as [number, number, number]
  }, [])
  const lift = useRef(0)
  const carPos = useRef(new THREE.Vector3())
  const shadow = useRef<THREE.Group>(null)
  const world = useRef<THREE.Group>(null)
  const earth = useRef<THREE.Group>(null)
  const fog = useRef<THREE.FogExp2>(null)
  const warm = useRef<THREE.DirectionalLight>(null)
  const space = useRef(0)
  const dust = useRef(0)
  const prevClimb = useRef(0)
  const groundY = useRef(0)
  const launch = useRef(0)
  const pools = useRef<THREE.Mesh[]>([])
  const poolMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: poolTexture(), color: new THREE.Color('#9fcfff'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )
  const key = useRef<THREE.DirectionalLight>(null)
  const nv = useMemo(() => new THREE.Vector3(), [])
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), l: new THREE.Vector3(), r: new THREE.Vector3() }), [])

  // drag to inspect the car
  useEffect(() => {
    let down = false
    let lastX = 0
    const isUi = (e: Event) => (e.target as HTMLElement | null)?.closest('button, a, input, [data-nodrag]')
    const dn = (e: PointerEvent) => {
      if (isUi(e)) return
      down = true
      lastX = e.clientX
    }
    const mv = (e: PointerEvent) => {
      if (!down) return
      yaw.current.target += (e.clientX - lastX) * 0.008
      lastX = e.clientX
    }
    const up = () => (down = false)
    window.addEventListener('pointerdown', dn)
    window.addEventListener('pointermove', mv)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerdown', dn)
      window.removeEventListener('pointermove', mv)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const now = performance.now()
    if (t0.current === null) t0.current = reduce || poster ? now - 6000 : now

    // scroll -> section progress (0 hero, 1 garage, 2 final)
    const vh = window.innerHeight
    const target = THREE.MathUtils.clamp(window.scrollY / vh, 0, 2)
    s.current = THREE.MathUtils.damp(s.current, target, 4, dt)
    const seg = Math.min(1, Math.floor(s.current + 1e-4))
    const f = ease(THREE.MathUtils.clamp(s.current - seg, 0, 1))
    const a = K[seg], b = K[Math.min(2, seg + 1)]

    // arrival: the car descends out of the night sky on its thrusters and settles into a hover
    const rt = THREE.MathUtils.clamp((now - (t0.current ?? now)) / 4200, 0, 1)
    const el = state.clock.elapsedTime
    const fall = 1 - easeOutExpo(rt)
    const carY = grounded ? 0 : HOVER + fall * 9 + Math.sin(el * 1.3) * 0.035 + Math.sin(el * 0.47) * 0.02

    // lift-off: scrolling out of the hero climbs off the desert floor into space.
    // The car stays put for the camera; the world drops away beneath it.
    const climb = ease(THREE.MathUtils.clamp((s.current - 0.08) / 0.87, 0, 1))
    const climbRate = Math.max(0, (climb - prevClimb.current) / Math.max(dt, 1e-4))
    prevClimb.current = climb
    space.current = THREE.MathUtils.smoothstep(climb, 0.3, 0.85)
    if (world.current) {
      world.current.position.y = -climb * climb * CLIMB
      groundY.current = world.current.position.y
      world.current.visible = climb < 0.72
    }
    if (fog.current) fog.current.density = 0.0105 + climb * 0.03
    if (warm.current) warm.current.intensity = 1.5 * (1 - space.current * 0.6)
    if (earth.current) {
      const e = THREE.MathUtils.smoothstep(climb, 0.55, 1)
      earth.current.visible = climb > 0.5
      earth.current.position.y = THREE.MathUtils.lerp(-1400, -306, e)
    }

    // in open space there is nothing to push against: lift idles down once the climb is done
    lift.current = THREE.MathUtils.damp(lift.current, (0.55 + fall * 0.45 + Math.sin(el * 7) * 0.04) * (1 - space.current * 0.85) + Math.min(0.45, climbRate * 1.5), 6, dt)
    dust.current = lift.current * Math.max(0, 1 - climb * 4)
    control.current.lift = lift.current
    if (grounded) { lift.current = 0; dust.current = 0; control.current.lift = 0 }
    control.current.boost = THREE.MathUtils.damp(control.current.boost, Math.min(1, climbRate * 2.5), 8, dt)
    control.current.spin = 0
    // tail lamps power up as the car settles
    control.current.tail = THREE.MathUtils.smoothstep(rt, 0.35, 0.9)
    control.current.brake = 0
    control.current.pitch = -fall * 0.12 - Math.min(0.1, climbRate * 0.25) + Math.sin(el * 0.9) * 0.008
    control.current.roll = Math.sin(el * 0.6) * 0.012
    // garage ("Explore the car"): the butterfly doors open to show the cabin; the car damps the motion
    control.current.doors = Math.abs(s.current - 1) < 0.3 ? 1 : 0
    if (carRef.current) {
      // ENTER THE GRID: rear thrusters fire, the nose lifts a touch and the car pulls away
      const st = useStore.getState()
      launch.current = st.fading && st.view === 'site' ? launch.current + dt : 0
      const L = launch.current
      if (L > 0) {
        control.current.boost = 1
        control.current.pitch = -0.05 * Math.min(1, L * 4)
        control.current.lift = 1
        control.current.doors = 0
      }
      carRef.current.position.set(0, carY + L * L * 1.5, -fall * 4 + L * L * 34)
      carPos.current.copy(carRef.current.position)
      if (shadow.current) shadow.current.position.set(carPos.current.x, 0.012, carPos.current.z)
      carRef.current.updateMatrixWorld()
      const near = Math.max(0, 1 - (carY - HOVER) / 3) * Math.max(0, 1 - climb * 5)
      poolMat.opacity = lift.current * 0.28 * near
      pools.current.forEach((m, k) => {
        if (!m) return
        nv.copy(NOZZLE_POS[k]).applyMatrix4(carRef.current!.matrixWorld)
        m.position.set(nv.x, 0.02, nv.z)
      })
      yaw.current.cur += (yaw.current.target - yaw.current.cur) * (1 - Math.exp(-dt * 7))
      // spring back when not in the garage so the hero / final framing stays authored
      if (Math.abs(s.current - 1) > 0.55) yaw.current.target *= Math.exp(-dt * 2.2)
      carRef.current.rotation.y = yaw.current.cur
    }

    // camera path
    tmp.p.lerpVectors(a.pos, b.pos, f)
    tmp.l.lerpVectors(a.look, b.look, f)
    tmp.l.y += fall * 4 * (1 - seg)
    // hero: a slow, deliberate orbit from the front fender toward the profile; settles on arrival
    const heroW = seg === 0 ? 1 - f : 0
    const orbit = (reduce ? 0 : Math.sin(el * 0.06) * 0.1 + fall * 0.45) * heroW
    if (orbit) {
      const dx = tmp.p.x - tmp.l.x, dz = tmp.p.z - tmp.l.z
      const c = Math.cos(orbit), sn = Math.sin(orbit)
      tmp.p.x = tmp.l.x + dx * c - dz * sn
      tmp.p.z = tmp.l.z + dx * sn + dz * c
    }
    let shift = THREE.MathUtils.lerp(a.shift, b.shift, f)
    const aspect = state.size.width / Math.max(1, state.size.height)
    if (aspect < 0.9) {
      // portrait: pull back, centre the car and lift it into the top half above the headline
      tmp.p.sub(tmp.l).multiplyScalar(1.85).add(tmp.l)
      shift *= 0.1
      tmp.l.y -= 1.1
    }
    if (!reduce) tmp.p.y += Math.sin(state.clock.elapsedTime * 0.21) * 0.015
    camera.position.copy(tmp.p)
    // shift target to the right of the camera so the car sits left of centre
    tmp.r.set(1, 0, 0).applyQuaternion(camera.quaternion)
    const dir = tmp.l.clone().sub(tmp.p).normalize()
    tmp.r.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
    camera.lookAt(tmp.l.clone().addScaledVector(tmp.r, shift))
    const cam = camera as THREE.PerspectiveCamera
    let fov = THREE.MathUtils.lerp(a.fov, b.fov, f)
    if (poster) {
      control.current.doors = 1
      const q = new URLSearchParams(location.search)
      const n = (k: string, d: number) => (q.has(k) ? parseFloat(q.get(k)!) : d)
      camera.position.set(n('cx', 6.4), n('cy', 1.35), n('cz', -5.6))
      camera.lookAt(n('lx', 0.6), n('ly', 2.45), n('lz', -0.3))
      fov = n('fov', 30)
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
  })

  return (
    <>
      <fogExp2 ref={fog} attach="fog" args={[FOG, 0.0105]} />
      <Sky space={space} boost={grounded ? 2.7 : 1} band={grounded ? band : undefined} />
      <DesertReflections intensity={1.35} />
      {/* key: soft cool moonlight high front-left, the only shadow caster */}
      <directionalLight
        ref={key} position={[7, 10, 8]} intensity={1.7} color="#dfe5fb"
        castShadow={quality !== 'low'} shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02}
        shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} shadow-camera-near={1} shadow-camera-far={30} shadow-radius={6}
      />
      {/* fill: dim sky/ground bounce so shadow sides keep detail */}
      <hemisphereLight args={['#7d8bd6', '#2a1c14', 0.28]} />
      {/* rim: warm afterglow from the horizon behind, separates roof, fenders and wing from the sky */}
      <directionalLight ref={warm} position={[GLOW_DIR.x * 30, 3, GLOW_DIR.z * 30]} intensity={1.5} color="#ff9a60" />

      {/* everything on the ground drops away as the car climbs */}
      <group ref={world}>
        <Ground />
        <Mountains />
        <AirDust count={quality === 'low' ? 300 : 900} />
        <ThrustDust strength={dust} origin={carPos} count={quality === 'low' ? 160 : 420} />
        {NOZZLE_POS.map((_, k) => (
          <mesh key={k} ref={(m) => { if (m) pools.current[k] = m }} material={poolMat} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[2.4, 2.4]} />
          </mesh>
        ))}
        <group ref={shadow}>
          <ContactShadows opacity={0.4} scale={9} blur={3} far={4} resolution={512} color="#000000" />
        </group>
      </group>
      {/* Earth rises into view below once the car is up in orbit */}
      <group ref={earth} position={[0, -1400, -60]} visible={false}>
        <Planet radius={300} sun={[0.75, 0.6, -0.1]} detail={3} />
      </group>

      <group ref={carRef}>
        <Car
          paint={grounded ? '#e7e9ec' : paint} variant={variantId} control={control} shadows={quality !== 'low'} beam={HOVER + 0.2} gas groundY={groundY}
          finishOverride={grounded ? { metalness: 0.22, roughness: 0.3, clearcoat: 1, flake: 0.06, iridescence: 0 } : undefined}
        />
        {/* taillight spill on the dust behind */}
        <pointLight position={[0, -0.3, -3.6]} color="#ff2a22" intensity={3.2} distance={7} decay={2} />
      </group>
      {grounded && <PhotoExtras />}
    </>
  )
}

let glowTex: THREE.Texture | null = null
function glow() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

/** Photo shot only: red tail-light haze over the dust behind the car, and Mars as a bright point high in the frame. */
function PhotoExtras() {
  const mars = useRef<THREE.Sprite>(null)
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera }) => {
    if (!mars.current) return
    v.set(-0.74, 0.8, 0.5).unproject(camera).sub(camera.position).normalize()
    mars.current.position.copy(camera.position).addScaledVector(v, 300)
  })
  return (
    <group>
      <pointLight position={[0, 0.55, -3.1]} color="#ff2a22" intensity={4.2} distance={8} decay={2} />
      <sprite position={[0.2, 0.7, -3.9]} scale={[8.5, 2.6, 1]}>
        <spriteMaterial map={glow()} color="#ff3a24" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
      </sprite>
      <sprite ref={mars} scale={[4.2, 4.2, 1]}>
        <spriteMaterial map={glow()} color="#ffcf9e" transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
      </sprite>
    </group>
  )
}
