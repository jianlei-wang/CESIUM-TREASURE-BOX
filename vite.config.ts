import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'
import { viewsBackend, viewsProxyOptions } from './scripts/vite-views-backend.mjs'

const CESIUM_GLOBAL_ID = '\0cesium-global'

const cesiumHtmlOptimize: Plugin = {
  name: 'cesium-html-optimize',
  transformIndexHtml(html: string) {
    return html
      .replace(/<link rel="stylesheet" href="\.?\/?cesium\/Widgets\/widgets\.css">/, '')
      .replace(/\s*<script src="\.?\/?cesium\/Cesium\.js"[^>]*><\/script>/g, '')
  }
}

const CESIUM_SYMBOLS = [
  'Appearance', 'BillboardCollection', 'BlendEquation', 'BlendFunction', 'BoundingRectangle', 'BoundingSphere', 'BoxGeometry', 'BufferUsage',
  'CallbackPositionProperty', 'CallbackProperty', 'Camera', 'Cartesian2', 'Cartesian3',
  'Cartesian4', 'Cartographic', 'Cesium3DTileColorBlendMode', 'Cesium3DTilesInspector',
  'Cesium3DTileset', 'Cesium3DTileStyle', 'ClearCommand',
  'ClippingPlane', 'ClippingPlaneCollection',
  'ClippingPolygon', 'ClippingPolygonCollection', 'Clock', 'ClockRange', 'Color',
  'ClockStep',
  'ColorGeometryInstanceAttribute', 'ColorMaterialProperty', 'ComponentDatatype',
  'ComputeCommand', 'ConstantPositionProperty', 'ConstantProperty', 'Credit',
  'CullFace', 'CustomDataSource', 'CustomShader', 'CzmlDataSource', 'DirectionalLight',
  'Terrain',
  'DistanceDisplayCondition', 'DrawCommand', 'Ellipsoid', 'EllipsoidGeodesic',
  'EllipsoidGeometry', 'EllipsoidOutlineGeometry', 'EllipsoidSurfaceAppearance',
  'EllipsoidTerrainProvider', 'Entity', 'Event', 'DeveloperError', 'FrameRateMonitor', 'Framebuffer', 'GeoJsonDataSource', 'GeographicTilingScheme',
  'Geometry', 'GeometryAttribute', 'GeometryAttributes', 'GeometryInstance', 'GeometryPipeline', 'GridMaterialProperty',
  'GroundPolylineGeometry',
  'GroundPolylinePrimitive',
  'GroundPrimitive',
  'HeadingPitchRange', 'HeadingPitchRoll', 'HeightReference', 'HermitePolynomialApproximation', 'HorizontalOrigin',
  'ImageMaterialProperty', 'ImageryLayer', 'ImageryProvider',
  'GridImageryProvider', 'IonImageryProvider', 'OpenStreetMapImageryProvider', 'TileMapServiceImageryProvider',
  'IntersectionTests', 'Ion', 'JulianDate', 'KmlDataSource',
  'LabelCollection', 'LabelGraphics', 'LabelStyle', 'LagrangePolynomialApproximation', 'Material', 'MaterialAppearance', 'Math', 'Matrix3', 'Matrix4',
  'Model', 'NearFarScalar', 'Pass', 'PassState', 'OrthographicFrustum', 'PerInstanceColorAppearance', 'PerspectiveFrustum', 'PixelDatatype',
  'PixelFormat', 'Plane', 'PointGraphics', 'PointPrimitive', 'PointPrimitiveCollection', 'PolygonGeometry', 'PolygonHierarchy',
  'PolylineArrowMaterialProperty',
  'PolylineCollection', 'PolylineColorAppearance', 'PolylineDashMaterialProperty',
  'PolylineGeometry', 'PolylineGlowMaterialProperty', 'PolylineGraphics', 'PolylineMaterialAppearance',
  'PolylineOutlineMaterialProperty',   'PostProcessStage', 'PostProcessStageComposite', 'PostProcessStageSampleMode', 'Primitive', 'PrimitiveCollection', 'PrimitiveType',
  'PropertyBag', 'Quaternion', 'Ray',   'Rectangle', 'RectangleGeometry', 'RectangleGraphics', 'ReferenceFrame', 'RenderState', 'Renderbuffer', 'RenderbufferFormat', 'Resource', 'SampledPositionProperty',
  'VelocityOrientationProperty',
  'SampledProperty', 'Sampler', 'Scene', 'SceneMode', 'SceneTransforms',
  'ScreenSpaceEventHandler', 'ScreenSpaceEventType', 'ShaderProgram', 'ShaderSource',
  'ShadowMode',   'SingleTileImageryProvider', 'Simon1994PlanetaryPositions', 'SkyAtmosphere', 'SplitDirection', 'SunLight',
  'StripeMaterialProperty',
  'Texture', 'Texture3D', 'Axis', 'CameraEventType', 'CatmullRomSpline', 'EasingFunction', 'EllipsoidalOccluder', 'KeyboardEventModifier', 'PointPrimitiveCollection', 'PolygonPipeline', 'PolylineMaterialAppearance', 'PostProcessStageLibrary', '_shadersGaussianBlur1D', 'TextureMagnificationFilter', 'TextureMinificationFilter', 'TextureUniform',
  'TextureWrap', 'TimeInterval', 'Transforms', 'Tonemapper', 'UniformType', 'UrlTemplateImageryProvider',
  'TimeIntervalCollection',
  'VertexArray', 'VertexFormat', 'VerticalOrigin', 'Viewer', 'WallGeometry',
  'CylinderGeometry', 'BoxGraphics', 'VoxelContent', 'VoxelPrimitive', 'VoxelShapeType',
  'MetadataType', 'MetadataComponentType', 'RequestScheduler',
  'WebMapServiceImageryProvider', 'WebMapTileServiceImageryProvider', 'WebMercatorProjection', 'WebMercatorTilingScheme',
  'ArcGisMapServerImageryProvider', 'ArcType', 'BlendingState', 'ClassificationPrimitive', 'ClassificationType',
  'buildModuleUrl', 'createWorldTerrainAsync', 'createOsmBuildingsAsync', 'CesiumTerrainProvider', 'ArcGISTiledElevationTerrainProvider', 'ParticleSystem', 'CircleEmitter', 'BoxEmitter',
  'defined', 'destroyObject', 'sampleTerrainMostDetailed'
]

