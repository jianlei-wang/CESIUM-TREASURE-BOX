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

export type PointColorMode = 'alternate' | 'single' | 'random'

export type DynamicPointsOptions = DynamicMassBaseOptions & {
  pointSize: number
  colorMode: PointColorMode
  color1: string
  color2: string
}

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec2 st;
in vec4 color;
in float size;

uniform sampler2D positionPrevTexture;
uniform sampler2D positionCurrTexture;
uniform float u_mix;
uniform float u_pointSize;

out vec4 v_color;

void main()
{
  vec4 prevPos = texture(positionPrevTexture, st);
  vec4 currPos = texture(positionCurrTexture, st);
  vec3 enu = vec3(mix(prevPos.xy, currPos.xy, u_mix), prevPos.z) + position;
  gl_Position = czm_modelViewProjection * vec4(enu, 1.0);
  gl_PointSize = u_pointSize * size;
  v_color = color;
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;

uniform float u_opacity;

out vec4 fragColor;

void main()
{
  float r = length(gl_PointCoord - vec2(0.5));
  if (r > 0.5) discard;
  float edge = smoothstep(0.5, 0.32, r);
  float core = smoothstep(0.32, 0.0, r);
  vec3 rgb = mix(v_color.rgb, vec3(1.0), core * 0.4);
  float alpha = v_color.a * u_opacity * (0.55 + 0.45 * edge);
  fragColor = vec4(rgb, alpha);
}
`

export class DynamicPointsLayer extends DynamicMassLayer<DynamicPointsOptions> {
  declare private cellColors: number[]
  declare private cellSizes: number[]

  constructor(viewer: Viewer, options: DynamicPointsOptions, onStats?: (stats: DynamicMassStats) => void) {
    super(viewer, options, onStats)
  }

  private resolveColor(index: number): Color {
    const { colorMode, color1, color2 } = this.options
    if (colorMode === 'single') return Color.fromCssColorString(color1)
    if (colorMode === 'random') return Color.fromHsl(Math.random(), 0.75, 0.6)
    return Color.fromCssColorString(index % 2 === 0 ? color1 : color2)
  }

  protected initCells(): void {
    this.cellColors = []
    this.cellSizes = []
    for (let i = 0; i < this.cellCount; i++) {
      this.randomAnchor(i)
      this.randomVelocity(i)
      const color = this.resolveColor(i)
      this.cellColors.push(
        Math.round(color.red * 255),
        Math.round(color.green * 255),
        Math.round(color.blue * 255),
        255
      )
      this.cellSizes.push(0.6 + Math.random() * 0.9)
    }
  }

  protected createContent(): MassDrawContent {
    const positions: number[] = []
    const st: number[] = []
    for (let i = 0; i < this.cellCount; i++) {
      positions.push(0, 0, 0)
      const [u, v] = this.cellToUv(i)
      st.push(u, v)
    }
    return {
      geometry: new Geometry({
        attributes: makeAttributes({
          position: makeFloatAttribute(positions, 3),
          st: makeFloatAttribute(st, 2),
          color: makeColorAttribute(this.cellColors),
          size: makeFloatAttribute(this.cellSizes, 1)
        }),
        primitiveType: PrimitiveType.POINTS
      }),
      attributeLocations: { position: 0, st: 1, color: 2, size: 3 },
      primitiveType: PrimitiveType.POINTS,
      renderState: createAlphaRenderState(true),
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniformMap: {
        u_pointSize: () => this.options.pointSize
      }
    }
  }

  setPointSize(pointSize: number): void {
    this.options.pointSize = pointSize
  }
}
