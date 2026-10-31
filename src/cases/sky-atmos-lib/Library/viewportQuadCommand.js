/**
 * 视口绘制命令扩展。
 *
 * 为天空管线提供两种支持自定义顶点着色器的视口命令：
 *   1. createViewportQuadCommand(fs, overrides, customVS) —— 第三个参数支持自定义顶点着色器；
 *   2. createViewportTriangleCommand(fs, vs, overrides) —— 直接以 (片元, 顶点, 配置) 创建全屏命令。
 *
 * 天空管线的离屏 Pass（aerial perspective / clouds / shadow / 各 bloom 材质）都依赖上述能力。
 * 这里只在传入的 context 实例上挂载这两个方法（不改官方 Context 原型），全部用官方导出的
 * DrawCommand / ShaderProgram / Geometry / VertexArray 实现，零侵入内核。
 */
import {
  defined,
  DrawCommand,
  ShaderProgram,
  PrimitiveType,
  Geometry,
  GeometryAttribute,
  ComponentDatatype,
  VertexArray,
  BufferUsage,
} from "cesium";
const defaultValue = (a, b) => a ?? b;
defaultValue.EMPTY_OBJECT = Object.freeze({});
import { viewportTriangleVertexShaderText } from "./PostProcessStage.js";

const attributeLocations = { position: 0, textureCoordinates: 1 };

import { adaptArraySamplerProgram } from "./internal/CesiumAdapter.js";
export { installFramebufferCallbacks } from "./internal/CesiumAdapter.js";

/**
 * 获取（并缓存）覆盖整个视口的全屏四边形 VertexArray。
 * 顶点位置使用裁剪空间 [-1,1]，顶点着色器里 gl_Position = vec4(position.xy, 1.0, 1.0)。
 */
function getViewportVertexArray(context) {
  if (defined(context._skyAtmosViewportVA)) {
    return context._skyAtmosViewportVA;
  }
  // 官方 Context 自带的全屏四边形（若存在则直接复用，几何与属性命名一致）
  if (typeof context.getViewportQuadVertexArray === "function") {
    try {
      const va = context.getViewportQuadVertexArray();
      if (defined(va)) {
        context._skyAtmosViewportVA = va;
        return va;
      }
    } catch (e) {
      // 回退到手动构建
    }
  }
  const geometry = new Geometry({
    attributes: {
      position: new GeometryAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
      }),
      textureCoordinates: new GeometryAttribute({
        componentDatatype: ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      }),
    },
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    primitiveType: PrimitiveType.TRIANGLES,
  });
  const va = VertexArray.fromGeometry({
    context,
    geometry,
    attributeLocations,
    bufferUsage: BufferUsage.STATIC_DRAW,
    interleave: true,
  });
  va.isViewportPipelineShared = true;
  context._skyAtmosViewportVA = va;
  return va;
}

function buildCommand(context, fragmentShaderSource, vertexShaderText, overrides) {
  overrides = defaultValue(overrides, defaultValue.EMPTY_OBJECT);
  // 允许调用方提供自定义属性槽位（如 SMAA 的 VS 使用 aPosition 而非 position）。
  const attribLoc = defaultValue(overrides.attributeLocations, attributeLocations);
  const shaderProgram = ShaderProgram.fromCache({
    context,
    vertexShaderSource: vertexShaderText,
    fragmentShaderSource,
    attributeLocations: attribLoc,
  });
  adaptArraySamplerProgram(shaderProgram, context);
  return new DrawCommand({
    vertexArray: getViewportVertexArray(context),
    primitiveType: defaultValue(overrides.primitiveType, PrimitiveType.TRIANGLES),
    renderState: overrides.renderState,
    shaderProgram,
    uniformMap: overrides.uniformMap,
    owner: overrides.owner,
    framebuffer: overrides.framebuffer,
    pass: overrides.pass,
  });
}

/**
 * 在给定 context 实例上安装支持自定义顶点着色器的视口命令方法。
 * 幂等：重复调用安全。
 * @param {Context} context Cesium 场景上下文（viewer.scene.context）
 */
export function installViewportCommands(context) {
  if (!defined(context) || context._skyAtmosViewportInstalled) {
    return;
  }

  // 使用支持自定义顶点着色器的全屏三角形命令
  context.isViewportQuad = false;

  // 保留官方原始实现，无自定义 VS 时回退
  const originalQuad = context.createViewportQuadCommand;

  context.createViewportQuadCommand = function (fragmentShaderSource, overrides, vertexShaderText) {
    if (defined(vertexShaderText)) {
      return buildCommand(this, fragmentShaderSource, vertexShaderText, overrides);
    }
    if (typeof originalQuad === "function") {
      return originalQuad.call(this, fragmentShaderSource, overrides);
    }
    return buildCommand(this, fragmentShaderSource, viewportTriangleVertexShaderText, overrides);
  };

  context.createViewportTriangleCommand = function (fragmentShaderSource, vertexShaderText, overrides) {
    return buildCommand(
      this,
      fragmentShaderSource,
      defaultValue(vertexShaderText, viewportTriangleVertexShaderText),
      overrides
    );
  };

  context._skyAtmosViewportInstalled = true;
}
