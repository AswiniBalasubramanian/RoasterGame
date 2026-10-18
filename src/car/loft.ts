import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'

/**
 * Cross-section of the body at one station along the car's length (z = forward).
 * Half profile, mirrored across x = 0. Points run bottom-centre -> outwards -> up -> top-centre.
 */
export interface Station {
  z: number
  yB: number; wB: number // underbody edge
  yS: number; wS: number // lower sill
  yM: number; wM: number // flank
  yF: number; wF: number // fender crown (outer)
  yI: number; wI: number // fender crown (inner)
  yH: number; wH: number // hood / deck edge, and centre-line height
}

export function stationRing(s: Station): THREE.Vector3[] {
  const R: [number, number][] = [
    [0, s.yB],
    [s.wB, s.yB],
    [s.wS, s.yS],
    [s.wM, s.yM],
    [s.wF, s.yF],
    [s.wI, s.yI],
    [s.wH, s.yH],
    [0, s.yH],
  ]
  const pts = R.map(([x, y]) => new THREE.Vector3(x, y, s.z))
  for (let i = 6; i >= 1; i--) pts.push(new THREE.Vector3(-R[i][0], R[i][1], s.z))
  return pts
}

/**
 * Loft a closed solid through rings of equal vertex count. Produces an indexed, watertight,
 * outward-facing mesh (required for boolean ops). `testK` is a ring edge whose outward normal is +x.
 */
export interface Refine {
  /** subdivisions between stations (Catmull-Rom along the length) */
  along: number
  /** subdivisions between profile points */
  across: number
  /** 0 = flat panels with knife creases, 1 = fully rounded section */
  round: number
}

/**
 * Densify rings: smooth spline along the car's length so the surface flows instead of stepping
 * station to station, and a blend of straight/spline across the section so panels get a slight
 * crown while the real character lines stay crisp.
 */
function refineRings(rings: THREE.Vector3[][], r: Refine): THREE.Vector3[][] {
  const n = rings[0].length
  const across = rings.map((ring) => {
    const curve = new THREE.CatmullRomCurve3(ring, true, 'centripetal')
    const out: THREE.Vector3[] = []
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n]
      for (let j = 0; j < r.across; j++) {
        const t = j / r.across
        const lin = a.clone().lerp(b, t)
        out.push(j === 0 ? a.clone() : lin.lerp(curve.getPoint((k + t) / n), r.round))
      }
    }
    return out
  })
  const m = across[0].length
  const cols = Array.from({ length: m }, (_, k) => new THREE.CatmullRomCurve3(across.map((ring) => ring[k]), false, 'centripetal'))
  const out: THREE.Vector3[][] = []
  const steps = (across.length - 1) * r.along
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push(cols.map((c) => c.getPoint(t)))
  }
  return out
}

export function loft(rings: THREE.Vector3[][], testK: number, crease = 0.78, refine?: Refine): THREE.BufferGeometry {
  if (refine) {
    rings = refineRings(rings, refine)
    testK = testK * refine.across + Math.floor(refine.across / 2)
  }
  const n = rings[0].length
  const pos: number[] = []
  rings.forEach((r) => r.forEach((p) => pos.push(p.x, p.y, p.z)))

  // decide side winding with one reference triangle
  const mid = Math.floor(rings.length / 2) - 1
  const a0 = rings[mid][testK], b0 = rings[mid][(testK + 1) % n], c0 = rings[mid + 1][(testK + 1) % n]
  const nrm = new THREE.Vector3().subVectors(b0, a0).cross(new THREE.Vector3().subVectors(c0, a0))
  const flip = nrm.x < 0

  const idx: number[] = []
  const tri = (a: number, b: number, c: number) => (flip ? idx.push(a, c, b) : idx.push(a, b, c))
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n
      const a = i * n + k, b = i * n + k2, c = (i + 1) * n + k2, d = (i + 1) * n + k
      tri(a, b, c)
      tri(a, c, d)
    }
  }

  const cap = (ri: number, dirZ: number) => {
    const ring = rings[ri]
    const c = new THREE.Vector3()
    ring.forEach((p) => c.add(p))
    c.divideScalar(n)
    const ci = pos.length / 3
    pos.push(c.x, c.y, c.z)
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n
      const e1 = new THREE.Vector3().subVectors(ring[k], c)
      const e2 = new THREE.Vector3().subVectors(ring[k2], c)
      const z = e1.cross(e2).z
      if (z * dirZ > 0) idx.push(ci, ri * n + k, ri * n + k2)
      else idx.push(ci, ri * n + k2, ri * n + k)
    }
  }
  cap(0, -1)
  cap(rings.length - 1, 1)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2))
  // smooth within a panel, crisp across real creases
  const creased = toCreasedNormals(g, crease)
  g.dispose()
  return creased
}

export interface Well { x: number; y: number; z: number; r: number; len: number }

/** Subtract cylindrical wheel wells from the body. Returns a mesh whose material is [paint, liner]. */
export function cutWells(body: THREE.BufferGeometry, paint: THREE.Material, liner: THREE.Material, wells: Well[]): THREE.Mesh {
  const ev = new Evaluator()
  ev.useGroups = true
  let result: Brush = new Brush(body, paint)
  result.updateMatrixWorld()
  for (const w of wells) {
    const cg = new THREE.CylinderGeometry(w.r, w.r, w.len, 40, 1)
    cg.rotateZ(Math.PI / 2)
    const cut = new Brush(cg, liner)
    cut.position.set(w.x, w.y, w.z)
    cut.updateMatrixWorld()
    result = ev.evaluate(result, cut, SUBTRACTION)
    cg.dispose()
  }
  return result
}
