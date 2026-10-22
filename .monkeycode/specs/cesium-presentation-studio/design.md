# Cesium 三维场景演示漫游制作系统 · 技术设计

## 1. 架构原则

- 新实现位于 `src/cases/presentation-studio-lib/`，不依赖仓库其他案例的运行时代码。
- 仅依赖 `vue` 与 `cesium`，UI 使用自研组件与内联 SVG 图标，不使用 Element Plus。
- 单一 Cesium Viewer，场景对象在初始化时创建，播放期只更新属性，避免逐帧增删实体。
- 播放采用「确定性时间轴求值」：任意时刻 `t` 都能从初始状态重放动作得到同一画面，进度拖拽、单步、导出共用同一求值器。
- 视频导出采用「Cesium Canvas + 2D 合成 Canvas + MediaRecorder」，把字幕、弹窗、章节层绘制进导出画面。

## 2. 目录

```
presentation-studio-lib/
  PresentationStudio.vue       根编排、状态、播放循环、场景生命周期
  studio.css                   全部样式（ps- 前缀）
  core/
    types.ts                   领域模型
    defaults.ts                图层/效果/地标定义、工厂、内置示例工程
    normalize.ts               导入数据校验与兜底
    timeline.ts                时间轴构建、动作求值、相机/航线插值
    scene.ts                   Cesium 场景封装
    recorder.ts                航线采样平滑、重采样
    storage.ts                 localStorage 工程库与草稿
    video.ts                   MediaRecorder + 合成画布
    export-overlay.ts          导出画面中的字幕/弹窗/章节绘制
  components/
    Icon.vue  UiField.vue  UiSwitch.vue  UiSection.vue  UiModal.vue
    LeftRail.vue  RightRail.vue  ActionEditor.vue
    TransportBar.vue  StageOverlays.vue  LoadingVeil.vue
```

案例注册仍使用 `presentation-editor` 卡片 ID，入口指向新根组件，旧实现文件不再被引用。

## 3. 数据模型

```ts
PresentationProject {
  format: 'cesium.presentation', version: 1,
  id, name, note, createTime, updateTime,
  initial: { camera, layers, effects, time },
  steps: PresentationStep[]
}

PresentationStep {
  stepId, stepName, duration, speedRate, stayTime,
  transition: { type: 'none'|'fade'|'dip'|'slide', duration },
  actions: PresentationAction[]
}

ActionType =
  'flyTo' | 'recordRoute' | 'layerToggle' | 'timeAnimation' |
  'subtitle' | 'popup' | 'sceneEffect'

PresentationAction {
  actionId, actionType, enable, duration, note,
  ...按类型的参数
}
```

- 相机姿态：经度、纬度、高度、heading、pitch、roll、fov。
- 航线：采样点数组（含归一化 `t`）、录制时长、平滑强度、高度偏移。
- 图层：`imagery / terrain / dayanta / landmarks / beacons / route`。
- 效果：`shadows / lighting / fog / atmosphere / contour / slope`。
- 时序目标：`dayanta / landmarks / beacons`。

## 4. 时间轴

对每个 Step：

- 相机动作有效时长 = `action.duration / step.speedRate`；其他动作使用原时长。
- `actionsTotal = Σ 启用动作有效时长`。
- Step 活动时长 = `max(step.duration, actionsTotal)`，随后追加 `stayTime`。
- 总时长 = Σ Step 活动时长 + 停留时长。

求值 `evaluate(timeline, t, initial)`：

1. 以工程初始相机、图层、效果、时序进度为起点。
2. 顺序重放已经发生的动作；当前动作按局部进度 `p` 插值。
3. 相机动作从动作起点相机插值，保证跳转一致。
4. 图层淡入淡出用不透明度数值；效果开关同样转成 0–1 数值。
5. 字幕/弹窗仅在动作时间窗口内输出视图，并计算淡入淡出。
6. 章节转场使用当前 Step 起始时间与 `transition.duration` 计算。

插值：

- 定点飞行：`linear / smoothstep / easeInOutCubic`，可选高度弧线。
- 航线：按弧长参数化 Catmull-Rom 位置插值，角度最短路径插值，支持入场混合。
- 时序动画：起止进度之间插值，起始 8% 做前后状态过渡，避免模型突然消失。

## 5. 场景层

- 影像：Bing QuadKey 瓦片，失败回退 OSM。
- 地形：Cesium World Terrain 异步加载；预加载椭球地形以便即时切换。
- 模型：本地 `/dayanta/tileset.json` 3D Tiles。
- 地标：PointPrimitive + LabelCollection，统一不透明度更新。
- 光柱：Entity Cylinder + Ellipse，按不透明度更新材质。
- 航线：Entity PolylineGlow，缓存当前航线对象避免逐帧重建。
- 时序：大雁塔使用 ClippingPlane 自下而上生长；地标按进度逐个揭示；光柱按进度脉冲。
- 地形分析：自定义 Globe Material，同时支持等高线与坡度晕渲，uniform 控制开关与强度。
- 场景效果：阴影、光照、雾密度、大气、地形分析材质。
- 相机：直接 `camera.setView`，播放期禁用输入；编辑期恢复。

## 6. 播放控制

- 模式：`idle / playing / paused / preview / recording / exporting`。
- 播放范围：整片、单 Step、单 Action 预览。
- 时钟：`rAF + performance.now()`，全局速度 0.5/1/1.5/2。
- 整片结束与停止按钮回到工程初始状态。
- 单步/动作预览在终点停住，便于调试。
- 编辑选中动作时在动作中点做一次静态预览，参数变化后防抖重算。

## 7. 航线录制

- 100ms 采样相机姿态，实时绘制临时轨迹。
- 停止后：去重、滑动平均平滑、按最大点数重采样、计算累计弧长。
- 生成 `recordRoute` 动作，默认入场混合 1.2s，可继续调整时长、平滑、高度偏移。

## 8. 视频导出

1. 按目标分辨率提升 `viewer.resolutionScale` 并 `resize`。
2. 创建目标尺寸 2D 合成画布与 `captureStream(fps)`。
3. MediaRecorder 优先 `video/mp4`，不支持时降级 `video/webm` 并在 UI 明示。
4. 每一帧：Cesium 渲染完成后把 WebGL 画布按 cover 方式绘入合成画布，再绘制字幕、弹窗、章节层。
5. 实时播放整片，显示进度，可取消；完成后下载并恢复分辨率与初始场景。

## 9. 持久化

- localStorage key：`cesium.presentation.studio.v1`。
- 保存工程库、当前工程 ID、未保存草稿。
- 深监听工程变化 → 600ms 防抖写草稿并标记 dirty。
- 显式保存后清除草稿；离开页面前 `beforeunload` 提示。
- 导入先 `normalizeProject`，非法数据拒绝并提示。

## 10. 异常兜底

- 时间/速度/角度/高度全部 clamp。
- 空 Step 禁止整片播放并提示。
- 航线少于 2 点不生成动作。
- Cesium 加载失败显示错误与重试。
- 导出中禁止编辑、录制、切换工程。

## 11. 视觉

深空蓝黑底、青蓝主色、琥珀强调色；玻璃拟态面板、细描边、弱网格与晕影；左侧工程/步骤轨，中间全屏场景，右侧参数编排，底部悬浮播放台；字幕与章节采用影视化排版。
