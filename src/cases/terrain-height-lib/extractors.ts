import * as CesiumNamespace from 'cesium'
import {
  BoundingRectangle,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClearCommand,
  Color,
  DrawCommand,
  Ellipsoid,
  Framebuffer,
  Math as CesiumMath,
  Matrix4,
  Pass,
  PixelDatatype,
  PixelFormat,
  Rectangle,
  sampleTerrainMostDetailed,
  ShaderSource,
  Texture,
  Transforms,
  type Viewer
} from 'cesium'
import {
  applyMask,
  buildMask,
  computeStats,
  delay,
  makeGridCartographics,
  type HeightStats
} from './grid'
import {
  placeOrthoTopDown,
  rectangleDimensions,
  refineOverhead,
  type RectLike
} from './camera'
import type {
  TerrainExtractExtra,
  TerrainExtractParams,
  TerrainExtractResult,
  TerrainExtractor,
  TerrainMethodId
} from './types'

const CesiumInternal = CesiumNamespace as unknown as Record<string, unknown>
const PassState = CesiumInternal.PassState as new (context: unknown) => { framebuffer?: Framebuffer; viewport?: BoundingRectangle }
const Renderbuffer = CesiumInternal.Renderbuffer as new (options: unknown) => { destroy: () => void }
const RenderbufferFormat = CesiumInternal.RenderbufferFormat as { DEPTH_COMPONENT16: unknown }

function finalize(
  methodId: TerrainMethodId | string,
  params: TerrainExtractParams,
  heights: Float32Array,
  elapsedMs: number,
  extra: TerrainExtractExtra
): TerrainExtractResult {
  const { mask, maskedCount } = buildMask(params.rectangle, params.size, params.polygon)
  const before: HeightStats = computeStats(heights, new Uint8Array(heights.length).fill(1))
  applyMask(heights, mask)
  const stats = computeStats(heights, mask)
  return {
    methodId,
    size: params.size,
    rectangle: params.rectangle,
    heights,
    elapsedMs,
    validCount: stats.validCount,
    holeCount: stats.holeCount,
    maskedCount,
    min: stats.min,
    max: stats.max,
    mean: stats.mean,
    extra: {
      ...extra,
      rawMin: Number.isFinite(before.min) ? before.min.toFixed(1) : '—',
      rawMax: Number.isFinite(before.max) ? before.max.toFixed(1) : '—'
    }
  }
}

/** 用 globe.getHeight 粗估矩形区域内最高地形（用于正交相机高度） */
function estimateMaxTerrain(viewer: Viewer, rectangle: RectLike, samples = 16): number {
  const globe = viewer.scene.globe
  const scratch = new Cartographic()
  let max = 0
  for (let i = 0; i <= samples; i += 1) {
    scratch.longitude = CesiumMath.lerp(rectangle.west, rectangle.east, i / samples)
    for (let j = 0; j <= samples; j += 1) {
      scratch.latitude = CesiumMath.lerp(rectangle.south, rectangle.north, j / samples)
      const h = globe.getHeight(scratch)
      if (typeof h === 'number' && Number.isFinite(h)) max = Math.max(max, h)
    }
  }
  return max
}

/* -------------------------------------------------------------------------- */
/* 方案一：sampleTerrainMostDetailed —— 精度基准                              */
/* -------------------------------------------------------------------------- */

async function runSampleMostDetailed(
  viewer: Viewer,
  params: TerrainExtractParams
): Promise<TerrainExtractResult> {
  const started = performance.now()
  const positions = makeGridCartographics(params.rectangle, params.size)
  params.onProgress?.(`正在向地形服务请求 ${positions.length} 个采样点并收敛到最高层级…`)
  await sampleTerrainMostDetailed(viewer.terrainProvider, positions)
  const heights = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 1) {
    const h = positions[i].height
    heights[i] = typeof h === 'number' && Number.isFinite(h) ? h : Number.NaN
  }
  return finalize('sample-most-detailed', params, heights, performance.now() - started, {
    api: 'sampleTerrainMostDetailed',
    samples: positions.length
  })
}

