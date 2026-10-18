import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg'
import { cutWells, loft, stationRing, type Station, type Well } from './loft'
import { WHEELS, useStore, type Finish, type VariantId } from '../store'
import { Gas } from './Gas'

export interface CarControl {
  /** -1..1 */
  steer: number
  /** wheel angular speed, rad/s (forward positive) */
  spin: number
  brake: number
  /** 0..1 */
  boost: number
  roll: number
  pitch: number
  /** 0..1 output of the four recessed lift modules (hover / lift-off) */
  lift: number
  /** 0..1 tail-light level, so lamps can power up on arrival (default 1) */
  tail?: number
  /** 0..1 butterfly doors, closed to fully open (default 0) */
  doors?: number
}

export const newControl = (): CarControl => ({ steer: 0, spin: 0, brake: 0, boost: 0, roll: 0, pitch: 0, lift: 0 })

/* ------------------------------------------------------------------ geometry data */

/** high quality builds a denser mesh: more sections along and around the body, rounder wheels */
const HP = () => useStore.getState().quality === 'high'

const WHEEL_R = 0.375
const FRONT_Z = 1.28
const REAR_Z = -1.32
const TRACK_X = 0.86

const S = (
  z: number, yB: number, wB: number, yS: number, wS: number, yM: number, wM: number,
  yF: number, wF: number, yI: number, wI: number, yH: number, wH: number,
): Station => ({ z, yB, wB, yS, wS, yM, wM, yF, wF, yI, wI, yH, wH })

//            z      yB   wB    yS   wS    yM   wM    yF   wF    yI   wI    yH   wH
const STATIONS: Station[] = [
  // tail taper: corners roll in and the deck drops so the rear isn't a flat slab
  S(-2.27, 0.42, 0.6, 0.46, 0.78, 0.68, 0.82, 0.84, 0.82, 0.83, 0.62, 0.8, 0.5),
  S(-2.20, 0.40, 0.68, 0.44, 0.86, 0.70, 0.90, 0.90, 0.90, 0.88, 0.66, 0.86, 0.56),
  S(-1.80, 0.30, 0.78, 0.34, 0.92, 0.66, 0.96, 0.95, 0.96, 0.93, 0.70, 0.87, 0.60),
  S(-1.32, 0.22, 0.84, 0.28, 0.96, 0.62, 0.99, 0.98, 0.99, 0.97, 0.70, 0.86, 0.60),
  S(-0.90, 0.17, 0.88, 0.24, 0.98, 0.58, 0.98, 0.85, 0.98, 0.86, 0.72, 0.82, 0.66),
  S(-0.30, 0.16, 0.90, 0.23, 0.99, 0.56, 0.99, 0.79, 0.99, 0.79, 0.76, 0.77, 0.72),
  S(0.40, 0.16, 0.90, 0.23, 0.99, 0.56, 1.00, 0.80, 0.99, 0.80, 0.75, 0.76, 0.70),
  S(0.90, 0.16, 0.90, 0.23, 0.99, 0.58, 1.00, 0.88, 1.00, 0.88, 0.66, 0.70, 0.52),
  S(1.28, 0.16, 0.88, 0.23, 0.98, 0.56, 1.00, 0.84, 1.00, 0.84, 0.595, 0.612, 0.455),
  S(1.65, 0.15, 0.86, 0.22, 0.97, 0.48, 0.99, 0.72, 0.99, 0.72, 0.53, 0.527, 0.39),
  S(1.95, 0.14, 0.80, 0.21, 0.92, 0.40, 0.94, 0.56, 0.94, 0.56, 0.48, 0.458, 0.34),
  S(2.20, 0.12, 0.62, 0.20, 0.74, 0.32, 0.76, 0.43, 0.76, 0.43, 0.44, 0.40, 0.30),
  // rounded nose tip, so the body ends in a small cap instead of a flat panel
  S(2.34, 0.16, 0.36, 0.21, 0.46, 0.27, 0.48, 0.32, 0.46, 0.32, 0.28, 0.31, 0.18),
]

const CANOPY: { z: number; yt: number; wt: number; yb: number; wb: number }[] = [
  { z: -1.50, yt: 0.86, wt: 0.50, yb: 0.76, wb: 0.72 },
  { z: -0.80, yt: 1.04, wt: 0.55, yb: 0.74, wb: 0.80 },
  { z: 0.30, yt: 1.07, wt: 0.57, yb: 0.74, wb: 0.80 },
  { z: 1.08, yt: 0.74, wt: 0.64, yb: 0.64, wb: 0.70 },
]

const canopyRing = (c: (typeof CANOPY)[number]) => [
  new THREE.Vector3(0, c.yt, c.z),
  new THREE.Vector3(c.wt, c.yt, c.z),
  new THREE.Vector3(c.wb, c.yb, c.z),
  new THREE.Vector3(0, c.yb, c.z),
  new THREE.Vector3(-c.wb, c.yb, c.z),
  new THREE.Vector3(-c.wt, c.yt, c.z),
]

/* ---- butterfly doors: hinged high at the A-pillar, they lift up and forward and cant outward */
const DOOR = { x0: 0.3, y0: 0.47, z0: -0.9, z1: 0.76, gap: 0.008 }
/** hinge line (along x) at the front of the roof, [y, z]; every door point sits below and behind it */
const HINGE: [number, number] = [1.09, 0.76]
/** rear shut line is an arc about the hinge: rotation keeps that distance, so the door never runs into the rear jamb */
const DOOR_R = 1.55
const DOOR_LIFT = 1.12
const DOOR_CANT = 0.3
/** cabin tub cut out of the body under the canopy */
const TUB = { x: 0.82, y0: 0.44, z0: -0.86, z1: 0.8 }