const cesiumGlobalShim = `const Cesium = window.Cesium
export default Cesium
${[...new Set(CESIUM_SYMBOLS)].map((s) => `export const ${s} = Cesium.${s}`).join('\n')}
`

const cesiumDevGlobal: Plugin = {
  name: 'cesium-dev-global',
  apply: 'serve',
  enforce: 'pre',
  transformIndexHtml(html: string) {
    return html.replace(/\s*<script src="\.?\/?cesium\/Cesium\.js"[^>]*><\/script>/g, '')
  },
  resolveId(id: string) {
    if (id === 'cesium') return CESIUM_GLOBAL_ID
  },
  load(id: string) {
    if (id === CESIUM_GLOBAL_ID) return cesiumGlobalShim
  }
}

const adminDevEntry: Plugin = {
  name: 'admin-dev-entry',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? '/'
      const [pathname, query] = url.split('?')
      if (pathname === '/admin' || pathname === '/admin/') {
        req.url = `/admin/index.html${query ? `?${query}` : ''}`
      }
      next()
    })
  }
}

const deploymentBase = process.env.BASE_URL?.trim() || './'

const compatPath = fileURLToPath(new URL('./src/cases/cesium-helpers-lib/compat/cesium-compat.ts', import.meta.url))
const helperPath = (dir: string, entry: string) =>
  fileURLToPath(new URL(`./src/cases/cesium-helpers-lib/packages/${dir}/src/${entry}.js`, import.meta.url))

const helperAliases: Record<string, string> = {
  '@geoblocks/cesium-audio': helperPath('cesium-audio', 'cesium-audio'),
  '@geoblocks/cesium-binoculars': helperPath('cesium-binoculars', 'cesium-binoculars'),
  '@geoblocks/cesium-bvh': helperPath('cesium-bvh', 'cesium-bvh'),
  '@geoblocks/cesium-compass': helperPath('cesium-compass', 'cesium-compass'),
  '@geoblocks/cesium-compass-bar': helperPath('cesium-compass-bar', 'cesium-compass-bar'),
  '@geoblocks/cesium-drone': helperPath('cesium-drone', 'cesium-drone'),
  '@geoblocks/cesium-first-person-mode': helperPath('FirstPersonCameraMode', 'FirstPersonCameraMode'),
  '@geoblocks/cesium-flyto': helperPath('cesium-flyto', 'cesium-flyto'),
  '@geoblocks/cesium-input': helperPath('cesium-input', 'cesium-input'),
  '@geoblocks/cesium-iso': helperPath('cesium-iso', 'cesium-iso'),
  '@geoblocks/cesium-obstacles': helperPath('cesium-obstacles', 'cesium-obstacles'),
  '@geoblocks/cesium-overlay': helperPath('cesium-overlay', 'cesium-overlay'),
  '@geoblocks/cesium-path-flyover': helperPath('cesium-path-flyover', 'cesium-path-flyover'),
  '@geoblocks/cesium-post-process': helperPath('cesium-post-process', 'cesium-post-process'),
  '@geoblocks/cesium-sphere-camera': helperPath('cesium-sphere-camera', 'cesium-sphere-camera'),
  '@geoblocks/cesium-view-cube': helperPath('cesium-view-cube', 'cesium-view-cube'),
  '@geoblocks/cesium-walk': helperPath('cesium-walk', 'cesium-walk')
}

export default defineConfig({
  base: deploymentBase,
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('cesium-')
        }
      }
    }),
    cesium(),
    cesiumHtmlOptimize,
    cesiumDevGlobal,
    adminDevEntry,
    viewsBackend()
  ],
  resolve: {
    alias: {
      '@rt': fileURLToPath(new URL('./src/cases/red-tide-3d', import.meta.url)),
      '@cesium/core': compatPath,
      '@cesium/engine': compatPath,
      ...helperAliases
    }
  },
  optimizeDeps: {
    exclude: ['cesium', 'dggal'],
    include: [
      'echarts',
      'xlsx',
      'shpjs',
      'shp-write',
      'jsts',
      'geotiff',
      'jszip',
      'proj4',
      'element-plus'
    ]
  },
  build: {
    chunkSizeWarningLimit: 1600
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.monkeycode-ai.online'],
    proxy: { '/api': viewsProxyOptions() }
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.monkeycode-ai.online'],
    proxy: { '/api': viewsProxyOptions() }
  }
})
