import {
  HeadingPitchRoll,
  Math as CesiumMath,
  Matrix4,
  Model,
  Transforms,
  type Cartesian3
} from 'cesium'

/**
 * Flying Drone (https://sketchfab.com/3d-models/flying-drone-2ecfb55304a043a2a86353f70cc1cf92)
 * by DogexorRexUwU (https://sketchfab.com/oscar.lopez.riviello), licensed under CC-BY-4.0.
 *
 * - scene_static.gltf：由 scene.gltf 转换而来。先把 KHR_materials_pbrSpecularGlossiness 改写为
 *   标准 metallic-roughness，再去除 88 骨骼蒙皮与动画（Cesium 1.144 的 GPU 蒙皮在当前渲染后端
 *   会把骨骼矩阵退化成常量缩放，导致整个模型不可见）。静态化后模型稳定可见，geometry 复用 scene.bin。
 *   设备图层与模拟飞行共用。
 */
export const DRONE_FULL_URI = '/models/flying_drone/scene_static.gltf'
export const DRONE_CREDIT =
  'Drone model: "Flying Drone" by DogexorRexUwU, CC-BY-4.0 (Sketchfab)'

/** 模型局部前向轴与航向之间的固定偏航修正。 */
const DRONE_YAW_OFFSET = 0

export type DroneModelOptions = {
  position: Cartesian3
  heading?: number
  scale?: number
  minimumPixelSize?: number
  id?: unknown
}

export function droneModelMatrix(position: Cartesian3, heading = 0): Matrix4 {
  return Transforms.headingPitchRollToFixedFrame(
    position,
    new HeadingPitchRoll(CesiumMath.toRadians(heading + DRONE_YAW_OFFSET), 0, 0)
  )
}

function loadModel(uri: string, options: DroneModelOptions): Promise<Model> {
  return Model.fromGltfAsync({
    url: uri,
    modelMatrix: droneModelMatrix(options.position, options.heading ?? 0),
    scale: options.scale ?? 1,
    minimumPixelSize: options.minimumPixelSize ?? 48,
    maximumScale: 20000,
    incrementallyLoadTextures: true,
    allowPicking: true,
    id: options.id,
    credit: DRONE_CREDIT
  })
}

/**
 * 加载无人机静态模型，设备图层与模拟飞行共用。
 * 调用方需要把返回的 model 加入 scene.primitives。
 */
export function createDroneModel(options: DroneModelOptions): Promise<Model> {
  return loadModel(DRONE_FULL_URI, options)
}
