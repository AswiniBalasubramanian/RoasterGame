import { useEffect, useRef } from 'react'
import { track } from '../game/track'
import { fmtTime, hud } from '../game/hud'
import { touch, type Inputs } from '../game/input'
import { VARIANTS, useStore } from '../store'

function TouchBtn({ k, label, cls, name }: { k: keyof Inputs; label: string; cls?: string; name?: string }) {
  const on = () => (touch[k] = true)
  const off = () => (touch[k] = false)
  return (
    <button
      className={`tb ${cls ?? ''}`} aria-label={name ?? label}
      onPointerDown={(e) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); on() }}
      onPointerUp={off} onPointerCancel={off} onLostPointerCapture={off} onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )
}

export function Hud() {
  const { paused, setPaused, restart, go, variantId } = useStore()
  const el = useRef<Record<string, HTMLElement | null>>({})
  const set = (k: string) => (n: HTMLElement | null) => { el.current[k] = n }
  const dot = useRef<SVGCircleElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const lastState = useRef('')

  useEffect(() => {
    let raf = 0
    const m = track.minimap
    const tick = () => {
      const e = el.current
      if (e.speed) e.speed.textContent = String(Math.round(hud.speed))
      if (e.boostFill) {
        e.boostFill.style.transform = `scaleX(${hud.boost})`
        e.boostFill.dataset.on = hud.boosting ? '1' : '0'
      }
      if (e.lap) e.lap.textContent = hud.marsKm >= 1e6 ? `${(hud.marsKm / 1e6).toFixed(1)}M km` : `${Math.round(hud.marsKm / 1000).toLocaleString()}k km`
      if (e.progress) e.progress.textContent = `${Math.round(hud.progress * 100)}%`
      if (e.time) e.time.textContent = fmtTime(hud.time)
      if (e.lapTime) e.lapTime.textContent = fmtTime(hud.lapTime)
      if (e.count) {
        const t = hud.state === 'countdown' ? String(hud.count || '') : hud.count === 0 ? 'GO' : ''
        if (e.count.textContent !== t) {
          e.count.textContent = t
          e.count.classList.remove('pop')
          void e.count.offsetWidth
          if (t) e.count.classList.add('pop')
        }
      }
      if (e.cp) e.cp.style.opacity = String(Math.max(0, 1 - hud.cpFlash / 1.4))
      if (e.cp && hud.cpFlash < 1.4) e.cp.textContent = `Checkpoint ${hud.cp === 0 ? 8 : hud.cp} / 8`
      if (e.hit) e.hit.style.opacity = String(Math.min(0.6, hud.impact * 0.7))
      if (e.boostGlow) e.boostGlow.style.opacity = hud.boosting ? '1' : '0'
      if (dot.current) {
        dot.current.setAttribute('cx', ((hud.x - m.ox) * m.s).toFixed(1))
        dot.current.setAttribute('cy', (100 - (hud.z - m.oz) * m.s).toFixed(1))
      }
      if (hud.state !== lastState.current) {
        lastState.current = hud.state
        if (results.current) {
          const open = hud.state === 'finished' ? '1' : '0'
          // move keyboard focus into the results dialog the moment it opens
          if (open === '1' && results.current.dataset.open !== '1') window.setTimeout(() => results.current?.querySelector<HTMLButtonElement>('button')?.focus(), 950)
          results.current.dataset.open = open
        }
        if (hud.state === 'finished' && e.rTotal) {
          e.rTotal.textContent = fmtTime(hud.time)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="hud" aria-live="off">
      <div className="hit" ref={set('hit')} />
      <div className="boost-glow" ref={set('boostGlow')} />

      <div className="hud-tl">
        <div className="lapline"><span>Mars</span><b ref={set('lap')}>54.6M km</b></div>
        <div className="timeline"><b ref={set('time')}>00:00.000</b></div>
        <div className="small">Run <span ref={set('progress')}>0%</span></div>
      </div>

      <svg className="minimap" viewBox="0 0 100 100" role="img" aria-label="Course minimap">
        <path d={track.minimap.d} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="3.4" strokeLinejoin="round" />
        <path d={track.minimap.d} fill="none" stroke="rgba(85,223,255,.9)" strokeWidth="0.8" strokeLinejoin="round" />
        <circle ref={dot} r="3" fill="#e82127" stroke="#fff" strokeWidth="0.9" />
      </svg>

      <div className="count" ref={set('count')} />
      <div className="cpflash" ref={set('cp')} />

      <div className="hud-bottom">
        <div className="speed"><b ref={set('speed')}>0</b><span>km/h</span></div>
        <div className="boostbar" aria-label="Boost energy"><i ref={set('boostFill')} /></div>
      </div>

      <div className="hint">
        <span>{VARIANTS[variantId].name} · orbital flight trial</span>
        <span><kbd>W</kbd><kbd>S</kbd> thrust <kbd>A</kbd><kbd>D</kbd> steer <kbd>↑</kbd><kbd>↓</kbd> climb / dive <kbd>Space</kbd> air-brake <kbd>Shift</kbd> boost <kbd>Esc</kbd> pause</span>
      </div>

      <div className="touch" aria-label="Touch controls">
        <div className="tl"><TouchBtn k="left" label="◀" name="Steer left" /><TouchBtn k="right" label="▶" name="Steer right" /><TouchBtn k="up" label="▲" name="Climb" cls="sm" /><TouchBtn k="down" label="▼" name="Dive" cls="sm" /></div>
        <div className="tr">
          <TouchBtn k="drift" label="Air-brake" cls="sm" />
          <TouchBtn k="boost" label="Boost" cls="sm red" />
          <TouchBtn k="brake" label="Brake" cls="sm" />
          <TouchBtn k="throttle" label="Go" name="Thrust" cls="go" />
        </div>
      </div>

      <button className="pausebtn" onClick={() => setPaused(true)} aria-label="Pause">II</button>

      {paused && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Paused">
          <div className="card">
            <h2>Paused</h2>
            <button className="btn primary wide" autoFocus onClick={() => setPaused(false)}>RESUME</button>
            <button className="btn ghost wide" onClick={restart}>RESTART RUN</button>
            <button className="btn ghost wide" onClick={() => go('site')}>BACK TO GARAGE</button>
          </div>
        </div>
      )}

      <div className="overlay results" ref={results} data-open="0" role="dialog" aria-modal="true" aria-label="Arrived at Mars">
        <div className="card">
          <h2>Arrived at Mars</h2>
          <div className="big"><span>Earth to Mars in</span><b ref={set('rTotal')} /></div>
          <p className="note">Solo flight trial. Race positions arrive with multiplayer.</p>
          <button className="btn primary wide" onClick={restart}>FLY AGAIN</button>
          <button className="btn ghost wide" onClick={() => go('site')}>BACK TO GARAGE</button>
        </div>
      </div>
    </div>
  )
}
