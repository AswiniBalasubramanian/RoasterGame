import { Environment, Lightformer } from '@react-three/drei'

/** Studio-style image based lighting: large overhead softbox, side strips, red rim, cool front fill. */
export function StudioEnv({ intensity = 1 }: { intensity?: number }) {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={intensity}>
      <color attach="background" args={['#020306']} />
      <Lightformer form="rect" intensity={2.4} position={[0, 7, 0]} scale={[12, 9, 1]} rotation-x={Math.PI / 2} />
      {[-1, 1].map((sx) =>
        [-5, -1.5, 2.5, 6].map((z, i) => (
          <Lightformer key={`${sx}${i}`} form="rect" intensity={i % 2 ? 1.1 : 1.8} position={[sx * 9, 1.5 + i * 1.6, z]} scale={[0.5, 5.5, 1]} rotation-y={sx * -Math.PI / 2} />
        )),
      )}
      <Lightformer form="rect" intensity={1.4} position={[0, 4.5, 6]} scale={[10, 0.5, 1]} rotation-x={Math.PI / 3} />
      <Lightformer form="rect" intensity={1.4} position={[0, 4.5, -6]} scale={[10, 0.5, 1]} rotation-x={-Math.PI / 3} />
      <Lightformer form="rect" intensity={4} color="#ff2a2f" position={[0, 1.2, -10]} scale={[16, 0.7, 1]} />
      <Lightformer form="rect" intensity={1.6} color="#55dfff" position={[0, 2.5, 10]} scale={[12, 0.5, 1]} rotation-y={Math.PI} />
      <Lightformer form="rect" intensity={0.25} position={[0, -2, 0]} scale={[14, 14, 1]} rotation-x={-Math.PI / 2} />
    </Environment>
  )
}
