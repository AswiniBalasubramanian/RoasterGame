import { FINISHES, PAINTS, VARIANTS, WHEELS, useStore, type FinishId, type WheelId, type VariantId } from '../store'
import { exportCarGLB } from '../car/Car'

const goto = (section: number) => window.scrollTo({ top: section * window.innerHeight, behavior: 'smooth' })

export function Wordmark() {
  return (
    <button className="wordmark" onClick={() => goto(0)} aria-label="roadster.game, back to top">
      {/* the roadster in profile: low wedge, canopy, two wheels, red full-width tail light */}
      <svg viewBox="0 0 40 18" width="36" height="16" aria-hidden="true">
        <path d="M1.5 12.6 C2 10.6 4.6 9.6 9 9 L15 8.4 C17.2 6.2 20.2 4.9 24 4.8 C28.6 4.8 32.4 6.6 35.6 8.6 L38.2 9.4 L38.6 12.6 Z" fill="currentColor" />
        <path d="M16.4 8.3 C18.4 6.6 20.8 5.8 23.8 5.8 C26.4 5.8 28.6 6.6 30.6 7.9 Z" fill="var(--bg)" opacity="0.55" />
        <circle cx="10.2" cy="13" r="3.4" fill="var(--bg)" />
        <circle cx="10.2" cy="13" r="2.4" fill="currentColor" />
        <circle cx="30.4" cy="13" r="3.4" fill="var(--bg)" />
        <circle cx="30.4" cy="13" r="2.4" fill="currentColor" />
        <rect x="36.6" y="9.2" width="2.6" height="1.3" rx="0.5" fill="var(--red)" />
      </svg>
      <span>roadster<em>.game</em></span>
    </button>
  )
}

export function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="sl">
      <span>{label}</span>
      <input type="range" aria-label={label} min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <output>{Math.round(value * 100)}</output>
    </label>
  )
}

function FinishStudio() {
  const { finish, customHex, paintId, setFinish, setFinishPreset, setCustomHex, resetFinish } = useStore()
  const hex = customHex ?? PAINTS.find((p) => p.id === paintId)!.hex
  return (
    <details className="studio">
      <summary>Finish studio</summary>
      <div className="studio-body">
        <label className="colorrow">
          <span>Custom colour</span>
          <input type="color" value={hex} onChange={(e) => setCustomHex(e.target.value)} aria-label="Custom paint colour" />
          <code>{hex.toUpperCase()}</code>
        </label>
        <div className="seg" role="radiogroup" aria-label="Paint finish">
          {(Object.keys(FINISHES) as FinishId[]).map((id) => (
            <button key={id} role="radio" aria-checked={finish.preset === id} className={finish.preset === id ? 'on' : ''} onClick={() => setFinishPreset(id)}>
              {FINISHES[id].name}
            </button>
          ))}
        </div>
        <Slider label="Metallic" value={finish.metalness} onChange={(v) => setFinish({ metalness: v })} />
        <Slider label="Roughness" value={finish.roughness} onChange={(v) => setFinish({ roughness: v })} />
        <Slider label="Clearcoat" value={finish.clearcoat} onChange={(v) => setFinish({ clearcoat: v })} />
        <Slider label="Flake" value={finish.flake} onChange={(v) => setFinish({ flake: v })} />
        <Slider label="Pearl shift" value={finish.iridescence} onChange={(v) => setFinish({ iridescence: v })} />
        <div className="seg" role="radiogroup" aria-label="Wheel finish">
          {(Object.keys(WHEELS) as WheelId[]).map((id) => (
            <button key={id} role="radio" aria-checked={finish.wheel === id} className={finish.wheel === id ? 'on' : ''} onClick={() => setFinish({ wheel: id })}>
              {WHEELS[id].name}
            </button>
          ))}
        </div>
        <div className="studio-actions">
          <button className="btn ghost" onClick={resetFinish}>Reset</button>
          <button className="btn ghost" onClick={() => exportCarGLB()}>Export .glb</button>
        </div>
        <p className="note">Edits are saved in this browser and carry into the race. The .glb opens in Blender, Figma Make or any glTF editor.</p>
      </div>
    </details>
  )
}

function Nav() {
  return (
    <header className="nav">
      <Wordmark />
      <nav aria-label="Primary">
        <button onClick={() => goto(1)}>VEHICLES</button>
        <button onClick={() => goto(2)}>TRACKS</button>
        <button className="soon" disabled aria-disabled="true" title="Multiplayer needs the game server, which is not built yet">
          MULTIPLAYER <i>soon</i>
        </button>
      </nav>
    </header>
  )
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat-row">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="bar" role="presentation">
        <i style={{ transform: `scaleX(${value / 100})` }} />
      </div>
    </div>
  )
}