const csgBrush = (g: THREE.BufferGeometry, m: THREE.Material) => {
  const b = new Brush(g, m)
  b.updateMatrixWorld()
  return b
}
const csgBox = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: THREE.Material) => {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  return csgBrush(g, m)
}
/** Door volume on one side (sx = +-1), grown by `pad` for the matching hole: a box clipped by the hinge arc. */
function doorVolume(ev: Evaluator, sx: number, pad: number, m: THREE.Material) {
  const x0 = DOOR.x0 - pad
  const bx = csgBox(sx > 0 ? x0 : -1.4, sx > 0 ? 1.4 : -x0, DOOR.y0 - pad, 1.4, DOOR.z0, DOOR.z1 + pad, m)
  const cg = new THREE.CylinderGeometry(DOOR_R + pad, DOOR_R + pad, 1.2, 128, 1)
  cg.rotateZ(Math.PI / 2)
  cg.translate(sx * 0.8, HINGE[0], HINGE[1])
  const v = ev.evaluate(bx, csgBrush(cg, m), INTERSECTION)
  bx.geometry.dispose()
  cg.dispose()
  return v
}

/** Satin-black lower cladding band, a few mm proud of the paint, covering sill and lower flank. */
function lowerRing(s: Station): THREE.Vector3[] {
  const o = 0.007
  const yL = s.yS + (s.yM - s.yS) * 0.42
  const wL = s.wS + (s.wM - s.wS) * 0.42 + o
  const R: [number, number][] = [[0, s.yB - o], [s.wB + o, s.yB - o], [s.wS + o, s.yS], [wL, yL], [0, yL]]
  const pts = R.map(([x, y]) => new THREE.Vector3(x, y, s.z))
  for (let i = 3; i >= 1; i--) pts.push(new THREE.Vector3(-R[i][0], R[i][1], s.z))
  return pts
}

function useWheelGeometry() {
  return useMemo(() => {
    const tireProfile = [
      [0.245, -0.13], [0.32, -0.15], [0.358, -0.135], [0.374, -0.09], [0.378, 0],
      [0.374, 0.09], [0.358, 0.135], [0.32, 0.15], [0.245, 0.13],
    ].map(([x, y]) => new THREE.Vector2(x, y))
    const tire = new THREE.LatheGeometry(tireProfile, HP() ? 160 : 72)
    tire.rotateZ(-Math.PI / 2)

    const barrel = new THREE.CylinderGeometry(0.255, 0.255, 0.27, HP() ? 96 : 40, 1, true)
    barrel.rotateZ(-Math.PI / 2)

    // aero disc: very shallow cone, face outward (+x)
    const disc = new THREE.CylinderGeometry(0.255, 0.215, 0.03, 48)
    disc.rotateZ(-Math.PI / 2)

    // six slanted star blades
    const blades: THREE.BufferGeometry[] = []
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      const p = (r: number, ang: number) => new THREE.Vector2(Math.cos(ang) * r, Math.sin(ang) * r)
      const sh = new THREE.Shape([p(0.035, a - 0.16), p(0.25, a + 0.34 - 0.07), p(0.25, a + 0.34 + 0.07), p(0.035, a + 0.16)])
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 })
      g.rotateY(Math.PI / 2)
      g.translate(0.138, 0, 0)
      blades.push(g)
    }
    const hub = new THREE.CylinderGeometry(0.05, 0.055, 0.04, 24)
    hub.rotateZ(-Math.PI / 2)
    hub.translate(0.142, 0, 0)
    // machined outer lip of the rim
    const lip = new THREE.RingGeometry(0.228, 0.258, HP() ? 160 : 72)
    lip.rotateY(Math.PI / 2)
    lip.translate(0.139, 0, 0)
    // inner face behind the spokes, recessed so the brake shows through
    const back = new THREE.CircleGeometry(0.25, 48)
    back.rotateY(Math.PI / 2)
    back.translate(-0.02, 0, 0)
    // ventilated rotor + hat
    const rotor = new THREE.CylinderGeometry(0.2, 0.2, 0.028, HP() ? 128 : 56, 1, false)
    rotor.rotateZ(-Math.PI / 2)
    rotor.translate(0.055, 0, 0)
    const rotorHat = new THREE.CylinderGeometry(0.095, 0.095, 0.05, 32)
    rotorHat.rotateZ(-Math.PI / 2)
    rotorHat.translate(0.075, 0, 0)
    // caliper: a block that hugs the top-rear of the rotor
    const caliper = new THREE.TorusGeometry(0.185, 0.034, 10, 18, 0.95)
    caliper.scale(1, 1, 1.5)
    caliper.rotateY(Math.PI / 2)
    caliper.translate(0.07, 0, 0)
    // moulded lettering ring on the outer sidewall, and a hexagonal centre-lock nut
    const wall = new THREE.RingGeometry(0.255, 0.335, HP() ? 192 : 96, 1)
    wall.rotateY(Math.PI / 2)
    wall.translate(0.151, 0, 0)
    const nut = new THREE.CylinderGeometry(0.04, 0.046, 0.034, 6)
    nut.rotateZ(-Math.PI / 2)
    nut.translate(0.17, 0, 0)
    const pin = new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16)
    pin.rotateZ(-Math.PI / 2)
    pin.translate(0.19, 0, 0)
    return { tire, barrel, disc, blades, hub, lip, back, rotor, rotorHat, caliper, wall, nut, pin }
  }, [])
}

/** Cambered airfoil section extruded across the span, leading edge forward (+z). */
function airfoil(span: number, chord: number, t: number) {
  const sh = new THREE.Shape()
  sh.moveTo(0, 0)
  sh.bezierCurveTo(chord * 0.08, t * 0.9, chord * 0.45, t, chord, t * 0.18)
  sh.lineTo(chord, t * 0.02)
  sh.bezierCurveTo(chord * 0.55, -t * 0.25, chord * 0.12, -t * 0.55, 0, 0)
  const g = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 18 })
  g.rotateY(Math.PI / 2)
  g.translate(-span / 2, 0, chord / 2)
  return g
}