/* -------------------------------------------------------------------------- */
/* 方案二：globe.getHeight —— 同步查询 + LOD 精化                             */
/* -------------------------------------------------------------------------- */

async function runGlobeGetHeight(
  viewer: Viewer,
  params: TerrainExtractParams
): Promise<TerrainExtractResult> {
  const started = performance.now()
  const handle = await refineOverhead(viewer, params.rectangle, { onProgress: params.onProgress })
  try {
    params.onProgress?.('正在同步读取已加载瓦片高度…')
    const globe = viewer.scene.globe
    const positions = makeGridCartographics(params.rectangle, params.size)
    const heights = new Float32Array(positions.length)
    const scratch = new Cartographic()
    for (let i = 0; i < positions.length; i += 1) {
      scratch.longitude = positions[i].longitude
      scratch.latitude = positions[i].latitude
      const h = globe.getHeight(scratch)
      heights[i] = typeof h === 'number' && Number.isFinite(h) ? h : Number.NaN
    }
    return finalize('globe-get-height', params, heights, performance.now() - started, {
      api: 'globe.getHeight',
      refine: '瞬移相机 + 等待瓦片稳定'
    })
  } finally {
    handle.restore()
  }
}

// 复用 grid 的网格生成，避免相机在飞行中修改参数
/* -------------------------------------------------------------------------- */
/* 方案三：自请地形瓦片 + 光栅化 —— 不依赖场景                                */
/* -------------------------------------------------------------------------- */

type TileMesh = {
  vertices: Float32Array
  stride: number
  indices: Uint16Array | Uint32Array
  indexCountWithoutSkirts: number
  vertexCountWithoutSkirts: number
  encoding: {
    decodePosition: (buffer: Float32Array, index: number, result: Cartesian3) => Cartesian3
  }
}

async function requestTileGeometryWithRetry(
  provider: TerrainViewerProvider,
  x: number,
  y: number,
  level: number,
  attempts = 8
): Promise<unknown> {
  for (let i = 0; i < attempts; i += 1) {
    const promise = provider.requestTileGeometry(x, y, level)
    if (promise) {
      try {
        return await promise
      } catch {
        // 落到重试
      }
    }
    await delay(120)
  }
  return undefined
}

type TerrainViewerProvider = {
  availability?: {
    computeBestAvailableLevelOverRectangle?: (rectangle: Rectangle) => number
    computeMaximumLevelAtPosition?: (position: Cartographic) => number
  }
  tilingScheme: {
    positionToTileXY: (position: Cartographic, level: number, result?: Cartesian2) => Cartesian2
    tileXYToRectangle: (x: number, y: number, level: number, result?: Rectangle) => Rectangle
  }
  requestTileGeometry: (x: number, y: number, level: number) => Promise<unknown> | undefined
}

function autoTileLevel(provider: TerrainViewerProvider, rectangle: Rectangle): number {
  let level: number | undefined
  const availability = provider.availability
  if (availability?.computeBestAvailableLevelOverRectangle) {
    level = availability.computeBestAvailableLevelOverRectangle(rectangle)
  }
  if ((level === undefined || !Number.isFinite(level)) && availability?.computeMaximumLevelAtPosition) {
    level = availability.computeMaximumLevelAtPosition(Rectangle.center(rectangle, new Cartographic()))
  }
  if (level === undefined || !Number.isFinite(level)) level = 12
  return Math.max(0, Math.min(14, Math.floor(level)))
}

function enumerateTiles(
  tilingScheme: TerrainViewerProvider['tilingScheme'],
  rectangle: Rectangle,
  level: number
): Array<{ x: number; y: number }> {
  const northwest = Rectangle.northwest(rectangle, new Cartographic())
  const southeast = Rectangle.southeast(rectangle, new Cartographic())
  const minTile = tilingScheme.positionToTileXY(northwest, level, new Cartesian2())
  const maxTile = tilingScheme.positionToTileXY(southeast, level, new Cartesian2())
  const minX = Math.min(minTile.x, maxTile.x)
  const maxX = Math.max(minTile.x, maxTile.x)
  const minY = Math.min(minTile.y, maxTile.y)
  const maxY = Math.max(minTile.y, maxTile.y)
  const tiles: Array<{ x: number; y: number }> = []
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileRectangle = tilingScheme.tileXYToRectangle(x, y, level)
      if (Rectangle.intersection(tileRectangle, rectangle)) tiles.push({ x, y })
    }
  }
  return tiles
}

