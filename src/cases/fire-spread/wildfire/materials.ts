import { Color, Material } from 'cesium'

export const WILDFIRE_LINE_TYPE = 'WildfireLine'

const WILDFIRE_LINE_SOURCE = `
  uniform vec4 coreColor;
  uniform vec4 glowColor;
  uniform float speed;
  uniform float pulse;
  uniform float noiseScale;

  float wildfireHash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    float across = abs(st.t - 0.5) * 2.0;
    float core = smoothstep(1.0, 0.0, across);
    float glow = exp(-across * 3.4);

    float flow = st.s * noiseScale;
    float t = czm_frameNumber * speed;
    float flicker = 0.74
      + 0.16 * sin(flow * 1.7 + t * 0.09)
      + 0.10 * sin(flow * 4.3 - t * 0.14);
    flicker *= 0.9 + 0.1 * wildfireHash(floor(flow * 6.0) + floor(t * 0.05));

    float intensity = clamp(pulse, 0.0, 1.5);
    vec4 color = mix(glowColor, coreColor, core);
    float alpha = core * color.a * flicker + glow * glowColor.a * 0.85;
    material.diffuse = color.rgb * (0.85 + 0.45 * core);
    material.emission = color.rgb * (core * 0.6 + glow * 0.35);
    material.alpha = clamp(alpha * intensity, 0.0, 1.0);
    return material;
  }
`

let registered = false

export function registerWildfireMaterials(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as {
    _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void }
  })._materialCache
  if (cache.getMaterial(WILDFIRE_LINE_TYPE)) return
  cache.addMaterial(WILDFIRE_LINE_TYPE, {
    fabric: {
      type: WILDFIRE_LINE_TYPE,
      uniforms: {
        coreColor: new Color(1.0, 0.92, 0.62, 0.95),
        glowColor: new Color(1.0, 0.42, 0.12, 0.6),
        speed: 1,
        pulse: 1,
        noiseScale: 26
      },
      source: WILDFIRE_LINE_SOURCE
    },
    translucent: () => true
  })
}
