import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import * as THREE from 'three'
import { Car, newControl } from '../car/Car'
import { Planet } from './Planet'
import { StudioEnv } from './Studio'
import { BOOST_PADS, CP_COUNT, EARTH_MARS_KM, HALF_WIDTH, lateral, nearest, track } from '../game/track'
import { hud } from '../game/hud'
import { readInputs, useKeyboard } from '../game/input'
import { PAINTS, VARIANTS, useStore } from '../store'

/* ------------------------------------------------------------ flight course */

/** Tube radius around the flight line before the course pushes you back (horizontal / vertical). */
const TUBE_H = HALF_WIDTH + 3
const TUBE_V = 11
const GATE_R = 14

let dotTex: THREE.Texture | null = null
function dot() {
  if (dotTex) return dotTex
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, '#fff'); g.addColorStop(0.3, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 64, 64)
  dotTex = new THREE.CanvasTexture(c)
  return dotTex
}

const at = (i: number) => new THREE.Vector3(track.px[i], track.py[i], track.pz[i])
const headingAt = (i: number) => Math.atan2(track.tx[i], track.tz[i])
const slopeAt = (i: number) => {
  const j = (i + 4) % track.n, k = (i - 4 + track.n) % track.n
  return Math.atan2(track.py[j] - track.py[k], track.ds * 8)
}

