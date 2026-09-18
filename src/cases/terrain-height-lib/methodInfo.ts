import type { TerrainMethodId } from './types'

export type MethodInfo = {
  title: string
  short: string
  tech: string[]
  fit: string[]
}

export const terrainMethodInfo: Record<TerrainMethodId, MethodInfo> = {
  'sample-most-detailed': {
    title: '方案一 · 服务端采样（精度基准）',
    short: 'sampleTerrainMostDetailed',
    tech: [
      'sampleTerrainMostDetailed(provider, positions)：向地形服务发起请求，把每个采样点收敛到其可用的最高精度层级，结果直接写回 positions[i].height。',
      '结果是地形服务端的原始数据，与相机位置、场景加载状态完全无关，因此作为五种方案的精度基准。',
      '内部按瓦片分组并逐层收敛，必须走网络；192×192 共 36864 点实测约 8~10 秒。'
    ],
    fit: ['需要一份准确的高度数据、对耗时不敏感的一次性导出。', '作为其它方案的对照基准。']
  },
  'globe-get-height': {
    title: '方案二 · getHeight 同步查询',
    short: 'globe.getHeight',
    tech: [
      'globe.getHeight(cartographic)：同步调用、不发网络请求，直接读取当前已加载在内存中的地形瓦片。',
      '读取的是“当前相机视角下已精化的瓦片”。相机不在提取区时，射线与粗网格或裙边求交，会返回约 -17000 m 的无效高度。',
      '解决：先瞬移相机到矩形正上方、等待精细瓦片加载稳定，再采样，结束后恢复用户相机（refineOverhead 精化协议）。',
      '即使不涉及网络，每个采样点都要在 CPU 上做射线与三角形求交，精细 LOD 下 192×192 实测也在 8~13 秒。'
    ],
    fit: ['理解提取原理与演示对照。', '相机恰好已覆盖提取区时的轻量同步查询。']
  },
  'terrain-mesh': {
    title: '方案三 · 自请瓦片光栅化',
    short: 'TerrainMesh → FBO',
    tech: [
      '绕开场景：先用 provider.availability 查询矩形范围内真实存在数据的最高层级，再枚举相交瓦片，逐个 requestTileGeometry 取数据并 createMesh 构建三角网格。',
      '网格顶点的经纬度直接换算为矩形内的归一化坐标（NDC 直映射），三角形内部高度由光栅化线性插值，天然连续。',
      '不依赖相机与场景状态，无头环境、批量任务、服务端脚本均可运行；只要瓦片请求齐全就不会有空洞。',
      '冷启动慢（首次需下载瓦片），且 requestTileGeometry 会被请求调度器节流返回 undefined，需要实现重试。'
    ],
    fit: ['脱离浏览器批量运行。', '希望结果与相机状态完全解耦，不介意耗时。']
  },
  'derived-shader': {
    title: '方案四 · 派生着色器注入 GLOBE pass',
    short: '派生着色器',
    tech: [
      '地球每帧都要渲染一遍，地形走 GLOBE pass。对其片元着色器做派生：把原 main 改名后追加新 main，先执行原逻辑，再把顶点世界坐标 v_positionMC 变换到基准点 ENU 局部坐标，把“天”方向分量写入颜色输出。',
      '在矩形正上方构造正交相机、创建 N×N 浮点 FBO，遍历该帧 GLOBE pass 的 DrawCommand 并用派生程序重新执行，读回即得当前渲染 LOD 的高度场。',
      '实测 192×192 仅需数百毫秒，比走网络的方案快一到两个数量级。',
      '依赖 Cesium 内部接口（ShaderCache / 渲染管线），版本升级时需回归测试。'
    ],
    fit: ['需要交互级刷新速度，如视口变化后重新初始化水面。', '接受依赖内部 API、愿意做版本回归的场景。']
  },
  'pick-depth': {
    title: '方案五 · pick 深度反投影',
    short: 'pick 深度反投影',
    tech: [
      'Cesium 处理鼠标拾取时，会用拾取相机把场景重渲染一遍，深度以 RGBA 四字节打包存入 pick framebuffer。本方案复用该离屏管线：把拾取视图的相机置于矩形正上方（顶视、正交），渲染后读出每个像素的深度。',
      '深度解包后按正交投影线性关系反投影回世界坐标，再换算经纬度与海拔。',
      '这是五种方案中唯一能同时捕获地形、3D Tiles 与建筑遮挡的方法。',
      '深度按 8bit×4 打包存在量化损失，表现为米级抖动；相机必须高于场景中所有物体，且高点估计依赖地形精化。'
    ],
    fit: ['场景中存在建筑、模型，流体需要被建筑遮挡。', '接受米级量化误差、需要地形以外几何的场景。']
  }
}