let sidewallTex: THREE.Texture | null = null
/** Moulded sidewall lettering, set round the tyre in a ring (planar UVs on a RingGeometry). */
function sidewall() {
  if (sidewallTex) return sidewallTex
  const n = 1024
  const c = document.createElement('canvas'); c.width = c.height = n
  const x = c.getContext('2d')!
  x.translate(n / 2, n / 2)
  x.fillStyle = '#fff'
  x.font = '600 34px Arial, sans-serif'
  const ring = (text: string, r: number, start: number) => {
    let a = start
    for (const ch of text) {
      const w = x.measureText(ch).width
      x.save(); x.rotate(a); x.translate(0, -r); x.fillText(ch, -w / 2, 0); x.restore()
      a += (w + 3) / r
    }
  }
  ring('ROADSTER.GAME  ORBITAL', 420, -0.9)
  ring('285/30 ZR21  EV-R', 420, 2.3)
  sidewallTex = new THREE.CanvasTexture(c)
  sidewallTex.anisotropy = 8
  return sidewallTex
}

let meshTex: THREE.Texture | null = null
/** Hexagonal grille mesh for the rear fascia. */
function hexMesh() {
  if (meshTex) return meshTex
  const n = 128
  const c = document.createElement('canvas'); c.width = c.height = n
  const x = c.getContext('2d')!
  x.fillStyle = '#050506'; x.fillRect(0, 0, n, n)
  x.strokeStyle = '#3a3c42'; x.lineWidth = 5
  const r = n / 4
  const hex = (cx: number, cy: number) => {
    x.beginPath()
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) }
    x.closePath(); x.stroke()
  }
  const w = r * Math.sqrt(3)
  for (let row = -1; row < 4; row++) for (let col = -1; col < 4; col++) hex(col * w + (row % 2 ? w / 2 : 0), row * r * 1.5)
  meshTex = new THREE.CanvasTexture(c)
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping
  meshTex.repeat.set(22, 4)
  meshTex.colorSpace = THREE.SRGBColorSpace
  meshTex.anisotropy = 8
  return meshTex
}

let weaveTex: THREE.Texture | null = null
/** 2x2 twill carbon weave, very low contrast. */
function weave() {
  if (weaveTex) return weaveTex
  const n = 64
  const c = document.createElement('canvas'); c.width = c.height = n
  const x = c.getContext('2d')!
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const k = ((i + j) >> 1) % 2
    const g = x.createLinearGradient(i * 8, j * 8, i * 8 + (k ? 8 : 0), j * 8 + (k ? 0 : 8))
    g.addColorStop(0, k ? '#2a2c30' : '#141518'); g.addColorStop(1, k ? '#1a1b1e' : '#222428')
    x.fillStyle = g; x.fillRect(i * 8, j * 8, 8, 8)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(6, 6)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  weaveTex = t
  return t
}

/** x of each LED segment across the full-width tail light */
const TAIL_SEGS = Array.from({ length: 28 }, (_, k) => -0.7 + k * (1.4 / 27))

/** [x, z] of the four lift modules recessed into the floor, inboard of the wheels */
const NOZZLES: [number, number][] = [[0.6, 0.85], [-0.6, 0.85], [0.6, -1.0], [-0.6, -1.0]]

/* ------------------------------------------------------------------ component */

let plumeTex: THREE.Texture | null = null
/** Vertical alpha ramp: bright at the nozzle, gone at the tip. */
function plumeAlpha() {
  if (plumeTex) return plumeTex
  const c = document.createElement('canvas'); c.width = 4; c.height = 128
  const x = c.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, '#9a9a9a'); g.addColorStop(0.55, '#262626'); g.addColorStop(1, '#000000')
  x.fillStyle = g; x.fillRect(0, 0, 4, 128)
  plumeTex = new THREE.CanvasTexture(c)
  return plumeTex
}

let flakeTex: THREE.Texture | null = null
function flakeNormal() {
  if (flakeTex) return flakeTex
  const n = 256
  const c = document.createElement('canvas'); c.width = c.height = n
  const x = c.getContext('2d')!
  const img = x.createImageData(n, n)
  for (let i = 0; i < n * n; i++) {
    const nx = (Math.random() - 0.5) * 0.9, ny = (Math.random() - 0.5) * 0.9
    const l = Math.hypot(nx, ny, 1)
    img.data[i * 4] = ((nx / l) * 0.5 + 0.5) * 255
    img.data[i * 4 + 1] = ((ny / l) * 0.5 + 0.5) * 255
    img.data[i * 4 + 2] = ((1 / l) * 0.5 + 0.5) * 255
    img.data[i * 4 + 3] = 255
  }
  x.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(26, 26)
  t.anisotropy = 4
  flakeTex = t
  return t
}

/** Registered so the garage can export the live car as a GLB for editing in Blender and friends. */
export const carRef: { current: THREE.Group | null } = { current: null }

