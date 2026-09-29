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

export type PolygonShape = 'triangle' | 'quad' | 'pentagon' | 'mixed'

export type PolygonColorMode = 'alternate' | 'single' | 'random'

export type DynamicPolygonOptions = DynamicMassBaseOptions & {
  /** 面半径（米），实际按 0.7~1.3 倍随机 */
  radius: number
  shape: PolygonShape
  colorMode: PolygonColorMode
  color1: string
  color2: string
}

export type DynamicPolygonStats = DynamicMassStats

const VERTEX_SHADER = `#version 300 es
precision highp float;

in vec3 position;
in vec2 st;
in vec4 color;

uniform sampler2D positionPrevTexture;
uniform sampler2D positionCurrTexture;
uniform float u_mix;

out vec4 v_color;

void main()
{
  vec4 prevPos = texture(positionPrevTexture, st);
  vec4 currPos = texture(positionCurrTexture, st);
  vec2 center = mix(prevPos.xy, currPos.xy, u_mix);
  vec3 enu = vec3(center, 0.0) + position;
  v_color = color;
  gl_Position = czm_modelViewProjection * vec4(enu, 1.0);
}
`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;

uniform float u_opacity;

out vec4 fragColor;

void main()
{
  fragColor = vec4(v_color.rgb, v_color.a * u_opacity);
}
`

type CellShape = { sides: number; radius: number; rotation: number }

export class DynamicPolygonLayer extends DynamicMassLayer<DynamicPolygonOptions> {
  declare private cellShapes: CellShape[]
  declare private cellColors: number[]

  constructor(viewer: Viewer, options: DynamicPolygonOptions, onStats?: (stats: DynamicMassStats) => void) {
    super(viewer, options, onStats)
  }

  private resolveColor(index: number): Color {
    const { colorMode, color1, color2 } = this.options
    if (colorMode === 'single') return Color.fromCssColorString(color1)
    if (colorMode === 'random') return Color.fromHsl(Math.random(), 0.75, 0.6)
    return Color.fromCssColorString(index % 2 === 0 ? color1 : color2)
  }

  private resolveSides(): number {
    const { shape } = this.options
    if (shape === 'triangle') return 3
    if (shape === 'quad') return 4
    if (shape === 'pentagon') return 5
    return 3 + Math.floor(Math.random() * 3)
  }

  protected initCells(): void {
    this.cellShapes = []
    this.cellColors = []
    for (let i = 0; i < this.cellCount; i++) {
      this.randomAnchor(i)
      this.randomVelocity(i)
      this.cellShapes.push({
        sides: this.resolveSides(),
        radius: this.options.radius * (0.7 + Math.random() * 0.6),
        rotation: Math.random() * Math.PI * 2
      })
      const color = this.resolveColor(i)
      this.cellColors.push(
        Math.round(color.red * 255),
        Math.round(color.green * 255),
        Math.round(color.blue * 255),
        255
      )
    }
  }

  protected createContent(): MassDrawContent {
    const positions: number[] = []
    const st: number[] = []
    const colorValues: number[] = []
    const indices: number[] = []
    let vertexCursor = 0

    for (let i = 0; i < this.cellCount; i++) {
      const { sides, radius, rotation } = this.cellShapes[i]
      const [u, v] = this.cellToUv(i)
      for (let s = 0; s < sides; s++) {
        const angle = rotation + (s * Math.PI * 2) / sides
        positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, this.options.heightOffset)
        st.push(u, v)
      }
      for (let s = 0; s < sides - 2; s++) {
        indices.push(vertexCursor, vertexCursor + s + 1, vertexCursor + s + 2)
      }
      const c = i * 4
      for (let s = 0; s < sides; s++) {
        colorValues.push(
          this.cellColors[c],
          this.cellColors[c + 1],
          this.cellColors[c + 2],
          this.cellColors[c + 3]
        )
      }
      vertexCursor += sides
    }

    return {
      geometry: new Geometry({
        attributes: makeAttributes({
          position: makeFloatAttribute(positions, 3),
          st: makeFloatAttribute(st, 2),
          color: makeColorAttribute(colorValues)
        }),
        indices: new Uint32Array(indices),
        primitiveType: PrimitiveType.TRIANGLES
      }),
      attributeLocations: { position: 0, st: 1, color: 2 },
      primitiveType: PrimitiveType.TRIANGLES,
      renderState: createAlphaRenderState(true),
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER
    }
  }
}