function rasterizeTriangle(
  xs: Float32Array,
  ys: Float32Array,
  zs: Float32Array,
  i0: number,
  i1: number,
  i2: number,
  output: Float32Array,
  size: number
): void {
  const x0 = xs[i0]
  const y0 = ys[i0]
  const x1 = xs[i1]
  const y1 = ys[i1]
  const x2 = xs[i2]
  const y2 = ys[i2]
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (area === 0) return
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
  const maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
  const maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)))
  const invArea = 1 / area
  const z0 = zs[i0]
  const z1 = zs[i1]
  const z2 = zs[i2]
  for (let py = minY; py <= maxY; py += 1) {
    const sy = py
    for (let px = minX; px <= maxX; px += 1) {
      const sx = px
      let w0 = ((x1 - sx) * (y2 - sy) - (x2 - sx) * (y1 - sy)) * invArea
      let w1 = ((x2 - sx) * (y0 - sy) - (x0 - sx) * (y2 - sy)) * invArea
      let w2 = 1 - w0 - w1
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue
      w0 = Math.max(0, w0)
      w1 = Math.max(0, w1)
      w2 = Math.max(0, w2)
      const total = w0 + w1 + w2
      const z = (w0 * z0 + w1 * z1 + w2 * z2) / total
      const o = py * size + px
      const previous = output[o]
      output[o] = Number.isFinite(previous) ? (previous + z) / 2 : z
    }
  }
}

function rasterizeMeshes(meshes: TileMesh[], rectangle: Rectangle, size: number): Float32Array {
  const output = new Float32Array(size * size).fill(Number.NaN)
  const ellipsoid = Ellipsoid.WGS84
  const position = new Cartesian3()
  const cartographic = new Cartographic()
  const west = rectangle.west
  const east = rectangle.east
  const north = rectangle.north
  const south = rectangle.south
  for (const mesh of meshes) {
    const vertexCount = mesh.vertexCountWithoutSkirts
    const xs = new Float32Array(vertexCount)
    const ys = new Float32Array(vertexCount)
    const zs = new Float32Array(vertexCount)
    for (let i = 0; i < vertexCount; i += 1) {
      mesh.encoding.decodePosition(mesh.vertices, i, position)
      ellipsoid.cartesianToCartographic(position, cartographic)
      xs[i] = ((cartographic.longitude - west) / (east - west)) * size - 0.5
      ys[i] = ((north - cartographic.latitude) / (north - south)) * size - 0.5
      zs[i] = cartographic.height
    }
    const indices = mesh.indices
    const count = Math.min(mesh.indexCountWithoutSkirts ?? indices.length, indices.length)
    for (let t = 0; t + 2 < count; t += 3) {
      rasterizeTriangle(xs, ys, zs, indices[t], indices[t + 1], indices[t + 2], output, size)
    }
  }
  return output
}

