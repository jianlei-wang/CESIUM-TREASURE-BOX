import { Color, Geometry, PrimitiveType, type Viewer } from 'cesium'
import {
  DynamicMassLayer,
  createAlphaRenderState,
  makeAttributes,
  makeColorAttribute,
  makeFloatAttribute,
  type DynamicMassBaseOptions,
  type DynamicMassStats,
  type MassDrawContent
} from '../mass-dynamic-lib/DynamicMassLayer'

export type LineColorMode = 'alternate' | 'single' | 'random'

export type DynamicLinesOptions = DynamicMassBaseOptions & {
  /** 线宽（像素，屏幕空间恒定） */
  width: number
  /** 线段长度（米），实际按 0.6~1.4 倍随机 */
  segmentLength: number
  colorMode: LineColorMode
  color1: string
  color2: string
}

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec2 st0;
in vec2 st1;
in float along;
in float side;
in vec4 color;

uniform sampler2D positionPrevTexture;
uniform sampler2D positionCurrTexture;
uniform float u_mix;
uniform float u_halfWidth;

out vec4 v_color;
out float v_cross;

void main()
{
  vec4 prev0 = texture(positionPrevTexture, st0);
  vec4 curr0 = texture(positionCurrTexture, st0);
  vec4 prev1 = texture(positionPrevTexture, st1);
  vec4 curr1 = texture(positionCurrTexture, st1);
  vec3 a0 = vec3(mix(prev0.xy, curr0.xy, u_mix), prev0.z) + position;
  vec3 a1 = vec3(mix(prev1.xy, curr1.xy, u_mix), prev1.z) + position;

  vec4 c0 = czm_modelViewProjection * vec4(a0, 1.0);
  vec4 c1 = czm_modelViewProjection * vec4(a1, 1.0);
  vec2 n0 = c0.xy / c0.w;
  vec2 n1 = c1.xy / c1.w;
  vec2 dir = n1 - n0;
  float len = length(dir);
  vec2 perp = len > 0.0 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);

  vec4 clip = along < 0.5 ? c0 : c1;
  vec2 ndcPerp = perp * (2.0 * u_halfWidth / czm_viewport.zw);
  clip.xy += ndcPerp * side * clip.w;

  v_color = color;
  v_cross = side;
  gl_Position = clip;
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
in float v_cross;

uniform float u_opacity;

out vec4 fragColor;

void main()
{
  float edge = 1.0 - abs(v_cross);
  float alpha = v_color.a * u_opacity * smoothstep(0.0, 0.4, edge);
  fragColor = vec4(v_color.rgb, alpha);
}
`

export class DynamicLinesLayer extends DynamicMassLayer<DynamicLinesOptions> {
  declare private lineCount: number
  declare private lineColors: number[][]

  constructor(viewer: Viewer, options: DynamicLinesOptions, onStats?: (stats: DynamicMassStats) => void) {
    super(viewer, options, onStats)
  }

  protected entityCount(): number {
    return this.lineCount
  }

  private resolveColor(index: number): Color {
    const { colorMode, color1, color2 } = this.options
    if (colorMode === 'single') return Color.fromCssColorString(color1)
    if (colorMode === 'random') return Color.fromHsl(Math.random(), 0.75, 0.6)
    return Color.fromCssColorString(index % 2 === 0 ? color1 : color2)
  }

  protected initCells(): void {
    this.lineCount = Math.floor(this.cellCount / 2)
    this.lineColors = []
    const half = this.halfExtent()
    const length = this.options.segmentLength
    for (let i = 0; i < this.lineCount; i++) {
      const c0 = i * 2
      const c1 = i * 2 + 1
      const east = (Math.random() * 2 - 1) * (half - length)
      const north = (Math.random() * 2 - 1) * (half - length)
      const height = this.options.heightOffset
      this.setAnchor(c0, east, north, height)
      const angle = Math.random() * Math.PI * 2
      const len = length * (0.6 + Math.random() * 0.8)
      this.setAnchor(c1, east + Math.cos(angle) * len, north + Math.sin(angle) * len, height)

      const direction = Math.random() * Math.PI * 2
      this.setVelocity(c0, direction)
      this.setVelocity(c1, direction)

      const color = this.resolveColor(i)
      this.lineColors.push([
        Math.round(color.red * 255),
        Math.round(color.green * 255),
        Math.round(color.blue * 255),
        255
      ])
    }
  }

  protected createContent(): MassDrawContent {
    const positions: number[] = []
    const st0: number[] = []
    const st1: number[] = []
    const along: number[] = []
    const side: number[] = []
    const colors: number[] = []
    const indices: number[] = []

    for (let i = 0; i < this.lineCount; i++) {
      const c0 = i * 2
      const c1 = i * 2 + 1
      const uv0 = this.cellToUv(c0)
      const uv1 = this.cellToUv(c1)
      const color = this.lineColors[i]
      for (let v = 0; v < 4; v++) {
        positions.push(0, 0, 0)
        st0.push(uv0[0], uv0[1])
        st1.push(uv1[0], uv1[1])
        colors.push(color[0], color[1], color[2], color[3])
      }
      along.push(0, 0, 1, 1)
      side.push(-1, 1, -1, 1)
      const base = i * 4
      indices.push(base, base + 1, base + 3, base, base + 3, base + 2)
    }

    return {
      geometry: new Geometry({
        attributes: makeAttributes({
          position: makeFloatAttribute(positions, 3),
          st0: makeFloatAttribute(st0, 2),
          st1: makeFloatAttribute(st1, 2),
          along: makeFloatAttribute(along, 1),
          side: makeFloatAttribute(side, 1),
          color: makeColorAttribute(colors)
        }),
        indices: new Uint32Array(indices),
        primitiveType: PrimitiveType.TRIANGLES
      }),
      attributeLocations: { position: 0, st0: 1, st1: 2, along: 3, side: 4, color: 5 },
      primitiveType: PrimitiveType.TRIANGLES,
      renderState: createAlphaRenderState(true),
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniformMap: {
        u_halfWidth: () => this.options.width / 2
      }
    }
  }

  setWidth(width: number): void {
    this.options.width = width
  }
}
