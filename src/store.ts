import { create } from 'zustand'

export type VariantId = 'sport' | 'velocity' | 'apex'
export type Quality = 'high' | 'medium' | 'low'

export interface Variant {
  id: VariantId
  name: string
  blurb: string
  /** 0-100 relative ratings used for the bars */
  accel: number
  top: number
  handling: number
  boost: number
  zeroToHundred: string
  topSpeed: string
  /** gameplay multipliers */
  vmax: number
  grip: number
  boostPower: number
}

export const VARIANTS: Record<VariantId, Variant> = {
  sport: {
    id: 'sport',
    name: 'Street',
    blurb: 'Two seats, hidden aero and ground-effect fans that pull the car onto the road. Road-going, wheels down.',
    accel: 78, top: 72, handling: 92, boost: 64,
    zeroToHundred: '2.4 s', topSpeed: '290 km/h',
    vmax: 66, grip: 1.15, boostPower: 0.9,
  },
  velocity: {
    id: 'velocity',
    name: 'Thrust',
    blurb: 'Adds cold-gas thrusters in the tail. Launches harder than anything with tyres should, and the wing earns its keep.',
    accel: 90, top: 86, handling: 84, boost: 82,
    zeroToHundred: '2.0 s', topSpeed: '330 km/h',
    vmax: 72, grip: 1.0, boostPower: 1.1,
  },
  apex: {
    id: 'apex',
    name: 'Flight',
    blurb: 'Thrusters around the whole perimeter for lift, hover and yaw. One seat, full wing, and yes, it leaves the ground.',
    accel: 98, top: 96, handling: 70, boost: 96,
    zeroToHundred: '1.7 s', topSpeed: '372 km/h',
    vmax: 80, grip: 0.86, boostPower: 1.35,
  },
}

export interface Paint { id: string; name: string; hex: string }
export const PAINTS: Paint[] = [
  { id: 'aero', name: 'Aero Silver', hex: '#d6d9de' },
  { id: 'crimson', name: 'Crimson', hex: '#c20f19' },
  { id: 'lunar', name: 'Lunar', hex: '#c9cdd3' },
  { id: 'obsidian', name: 'Obsidian', hex: '#0d0f13' },
  { id: 'cobalt', name: 'Cobalt', hex: '#1f4fe0' },
  { id: 'ember', name: 'Ember', hex: '#e2560a' },
]

export type FinishId = 'ceramic' | 'gloss' | 'metallic' | 'pearl' | 'satin' | 'matte'
export interface Finish {
  preset: FinishId
  metalness: number
  roughness: number
  clearcoat: number
  flake: number
  iridescence: number
  wheel: WheelId
}
export type WheelId = 'silver' | 'graphite' | 'bronze' | 'gold'
export const WHEELS: Record<WheelId, { name: string; color: string; metal: number; rough: number }> = {
  silver: { name: 'Silver', color: '#c3c6cc', metal: 1, rough: 0.3 },
  graphite: { name: 'Graphite', color: '#585c64', metal: 1, rough: 0.3 },
  bronze: { name: 'Bronze', color: '#8d6b4d', metal: 1, rough: 0.34 },
  gold: { name: 'Gold', color: '#c9a24a', metal: 1, rough: 0.28 },
}
export const FINISHES: Record<FinishId, { name: string } & Omit<Finish, 'preset' | 'wheel'>> = {
  ceramic: { name: 'Ceramic', metalness: 0.05, roughness: 0.3, clearcoat: 1, flake: 0, iridescence: 0 },
  gloss: { name: 'Gloss', metalness: 0.25, roughness: 0.22, clearcoat: 1, flake: 0, iridescence: 0 },
  metallic: { name: 'Metallic', metalness: 0.9, roughness: 0.22, clearcoat: 1, flake: 0.25, iridescence: 0 },
  pearl: { name: 'Pearl', metalness: 0.55, roughness: 0.28, clearcoat: 1, flake: 0.3, iridescence: 0.7 },
  satin: { name: 'Satin', metalness: 0.6, roughness: 0.5, clearcoat: 0.35, flake: 0.2, iridescence: 0 },
  matte: { name: 'Matte', metalness: 0.15, roughness: 0.88, clearcoat: 0, flake: 0, iridescence: 0 },
}
const defaultFinish = (): Finish => ({ preset: 'metallic', ...FINISHES.metallic, wheel: 'graphite' })
function loadSaved(): { finish: Finish; customHex: string | null } {
  try {
    const raw = localStorage.getItem('orbital.finish.v4')
    if (raw) return { finish: { ...defaultFinish(), ...JSON.parse(raw).finish }, customHex: JSON.parse(raw).customHex ?? null }
  } catch { /* storage unavailable */ }
  return { finish: defaultFinish(), customHex: null }
}
function save(finish: Finish, customHex: string | null) {
  try { localStorage.setItem('orbital.finish.v4', JSON.stringify({ finish, customHex })) } catch { /* ignore */ }
}

export type View = 'site' | 'drive'

interface State {
  view: View
  paintId: string
  variantId: VariantId
  quality: Quality
  paused: boolean
  fading: boolean
  runId: number
  finish: Finish
  customHex: string | null
  setFinishPreset: (id: FinishId) => void
  setFinish: (patch: Partial<Finish>) => void
  setCustomHex: (hex: string | null) => void
  resetFinish: () => void
  setPaint: (id: string) => void
  setVariant: (id: VariantId) => void
  setQuality: (q: Quality) => void
  setPaused: (p: boolean) => void
  go: (v: View) => void
  restart: () => void
}

export const useStore = create<State>((set, get) => ({
  view: typeof location !== 'undefined' && new URLSearchParams(location.search).get('view') === 'drive' ? 'drive' : 'site',
  paintId: 'aero',
  variantId: 'velocity',
  quality: 'high',
  paused: false,
  fading: false,
  runId: 0,
  ...loadSaved(),
  setFinishPreset: (id) => { const f = { ...get().finish, preset: id, ...FINISHES[id] }; save(f, get().customHex); set({ finish: f }) },
  setFinish: (patch) => { const f = { ...get().finish, ...patch }; save(f, get().customHex); set({ finish: f }) },
  setCustomHex: (customHex) => { save(get().finish, customHex); set({ customHex }) },
  resetFinish: () => { const f = defaultFinish(); save(f, null); set({ finish: f, customHex: null }) },
  setPaint: (paintId) => { save(get().finish, null); set({ paintId, customHex: null }) },
  setVariant: (variantId) => set({ variantId }),
  setQuality: (quality) => set({ quality }),
  setPaused: (paused) => set({ paused }),
  restart: () => set((st) => ({ runId: st.runId + 1, paused: false })),
  go: (v) => {
    if (get().fading || get().view === v) return
    set({ fading: true })
    window.setTimeout(() => {
      set({ view: v, paused: false })
      window.scrollTo({ top: 0 })
      window.setTimeout(() => set({ fading: false }), 120)
    }, 520)
  },
}))