async function runTerrainMesh(
  viewer: Viewer,
  params: TerrainExtractParams
): Promise<TerrainExtractResult> {
  const started = performance.now()
  const provider = viewer.terrainProvider as unknown as TerrainViewerProvider
  const tilingScheme = provider.tilingScheme
  if (!tilingScheme) throw new Error('当前地形服务不提供瓦片结构（无 tilingScheme）')

  const level = params.tileLevel && params.tileLevel > 0 ? Math.min(18, params.tileLevel) : autoTileLevel(provider, params.rectangle)
  const tiles = enumerateTiles(tilingScheme, params.rectangle, level)
  if (tiles.length > 400) throw new Error(`层级 L${level} 相交瓦片 ${tiles.length} 个，请降低瓦片层级`)
  params.onProgress?.(`自请瓦片：层级 L${level}，相交 ${tiles.length} 个瓦片…`)

  const meshes: TileMesh[] = []
  let failed = 0
  for (let i = 0; i < tiles.length; i += 1) {
    if (params.signal?.aborted) throw new Error('已取消')
    const { x, y } = tiles[i]
    const data = await requestTileGeometryWithRetry(provider, x, y, level)
    if (!data) {
      failed += 1
      continue
    }
    const createMesh = (data as { createMesh?: (options: Record<string, unknown>) => Promise<unknown> }).createMesh
    if (!createMesh) {
      failed += 1
      continue
    }
    const mesh = (await createMesh.call(data, {
      tilingScheme,
      x,
      y,
      level,
      requestVertexNormals: false,
      requestWaterMask: false,
      throttle: false
    })) as TileMesh | undefined
    if (!mesh) {
      failed += 1
      continue
    }
    meshes.push(mesh)
    if ((i + 1) % 8 === 0) params.onProgress?.(`已请求 ${i + 1}/${tiles.length} 个瓦片…`)
  }
  if (meshes.length === 0) throw new Error('未取到任何可用地形瓦片')

  params.onProgress?.('正在把瓦片三角网格光栅化为高度场…')
  const heights = rasterizeMeshes(meshes, params.rectangle, params.size)
  let vertices = 0
  for (const mesh of meshes) vertices += mesh.vertexCountWithoutSkirts
  return finalize('terrain-mesh', params, heights, performance.now() - started, {
    level,
    tiles: tiles.length,
    meshes: meshes.length,
    failedTiles: failed,
    vertices
  })
}

/* -------------------------------------------------------------------------- */
/* 方案四：派生着色器注入 GLOBE pass                                          */
/* -------------------------------------------------------------------------- */

function getDerivedHeightProgram(context: CesiumContext, shaderProgram: CesiumShaderProgram): CesiumShaderProgram | undefined {
  if (!shaderProgram) return undefined
  const keyword = 'terrainHeightExtract'
  const cache = context.shaderCache
  const existing = cache.getDerivedShaderProgram(shaderProgram, keyword)
  if (existing) return existing
  try {
    const fragment = shaderProgram.fragmentShaderSource.clone()
    const replaceMain = (ShaderSource as unknown as { replaceMain: (source: string, name: string) => string }).replaceMain
    fragment.sources = fragment.sources.map((source: string) => replaceMain(source, 'czm_terrainHeightMain'))
    fragment.sources.push(`
uniform mat4 u_extractMatrix;
void main()
{
    czm_terrainHeightMain();
    vec3 localPosition = (u_extractMatrix * vec4(v_positionMC, 1.0)).xyz;
    out_FragColor = vec4(localPosition.z, out_FragColor.g, out_FragColor.b, 1.0);
}
`)
    return cache.createDerivedShaderProgram(shaderProgram, keyword, {
      vertexShaderSource: shaderProgram.vertexShaderSource.clone(),
      fragmentShaderSource: fragment,
      attributeLocations: shaderProgram._attributeLocations
    })
  } catch {
    return undefined
  }
}

type CesiumShaderProgram = {
  fragmentShaderSource: { clone: () => { sources: string[] } }
  vertexShaderSource: { clone: () => unknown }
  _attributeLocations: unknown
}

type CesiumContext = {
  colorBufferFloat: boolean
  shaderCache: {
    getDerivedShaderProgram: (program: CesiumShaderProgram, keyword: string) => CesiumShaderProgram | undefined
    createDerivedShaderProgram: (
      program: CesiumShaderProgram,
      keyword: string,
      options: { vertexShaderSource: unknown; fragmentShaderSource: unknown; attributeLocations: unknown }
    ) => CesiumShaderProgram
  }
  readPixels: (state: { framebuffer: Framebuffer; width: number; height: number }) => Float32Array | Uint8Array
  draw: (
    command: unknown,
    passState: unknown,
    shaderProgram: unknown,
    uniformMap: unknown
  ) => void
}

