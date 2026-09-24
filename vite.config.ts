import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

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
  'ClippingPolygon', 'ClippingPolygonCollection', 'ClockRange', 'Color',
  'ClockStep',
  'ColorGeometryInstanceAttribute', 'ColorMaterialProperty', 'ComponentDatatype',
  'ComputeCommand', 'ConstantPositionProperty', 'ConstantProperty', 'Credit',
  'CullFace', 'CustomDataSource', 'CustomShader', 'CzmlDataSource', 'DirectionalLight',
  'DistanceDisplayCondition', 'DrawCommand', 'Ellipsoid', 'EllipsoidGeodesic',
  'EllipsoidGeometry', 'EllipsoidOutlineGeometry', 'EllipsoidSurfaceAppearance',
  'EllipsoidTerrainProvider', 'Entity', 'Event', 'DeveloperError', 'FrameRateMonitor', 'Framebuffer', 'GeoJsonDataSource', 'GeographicTilingScheme',
  'Geometry', 'GeometryAttribute', 'GeometryAttributes', 'GeometryInstance', 'GeometryPipeline', 'GridMaterialProperty',
  'GroundPolylineGeometry',
  'GroundPolylinePrimitive',
  'GroundPrimitive',
  'HeadingPitchRange', 'HeadingPitchRoll', 'HeightReference', 'HermitePolynomialApproximation', 'HorizontalOrigin',
  'ImageMaterialProperty', 'ImageryLayer', 'ImageryProvider', 'ImagerySplitDirection',
  'GridImageryProvider', 'IonImageryProvider', 'OpenStreetMapImageryProvider', 'TileMapServiceImageryProvider',
  'IntersectionTests', 'Ion', 'JulianDate', 'KmlDataSource',
  'LabelCollection', 'LabelGraphics', 'LabelStyle', 'LagrangePolynomialApproximation', 'Material', 'MaterialAppearance', 'Math', 'Matrix3', 'Matrix4',
  'Model', 'NearFarScalar', 'Pass', 'PassState', 'OrthographicFrustum', 'PerInstanceColorAppearance', 'PerspectiveFrustum', 'PixelDatatype',
  'PixelFormat', 'Plane', 'PointGraphics', 'PointPrimitive', 'PointPrimitiveCollection', 'PolygonGeometry', 'PolygonHierarchy',
  'PolylineArrowMaterialProperty',
  'PolylineCollection', 'PolylineColorAppearance', 'PolylineDashMaterialProperty',
  'PolylineGeometry', 'PolylineGlowMaterialProperty', 'PolylineGraphics', 'PolylineMaterialAppearance',
  'PolylineOutlineMaterialProperty',   'PostProcessStage', 'PostProcessStageComposite', 'PostProcessStageSampleMode', 'Primitive', 'PrimitiveCollection', 'PrimitiveType',
  'PropertyBag', 'Quaternion', 'Ray',   'Rectangle', 'RectangleGeometry', 'ReferenceFrame', 'RenderState', 'Renderbuffer', 'RenderbufferFormat', 'Resource', 'SampledPositionProperty',
  'VelocityOrientationProperty',
  'SampledProperty', 'Sampler', 'Scene', 'SceneMode', 'SceneTransforms',
  'ScreenSpaceEventHandler', 'ScreenSpaceEventType', 'ShaderProgram', 'ShaderSource',
  'ShadowMode',   'SingleTileImageryProvider', 'Simon1994PlanetaryPositions', 'SkyAtmosphere', 'SplitDirection', 'SunLight',
  'Texture', 'Texture3D', 'TextureMagnificationFilter', 'TextureMinificationFilter',
  'TextureWrap', 'TimeInterval', 'Transforms', 'Tonemapper', 'UniformType', 'UrlTemplateImageryProvider',
  'TimeIntervalCollection',
  'VertexArray', 'VertexFormat', 'VerticalOrigin', 'Viewer', 'WallGeometry',
  'CylinderGeometry', 'BoxGraphics', 'VoxelContent', 'VoxelPrimitive', 'VoxelShapeType',
  'MetadataType', 'MetadataComponentType',
  'WebMapServiceImageryProvider', 'WebMapTileServiceImageryProvider', 'WebMercatorProjection', 'WebMercatorTilingScheme',
  'ArcGisMapServerImageryProvider', 'ArcType', 'BlendingState', 'ClassificationType',
  'createWorldTerrainAsync', 'CesiumTerrainProvider', 'ArcGISTiledElevationTerrainProvider', 'ParticleSystem', 'CircleEmitter', 'BoxEmitter', 'CylinderEmitter',
  'defined', 'destroyObject', 'sampleTerrainMostDetailed'
]

const cesiumGlobalShim = `const Cesium = window.Cesium
export default Cesium
${CESIUM_SYMBOLS.map((s) => `export const ${s} = Cesium.${s}`).join('\n')}
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

export default defineConfig({
  base: './',
  plugins: [vue(), cesium(), cesiumHtmlOptimize, cesiumDevGlobal],
  optimizeDeps: {
    exclude: ['cesium'],
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
    allowedHosts: ['.monkeycode-ai.online']
  }
})
