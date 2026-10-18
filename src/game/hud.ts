/** Mutable per-frame race data. The HUD reads it in requestAnimationFrame, so the game loop never triggers React renders. */
export interface HudData {
  state: 'countdown' | 'racing' | 'finished'
  count: number // 3,2,1,0 (GO)
  speed: number // km/h
  boost: number // 0..1
  boosting: boolean
  lap: number // 1-based
  time: number
  lapTime: number
  best: number
  cp: number // last checkpoint index passed this lap (0..7)
  cpFlash: number // seconds since last checkpoint flash
  x: number
  z: number
  h: number
  impact: number
  lapTimes: number[]
  gear: string
  /** 0..1 progress along the run, and km left to Mars for the readout */
  progress: number
  marsKm: number
}

export const hud: HudData = {
  state: 'countdown', count: 3, speed: 0, boost: 0.5, boosting: false, lap: 1, time: 0, lapTime: 0, best: 0,
  cp: 0, cpFlash: 9, x: 0, z: 0, h: 0, impact: 0, lapTimes: [], gear: 'D', progress: 0, marsKm: 54.6e6,
}

export const fmtTime = (t: number, empty = '00:00.000') => {
  if (!isFinite(t) || t <= 0) return empty
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}
