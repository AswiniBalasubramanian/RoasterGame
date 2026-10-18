import * as THREE from 'three'

/**
 * The Mars Run: a one-way flight line from Earth orbit out to Mars. Open path (no loop):
 * index 0 is the launch gate above Earth, index n-1 is the arrival point in Mars orbit.
 */
export const SAMPLES = 1600
export const HALF_WIDTH = 13
export const CP_COUNT = 8
/** one run, start to Mars */
export const LAPS = 1
/** the real Earth-Mars distance at closest approach, used for the HUD readout */
export const EARTH_MARS_KM = 54.6e6
export const BOOST_PADS = [0.12, 0.27, 0.41, 0.55, 0.68, 0.8, 0.9].map((f, k) => ({ idx: Math.round(f * SAMPLES), off: k % 2 ? 5 : -5 }))

/** Sweeping S-bends heading out along +z, about 5 km long. */
const CONTROL: [number, number][] = Array.from({ length: 18 }, (_, k) => [
  k === 0 ? 0 : Math.sin(k * 0.9) * 170 + Math.sin(k * 0.37 + 0.6) * 110,
  k * 290,
])

export interface Track {
  n: number
  length: number
  ds: number
  px: Float32Array
  pz: Float32Array
  /** course altitude: the flight line climbs and dives through space */
  py: Float32Array
  /** unit tangent */
  tx: Float32Array
  tz: Float32Array
  /** unit side vector (car's left when heading along the tangent) */
  sx: Float32Array
  sz: Float32Array
  minimap: { d: string; w: number; h: number; ox: number; oz: number; s: number }
  /** arrival point and the direction Mars lies in beyond it */
  end: THREE.Vector3
  endDir: THREE.Vector3
}

function build(): Track {
  const pts = CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z))
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
  const sp = curve.getSpacedPoints(SAMPLES - 1)
  const n = sp.length
  const px = new Float32Array(n), pz = new Float32Array(n)
  const tx = new Float32Array(n), tz = new Float32Array(n)
  const sx = new Float32Array(n), sz = new Float32Array(n)
  const py = new Float32Array(n)
  sp.forEach((p, i) => {
    px[i] = p.x; pz[i] = p.z
    const u = (i / n) * Math.PI * 2
    // climbs and dives, easing to level flight at launch and arrival
    const ends = Math.min(1, i / 60, (n - 1 - i) / 90)
    py[i] = 30 + (Math.sin(u * 3) * 18 + Math.sin(u * 7 + 1.1) * 8) * ends
  })
  let length = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2)
    let dx = px[b] - px[a], dz = pz[b] - pz[a]
    const m = Math.hypot(dx, dz) || 1
    dx /= m; dz /= m
    tx[i] = dx; tz[i] = dz
    sx[i] = dz; sz[i] = -dx
    if (i < n - 1) length += Math.hypot(px[i + 1] - px[i], pz[i + 1] - pz[i])
  }
  // minimap path
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]) }
  const w = maxX - minX, h = maxZ - minZ
  const s = 84 / Math.max(w, h)
  const ox = minX - (100 / s - w) / 2, oz = minZ - (100 / s - h) / 2
  let d = ''
  for (let i = 0; i < n; i += 8) d += `${i === 0 ? 'M' : 'L'}${((px[i] - ox) * s).toFixed(1)} ${(100 - (pz[i] - oz) * s).toFixed(1)} `
  const end = new THREE.Vector3(px[n - 1], py[n - 1], pz[n - 1])
  const endDir = new THREE.Vector3(tx[n - 1], 0, tz[n - 1]).normalize()
  return { n, length, ds: length / (n - 1), px, pz, py, tx, tz, sx, sz, minimap: { d, w, h, ox, oz, s }, end, endDir }
}

export const track = build()

/** Closest sample to (x,z), searching around `hint` (clamped to the open path). */
export function nearest(x: number, z: number, hint: number, win = 36): number {
  const { n, px, pz } = track
  let best = hint, bd = Infinity
  for (let k = -win; k <= win; k++) {
    const i = hint + k
    if (i < 0 || i >= n) continue
    const dx = x - px[i], dz = z - pz[i]
    const d = dx * dx + dz * dz
    if (d < bd) { bd = d; best = i }
  }
  return best
}

/** Signed lateral offset from the centre line (positive = car's left of travel). */
export function lateral(x: number, z: number, i: number): number {
  return (x - track.px[i]) * track.sx[i] + (z - track.pz[i]) * track.sz[i]
}