async function runDerivedShader(
  viewer: Viewer,
  params: TerrainExtractParams
): Promise<TerrainExtractResult> {
  const started = performance.now()
  const scene = viewer.scene as unknown as CesiumScene
  const context = scene.context
  if (!context) throw new Error('无法访问 Cesium Context')
  if (!context.colorBufferFloat) {
    throw new Error('当前 WebGL 环境不支持浮点颜色缓冲（EXT_color_buffer_float），无法使用派生着色器方案')
  }

  const size = params.size
  const { width: widthM, height: heightM, centerLon, centerLat } = rectangleDimensions(params.rectangle)
  const handle = await refineOverhead(viewer, params.rectangle, { onProgress: params.onProgress })

  let color: Texture | undefined
  let depth: { destroy: () => void } | undefined
  let framebuffer: Framebuffer | undefined
  try {
    const margin = params.cameraMargin ?? 1500
    const maxTerrain = estimateMaxTerrain(viewer, params.rectangle)
    const objectHeight = params.maxObjectHeight ?? 0
    const cameraHeight = maxTerrain + objectHeight + margin * 2
    const near = Math.max(0.1, cameraHeight - maxTerrain - objectHeight - margin)
    const far = cameraHeight + margin * 2
    const aspectRatio = widthM / Math.max(heightM, 1e-6)

    color = new Texture({
      context: context as never,
      width: size,
      height: size,
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.FLOAT
    })
    depth = new Renderbuffer({
      context: context as never,
      width: size,
      height: size,
      format: RenderbufferFormat.DEPTH_COMPONENT16
    })
    framebuffer = new Framebuffer({
      context: context as never,
      colorTextures: [color],
      depthRenderbuffer: depth,
      destroyAttachments: true
    } as never)
    const clear = new ClearCommand({
      framebuffer,
      color: new Color(-1e6, -1e6, -1e6, 1),
      depth: 1.0
    })
    ;(clear.execute as unknown as (ctx: unknown, state: unknown) => void)(context, new PassState(context as never))

    placeOrthoTopDown(viewer, params.rectangle, { width: widthM, aspectRatio, near, far, cameraHeight })
    const frames = Math.max(1, params.renderFrames ?? 2)
    for (let i = 0; i < frames; i += 1) {
      scene.requestRender()
      scene.render()
    }

    const commandList = scene.frameState.commandList as Array<{ pass: number; shaderProgram: CesiumShaderProgram; uniformMap: Record<string, unknown> }>
    const extractMatrix = Matrix4.inverse(
      Transforms.eastNorthUpToFixedFrame(
        Cartesian3.fromRadians(centerLon, centerLat, 0),
        Ellipsoid.WGS84,
        new Matrix4()
      ),
      new Matrix4()
    )
    const passState = new PassState(context as never)
    passState.framebuffer = framebuffer
    passState.viewport = new BoundingRectangle(0, 0, size, size)

    let globeCommands = 0
    for (const command of commandList) {
      if (command.pass !== Pass.GLOBE) continue
      const shader = getDerivedHeightProgram(context, command.shaderProgram)
      if (!shader) continue
      globeCommands += 1
      const clone = (DrawCommand as unknown as { shallowClone: (command: unknown) => { framebuffer?: Framebuffer } | undefined }).shallowClone(command)
      if (!clone) continue
      clone.framebuffer = framebuffer
      const uniformMap = Object.assign({}, command.uniformMap, { u_extractMatrix: () => extractMatrix })
      context.draw(clone, passState, shader, uniformMap)
    }
    if (globeCommands === 0) throw new Error('本帧未找到 GLOBE 绘制命令，无法注入派生着色器')

    const pixels = context.readPixels({ framebuffer, width: size, height: size })
    const heights = new Float32Array(size * size)
    for (let row = 0; row < size; row += 1) {
      const sourceRow = size - 1 - row
      for (let col = 0; col < size; col += 1) {
        const value = pixels[(sourceRow * size + col) * 4]
        heights[row * size + col] = Number.isFinite(value) && value > -1e5 ? value : Number.NaN
      }
    }
    return finalize('derived-shader', params, heights, performance.now() - started, {
      level: '当前渲染 LOD',
      globeCommands
    })
  } finally {
    try {
      framebuffer?.destroy()
    } catch {
      // 忽略销毁异常
    }
    try {
      color?.destroy()
    } catch {
      // 忽略销毁异常
    }
    handle.restore()
  }
}