/** A dotted light line along the centre of the flight path, so the course reads in open space. */
function CourseLine() {
  const geo = useMemo(() => {
    const pts: number[] = []
    for (let i = 0; i < track.n; i += 2) pts.push(track.px[i], track.py[i], track.pz[i])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <points geometry={geo}>
      <pointsMaterial map={dot()} size={0.9} sizeAttenuation color={new THREE.Color('#55dfff').multiplyScalar(1.4)} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </points>
  )
}

/** Checkpoint gates: big light rings to fly through, tilted with the climb of the course. */
function Gates() {
  const cyan = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#55dfff').multiplyScalar(2), toneMapped: false }), [])
  const red = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a30').multiplyScalar(2.4), toneMapped: false }), [])
  const frame = useMemo(() => new THREE.MeshStandardMaterial({ color: '#141821', metalness: 0.9, roughness: 0.3 }), [])
  return (
    <group>
      {Array.from({ length: CP_COUNT + 1 }, (_, k) => {
        const i = Math.min(track.n - 1, Math.round((k * (track.n - 1)) / CP_COUNT))
        const start = k === 0 || k === CP_COUNT
        return (
          <group key={k} position={at(i)} rotation={[0, headingAt(i), 0]}>
            <group rotation={[-slopeAt(i), 0, 0]}>
              <mesh material={frame}><torusGeometry args={[GATE_R + 0.6, 0.55, 12, 96]} /></mesh>
              <mesh material={start ? red : cyan}><torusGeometry args={[GATE_R, 0.14, 8, 128]} /></mesh>
              {/* four running lights on the frame */}
              {[0, 1, 2, 3].map((q) => (
                <mesh key={q} material={start ? red : cyan} position={[Math.cos((q * Math.PI) / 2 + Math.PI / 4) * (GATE_R + 0.6), Math.sin((q * Math.PI) / 2 + Math.PI / 4) * (GATE_R + 0.6), 0]}>
                  <boxGeometry args={[0.7, 0.7, 1.4]} />
                </mesh>
              ))}
            </group>
          </group>
        )
      })}
    </group>
  )
}

/** Boost rings: fly through the centre for a kick of speed. */
function BoostRings() {
  const refs = useRef<THREE.Group[]>([])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a40').multiplyScalar(2.2), toneMapped: false }), [])
  useFrame((_, dt) => refs.current.forEach((g, k) => { if (g) g.rotation.z += dt * (k % 2 ? 1.2 : -1.2) }))
  return (
    <group>
      {BOOST_PADS.map((p, k) => {
        const i = p.idx
        const pos = at(i).add(new THREE.Vector3(track.sx[i] * p.off, 0, track.sz[i] * p.off))
        return (
          <group key={i} position={pos} rotation={[0, headingAt(i), 0]}>
            <group ref={(g) => { if (g) refs.current[k] = g }} rotation={[-slopeAt(i), 0, 0]}>
              <mesh material={mat}><torusGeometry args={[4.2, 0.12, 8, 64]} /></mesh>
              {[0, 1, 2, 3, 4, 5].map((q) => (
                <mesh key={q} material={mat} rotation={[0, 0, (q / 6) * Math.PI * 2]} position={[Math.cos((q / 6) * Math.PI * 2) * 3.6, Math.sin((q / 6) * Math.PI * 2) * 3.6, 0]}>
                  <boxGeometry args={[0.5, 0.12, 0.12]} />
                </mesh>
              ))}
            </group>
          </group>
        )
      })}
    </group>
  )
}

/** Drifting asteroid field around the course. */
function Asteroids({ count }: { count: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const group = useRef<THREE.Group>(null)
  const geo = useMemo(() => {
    const g = new THREE.DodecahedronGeometry(1, 1)
    const pa = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pa.count; i++) {
      const k = 0.78 + Math.sin(pa.getX(i) * 4.3 + pa.getY(i) * 2.9) * 0.14 + Math.cos(pa.getZ(i) * 5.7) * 0.08
      pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k, pa.getZ(i) * k)
    }
    g.computeVertexNormals()
    return g
  }, [])
  useEffect(() => {
    const m = ref.current
    if (!m) return
    const o = new THREE.Object3D()
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let k = 0; k < count; k++) {
      const i = Math.floor(rnd() * track.n)
      const side = rnd() < 0.5 ? -1 : 1
      const w = rnd() < 0.15 ? 12 + rnd() * 26 : 1.2 + rnd() * 6
      // keep every rock, including its radius, outside the flight tube
      const d = TUBE_H + 8 + w + rnd() * 230
      o.position.set(track.px[i] + track.sx[i] * d * side, track.py[i] + (rnd() - 0.5) * 120, track.pz[i] + track.sz[i] * d * side)
      o.scale.set(w, w * (0.6 + rnd() * 0.5), w * (0.7 + rnd() * 0.5))
      o.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6)
      o.updateMatrix()
      m.setMatrixAt(k, o.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  }, [count])
  useEffect(() => () => geo.dispose(), [geo])
  return (
    <group ref={group}>
      <instancedMesh ref={ref} args={[geo, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial color="#3a3530" roughness={0.95} metalness={0.05} flatShading />
      </instancedMesh>
    </group>
  )
}

const MARS_R = 520
const MARS_POS = track.end.clone().addScaledVector(track.endDir, MARS_R + 260).add(new THREE.Vector3(0, -120, 0)).toArray() as [number, number, number]

/** The star field is centred on the camera so it never runs out over a 5 km flight. */
function TravellingStars({ count }: { count: number }) {
  const g = useRef<THREE.Group>(null)
  useFrame(({ camera }) => { if (g.current) g.current.position.copy(camera.position) })
  return (
    <group ref={g}>
      <Stars radius={900} depth={200} count={count} factor={9} saturation={0.15} fade speed={0.1} />
    </group>
  )
}

/* ------------------------------------------------------------ simulation */

interface Sim {
  x: number; z: number; h: number; vx: number; vz: number
  boost: number; cum: number; idx: number; lastCp: number; lapStart: number; lastLap: number
  turn: number; cd: number; padCool: number[]; shake: number; camH: number; camInit: boolean
  camPos: THREE.Vector3; fov: number
  /** altitude and vertical speed */
  y: number; vy: number
}

function freshSim(): Sim {
  const i0 = 6
  return {
    x: track.px[i0], z: track.pz[i0], h: Math.atan2(track.tx[i0], track.tz[i0]), vx: 0, vz: 0,
    boost: 0.55, cum: i0, idx: i0, lastCp: -1, lapStart: 0, lastLap: 0,
    turn: 0, cd: 3.4, padCool: BOOST_PADS.map(() => 0), shake: 0, camH: 0, camInit: false,
    camPos: new THREE.Vector3(), fov: 62,
    y: track.py[i0], vy: 0,
  }
}

export function DriveScene() {
  const { camera } = useThree()
  const paintId = useStore((s) => s.paintId)
  const variantId = useStore((s) => s.variantId)
  const quality = useStore((s) => s.quality)
  const runId = useStore((s) => s.runId)
  const paint = PAINTS.find((p) => p.id === paintId)!.hex
  const V = VARIANTS[variantId]
  useKeyboard(true)

  const carRef = useRef<THREE.Group>(null)
  const control = useRef(newControl())
  const sim = useRef<Sim>(freshSim())
  const lookAt = useMemo(() => new THREE.Vector3(), [])
  const lift = useRef(0.3)

  useEffect(() => {
    sim.current = freshSim()
    Object.assign(hud, { state: 'countdown', count: 3, speed: 0, boost: 0.55, boosting: false, lap: 1, time: 0, lapTime: 0, best: 0, cp: 0, cpFlash: 9, impact: 0, lapTimes: [] as number[] })
  }, [runId])

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20)
    const S = sim.current
    const paused = useStore.getState().paused
    const inp = readInputs()
    const fx = Math.sin(S.h), fz = Math.cos(S.h)
    const lx = Math.cos(S.h), lz = -Math.sin(S.h) // car's left
    let vf = S.vx * fx + S.vz * fz
    let vl = S.vx * lx + S.vz * lz

    if (!paused) {
      // ------------------------------------------------ state machine
      if (hud.state === 'countdown') {
        S.cd -= dt
        hud.count = Math.max(0, Math.ceil(S.cd))
        if (S.cd <= 0) { hud.state = 'racing'; hud.count = 0; hud.time = 0; hud.lapTime = 0 }
      } else if (hud.state === 'racing') {
        hud.time += dt
        hud.lapTime += dt
        if (hud.time > 0.9 && hud.count === 0) hud.count = -1
      }
      const live = hud.state === 'racing'
      const finished = hud.state === 'finished'

      // ------------------------------------------------ driving model
      const throttle = live && inp.throttle
      const braking = (live && inp.brake) || finished
      const boosting = live && inp.boost && S.boost > 0.02 && vf > 8
      const vmax = V.vmax * (boosting ? 1.2 : 1)

      if (throttle) {
        const ratio = Math.min(1.3, Math.max(0, vf / vmax))
        let a = 36 * (1 - Math.pow(ratio, 1.5))
        if (boosting) a += 34 * V.boostPower
        vf += a * dt
      }
      if (braking) {
        if (vf > 1) vf -= (finished ? 26 : 56) * dt
        else if (!finished) vf = Math.max(-16, vf - 20 * dt)
        else vf = Math.max(0, vf)
      }
      vf -= vf * 0.045 * dt + Math.sign(vf) * 2.0 * dt
      if (Math.abs(vf) < 0.15 && !throttle && !braking) vf = 0

      const drift = live && inp.drift
      let grip = 9.5 * V.grip
      if (drift) { grip = 1.5; vf -= Math.sign(vf) * 7 * dt }
      vl *= Math.exp(-grip * dt)

      const want = live ? (inp.left ? 1 : 0) - (inp.right ? 1 : 0) : 0
      S.turn += (want - S.turn) * (1 - Math.exp(-dt * 9))
      const sp = Math.abs(vf)
      const steerRate = (drift ? 2.3 : 1.7) / (1 + sp / 34) * Math.min(1, sp / 7) * Math.sign(vf || 1)
      const newH = S.h + S.turn * steerRate * dt

      if (boosting) S.boost = Math.max(0, S.boost - 0.3 * dt)
      else S.boost = Math.min(1, S.boost + 0.06 * dt)

      // recompose with the OLD heading so velocity lags the car's rotation (this is what makes slides)
      S.vx = fx * vf + lx * vl
      S.vz = fz * vf + lz * vl
      S.h = newH
      S.x += S.vx * dt
      S.z += S.vz * dt

      // ------------------------------------------------ track
      const i = nearest(S.x, S.z, S.idx)
      S.cum += i - S.idx
      S.idx = i

      // vertical: climb / dive, with a gentle assist back toward the flight line when hands-off
      const wantY = live ? (inp.up ? 1 : 0) - (inp.down ? 1 : 0) : 0
      S.vy += wantY * 30 * dt
      if (!wantY) S.vy += (track.py[i] - S.y) * 1.1 * dt
      S.vy *= Math.exp(-2.4 * dt)
      S.y += S.vy * dt
      const dyc = S.y - track.py[i]
      if (Math.abs(dyc) > TUBE_V) {
        S.y = track.py[i] + Math.sign(dyc) * TUBE_V
        if (S.vy * Math.sign(dyc) > 0) {
          const hit = Math.min(1, Math.abs(S.vy) / 18)
          S.vy *= -0.3
          S.shake = Math.max(S.shake, hit * 0.6)
          hud.impact = Math.max(hud.impact, hit * 0.6)
        }
      }

      const d = lateral(S.x, S.z, i)
      const lim = TUBE_H
      // heading assist: hands-off the car eases onto the course line; near the edge it turns
      // along the course instead of pinning itself against the boundary
      {
        let dh = Math.atan2(track.tx[i], track.tz[i]) - S.h
        dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        const edge = THREE.MathUtils.smoothstep(Math.abs(d), lim * 0.6, lim)
        const rate = (want === 0 ? 0.8 : 0) + edge * 3.2
        if (live && rate > 0) S.h += dh * (1 - Math.exp(-dt * rate))
      }
      if (Math.abs(d) > lim) {
        const sgn = Math.sign(d)
        const over = Math.abs(d) - lim
        S.x -= track.sx[i] * sgn * over
        S.z -= track.sz[i] * sgn * over
        // kill outward velocity, scrub speed
        const out = (S.vx * track.sx[i] + S.vz * track.sz[i]) * sgn
        if (out > 0) {
          S.vx -= track.sx[i] * sgn * out * 1.35
          S.vz -= track.sz[i] * sgn * out * 1.35
          const hit = Math.min(1, out / 22)
          S.vx *= 1 - 0.14 * hit
          S.vz *= 1 - 0.14 * hit
          S.shake = Math.max(S.shake, hit)
          hud.impact = Math.max(hud.impact, hit)
        }
      }

      // boost pads
      BOOST_PADS.forEach((p, k) => {
        S.padCool[k] -= dt
        const ai = i - p.idx
        if (Math.abs(ai * track.ds) < 7.2 && Math.abs(d - p.off) < 4.2 && Math.abs(S.y - track.py[p.idx]) < 4.2 && S.padCool[k] <= 0) {
          S.padCool[k] = 1.5
          S.boost = Math.min(1, S.boost + 0.42)
          const f = Math.hypot(S.vx, S.vz)
          const add = 16 * V.boostPower
          S.vx += (S.vx / (f || 1)) * add
          S.vz += (S.vz / (f || 1)) * add
          S.shake = Math.max(S.shake, 0.35)
        }
      })

      // checkpoints + laps
      if (live) {
        const segLen = (track.n - 1) / CP_COUNT
        const cpNow = Math.floor(S.cum / segLen)
        if (cpNow > S.lastCp && S.lastCp >= 0) { hud.cpFlash = 0; hud.cp = ((cpNow % CP_COUNT) + CP_COUNT) % CP_COUNT }
        S.lastCp = cpNow
        // arrival: through the last gate into Mars orbit
        if (S.cum >= track.n - 4) {
          hud.lapTimes = [hud.time]
          hud.best = hud.time
          hud.state = 'finished'
        }
      } else if (hud.state === 'countdown') {
        S.lastCp = Math.floor(S.cum / ((track.n - 1) / CP_COUNT))
      }
      hud.progress = THREE.MathUtils.clamp(S.cum / (track.n - 1), 0, 1)
      hud.marsKm = EARTH_MARS_KM * (1 - hud.progress)
      hud.cpFlash += dt
      hud.impact = Math.max(0, hud.impact - dt * 2.2)
      S.shake = Math.max(0, S.shake - dt * 2.6)

      // hud
      hud.speed = Math.hypot(S.vx, S.vz) * 3.6
      hud.boost = S.boost
      hud.boosting = boosting
      hud.x = S.x; hud.z = S.z; hud.h = S.h
      hud.gear = vf < -0.5 ? 'R' : 'D'

      // car visuals
      const c = control.current
      c.spin = 0 // in flight the wheels stay still
      c.steer = S.turn
      c.brake = braking && vf > 0.5 ? 1 : 0
      c.boost = boosting ? 1 : 0
      // flight attitude: bank into turns, nose follows the climb, a touch of squat under thrust
      c.roll = THREE.MathUtils.clamp(-vl * 0.012 - S.turn * vf * 0.004, -0.5, 0.5)
      c.pitch = THREE.MathUtils.clamp(-S.vy * 0.022 - (throttle ? 0.02 : 0) + (braking ? 0.03 : 0), -0.4, 0.4)
    }

    // lift modules glow with vertical effort; a slow stabilising float when cruising
    const el = state.clock.elapsedTime
    lift.current = THREE.MathUtils.damp(lift.current, 0.2 + Math.min(0.6, Math.abs(S.vy) * 0.05) + (hud.boosting ? 0.2 : 0), 6, dt)
    control.current.lift = lift.current
    if (carRef.current) {
      carRef.current.position.set(S.x, S.y + Math.sin(el * 1.3) * 0.04, S.z)
      carRef.current.rotation.y = S.h
    }

    // ------------------------------------------------ chase camera
    const speed = Math.hypot(S.vx, S.vz)
    const sf = Math.min(1, speed / V.vmax)
    if (!S.camInit) { S.camH = S.h; S.camInit = true }
    // camera heading lags the car's heading so slides are visible
    let dh = S.h - S.camH
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    S.camH += dh * (1 - Math.exp(-dt * 4.2))
    const back = 7.6 + sf * 2.6 + (hud.boosting ? 1.3 : 0)
    const height = S.y + 2.7 + sf * 0.5 - S.vy * 0.03
    const cx = S.x - Math.sin(S.camH) * back
    const cz = S.z - Math.cos(S.camH) * back
    const target = new THREE.Vector3(cx, height, cz)
    if (S.camPos.lengthSq() === 0) S.camPos.copy(target)
    S.camPos.lerp(target, 1 - Math.exp(-dt * 12))
    camera.position.copy(S.camPos)
    if (S.shake > 0.001) {
      camera.position.x += (Math.random() - 0.5) * S.shake * 0.6
      camera.position.y += (Math.random() - 0.5) * S.shake * 0.4
    }
    lookAt.set(S.x + Math.sin(S.camH) * 6, S.y + 1.1 + S.vy * 0.04, S.z + Math.cos(S.camH) * 6)
    camera.lookAt(lookAt)
    camera.rotateZ(-S.turn * sf * 0.035)
    const cam = camera as THREE.PerspectiveCamera
    const fovT = 58 + sf * 18 + (hud.boosting ? 8 : 0)
    S.fov += (fovT - S.fov) * (1 - Math.exp(-dt * 5))
    if (Math.abs(cam.fov - S.fov) > 0.02) { cam.fov = S.fov; cam.updateProjectionMatrix() }
  })

  return (
    <>
      <color attach="background" args={['#020308']} />
      <fogExp2 attach="fog" args={['#05060d', 0.0016]} />
      <StudioEnv intensity={0.95} />
      <directionalLight position={[-60, 160, 40]} intensity={0.9} color="#ffe2cc" />
      <directionalLight position={[80, 40, -100]} intensity={0.6} color="#8fb8ff" />

      <TravellingStars count={quality === 'low' ? 3000 : 9000} />
      {/* home: Earth below and behind the launch gate */}
      <Planet radius={620} position={[0, -820, -700]} sun={[0.3, 0.6, 0.7]} detail={10} palette="earth" />
      {/* a distant ringed giant for scale */}
      <Planet radius={260} position={[3800, 1500, 3400]} sun={[-0.6, 0.15, -0.8]} ring detail={1.4} palette="giant" />
      {/* the destination: Mars, dead ahead of the arrival gate */}
      <Planet radius={MARS_R} position={MARS_POS} sun={[-track.endDir.x * 0.8, 0.45, -track.endDir.z * 0.8]} detail={3} palette="mars" />

      <CourseLine />
      <BoostRings />
      <Gates />
      <Asteroids count={quality === 'low' ? 60 : 160} />

      <group ref={carRef}>
        <Car paint={paint} variant={variantId} control={control} gas />
      </group>
    </>
  )
}
