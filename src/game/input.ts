import { useEffect } from 'react'
import { useStore } from '../store'

export interface Inputs {
  throttle: boolean
  brake: boolean
  left: boolean
  right: boolean
  drift: boolean
  boost: boolean
  /** climb / dive */
  up: boolean
  down: boolean
}

export const inputs: Inputs = { throttle: false, brake: false, left: false, right: false, drift: false, boost: false, up: false, down: false }
/** On-screen controls write here; merged with the keyboard. */
export const touch: Inputs = { throttle: false, brake: false, left: false, right: false, drift: false, boost: false, up: false, down: false }

const map: Record<string, keyof Inputs> = {
  KeyW: 'throttle',
  KeyS: 'brake',
  ArrowUp: 'up', KeyR: 'up',
  ArrowDown: 'down', KeyF: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'drift',
  ShiftLeft: 'boost', ShiftRight: 'boost',
}

const keyState: Inputs = { throttle: false, brake: false, left: false, right: false, drift: false, boost: false, up: false, down: false }

export function readInputs(): Inputs {
  // Gamepad (optional): left stick steer, RT/A gas, LT/B brake, X drift, RB boost
  const pad = navigator.getGamepads?.().find((g) => g && g.connected)
  const gp: Inputs = { throttle: false, brake: false, left: false, right: false, drift: false, boost: false, up: false, down: false }
  if (pad) {
    const ax = pad.axes[0] ?? 0
    gp.left = ax < -0.25
    gp.right = ax > 0.25
    gp.throttle = (pad.buttons[7]?.value ?? 0) > 0.1 || !!pad.buttons[0]?.pressed
    gp.brake = (pad.buttons[6]?.value ?? 0) > 0.1 || !!pad.buttons[1]?.pressed
    gp.drift = !!pad.buttons[2]?.pressed
    gp.boost = !!pad.buttons[5]?.pressed
    const ay = pad.axes[1] ?? 0
    gp.up = ay < -0.3
    gp.down = ay > 0.3
  }
  ;(Object.keys(inputs) as (keyof Inputs)[]).forEach((k) => {
    inputs[k] = keyState[k] || touch[k] || gp[k]
  })
  return inputs
}

export function useKeyboard(active: boolean) {
  useEffect(() => {
    if (!active) return
    const dn = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !e.repeat) {
        const s = useStore.getState()
        s.setPaused(!s.paused)
        return
      }
      const k = map[e.code]
      if (k) {
        keyState[k] = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      const k = map[e.code]
      if (k) keyState[k] = false
    }
    const blur = () => (Object.keys(keyState) as (keyof Inputs)[]).forEach((k) => (keyState[k] = false))
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      blur()
    }
  }, [active])
}