export async function exportCarGLB(name = 'orbital-roadster.glb') {
  if (!carRef.current) return
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')
  const buf = (await new GLTFExporter().parseAsync(carRef.current, { binary: true, onlyVisible: true })) as ArrayBuffer
  const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function Car({
  paint, variant, control, shadows = false, beam = 0.7, gas = false, groundY, finishOverride,
}: {
  /** per-shot paint finish, layered over the garage finish without saving it */
  finishOverride?: Partial<Finish>
  /** emit cold-gas vapour clouds from the lift modules */
  gas?: boolean
  /** world ground height the vapour rolls out across (omit in open space) */
  groundY?: MutableRefObject<number>
  /** length of the lift beams, roughly the hover height */
  beam?: number
  paint: string
  variant: VariantId
  control?: MutableRefObject<CarControl>
  shadows?: boolean
}) {
  const root = useRef<THREE.Group>(null)
  const finishStore = useStore((st) => st.finish)
  const overrideKey = finishOverride ? JSON.stringify(finishOverride) : ''
  const finish = useMemo(() => (finishOverride ? { ...finishStore, ...finishOverride } : finishStore), [finishStore, overrideKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const customHex = useStore((st) => st.customHex)
  const frontL = useRef<THREE.Group>(null)
  const frontR = useRef<THREE.Group>(null)
  const spinners = useRef<THREE.Group[]>([])
  const tail = useRef<THREE.MeshBasicMaterial>(null)
  const jets = useRef<THREE.Group>(null)
  const plumes = useRef<THREE.Group>(null)
  const fanRotors = useRef<THREE.Group[]>([])
  const fins = useRef<THREE.Group[]>([])
  const target = useMemo(() => new THREE.Color(paint), []) // eslint-disable-line react-hooks/exhaustive-deps
  const spinAngle = useRef(0)
  const dummy = useMemo(() => newControl(), [])

  const paintMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: paint, metalness: 0.8, roughness: 0.27, clearcoat: 0.9, clearcoatRoughness: 0.1,
        envMapIntensity: 1.0,
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const linerMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#050608', roughness: 0.95, metalness: 0 }), [])
  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        // bronze-tinted optical glass: dark body, strong environment reflection
        color: '#2a1e10', metalness: 0.1, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.52,
        specularIntensity: 1, envMapIntensity: 1.7, transparent: true, opacity: 0.86, iridescence: 0.2, iridescenceIOR: 1.6,
      }),
    [],
  )
  const carbon = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: weave(), roughness: 0.34, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }), [])
  const darkMetal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.4, metalness: 1 }), [])
  const rubber = useMemo(() => new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.9, metalness: 0 }), [])
  const rotorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7b7e84', roughness: 0.36, metalness: 1 }), [])
  const caliperMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#7a1c17', roughness: 0.32, metalness: 0.3, clearcoat: 0.8 }), [])
  const leather = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b1d15', roughness: 0.62, metalness: 0 }), [])
  const sidewallMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a4b50', alphaMap: sidewall(), transparent: true, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 }), [])
  const grille = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', map: hexMesh(), roughness: 0.55, metalness: 0.5 }), [])
  const tailSeg = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a1f').multiplyScalar(2.2), toneMapped: false }), [])
  const lens = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#050506', roughness: 0.18, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.5 }), [])
  const titanium = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8b8f96', roughness: 0.3, metalness: 1 }), [])
  const recess = useMemo(() => new THREE.MeshStandardMaterial({ color: '#030304', roughness: 0.8, metalness: 0.4 }), [])
  const fanGlow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fd0ff').multiplyScalar(1.3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), [])
  const spokeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#060607', roughness: 0.28, metalness: 0.75 }), [])
  const alloy = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c3c6cc', roughness: 0.32, metalness: 1 }), [])
  const bronze = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8d6b4d', roughness: 0.34, metalness: 1 }), [])
  const cladding = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#0b0c0f', roughness: 0.42, metalness: 0.25, clearcoat: 0.5, clearcoatRoughness: 0.3 }), [])
  const rimMat = useMemo(() => new THREE.MeshPhysicalMaterial({ color: '#0b0c0f', roughness: 0.22, metalness: 0.7, clearcoat: 1 }), [])
  const chrome = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9dce0', roughness: 0.12, metalness: 1 }), [])
  const cabinGlow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a3a').multiplyScalar(1.1), toneMapped: false }), [])
  const plumeMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#a8d8ff').multiplyScalar(1.2), alphaMap: plumeAlpha(), side: THREE.DoubleSide, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )
  const lightBar = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4f7ff').multiplyScalar(1.4), toneMapped: false }), [])
  const redGlow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a1f').multiplyScalar(1.7), toneMapped: false }), [])
  const jetMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8a4a').multiplyScalar(2.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )

  const wheel = useWheelGeometry()

  const trimMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3a2417', roughness: 0.7, metalness: 0 }), [])
  const edgeMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#050506', transparent: true, opacity: 0.9 }), [])

  const bodyMesh = useMemo(() => {
    // crisp blade-like flanks: panels stay flat across, creases hold, surfaces still flow along the length
    const body = loft(STATIONS.map(stationRing), 3, 0.45, { along: HP() ? 12 : 6, across: HP() ? 5 : 3, round: 0.18 })
    const wells: Well[] = [
      { x: 0.96, y: WHEEL_R, z: FRONT_Z, r: 0.415, len: 0.72 },
      { x: -0.96, y: WHEEL_R, z: FRONT_Z, r: 0.415, len: 0.72 },
      { x: 0.96, y: WHEEL_R, z: REAR_Z, r: 0.415, len: 0.72 },
      { x: -0.96, y: WHEEL_R, z: REAR_Z, r: 0.415, len: 0.72 },
    ]
    const ev = new Evaluator()
    ev.useGroups = true
    // open cabin tub, trimmed in leather, so the doors reveal a real interior
    const tub = csgBox(-TUB.x, TUB.x, TUB.y0, 1.4, TUB.z0, TUB.z1, trimMat)
    const shell = ev.evaluate(cutWells(body, paintMat, linerMat, wells) as Brush, tub, SUBTRACTION)
    body.dispose()
    tub.geometry.dispose()
    let mesh: Brush = shell
    const doors = [1, -1].map((sx) => {
      // painted lower door: the flank skin inside the door volume; its jambs are dark liner
      const vol = doorVolume(ev, sx, 0, linerMat)
      const hole = doorVolume(ev, sx, DOOR.gap, linerMat)
      const panel = ev.evaluate(shell, vol, INTERSECTION)
      mesh = ev.evaluate(mesh, hole, SUBTRACTION)
      vol.geometry.dispose()
      hole.geometry.dispose()
      return panel
    })
    mesh.castShadow = false
    const band = cutWells(loft(STATIONS.map(lowerRing), 2, 0.6, { along: HP() ? 12 : 6, across: HP() ? 3 : 2, round: 0.3 }), cladding, linerMat, wells.map((w) => ({ ...w, r: w.r + 0.01 })))
    mesh.add(band)
    return { mesh, doors }
  }, [paintMat, linerMat, cladding, trimMat])

  const canopy = useMemo(() => {
    const solid = loft(CANOPY.map(canopyRing), 1, 0.7, { along: HP() ? 16 : 8, across: HP() ? 6 : 3, round: 0.55 })
    // hollow it: a slightly smaller copy, dropped so it pierces the floor, leaves a ~2-3 cm glass shell
    const inner = solid.clone()
    inner.translate(0, -0.74, 0.2)
    inner.scale(0.92, 1.06, 0.97)
    inner.translate(0, 0.7, -0.2)
    const ev = new Evaluator()
    ev.useGroups = true
    const shell = ev.evaluate(csgBrush(solid, glassMat), csgBrush(inner, glassMat), SUBTRACTION)
    solid.dispose()
    inner.dispose()
    let mesh: Brush = shell
    const doors = [1, -1].map((sx) => {
      const vol = doorVolume(ev, sx, 0, glassMat)
      const hole = doorVolume(ev, sx, DOOR.gap, glassMat)
      const glass = ev.evaluate(shell, vol, INTERSECTION)
      mesh = ev.evaluate(mesh, hole, SUBTRACTION)
      vol.geometry.dispose()
      hole.geometry.dispose()
      return { glass, lines: new THREE.LineSegments(new THREE.EdgesGeometry(glass.geometry, 38), edgeMat) }
    })
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 38), edgeMat)
    return { mesh, lines, doors }
  }, [glassMat, edgeMat])

  /** one hinge group per side, door parts re-based so the group origin is the hinge point */
  const doorParts = useMemo(
    () =>
      [1, -1].map((sx, k) => {
        const parts: THREE.Object3D[] = [bodyMesh.doors[k], canopy.doors[k].glass, canopy.doors[k].lines]
        parts.forEach((o) => o.position.set(-sx * DOOR.x0, -HINGE[0], -HINGE[1]))
        return { sx, parts }
      }),
    [bodyMesh, canopy],
  )
  const doorPivots = useRef<THREE.Group[]>([])
  const doorOpen = useRef(0)
  const reduceMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    target.set(customHex ?? paint)
  }, [paint, customHex, target])

  useEffect(() => {
    paintMat.metalness = finish.metalness
    paintMat.roughness = finish.roughness
    paintMat.clearcoat = finish.clearcoat
    paintMat.clearcoatRoughness = 0.08 + (1 - finish.clearcoat) * 0.2
    paintMat.iridescence = finish.iridescence
    paintMat.iridescenceIOR = 1.6
    paintMat.iridescenceThicknessRange = [180, 520]
    paintMat.normalMap = finish.flake > 0.01 ? flakeNormal() : null
    paintMat.normalScale.setScalar(finish.flake * 0.35)
    paintMat.needsUpdate = true
    const w = WHEELS[finish.wheel]
    alloy.color.set(w.color); alloy.metalness = w.metal; alloy.roughness = w.rough
  }, [finish, paintMat, alloy])

  useEffect(() => {
    root.current?.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        const mat = m.material as THREE.Material
        const glow = (mat as THREE.MeshBasicMaterial).isMeshBasicMaterial
        m.castShadow = shadows && !glow
        m.receiveShadow = shadows && !glow
      }
    })
  }, [shadows, variant])

  useEffect(() => {
    carRef.current = root.current
    return () => { if (carRef.current === root.current) carRef.current = null }
  }, [])

  useEffect(() => {
    return () => {
      bodyMesh.mesh.geometry.dispose()
      bodyMesh.doors.forEach((d) => d.geometry.dispose())
      canopy.mesh.geometry.dispose()
      canopy.lines.geometry.dispose()
      canopy.doors.forEach((d) => { d.glass.geometry.dispose(); d.lines.geometry.dispose() })
      ;[trimMat, edgeMat, paintMat, linerMat, glassMat, carbon, darkMetal, rubber, spokeMat, alloy, bronze, lightBar, redGlow, jetMat, cladding, rimMat, chrome, cabinGlow, plumeMat, rotorMat, caliperMat, leather, lens, titanium, recess, fanGlow, sidewallMat, grille, tailSeg].forEach((m) => m.dispose())
      Object.values(wheel).flat().forEach((g) => (g as THREE.BufferGeometry).dispose())
    }
  }, [bodyMesh, canopy, trimMat, edgeMat, paintMat, linerMat, glassMat, carbon, darkMetal, rubber, spokeMat, alloy, bronze, lightBar, redGlow, jetMat, cladding, rimMat, chrome, cabinGlow, plumeMat, rotorMat, caliperMat, leather, lens, titanium, recess, fanGlow, sidewallMat, grille, tailSeg, wheel])

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const c = control?.current ?? dummy
    paintMat.color.lerp(target, 1 - Math.exp(-dt * 6))
    spinAngle.current += c.spin * dt
    const steerAngle = c.steer * 0.5
    if (frontL.current) frontL.current.rotation.y = steerAngle
    if (frontR.current) frontR.current.rotation.y = steerAngle
    spinners.current.forEach((g, i) => {
      if (g) g.rotation.x = i % 2 === 0 ? spinAngle.current : -spinAngle.current
    })
    if (root.current) {
      root.current.rotation.z = THREE.MathUtils.damp(root.current.rotation.z, c.roll, 8, dt)
      root.current.rotation.x = THREE.MathUtils.damp(root.current.rotation.x, c.pitch, 8, dt)
    }
    redGlow.color.set('#ff1a1f').multiplyScalar((c.brake > 0.1 ? 3.4 : 1.6) * (c.tail ?? 1))
    jetMat.opacity = THREE.MathUtils.damp(jetMat.opacity, c.boost > 0.05 ? 0.85 : 0, 12, dt)
    const lift = c.lift ?? 0
    // beams: faint, steady, a slow shimmer rather than a flame
    plumeMat.opacity = THREE.MathUtils.damp(plumeMat.opacity, lift > 0.02 ? (gas ? 0.012 + lift * 0.02 : 0.05 + lift * 0.09) : 0, 6, dt)
    if (plumes.current) {
      const fl = 0.96 + Math.sin(performance.now() * 0.004) * 0.03
      plumes.current.children.forEach((p) => p.scale.set(fl, 1, fl))
    }
    // stabilizers deploy out of the rear flanks with lift
    fins.current.forEach((g, k) => {
      if (g) g.rotation.z = THREE.MathUtils.damp(g.rotation.z, (k ? -1 : 1) * Math.min(1, lift * 1.4) * 0.55, 4, dt)
    })
    // butterfly doors: cant out, then lift up and forward about the hinge
    const doorTarget = THREE.MathUtils.clamp(c.doors ?? 0, 0, 1)
    doorOpen.current = reduceMotion ? doorTarget : THREE.MathUtils.damp(doorOpen.current, doorTarget, 3, dt)
    const dOpen = doorOpen.current * doorOpen.current * (3 - 2 * doorOpen.current)
    doorPivots.current.forEach((g, k) => {
      if (g) g.rotation.set(dOpen * DOOR_LIFT, 0, (k ? -1 : 1) * dOpen * DOOR_CANT)
    })
    fanGlow.opacity = THREE.MathUtils.damp(fanGlow.opacity, lift * 0.5, 8, dt)
    fanRotors.current.forEach((g, k) => { if (g) g.rotation.y += dt * (6 + lift * 30) * (k ? -1 : 1) })
    if (jets.current) {
      const f = 0.7 + Math.sin(performance.now() * 0.06) * 0.2
      jets.current.scale.set(1, 1, Math.max(0.01, c.boost * 1.6 * f))
    }
  })

  const wingCfg = {
    sport: { w: 1.5, d: 0.42, y: 1.0, z: -2.3, end: 0.08, pylonH: 0.14 },
    velocity: { w: 1.78, d: 0.54, y: 1.1, z: -2.32, end: 0.14, pylonH: 0.24 },
    apex: { w: 1.96, d: 0.7, y: 1.2, z: -2.34, end: 0.26, pylonH: 0.34 },
  }[variant]

  const wingGeo = useMemo(() => airfoil(wingCfg.w, wingCfg.d, 0.06), [wingCfg.w, wingCfg.d])
  useEffect(() => () => wingGeo.dispose(), [wingGeo])
  /** tapered pylon: broad at the deck, slim under the wing */
  const pylonGeo = useMemo(() => {
    const h = wingCfg.pylonH
    const sh = new THREE.Shape([new THREE.Vector2(-0.12, -h - 0.07), new THREE.Vector2(0.1, -h - 0.07), new THREE.Vector2(0.05, 0), new THREE.Vector2(-0.05, 0)])
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.024, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 })
    g.rotateY(Math.PI / 2)
    g.translate(-0.012, 0, 0)
    return g
  }, [wingCfg.pylonH])
  useEffect(() => () => pylonGeo.dispose(), [pylonGeo])

  const wheelAt = (i: number, x: number, z: number, steerRef?: MutableRefObject<THREE.Group | null>) => {
    const right = x > 0
    return (
      <group key={i} position={[x, WHEEL_R, z]} ref={steerRef}>
        <group rotation={[0, right ? 0 : Math.PI, 0]}>
          <group ref={(g) => { if (g) spinners.current[i] = g }}>
            <mesh geometry={wheel.tire} material={rubber} />
            <mesh geometry={wheel.barrel} material={darkMetal} />
            <mesh geometry={wheel.back} material={recess} />
            <mesh geometry={wheel.rotor} material={rotorMat} />
            <mesh geometry={wheel.rotorHat} material={darkMetal} />
            {wheel.blades.map((g, k) => (
              <mesh key={k} geometry={g} material={alloy} />
            ))}
            <mesh geometry={wheel.lip} material={alloy} />
            <mesh geometry={wheel.hub} material={rimMat} />
            <mesh geometry={wheel.wall} material={sidewallMat} />
            <mesh geometry={wheel.nut} material={titanium} />
            <mesh geometry={wheel.pin} material={caliperMat} />
          </group>
          {/* caliper stays put while the wheel turns: top-rear of the rotor */}
          <mesh geometry={wheel.caliper} material={caliperMat} rotation={[0.35, 0, 0]} />
        </group>
      </group>
    )
  }

  const fans = [-0.375, -0.125, 0.125, 0.375]

  return (
    <group ref={root} name="orbital-roadster" castShadow={shadows}>
      <primitive object={bodyMesh.mesh} />

      {/* canopy */}
      <primitive object={canopy.mesh} />
      <primitive object={canopy.lines} />

      {/* butterfly doors, each cut from the flank and canopy, hinged at the top of the A-pillar */}
      {doorParts.map(({ sx, parts }, k) => (
        <group key={`door${sx}`} ref={(g) => { if (g) doorPivots.current[k] = g }} position={[sx * DOOR.x0, HINGE[0], HINGE[1]]}>
          {parts.map((o, i) => <primitive key={i} object={o} />)}
        </group>
      ))}

      {/* front-fender louvres: carbon slats in a recessed pocket on the flat fender crown */}
      {[1, -1].map((sx) => (
        <group key={`lv${sx}`} position={[sx * 0.83, 0.874, 1.06]} rotation={[0.105, 0, 0]}>
          <mesh material={recess}>
            <boxGeometry args={[0.2, 0.004, 0.26]} />
          </mesh>
          {[-0.1, -0.06, -0.02, 0.02, 0.06, 0.1].map((z) => (
            <mesh key={z} material={carbon} position={[0, 0.006, z]} rotation={[-0.5, 0, 0]}>
              <boxGeometry args={[0.19, 0.006, 0.026]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* camera pods on the fender crowns in place of mirrors */}
      {[1, -1].map((sx) => (
        <group key={`cam${sx}`} position={[sx * 0.86, 0.88, 0.7]}>
          <mesh material={carbon} position={[0, 0.03, 0]}>
            <boxGeometry args={[0.014, 0.06, 0.05]} />
          </mesh>
          <mesh material={paintMat} position={[sx * 0.02, 0.07, -0.01]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.55]}>
            <capsuleGeometry args={[0.022, 0.07, 6, 16]} />
          </mesh>
          <mesh material={lens} position={[sx * 0.02, 0.07, -0.062]}>
            <sphereGeometry args={[0.012, 12, 8]} />
          </mesh>
        </group>
      ))}

      {/* sill skirts */}
      {[-1, 1].map((sx) => (
        <mesh key={`sk${sx}`} material={carbon} position={[sx * 0.985, 0.2, 0]}>
          <boxGeometry args={[0.04, 0.11, 2.3]} />
        </mesh>
      ))}

      {/* nose */}
      {/* hidden headlamp: a dark lens across the nose tip with one thin light blade, both clear of the paint */}
      <mesh material={lens} position={[0, 0.27, 2.352]}>
        <boxGeometry args={[0.84, 0.034, 0.014]} />
      </mesh>
      <mesh material={lightBar} position={[0, 0.272, 2.362]}>
        <boxGeometry args={[0.78, 0.007, 0.006]} />
      </mesh>
      {/* lower intake below the light blade */}
      <mesh material={cladding} position={[0, 0.2, 2.35]}>
        <boxGeometry args={[0.6, 0.05, 0.016]} />
      </mesh>
      <mesh material={carbon} position={[0, 0.11, 2.06]}>
        <boxGeometry args={[1.22, 0.014, 0.34]} />
      </mesh>

      {/* tail */}
      {/* full-width tail light: a smoked lens with individual LED segments behind it */}
      <mesh material={lens} position={[0, 0.745, -2.277]}>
        <boxGeometry args={[1.56, 0.056, 0.016]} />
      </mesh>
      {TAIL_SEGS.map((x) => (
        <mesh key={`ts${x}`} material={tailSeg} position={[x, 0.745, -2.287]}>
          <boxGeometry args={[0.044, 0.016, 0.006]} />
        </mesh>
      ))}
      <mesh material={redGlow} position={[0, 0.733, -2.286]}>
        <boxGeometry args={[1.46, 0.004, 0.004]} />
      </mesh>
      {/* black rear fascia with a hex-mesh grille under the light */}
      <mesh material={cladding} position={[0, 0.565, -2.275]}>
        <boxGeometry args={[1.56, 0.27, 0.03]} />
      </mesh>
      <mesh material={grille} position={[0, 0.57, -2.292]}>
        <boxGeometry args={[1.36, 0.18, 0.004]} />
      </mesh>
      {/* carbon diffuser with vertical strakes */}
      <mesh material={carbon} position={[0, 0.15, -1.98]} rotation={[0.18, 0, 0]}>
        <boxGeometry args={[1.5, 0.018, 0.62]} />
      </mesh>
      {[-0.6, -0.3, 0, 0.3, 0.6].map((x) => (
        <mesh key={`fin${x}`} material={carbon} position={[x, 0.22, -2.0]} rotation={[0.18, 0, 0]}>
          <boxGeometry args={[0.014, 0.15, 0.58]} />
        </mesh>
      ))}
      {/* quad rear cold-gas nozzles: titanium tube, dark recessed throat */}
      {fans.map((x) => (
        <group key={`t${x}`} position={[x, 0.42, -2.3]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={titanium}>
            <cylinderGeometry args={[0.05, 0.054, 0.1, 28, 1, true]} />
          </mesh>
          <mesh material={recess} position={[0, 0.02, 0]}>
            <cylinderGeometry args={[0.042, 0.042, 0.06, 20]} />
          </mesh>
        </group>
      ))}
      <group ref={jets} position={[0, 0.42, -2.36]}>
        {fans.map((x) => (
          <mesh key={`j${x}`} material={jetMat} position={[x, 0, -0.5]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.055, 1.0, 12, 1, true]} />
          </mesh>
        ))}
      </group>

      {/* wing */}
      <group position={[0, wingCfg.y, wingCfg.z]}>
        {[-1, 1].map((s) => (
          <mesh key={s} geometry={pylonGeo} material={carbon} position={[s * 0.5, 0, 0.08]} />
        ))}
        <mesh geometry={wingGeo} material={paintMat} rotation={[-0.09, 0, 0]} />
        <mesh material={redGlow} position={[0, -0.002, -wingCfg.d / 2 - 0.004]} rotation={[-0.09, 0, 0]}>
          <boxGeometry args={[wingCfg.w * 0.94, 0.02, 0.01]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={`e${s}`} position={[s * (wingCfg.w / 2), 0.0, 0]}>
            <mesh material={carbon}>
              <boxGeometry args={[0.014, wingCfg.end + 0.08, wingCfg.d * 1.02]} />
            </mesh>
            {/* light blade set into each endplate */}
            <mesh material={redGlow} position={[s * 0.009, 0, -wingCfg.d * 0.49]}>
              <boxGeometry args={[0.004, (wingCfg.end + 0.08) * 0.8, 0.018]} />
            </mesh>
          </group>
        ))}
      </group>

      {/* warm-lit leather cabin, seen through the gold glass and through the open doors */}
      <mesh material={leather} position={[0, TUB.y0 + 0.012, -0.03]}>
        <boxGeometry args={[TUB.x * 2 - 0.02, 0.02, TUB.z1 - TUB.z0 - 0.02]} />
      </mesh>
      {/* dash with the glow strip along its face, steering wheel, centre tunnel */}
      <mesh material={leather} position={[0, 0.66, 0.66]}>
        <boxGeometry args={[TUB.x * 2 - 0.04, 0.14, 0.26]} />
      </mesh>
      <mesh material={titanium} position={[-0.27, 0.71, 0.45]} rotation={[0.35, 0, 0]}>
        <torusGeometry args={[0.12, 0.014, 10, 36]} />
      </mesh>
      <mesh material={leather} position={[0, 0.52, 0.05]}>
        <boxGeometry args={[0.16, 0.12, 0.9]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={`seat${s}`} position={[s * 0.3, 0.47, -0.4]}>
          <mesh material={leather} position={[0, 0.04, 0.1]}>
            <boxGeometry args={[0.34, 0.07, 0.4]} />
          </mesh>
          <mesh material={leather} position={[0, 0.2, -0.12]} rotation={[0.38, 0, 0]}>
            <boxGeometry args={[0.32, 0.38, 0.07]} />
          </mesh>
        </group>
      ))}
      <mesh material={cabinGlow} position={[0, 0.66, 0.527]}>
        <boxGeometry args={[1.2, 0.008, 0.008]} />
      </mesh>
      <pointLight position={[0, 0.86, -0.1]} color="#ff8a3a" intensity={1.6} distance={2.4} decay={2} />

      {/* four lift modules recessed flush into the floor: titanium bezel, emitter face */}
      {NOZZLES.map(([x, z], i) => (
        <group key={`lm${i}`} position={[x, 0.095, z]}>
          <mesh material={titanium} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.13, 0.014, 10, 40]} />
          </mesh>
          <mesh material={recess} position={[0, 0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.125, 32]} />
          </mesh>
          <mesh material={fanGlow} position={[0, -0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.1, 32]} />
          </mesh>
        </group>
      ))}
      {/* downward light beams: open, double-sided, alpha fading toward the ground */}
      <group ref={plumes}>
        {NOZZLES.map(([x, z], i) => (
          <group key={`pl${i}`} position={[x, 0.1, z]}>
            <mesh material={plumeMat} position={[0, -beam / 2, 0]}>
              <cylinderGeometry args={[0.12, 0.55, beam, 32, 1, true]} />
            </mesh>
            <mesh material={plumeMat} position={[0, -beam * 0.3, 0]}>
              <cylinderGeometry args={[0.07, 0.2, beam * 0.6, 24, 1, true]} />
            </mesh>
          </group>
        ))}
      </group>

      {gas && (
        <Gas root={root} emitters={NOZZLES.map(([x, z]) => [x, 0.09, z] as [number, number, number])} lift={() => (control?.current ?? dummy).lift} groundY={groundY} />
      )}

      {/* deployable stabilizers, hinged at the rear flanks */}
      {[1, -1].map((sx, k) => (
        <group key={`fin${sx}`} ref={(g) => { if (g) fins.current[k] = g }} position={[sx * 0.97, 0.64, -1.75]}>
          <mesh material={carbon} position={[sx * 0.11, 0, 0]}>
            <boxGeometry args={[0.22, 0.014, 0.38]} />
          </mesh>
        </group>
      ))}

      {/* underbody: satin floor tray and the two ground-effect suction fans */}
      <mesh material={cladding} position={[0, 0.118, -0.1]}>
        <boxGeometry args={[1.56, 0.012, 3.5]} />
      </mesh>
      {[0.42, -0.62].map((z, k) => (
        <group key={z} position={[0, 0.094, z]}>
          <mesh material={titanium} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.25, 0.018, 10, 48]} />
          </mesh>
          <mesh material={recess} position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.24, 40]} />
          </mesh>
          <mesh material={fanGlow} position={[0, 0.002, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.2, 0.24, 48]} />
          </mesh>
          <group ref={(g) => { if (g) fanRotors.current[k] = g }}>
            {Array.from({ length: 9 }, (_, b) => (
              <mesh key={b} material={darkMetal} rotation={[0, (b / 9) * Math.PI * 2, 0.35]} position={[Math.cos((b / 9) * Math.PI * 2) * 0.12, -0.004, -Math.sin((b / 9) * Math.PI * 2) * 0.12]}>
                <boxGeometry args={[0.2, 0.006, 0.05]} />
              </mesh>
            ))}
            <mesh material={titanium} position={[0, -0.006, 0]}>
              <cylinderGeometry args={[0.045, 0.045, 0.02, 20]} />
            </mesh>
          </group>
        </group>
      ))}

      {/* wheels */}
      {wheelAt(0, TRACK_X, REAR_Z)}
      {wheelAt(1, -TRACK_X, REAR_Z)}
      {wheelAt(2, TRACK_X, FRONT_Z, frontR)}
      {wheelAt(3, -TRACK_X, FRONT_Z, frontL)}
    </group>
  )
}

export const CAR_DIMENSIONS = { length: 4.4, width: 2.0, height: 1.07, wheelRadius: WHEEL_R }
