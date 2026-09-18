import { Color, Material } from 'cesium'

export const VIDEO_FUSION_TYPE = 'VideoFusionMaterial'
export const VIDEO_FEATHER_TYPE = 'VideoFeatherMaterial'

const VIDEO_FUSION_SOURCE = `
  uniform sampler2D image;
  uniform vec4 color;
  uniform float opacity;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec4 texColor = texture(image, st);
    material.diffuse = texColor.rgb * color.rgb;
    material.alpha = texColor.a * color.a * opacity;
    return material;
  }
`

const VIDEO_FEATHER_SOURCE = `
  uniform sampler2D image;
  uniform vec4 color;
  uniform float featherWidth;

  czm_material czm_getMaterial(czm_materialInput materialInput) {
    czm_material material = czm_getDefaultMaterial(materialInput);
    vec2 st = materialInput.st;
    vec4 texColor = texture(image, st);
    float edgeDist = min(min(st.x, 1.0 - st.x), min(st.y, 1.0 - st.y));
    float feather = smoothstep(0.0, featherWidth, edgeDist);
    material.diffuse = texColor.rgb * color.rgb;
    material.alpha = texColor.a * color.a * feather;
    return material;
  }
`

let registered = false

export function registerVideoMaterials(): void {
  if (registered) return
  registered = true
  const cache = (Material as unknown as {
    _materialCache: { getMaterial: (t: string) => unknown; addMaterial: (t: string, m: unknown) => void }
  })._materialCache
  const entries: Array<{ type: string; source: string; uniforms: Record<string, unknown> }> = [
    {
      type: VIDEO_FUSION_TYPE,
      source: VIDEO_FUSION_SOURCE,
      uniforms: { image: Material.DefaultImageId, color: new Color(1, 1, 1, 1), opacity: 0.6 }
    },
    {
      type: VIDEO_FEATHER_TYPE,
      source: VIDEO_FEATHER_SOURCE,
      uniforms: { image: Material.DefaultImageId, color: new Color(1, 1, 1, 1), featherWidth: 0.25 }
    }
  ]
  for (const entry of entries) {
    if (cache.getMaterial(entry.type)) continue
    cache.addMaterial(entry.type, {
      fabric: {
        type: entry.type,
        uniforms: entry.uniforms,
        source: entry.source
      },
      translucent: () => true
    })
  }
}
