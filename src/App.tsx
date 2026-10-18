import { useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { useStore } from './store'
import { SiteScene } from './scenes/SiteScene'
import { DriveScene } from './scenes/DriveScene'
import { Landing } from './ui/Landing'
import { Hud } from './ui/Hud'

function hasWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

function Effects() {
  const quality = useStore((s) => s.quality)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.toneMapping = quality === 'low' ? THREE.AgXToneMapping : THREE.NoToneMapping
    gl.toneMappingExposure = 1
  }, [gl, quality])
  if (quality === 'low') return null
  return (
    <EffectComposer multisampling={quality === 'high' ? 4 : 0} enableNormalPass={false}>
      {/* ambient occlusion: contact darkening in panel gaps, arches, vents and the cabin, what makes CGI read as a physical object */}
      <N8AO aoRadius={0.5} distanceFalloff={0.5} intensity={quality === 'high' ? 2.4 : 1.8} quality={quality === 'high' ? 'high' : 'low'} halfRes={quality !== 'high'} />
      {/* restrained: only genuinely bright lights (lamps, light bars) cross the threshold */}
      <Bloom intensity={quality === 'high' ? 0.3 : 0.24} luminanceThreshold={1.15} luminanceSmoothing={0.15} mipmapBlur radius={0.6} />
      <Vignette offset={0.3} darkness={0.42} />
      {/* AgX keeps detail in bright metallic highlights instead of clipping them to flat white */}
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  )
}

export function App() {
  const view = useStore((s) => s.view)
  const fading = useStore((s) => s.fading)
  const quality = useStore((s) => s.quality)
  const setQuality = useStore((s) => s.setQuality)
  const [booted, setBooted] = useState(false)
  const gl = useMemo(hasWebGL, [])
  const params = useMemo(() => new URLSearchParams(location.search), [])
  const pinned = params.get('q') as 'high' | 'medium' | 'low' | null

  useEffect(() => {
    if (pinned) setQuality(pinned)
  }, [pinned, setQuality])

  if (!gl) {
    return (
      <div className="noscene">
        <div>
          <b>roadster.game needs WebGL</b>
          Your browser or device has WebGL turned off. Enable hardware acceleration, or try a recent version of Chrome, Edge, Firefox or Safari.
        </div>
      </div>
    )
  }

  const dpr: [number, number] = quality === 'high' ? [1, 1.75] : quality === 'medium' ? [1, 1.25] : [1, 1]

  return (
    <>
      <div id="stage" role="img" aria-label={view === 'site' ? 'A silver two-seat roadster hovering on its lift beams above a night desert, climbing into orbit as you scroll' : 'Chase view of the roadster flying through ring gates in space'}>
        <Canvas
          camera={{ position: [3.7, 0.95, 7.1], fov: 29, near: 0.1, far: 6000 }}
          dpr={dpr}
          shadows={quality === 'low' ? false : 'soft'}
          gl={{ antialias: quality === 'low', powerPreference: 'high-performance', toneMapping: THREE.NoToneMapping }}
          onCreated={() => window.setTimeout(() => setBooted(true), 500)}
        >
          {!pinned && (
            <PerformanceMonitor
              ms={250} iterations={8} threshold={0.6}
              onDecline={() => setQuality(quality === 'high' ? 'medium' : 'low')}
            />
          )}
          {view === 'site' ? <SiteScene /> : <DriveScene />}
          <Effects />
        </Canvas>
      </div>
      <div className="vignette" />
      {view === 'site' ? <Landing /> : <Hud />}
      <div className={`fader ${fading ? 'on' : ''}`} />
      <div className={`boot ${booted ? 'done' : ''}`} aria-hidden={booted}>
        <div>
          roadster.game
          <i />
        </div>
      </div>
    </>
  )
}