/* -------------------------------------------------------------------------- */
/* 方案五：pick 深度反投影 —— 唯一包含建筑与 3D Tiles                         */
/* -------------------------------------------------------------------------- */

function unpackDepth(pixels: Uint8Array, index: number): number {
  return (
    pixels[index] / 255 +
    pixels[index + 1] / 65025 +
    pixels[index + 2] / 16581375 +
    pixels[index + 3] / 4228250625
  )
}

type CesiumScene = {
  context: CesiumContext
  frameState: { commandList: unknown[] }
  view: {
    camera: {
      positionWC: Cartesian3
      rightWC: Cartesian3
      upWC: Cartesian3
      directionWC: Cartesian3
    }
    frustumCommandsList: Array<{ near: number; far: number }>
  }
  floatingOrigin?: { _cameraPosition: Cartesian3 }
  pickPositionSupported: boolean
  useDepthPicking: boolean
  pickTranslucentDepth: boolean
  opaqueFrustumNearOffset: number
  drawingBufferWidth: number
  drawingBufferHeight: number
  render: () => void
  requestRender: () => void
  _picking: { getPickDepth: (scene: unknown, index: number) => { framebuffer?: Framebuffer } }
}

async function runPickDepth(
  viewer: Viewer,
  params: TerrainExtractParams
): Promise<TerrainExtractResult> {
  const started = performance.now()
  const scene = viewer.scene as unknown as CesiumScene
  const context = scene.context
  if (!context) throw new Error('无法访问 Cesium Context')
  if (!scene.pickPositionSupported) throw new Error('当前环境不支持深度拾取（scene.pickPositionSupported=false）')
  scene.useDepthPicking = true
  scene.pickTranslucentDepth = false

  const size = params.size
  const { width: widthM, height: heightM } = rectangleDimensions(params.rectangle)
  const drawingWidth = scene.drawingBufferWidth
  const drawingHeight = scene.drawingBufferHeight
  const aspectRatio = widthM / Math.max(heightM, 1e-6)
  const handle = await refineOverhead(viewer, params.rectangle, { onProgress: params.onProgress })
  try {
    const maxTerrain = estimateMaxTerrain(viewer, params.rectangle)
    const objectHeight = params.maxObjectHeight ?? 0
    const margin = params.cameraMargin ?? 2000
    const cameraHeight = maxTerrain + objectHeight + margin
    const near = Math.max(0.1, cameraHeight - maxTerrain - objectHeight)
    const far = cameraHeight + margin

    placeOrthoTopDown(viewer, params.rectangle, { width: widthM, aspectRatio, near, far, cameraHeight })
    const frames = Math.max(1, params.renderFrames ?? 2)
    for (let i = 0; i < frames; i += 1) {
      scene.requestRender()
      scene.render()
    }

    const view = scene.view
    const frustumCommandsList = view.frustumCommandsList
    if (!frustumCommandsList || frustumCommandsList.length === 0) throw new Error('未获取到视锥命令列表')

    params.onProgress?.(`正在读回 ${drawingWidth}×${drawingHeight} 深度缓冲…`)
    const buffers: Array<Uint8Array | undefined> = []
    for (let i = 0; i < frustumCommandsList.length; i += 1) {
      const pickDepth = scene._picking.getPickDepth(scene, i)
      const fb = pickDepth?.framebuffer
      buffers.push(
        (fb
          ? context.readPixels({ framebuffer: fb, width: drawingWidth, height: drawingHeight })
          : undefined) as Uint8Array | undefined
      )
    }
    if (buffers.every((buffer) => !buffer)) throw new Error('未读取到可用的拾取深度缓冲')

    const camera = view.camera
    const positionWC = Cartesian3.clone(camera.positionWC)
    const rightWC = Cartesian3.clone(camera.rightWC)
    const upWC = Cartesian3.clone(camera.upWC)
    const directionWC = Cartesian3.clone(camera.directionWC)
    const halfWidth = widthM / 2
    const halfHeight = heightM / 2

    const positions = makeGridCartographics(params.rectangle, size)
    const heights = new Float32Array(size * size).fill(Number.NaN)
    const surface = new Cartesian3()
    const origin = new Cartesian3()
    const world = new Cartesian3()
    const offset = new Cartesian3()
    const cartographic = new Cartographic()
    let hits = 0

    for (let i = 0; i < positions.length; i += 1) {
      const longitude = positions[i].longitude
      const latitude = positions[i].latitude
      Cartesian3.fromRadians(longitude, latitude, 0, Ellipsoid.WGS84, surface)
      const dx = surface.x - positionWC.x
      const dy = surface.y - positionWC.y
      const dz = surface.z - positionWC.z
      const localX = dx * rightWC.x + dy * rightWC.y + dz * rightWC.z
      const localY = dx * upWC.x + dy * upWC.y + dz * upWC.z
      const ndcX = localX / halfWidth
      const ndcY = localY / halfHeight
      if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) continue
      const px = Math.min(drawingWidth - 1, Math.max(0, Math.floor((ndcX * 0.5 + 0.5) * drawingWidth)))
      const py = Math.min(drawingHeight - 1, Math.max(0, Math.floor((ndcY * 0.5 + 0.5) * drawingHeight)))
      const byteIndex = (py * drawingWidth + px) * 4

      let depth = Number.NaN
      let frustumIndex = -1
      for (let k = 0; k < buffers.length; k += 1) {
        const buffer = buffers[k]
        if (!buffer) continue
        const value = unpackDepth(buffer, byteIndex)
        if (value > 0 && value < 1) {
          depth = value
          frustumIndex = k
          break
        }
      }
      if (frustumIndex < 0) continue

      const frustum = frustumCommandsList[frustumIndex]
      const nearDistance = frustum.near * (frustumIndex !== 0 ? scene.opaqueFrustumNearOffset : 1)
      const farDistance = frustum.far
      const distance = nearDistance + depth * (farDistance - nearDistance)

      Cartesian3.clone(positionWC, origin)
      Cartesian3.multiplyByScalar(rightWC, localX, offset)
      Cartesian3.add(origin, offset, origin)
      Cartesian3.multiplyByScalar(upWC, localY, offset)
      Cartesian3.add(origin, offset, origin)
      Cartesian3.multiplyByScalar(directionWC, distance, offset)
      Cartesian3.add(origin, offset, world)

      Ellipsoid.WGS84.cartesianToCartographic(world, cartographic)
      heights[i] = cartographic.height
      hits += 1
    }

    return finalize('pick-depth', params, heights, performance.now() - started, {
      drawingBuffer: `${drawingWidth}×${drawingHeight}`,
      hits,
      depthFormat: '8bit×4 packed'
    })
  } finally {
    handle.restore()
  }
}

export const terrainExtractors: Record<TerrainMethodId, TerrainExtractor> = {
  'sample-most-detailed': {
    id: 'sample-most-detailed',
    label: 'sampleTerrainMostDetailed',
    run: runSampleMostDetailed
  },
  'globe-get-height': {
    id: 'globe-get-height',
    label: 'globe.getHeight',
    run: runGlobeGetHeight
  },
  'terrain-mesh': {
    id: 'terrain-mesh',
    label: '自请瓦片光栅化',
    run: runTerrainMesh
  },
  'derived-shader': {
    id: 'derived-shader',
    label: '派生着色器',
    run: runDerivedShader
  },
  'pick-depth': {
    id: 'pick-depth',
    label: 'pick 深度反投影',
    run: runPickDepth
  }
}

export const terrainExtractorList: TerrainExtractor[] = Object.values(terrainExtractors)