export function Landing() {
  const { variantId, paintId, setVariant, setPaint, go } = useStore()
  const v = VARIANTS[variantId]
  const paint = PAINTS.find((p) => p.id === paintId)!

  return (
    <main>
      <Nav />

      <section className="hero" aria-labelledby="h1">
        <div className="hero-copy">
          <h1 id="h1">
            <span className="mask"><span className="line l1">BEYOND</span></span>{' '}
            <span className="mask"><span className="line l2">THE ROAD.</span></span>
          </h1>
          <p className="sub fade">A two-seat roadster with hidden aero, ground-effect fans and cold-gas thrusters. Lift off the desert. Next stop, Mars.</p>
          <ul className="chips fade" aria-label="Key systems">
            <li>Active aero</li>
            <li>Cold-gas thrusters</li>
            <li>Ground-effect fans</li>
          </ul>
          <div className="ctas fade">
            <button className="btn primary" onClick={() => go('drive')}>ENTER THE GRID</button>
            <button className="btn ghost" onClick={() => goto(1)}>EXPLORE THE CAR</button>
          </div>
        </div>
      </section>

      <section className="garage" aria-labelledby="gh">
        <p className="drag-hint" aria-hidden="true">Drag to turn the car</p>
        <aside className="panel" data-nodrag>
          <h2 id="gh">{v.name}</h2>
          <p className="blurb">{v.blurb}</p>

          <div className="tabs" role="tablist" aria-label="Vehicle variant">
            {(Object.keys(VARIANTS) as VariantId[]).map((id) => (
              <button key={id} role="tab" aria-selected={id === variantId} className={id === variantId ? 'on' : ''} onClick={() => setVariant(id)}>
                {VARIANTS[id].name}
              </button>
            ))}
          </div>

          <div className="swatches" role="radiogroup" aria-label={`Paint, ${paint.name} selected`}>
            {PAINTS.map((p) => (
              <button
                key={p.id} role="radio" aria-checked={p.id === paintId} aria-label={p.name} title={p.name}
                className={p.id === paintId ? 'sw on' : 'sw'} style={{ ['--c' as string]: p.hex }} onClick={() => setPaint(p.id)}
              />
            ))}
            <span className="sw-name">{paint.name}</span>
          </div>

          <FinishStudio />

          <div className="stats">
            <Bar label="Acceleration" value={v.accel} />
            <Bar label="Top speed" value={v.top} />
            <Bar label="Handling" value={v.handling} />
            <Bar label="Boost" value={v.boost} />
          </div>
          <dl className="figures">
            <div><dt>0–100 km/h</dt><dd>{v.zeroToHundred}</dd></div>
            <div><dt>Top speed</dt><dd>{v.topSpeed}</dd></div>
          </dl>

          <button className="btn primary wide" onClick={() => go('drive')}>FLY THE {v.name.toUpperCase()} TO MARS</button>
        </aside>
      </section>

      <section className="final" aria-labelledby="fh">
        <div className="final-copy">
          <h2 id="fh">NEXT STOP, MARS.</h2>
          <div className="worlds" role="list">
            <button className="world on" role="listitem" onClick={() => go('drive')}>
              <b>The Mars Run</b>
              <span>From Earth orbit to Mars in one run: through the gates, past the asteroid field, into Mars orbit.</span>
            </button>
            <div className="world locked" role="listitem" aria-disabled="true">
              <b>Nebula Run</b>
              <span>In development. Not playable in this build.</span>
            </div>
          </div>
          <button className="btn primary" onClick={() => go('drive')}>ENTER THE GRID</button>
        </div>
        <footer className="foot">
          <ul className="keys" aria-label="Controls">
            <li><kbd>W</kbd><kbd>S</kbd><em>thrust</em></li>
            <li><kbd>A</kbd><kbd>D</kbd><em>steer</em></li>
            <li><kbd>↑</kbd><kbd>↓</kbd><em>climb / dive</em></li>
            <li><kbd>Space</kbd><em>air-brake</em></li>
            <li><kbd>Shift</kbd><em>boost</em></li>
            <li><kbd>Esc</kbd><em>pause</em></li>
          </ul>
          <p>roadster.game is an independent prototype, not affiliated with any automaker. The vehicle and world are original work.</p>
          <p className="credit">Built by <a href="https://www.linkedin.com/in/iam-aswini" rel="author noopener" target="_blank">Aswini</a></p>
        </footer>
      </section>
    </main>
  )
}
