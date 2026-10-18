import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const vert = /* glsl */ `
  varying vec3 vN; varying vec3 vP; varying vec3 vW;
  void main(){
    vN = normalize(mat3(modelMatrix) * normal);
    vP = position;
    vec4 w = modelMatrix * vec4(position,1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`

const frag = /* glsl */ `
  precision highp float;
  varying vec3 vN; varying vec3 vP; varying vec3 vW;
  uniform vec3 uSun; uniform float uTime; uniform float uFreq;
  uniform vec3 uOcean; uniform vec3 uDeep; uniform vec3 uLand; uniform vec3 uGlow;
  uniform float uCloud; uniform float uCity; uniform vec3 uCloudCol;

  float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float noise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
  }
  float fbm(vec3 p){ float a=.5, s=0.; for(int i=0;i<6;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }

  void main(){
    vec3 n = normalize(vN);
    vec3 pp = normalize(vP);
    float t = uTime * 0.004;
    // continents
    float h = fbm(pp*2.6*uFreq + vec3(3.1,1.7,0.4));
    float land = smoothstep(0.54, 0.6, h);
    // swirling clouds
    vec3 w = pp*3.4*uFreq; w.x += t;
    float warp = fbm(w*1.6 + 4.0);
    float cl = fbm(w + warp*1.7 + vec3(t*1.5,0.,0.));
    float clouds = smoothstep(0.5, 0.78, cl);
    vec3 base = mix(mix(uDeep, uOcean, smoothstep(0.2,0.55,h)), uLand, land);
    base = mix(base, uCloudCol, clouds*uCloud);

    float ndl = dot(n, normalize(uSun));
    float day = smoothstep(-0.08, 0.35, ndl);
    vec3 col = base * (0.035 + day*0.8);
    // twilight band
    float tw = exp(-pow((ndl-0.02)*5.0, 2.0));
    col += vec3(0.95,0.45,0.25) * tw * 0.12;
    // night side city-ish glow in land
    col += vec3(1.0,0.7,0.4) * land * (1.0-day) * smoothstep(0.62,0.75,fbm(pp*18.0*uFreq)) * 0.35 * uCity;

    vec3 V = normalize(cameraPosition - vW);
    float fres = pow(1.0 - max(dot(n,V),0.0), 3.0);
    col += uGlow * fres * (0.12 + day*0.9);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`

const atmoVert = /* glsl */ `
  varying vec3 vN; varying vec3 vW;
  void main(){
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`
const atmoFrag = /* glsl */ `
  precision highp float;
  varying vec3 vN; varying vec3 vW;
  uniform vec3 uSun; uniform vec3 uGlow;
  void main(){
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float rim = pow(max(0.0, 0.62 + dot(n, V)), 5.0);
    float day = smoothstep(-0.3, 0.5, dot(n, normalize(uSun)));
    vec3 c = uGlow * rim * (0.08 + day * 1.5);
    gl_FragColor = vec4(c, rim * (0.25 + day));
    #include <colorspace_fragment>
  }`

const PALETTES = {
  earth: { ocean: '#1559b8', deep: '#04204f', land: '#2d6a62', glow: '#58b6ff', cloud: 0.7, city: 1, cloudCol: '#b8ccea' },
  // rust plains, dark basalt highlands, thin dust instead of cloud cover, salmon limb, no city lights
  // pale ice giant: cool and featureless so it never reads as Mars or Earth
  giant: { ocean: '#9cc4d4', deep: '#5f8ea3', land: '#9cc4d4', glow: '#bfe6f5', cloud: 0.45, city: 0, cloudCol: '#dcf0f6' },
  mars: { ocean: '#b5552b', deep: '#6e2a14', land: '#3d1d14', glow: '#ff9a6a', cloud: 0.18, city: 0, cloudCol: '#e2a27a' },
}

export function Planet({
  radius = 70, position = [0, 0, 0], sun = [-0.4, 0.35, 0.85], ring = false, detail = 1, palette = 'earth',
}: { radius?: number; position?: [number, number, number]; sun?: [number, number, number]; ring?: boolean; detail?: number; palette?: keyof typeof PALETTES }) {
  const pal = PALETTES[palette]
  const mat = useRef<THREE.ShaderMaterial>(null)
  const uniforms = useMemo(
    () => ({
      uSun: { value: new THREE.Vector3(...sun) },
      uTime: { value: 0 },
      uFreq: { value: detail },
      uOcean: { value: new THREE.Color(pal.ocean) },
      uDeep: { value: new THREE.Color(pal.deep) },
      uLand: { value: new THREE.Color(pal.land) },
      uGlow: { value: new THREE.Color(pal.glow) },
      uCloud: { value: pal.cloud },
      uCity: { value: pal.city },
      uCloudCol: { value: new THREE.Color(pal.cloudCol) },
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const atmoUniforms = useMemo(() => ({ uSun: uniforms.uSun, uGlow: uniforms.uGlow }), [uniforms])
  useFrame((_, dt) => {
    uniforms.uTime.value += dt
  })
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[radius, 128, 96]} />
        <shaderMaterial ref={mat} vertexShader={vert} fragmentShader={frag} uniforms={uniforms} />
      </mesh>
      <mesh scale={1.045}>
        <sphereGeometry args={[radius, 96, 64]} />
        <shaderMaterial
          vertexShader={atmoVert} fragmentShader={atmoFrag} uniforms={atmoUniforms}
          transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.BackSide}
        />
      </mesh>
      {ring && (
        <mesh rotation={[Math.PI / 2.3, 0.2, 0.3]}>
          <ringGeometry args={[radius * 1.35, radius * 2.1, 192, 1]} />
          <meshBasicMaterial color="#b6a6ff" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  )
}
