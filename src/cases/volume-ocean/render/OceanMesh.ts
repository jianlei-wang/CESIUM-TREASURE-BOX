/**
 * 叠加网格工具 —— 逐顶点着色网格的几何与外观
 *
 * 用于海底地形、水平切片、垂直断面等规则网格：位置用相对视点的双精度 ECEF，
 * 颜色逐顶点写入，外观一次着色、支持半透明与可选深度测试。
 */

import {
  Appearance,
  BlendingState,
  BoundingSphere,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  Primitive,
  type Geometry as GeometryType
} from 'cesium'

export interface VertexColorAppearanceOptions {
  translucent?: boolean
  depthTest?: boolean
  doubleSided?: boolean
}

/** 逐顶点颜色的外观：顶点着色器直接输出 color，不做光照 */
export function createVertexColorAppearance(options: VertexColorAppearanceOptions = {}): Appearance {
  return new Appearance({
    translucent: options.translucent ?? true,
    closed: false,
    renderState: {
      depthTest: { enabled: options.depthTest ?? true },
      cull: { enabled: !(options.doubleSided ?? true) },
      blending: BlendingState.ALPHA_BLEND
    },
    vertexShaderSource: `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in float batchId;
      in vec4 color;
      out vec4 v_color;
      void main()
      {
        vec4 position = czm_translateRelativeToEye(position3DHigh, position3DLow);
        v_color = color;
        gl_Position = czm_modelViewProjectionRelativeToEye * position;
      }
    `,
    fragmentShaderSource: `
      in vec4 v_color;
      void main()
      {
        if (v_color.a < 0.004) discard;
        out_FragColor = v_color;
      }
    `
  })
}

/** 把 0~255 颜色写入逐顶点颜色缓冲 */
export function writeVertexColor(
  colors: Uint8Array,
  vertexIndex: number,
  rgb: [number, number, number] | readonly number[],
  alpha: number
): void {
  const offset = vertexIndex * 4
  colors[offset] = rgb[0]
  colors[offset + 1] = rgb[1]
  colors[offset + 2] = rgb[2]
  colors[offset + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
}

/** 由位置 / 颜色 / 索引构建几何 */
export function buildVertexColorGeometry(
  positions: Float64Array,
  colors: Uint8Array,
  indices: number[],
  mode: number
): GeometryType {
  const attributes = new GeometryAttributes()
  attributes.position = new GeometryAttribute({
    componentDatatype: ComponentDatatype.DOUBLE,
    componentsPerAttribute: 3,
    values: positions
  })
  attributes.color = new GeometryAttribute({
    componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
    componentsPerAttribute: 4,
    normalize: true,
    values: colors
  })
  const maxIndex = indices.length ? Math.max(...indices) : 0
  return new Geometry({
    attributes,
    indices: maxIndex > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    primitiveType: mode,
    boundingSphere: BoundingSphere.fromVertices(positions)
  })
}

export function createVertexColorPrimitive(
  positions: Float64Array,
  colors: Uint8Array,
  indices: number[],
  mode: number,
  options: VertexColorAppearanceOptions = {}
): Primitive {
  return new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: buildVertexColorGeometry(positions, colors, indices, mode)
    }),
    appearance: createVertexColorAppearance(options),
    asynchronous: false,
    allowPicking: false
  })
}
