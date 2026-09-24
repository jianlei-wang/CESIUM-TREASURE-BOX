# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-09-08
- Context: Discovered by Agent while delivering V6.23 可视化大屏模块（datav 分类 + demo0 样板屏；参考 SC-DATAV demos0-3 平移，后续 demo1~3 同此约定）
- Category: Environment Configuration
- Instructions:
  - datav 模块架构铁律：模块代码/数据/素材全部放独立 `src/datav/` 子树（自包含，天然不被 `sync-cases.mjs` 的 `src/cases/` 扫描影响）；`src/cases/datav-*` 只放 defineAsyncComponent 桥接壳 + Meta（id/category=`datav`，**无 icon 字段**）；分类图标用 `@element-plus/icons-vue` 的 `DataBoard` 加在 `src/cases/index.ts` categories。
  - 技术选型已拍板：参考工程用 React + @react-three/fiber，本项目一律「原生 Three.js 命令式 Build 函数 + 注册到 DatavEngine.addFrame 帧回调」重写，不引 React 生态包（仅新增 `three`）；公共能力沉淀到 `src/datav/common/`（engine/stage/FitStage 1920×1080 等比缩放/textSprite/effects/echartBox），echarts 沿用项目全量包。
  - `parseGeo` 处理 GeoJSON 必须按 `geometry.type` 归一化 ring 层级：`Polygon`→`[coordinates]`、`MultiPolygon`→直接取 `coordinates`（多边形数组），否则 polygon 数组被当 ring 遍历导致坐标 NaN/undefined，CatmullRomCurve3 抛 `Cannot read properties of undefined (reading 'x')`（sc.json 21 个 Polygon 要素 vs sc_outline.json 单要素 MultiPolygon 是本坑样例）。
  - DatavEngine 的 WebGLRenderer 开 `preserveDrawingBuffer: true`，使 headless 可用页内 canvas→2D `drawImage`+`getImageData` 做像素级渲染断言。
  - three 场景动画清理纪律：一切 per-frame 逻辑（uniform 步进/飞线 index/相机 introMove）都放进 engine 帧循环或 rAF 回调内统一 handle，onBeforeUnmount 统一 dispose（引擎/geo.dispose/stage/interval），组件内 setInterval 单独收集清理。
  - datav 冒烟复用范式：`npm run sync` 后 manifest entries 增加；headless 验证文件 `/tmp/opencode/verify_datav_demo0.cjs`（分类点击→卡片→进入→`.datav-root canvas`→ECharts 面板计数→像素非空断言→0 pageerror）；SwiftShader 帧率低，rAF/等待超时放宽。demo0 已完成阶段验收，demo1~3 平移沿用 datav-demo0 壳模板。
  - **datav 几何投影铁律（V6.23.2）**：与参考工程 Demo0/map/index.tsx 保持一致，用项目已有的 `d3-geo`：`geoMercator().center(centroid).translate([0,0])`（见 `src/datav/demo0/geo.ts` makeProjector）。d3 墨卡托 y 朝南，平面点必须再 `Vector2(x, -y)` 翻回北朝上，才能与北向上的 `sc_map` 纹理/UV 对齐；手写北朝上公式后再取 `-y` 会把贴图相对地面黑色轮廓竖直翻转。禁止等距经纬度近似（宽高比 1.35 vs 纹理 1.169）。轮廓挤出/飞线只用 MultiPolygon 的 `coordinates[0]` 主环（对齐 outline.tsx）。

[Project Knowledge Summary]
- Date: 2026-09-07
- Context: Discovered by Agent while delivering V6.21 + V6.21.1 天气特效-沙尘暴（weather）/ 场景截图控件 + 区域截图控件（widgets）三案例
- Category: Environment Configuration
- Instructions:
  - 天气特效共享 shader 追加到 `src/lib/weather.ts`（本迭代新增 `export const SANDSTORM_FRAGMENT`，行 419-524，uniform `time/density/haze/wind/speed/tint/darken`，内置 hash/noise/perlin3-fbm，streakLayer 横向沙丝 + bankMask 双 perlin 卷尘 + 沙色雾 mix）；新增天气类案例优先复习该文件并复用天气壳 `.weather-shell` 深蓝玻璃面板惯例。
  - Cesium 全屏后处理惯例：`scene.postProcessStages.add(new Cesium.PostProcessStage({ fragmentShader, uniforms }))`；动画 time 在 `scene.postUpdate` 回调内用 clock 差分累计（不写 rAF，避免与渲染帧脱节）；开关仅切 `stage.enabled`。SwiftShader 无头下可验证 shader 无编译 error + 滑杆交互无 pageerror。
  - 深度重建类后处理（如视频投影融合）在无头 SwiftShader 下**无法可视化验证**：PostProcessStage 的 `depthTexture` 采样恒为 1.0（天空），连 Cesium 内置 `PostProcessStageLibrary.createDepthViewStage()` 输出也全空白；即使 `context.depthTexture=true`/`fragmentDepth=true`、无地形椭球、`depthTestAgainstTerrain` 真/假均为空。须以真实浏览器截图验收。读取深度用 `czm_readDepth(depthTexture, uv)`（Cesium 内置 DepthView/DepthOfField 同款），本项目用的 `czm_unpackDepth(texture(...))` 在真实深度纹理（`.gba=0`）下与 `czm_readDepth` 等价（log 深度关闭时 `reverseLogDepth` 为恒等）。`czm_globeDepthTexture` 在 PostProcessStage 中不可用（采样致 `UniformSampler.set` 读 `_target` 崩溃）。
  - 截图类案例必须自建 Viewer 并设 `contextOptions: { webgl: { preserveDrawingBuffer: true, alpha: false } }`——共享入口 `src/lib/cesium-scene.ts` 的 `createMapScene` 不接受 contextOptions，不可复用；相机默认矩形 / Ion.defaultAccessToken / Bing 影像 / globe.baseColor 等其余配置按 `cesium-scene.ts` 原样复制。
  - 截图捕获纪律：先写 `viewer.resolutionScale = scale`（清晰度），注册一次性 `scene.postRender` listener + `viewer.scene.requestRender()`，回调里 `canvas.toDataURL()`（或全量 drawImage 到离屏再裁剪）；SwiftShader 高倍率 PNG 编码偏慢，内部超时须放宽到 ≥8s。Playwright 断言下载文件要轮询 download 事件（download 事件有延迟竞态），不要固定 sleep。
  - 区域截图控件最终交互（V6.21.1 用户选定「页面遮罩拖拽框选」，废弃两击+飞行方案）：点「开始框选」在 `.widget-shell` 上覆盖 `.crop-mask` 遮罩（`inset:0`、z-index 40、crosshair）；mousedown 记起点后把 mousemove/mouseup/keydown(Esc) 挂 window，实时显示选区虚线框 + `W×H px` 标签；松开 clamp 坐标得 CSS DragBox（<12px 判取消）。DOM（遮罩/浮控面板）无法光栅化，出图前先隐藏 DOM 层，`readMapFrame`（postRender once + requestRender → 把 preserveDrawingBuffer 的 viewer.canvas drawImage 到离屏）取地图帧，按 `frame.width/canvas.clientWidth` 换算像素做 `drawImage` 子矩形裁剪 → `区域图鉴-YYYYMMDD-HHmmss.(png|jpg)` 下载；面板刷新降采样缩略图。相机保持当前视角，不做 flyTo。
  - 截图类案例的 `new Viewer` 必须挂在尺寸固定的地图容器元素（`.cesium-container`），**不能把外层 `.widget-shell` 直接作为挂载元素**：Cesium 会把整套 `.cesium-viewer` 注入该元素，与地图子 div 并列成块级布局，且 `.widget-shell` 有 `overflow:hidden`，canvas 被挤到可视区外裁掉，表现即「地图场景不可见」（V6.21.2 根因）。
  - 三案例注册位置与命名：weather-sandstorm（category weather，接 integralHeightFogCase 后）；widget-scene-shot / widget-region-shot（category widgets，接 widgetMapSplitCase 后、voxelStrata 前）；`src/cases/index.ts` 的 import 与 demoCase 数组条目成对添加，组内保持连续。icon 约定：默认新案例无 icon 可先省略 `icon` 字段（DemoCard.icon 可选）；用户反馈提供图后复制 `.monkeycode-tmp-files/*-image-<n>.webp` 为 `src/cases/<case>/icon.webp` 并 `import icon from './icon.webp'` + `icon,`。本次映射：weather-sandstorm=image-1、widget-scene-shot=image-2、widget-region-shot=image-3。

[Project Knowledge Summary]
- Date: 2026-09-07
- Context: Discovered by Agent while delivering situation-plotting case (综合态势标绘控件, category widgets, reusable lib src/cases/situation-plotting-lib/)
- Category: Environment Configuration
- Instructions:
  - 实体命名/标识符约定（跨模块、代码各处直接引用，改动需全局同步）：几何实体沿用 `PLOT_ENTITY_PREFIX='military-plotting-'`；点标注实体前缀 `situation-annotation-text-|image-|model-`；选中高亮实体 id 固定 `situation-annotation-select-marker`；导出文件名前缀 `综合态势标绘-`、point DBF 字段 `POINT_DBF_FIELDS = ['kind','content','source','size','scale','heading','height']`。
  - 标注实体的位置语义 = 平面 `position` 承载 lon/lat，高度/贴地另算：model 的 height 计入渲染平面并写回导出字段；文本/图片高度为 0。编辑拖拽一律调用 annotation-types 的 `updateAnnotationPosition(viewer, object)` 同步 position 与 altitude，**不要全量重建实体**；选中高亮实体惰性单例渲染：样式参数只在首次 add 时赋值，移动/旋转/缩放只改 `marker.position`，条件不满足时 remove，可避免闪烁。
  - 本组件内几何（PlotEditSession）与标注（AnnotationSession）两套会话互不感知；文本旋钮按设计禁用（`annotationEditTools()` 返回 disabled），图片/模型才可旋转；geometry editor 的 `.objects` items 导出前按 shape 'polygon'|'polyline' 过滤（'none' 是起止辅助点）。
  - 上传控件：图片与模型各一张隐藏 `<input type="file">` 固定 ref（`imageUploadInput`/`modelUploadInput`），handler 收 `event` 自行取 `event.target.files`（不要收 Files 参数）并清空 `input.value`；glTF 引用外部纹理/缓冲时支持 multiple 多选后对 uri/url 做相对资源重写。
  - 验证范式（复用）：`npx vue-tsc -b --force` 0 error；`npm run build` EXIT=0（脚本含 vue-tsc 与 vite 两阶段）；headless 冒烟 `/tmp/opencode/verify_situation.cjs`（全局搜索进卡 → 文本/图片/模型模式在地图点击放置 → 编辑列表/属性面板 → GeoJSON/SHP 下载断言，忽略 favicon.ico 404 噪音）。
  - 收尾追加反馈（2026-09-07 同日）：案例改名「综合态势标绘控件」、category `draw`→`widgets`（「界面控件」分类），面板默认标题同步；卡片 icon 采用上传 image-1 = `.monkeycode-tmp-files/ecc51bf4-image-1.webp`（49272B）→ 复制 `src/cases/situation-plotting/icon.webp` 并在 index.ts `import icon` + `icon,` 字段；改名/迁移后的冒烟与 vue-tsc 保持全绿。

[Project Knowledge Summary]
- Date: 2026-08-25
- Context: Discovered by Agent while performing project code cleanup per `docs/project-code-cleanup-instruction.md`
- Category: Environment Configuration
- Instructions:
  - The `.monkeycode-tmp-files/` directory is excluded from version control (its own `.gitignore` contains `*`). Source code under `src/` must not import or reference any file inside `.monkeycode-tmp-files/`, otherwise builds break when the directory is absent (e.g., after clone).
  - Each case in `src/cases/` should reference its own local `icon.webp` via `./icon.webp` in `index.ts`, not files from `.monkeycode-tmp-files/`.
  - `src/lib/cesium-scene.ts` hardcodes the Cesium Ion access token; `src/lib/tianditu.ts` hardcodes the Tianditu token. These are SECURITY_REVIEW items awaiting a credential migration plan.

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: User instruction while implementing 3DTiles/rotation case migration
- Category: Workflow & Collaboration
- Instructions:
  - 所有涉及地形加载的案例（如 3DTiles 加载、3DTiles 压平）统一参考 `src/cases/terrain-control/TerrainControlDemo.vue`：加载前设置 `viewer.scene.globe.depthTestAgainstTerrain = true` 与 `viewer.scene.globe.maximumScreenSpaceError = 2`，`await loadWorldTerrain(viewer)` 期间 `statusMessage` 显示"正在加载Cesium World Terrain..."，卸载时用 `disposed` 保护避免写入已销毁的 Viewer。
  - Cesium Ion 地形服务（`api.cesium.com/v1/assets/1/endpoint`）存在间歇性故障，偶发返回 503/502 或 "Request has failed."，重试即恢复；排查地形加载失败时先重试确认是否为外部服务不稳定。

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while fixing 3DTiles load case inspector/shadow switches
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium `viewerCesium3DTilesInspectorMixin` 只创建不销毁：每次 `viewer.extend` 新建 `div.cesium-viewer-cesium3DTilesInspectorContainer` 与 `Cesium3DTilesInspector` 实例，且经 `Object.defineProperties` 重复定义同名属性会抛错。需要可关闭的检查器面板时，直接 `new Cesium3DTilesInspector(container, viewer.scene)` 管理 widget/容器引用，关闭时 `destroy()` + 移除容器；容器类名可自定义，Cesium inspector 内部不依赖默认容器类名。
  - Cesium 默认 `Scene.light` 为 `SunLight`，其方向由当前时钟时间决定；若当前时刻太阳在地平线下，开启阴影（`scene.shadowMap.enabled`）不会有可见阴影。需要阴影开关稳定生效时，开启时改为固定 `DirectionalLight`（如方向 `(-0.5,-0.6,0.7)`、强度 3.0），关闭时还原 `SunLight`。

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while implementing point/polyline/polygon dynamic drawing cases
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium Entity 材质属性读取：`polyline.material`/`polygon.material` 的 `getValue(time)` 返回 `{ color: Color }` 结构（`ColorMaterialProperty`），不是 Color 本身；验证透明度需读 `material.getValue(0).color.alpha`。
  - 多边形边框独立用 polyline 实体绘制（顶点首尾闭合）比 polygon 自带 `outline` 更灵活，可直接控制边框宽度与颜色。
  - 动态绘制类案例统一交互约定：`LEFT_CLICK` 采集顶点、`RIGHT_CLICK` 或 `LEFT_DOUBLE_CLICK` 结束/闭合；顶点数不足（点 1、线 2、面 3）时提示"点数不足"。
  - 参数实时联动：`watch` 参数数组后遍历 `viewer.entities` 修改对应 `point`/`polyline`/`polygon` 属性即可，无需重建实体。

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while fixing polyline/polygon draw preview and switches
- Category: Troubleshooting & Debugging
- Instructions:
  - primitive `PolylineCollection` 的 polyline `material` 属性 setter 只接受 `Material` 实例（销毁时调 `this._material.destroy()`）；直接赋 `Color` 会报 `this._material.destroy is not a function` 并导致渲染停止。画实时预览线必须用 `Material.fromType(Material.ColorType)`（本项目为 `measure-lib/material.ts` 的 `makeLineMaterial(color)`）。
  - `PolygonGraphics` 没有 `clampToGround` 属性（TS 直接报错）；贴地面用 `height: 0 + heightReference: HeightReference.CLAMP_TO_GROUND` 替代（`perPositionHeight: false`）。
  - 给带 `heightReference` 的 polygon entity 动态更新 `hierarchy` 时，`GroundGeometryUpdater` 会创建 `TerrainOffsetProperty` 并调用 `PolygonGeometryUpdater._computeCenter` 计算质心；当 hierarchy 只有 1~2 个点或含重复点时面积退化产生 NaN，抛 `cartesian has a NaN component`。预览面应仅当顶点数 ≥3 且预览点与最后采集点不重复时才 `setValue` hierarchy。
  - 点击事件时序：MOUSE_MOVE 先于 LEFT_CLICK 触发，点击瞬间 `lastPreviewPos` 与刚采集的顶点位置重合，构建预览点位数组前需按 `Cartesian3.equals` 去重。
  - 实体显示开关的正确实现：实体始终创建、开关只切换 `show` 属性（如 `vertexEntities` 存实体引用、`watch(showX)` 统一 `point.show = ...`），不要依赖创建时机的条件判断。

[User Instruction Summary]
- Date: 2026-08-26
- Context: User instruction while planning new buffer analysis cases
- Instructions:
  - 新增案例默认不自动生成 icon，`DemoCard.icon` 留空即可（首页自动显示"暂无截图"占位）。若用户在迭代反馈中提供了截图（如 image-1/image-2/image-3），则将截图拷为案例目录 `icon.webp` 并在 `index.ts` 添加 `icon` 引用。首页卡片读的是 `src/cases/manifest.ts`，改完后必须 `npm run sync` 才会显示新 icon。

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while implementing point/line/polygon buffer analysis cases
- Category: Build Methods
- Instructions:
  - 缓冲区几何计算使用完整版 `jsts@2.7.1`（非 @turf/jsts 精简版）：`new jsts.operation.buffer.BufferOp(geom, new BufferParameters())`，通过 `setJoinStyle`（JOIN_ROUND/JOIN_MITRE/JOIN_BEVEL）、`setEndCapStyle`（CAP_ROUND/CAP_FLAT/CAP_SQUARE）、`setQuadrantSegments`（即圆滑度 steps）控制圆角/方角与圆滑度；`@turf/buffer` 的源码忽略 `joinStyle`/`endCapStyle`（只透传 steps），不能用它实现端点/拐角样式。
  - jsts 投影方案（turf 同款）：`geoAzimuthalEquidistant().rotate([-cx, -cy]).scale(earthRadius)`，project/invert 在经纬度与平面米坐标间互转；radius 直接以米传给 `getResultGeometry(radius)`。
  - jsts 是 CJS/UMD 包且内部自带 `__esModule: true`，会误导 vite 的 CJS interop（`import default` 取到 `.default` 为 undefined）。加载方式：`import * as jstsModule from 'jsts'` + 运行时 `operation` 存在性判断 `(ns.operation ? ns : ns.default)`，兼容 vite dev（esbuild prebundle）与 vite build（rollup commonjs）；jsts 无官方类型，需自建 `jsts.d.ts` 声明。
  - Cesium `PolygonGraphics.outline/outlineColor/outlineWidth` 在地面多边形上渲染不可靠；多边形边框应改用独立 `polyline` 实体（创建时直接给 width/material/show，更新时改 show/width/material/positions）。
  - turf `polygon()` 要求 LinearRing 至少 4 个位置（首尾需闭合），传入 3 个顶点的面会抛 `Each LinearRing of a Polygon must have 4 or more Positions`；生成面缓冲前必须自动闭合环（追加首点）。
  - 无头 swiftshader 下 Cesium `scene.pickPosition`/`globe.pick` 偶发返回 undefined（渲染时序），地图点击采集顶点可能丢点；真实 GPU 环境正常。

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while porting the dynamic volumetric water case (custom Primitive + GLSL)
- Category: Troubleshooting & Debugging
- Instructions:
  - `Cesium.Appearance` 不设 `material` 时 `Appearance.update()` 返回 undefined，`Primitive.update` 直接 return，渲染命令不生成（画面完全无该 primitive）。必须给 `new Cesium.Appearance({...})` 传 `material: Cesium.Material.fromType(Cesium.Material.ColorType)`；自定义片元着色器用 `out_FragColor` 时 Color 材质的 `czm_getMaterial` 注入无害。
  - Cesium 1.144 的 `Pass` 枚举已扩展：OPAQUE=9、TRANSLUCENT=10（旧版 OPAQUE=4/TRANSLUCENT=6 已废弃）；调试 `frameState.commandList` 的 pass 时按新值判断。
  - `Primitive.geometryInstances` 在几何上传 GPU 后会被置 undefined（`releaseGeometryInstances` 默认 true），判断渲染状态用 `_va`/`_colorCommands`/`_boundingSphereWC`；Cesium 1.144 的 Primitive 内部无 `_primitive` 对象（旧版结构）。
  - 无头 swiftshader 下 canvas 默认 `preserveDrawingBuffer=false`，用 2D `drawImage`/`toDataURL` 读 WebGL canvas 得到空白/黑，像素验证不可信；用 CDP `Page.captureScreenshot` 截真实合成画面，配全局安装的 pngjs 解码统计颜色。
  - 持续动画（每帧渲染）会让 playwright `page.screenshot` 等待稳定帧超时；改用 CDP 截图。全局验证环境：`playwright-core@1.49.0` 匹配 `~/.cache/ms-playwright/chromium-1234`，启动参数 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`。

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while fixing dynamic-volume-water draw coordinates bug
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium `Cartographic.fromCartesian()` 返回的 `longitude/latitude` 是**弧度**；项目内 `PolygonPosition` 约定为**度数**。地图绘制 `pickPosition` 采集到 Cartesian3 后转 PolygonPosition 时必须 `×180/π`（或 `CesiumMath.toDegrees`），否则写入坐标文本与构建网格的节点坐标全部错乱（表现为极小值/错误区域）。
  - 常用默认多边形数据集中存于 `src/cases/water-reflection/water-positions.ts` 的 `LIJIANG_WATER_POSITIONS`（丽江水域，428 点闭合环，lon 100.638~100.692、lat 26.463~26.63），其他水面/水域案例默认边界可复用它；`normalizePolygonPositions` 会自动去掉首尾重复点。
  - 428 点多边形 + meshSegments 160 在无头 swiftshader 下重建水面网格会触发约 771ms 长任务（ySegments 按 depth/width 放大），属可接受范围；如出现明显卡顿可考虑降低 meshSegments 或对多边形抽稀。
  - 案例需要默认加载 Cesium World Terrain 时，统一走 `loadWorldTerrain(viewer)`：先设 `scene.globe.depthTestAgainstTerrain = true` + `maximumScreenSpaceError = 2`，`statusMessage` 显示「正在加载Cesium World Terrain...」，用 `disposed` 标志保护异步回调不写已销毁的 Viewer；`loadWorldTerrain` 失败时应降级（catch 后仍初始化场景）而非阻塞案例使用（Ion 地形服务存在间歇性故障）。

[Project Knowledge Summary]
- Date: 2026-08-26
- Context: Discovered by Agent while implementing the 3D water-depth-heat interpolation case (grid Primitive + vertex color)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 1.144 的 `new Cesium.GeometryAttributes({...})` 构造函数不接受对象参数（旧版本可传）；必须 `new Cesium.GeometryAttributes()` 后逐个赋值 `attributes.position/color = new Cesium.GeometryAttribute({...})`。
  - TypeScript 无法追踪跨函数调用对模块级变量的窄化（函数内部把模块级引用置 undefined 后，调用处其后使用该引用会报 `possibly 'undefined'`）；网格/点集等模块级对象赋值后循环内引用应改用局部变量保存返回值再遍历。
  - 网格面逐顶点着色渲染方案：`interpolateGrid` 的 cells 三角化后构建逐顶点 `color` attribute（`ComponentDatatype.UNSIGNED_BYTE` + `normalize:true`），自定义 `Appearance`（`renderState.depthTest.enabled=false` + `cull.enabled=false` + `BlendingState.ALPHA_BLEND`，顶点着色器 `czm_translateRelativeToEye` + 片元 `out_FragColor`），`Primitive` 设 `asynchronous:false`；无需 `material`（未用材质贴图时与动态体积水的 `material` 约定不冲突）。
  - 普通克里金插值性能关键：变差函数拟合（`fitVariogramModel`）只在网格重建时做 1 次并缓存进 `InterpolationGrid.krigingModel`，每 cell 只解小线性系统；38×38 网格 + 2600 点在无头环境可流畅完成。

[Project Knowledge Summary]
- Date: 2026-08-27
- Context: Discovered by Agent while implementing 2D/3D heatmap cases (port of leaflet.heat + h337)
- Category: Troubleshooting & Debugging
- Instructions:
  - `Cesium.ImageMaterialProperty` 用带 alpha 的 canvas（热力图、纹理图）时必须传 `transparent: true`，否则 alpha 通道被忽略、显示不透明黑底。
  - Cesium 1.144 没有 `Cesium.IndexDatatype.getSizeInBytes`；`Uint16Array`/`Uint32Array` 的选择用 `Math.max(...indices) > 65535` 判断。
  - 热力 canvas 渲染两段式（leaflet.heat/h337 同款）：先 shadow canvas 按 `globalAlpha=(value-min)/(max-min)` 叠加径向渐变 sprite 累积强度，再 colorize 按 alpha 从 256 色 palette 查色并夹取到 `[minOpacity, maxOpacity]`。要逐像素采样强度/颜色时，一次性导出像素数组（`getImageData` 全量）供索引，不要对每像素调用 `getImageData(1×1)`（3D 网格几万顶点会卡死）。
  - 首页按分类 tab 筛选、默认只渲染 `effects` 分类卡片；无头验证其他分类的案例需先点击 `.category-item`（如「数据可视化」）切换再点卡片，否则 `demo-card` 找不到。
  - 热力图 3D 案例公共逻辑抽到 `src/cases/heatmap-lib/`（heatmap-engine.ts 渲染引擎 + heatmap-data.ts 场景数据），2D/3D 两个案例复用；内置数据场景（北京多中心/上海带状/广州环形/成都聚集）用 seededRandom + Box-Muller 高斯生成。
  - 案例面板用 `aria-label` 的 select（如「数据场景」）无头验证时 `page.selectOption` 的 value 必须与 `heatmap-data.ts` 中 `scene.id` 完全一致（chengdu 是 `chengdu-core` 不是 `chengdu-cluster`）；Playwright 对不存在的 option 会报 "did not find some options"。
  - Playwright 直接改 range input 驱动 Vue 时，仅 dispatch `change` 不会更新 v-model 状态；需先 `el.value = v` 再依次 dispatch `input`（更新 v-model.number）和 `change`（触发 `@change` 回调）。
  - 3D 网格案例相机视距要与高度倍率匹配：默认 `heightScale` 3000 时，视距约 `Math.max(30000, span*25000)` + 42° 俯角才能看出 3000m 级起伏；视距过大（如 span*90000 约 279km）时高度变化在画面中几乎不可见。
  - 用户反馈"更换数据源不跳转"类缺陷的通用排查：检查 `onSceneChange` 是否只重建数据而没调用 `camera.flyTo` 到新 `scene.bounds`；"随机生成闪烁"则是 `busy` 遮罩 + 先 remove 后 add 产生空帧，修复为同步重建 + 先构建新 Primitive 再移除旧 Primitive。

[Project Knowledge Summary]
- Date: 2026-08-27
- Context: Discovered by Agent while implementing vehicle fixed-view viewshed case (port of three-cesium-examples ViewShedAnalyser)
- Category: Troubleshooting & Debugging
- Instructions:
  - `src/cases/viewshed-lib/viewshed-engine.ts` 大量使用 Cesium 内部 API（`DrawCommand.boundingVolume`、`ShaderProgram.replaceCache`、`Cesium.Buffer`、`new VertexArray({...})`、`Camera._transform`、`FrameState`/`Context` 类型等），这些在 Cesium 1.144 的公开类型中不存在，vue-tsc 会报错；统一用 `(Cesium.X as any)`/`as any` 强转即可通过（运行时这些内部符号仍存在，构建与运行均正常）。
  - 可视域引擎 shader（`sensorFS`/`scanPlaneFS`）自定义了 `struct czm_ellipsoid` 与 `czm_getWgs84EllipsoidEC`，Cesium 1.144 内置 shader 中已无同名符号（搜索 Build/Cesium.js 无匹配），不会产生重复定义冲突；其依赖的 `czm_inverseModelView`/`czm_twoPi`/`czm_getMaterial`/`out_FragColor` 等仍存在。
  - 车辆固定视角可视域案例：观察方向用 ENU 矩阵列向量组合（`east*sin(h) + north*cos(h)`），`Matrix4.getColumn` 的结果类型是 `Cartesian4`（含 w），取 xyz 需先 `new Cartesian4()` 再构造 `Cartesian3`。

[Project Knowledge Summary]
- Date: 2026-08-27
- Context: Discovered by Agent while upgrading vehicle viewshed case to dynamic ground-clamped route drawing
- Category: Troubleshooting & Debugging
- Instructions:
  - 车辆可视域案例贴地路线实现：绘制用 `pickPosition`（measure-lib，含深度/地形拾取回退）采集点；结束绘制后用 `sampleTerrainMostDetailed` 对路径顶点采样真实地形高度（返回 `Cartographic[]`），需先 `viewer.terrainProvider instanceof CesiumTerrainProvider` 判断（EllipsoidTerrainProvider 调用会抛错），`terrainReady` 标志（loadWorldTerrain 完成后置 true）防止过早采样；路径 polyline 加 `clampToGround: true` 保证贴地显示。
  - 车辆行进位置 = 路径插值点（含采样地形高度）+ 观察高度；路径点不足 2 个时提示「路径至少需要 2 个点」。
  - 无头 swiftshader 下 CDP `Page.captureScreenshot` 对持续动画场景可能返回合成器缓存帧（连续两次截图像素完全相同，修改参数后也不刷新），不能据此判断画面是否更新；验证动画是否运行应直接读取实体位置（`entity.position.getValue(clockTime)` 前后对比）或 Vue 状态文本（如进度条）。

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while fixing terrain-excavation case (depthTest=true 下开挖结果不可见)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 1.144 地形多边形裁剪应使用 `Globe.clippingPolygons`（`ClippingPolygonCollection` + `new ClippingPolygon({positions})`，1.111+ 原生支持 terrain 裁剪，PR #11750），参考 @bimangle/cesium-tool-excavate 的选择逻辑；`Globe.clippingPlanes`（无限半空间平面）在 `depthTestAgainstTerrain=true` 下对坑内实体深度遮挡不可靠。`ClippingPolygonCollection` 无 `edgeWidth/edgeColor`，裁剪边界改用坑底 polygon 的 `outline` 表达。注意：此 API 只做「裁剪出缺口/掏洞」，无法把区域「压平填面」到目标高度——压平类需求见 V6.12 条目改用「整平面 PolygonGeometry + 外立面实体」方案。
  - Cesium `PolygonGraphics` 没有 `clampToGround` 属性（TS 报错）；让多边形贴合地表用 `perPositionHeight: true`（顶点自带 pick 出的地表高度）。
  - `Globe.clippingPolygons` 的 TS 类型声明为必选值，赋 undefined 清空需中转 `(globe as unknown as { clippingPolygons?: ClippingPolygonCollection }).clippingPolygons = undefined`。
  - 无头 SwiftShader 下 Cesium canvas 会被 resize 成 300x150 且 `toDataURL`/`readPixels` 全返回 baseColor，像素级验证不可靠；判断 Cesium 渲染结果应以引擎源码推理或真实浏览器验证为准。

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while upgrading profile-analysis case (多类型采样切换 + 起终点标记修复)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium point/label 实体贴合地形需 `heightReference: HeightReference.CLAMP_TO_GROUND`（polyline 用 `clampToGround: true`），仅传经纬度（高度 0）会在椭球面、被地形深度遮挡或位置错误；标记需随绘制路径更新时用带固定 id 的实体 `removeById` 重建。
  - 路径距离/剖面采样累计：手写 haversine（R=6371008.8）求每段球面距离，先按每段高密度点（如 500）构建带累计距离序列，再按目标距离线性插值取采样点，比逐点重建 `@turf/length` LineString 性能好且单位可控；距离统一用米，剖面 x 轴换算 km 显示。

[Project Knowledge Summary]
- Date: 2026-08-29
- Context: Discovered by Agent while porting CesiumChina/cesium-widget controls (V3.96)
- Category: Troubleshooting & Debugging
- Instructions:
  - 新版 Cesium 1.144 API 变更（移植旧版 cesium-widget / 旧代码时需适配）：`Cesium.getTimestamp()` 已移除，改用 `performance.now()`；`SceneTransforms.wgs84ToWindowCoordinates(scene, pos)` 改为 `SceneTransforms.worldToWindowCoordinates(scene, pos)`；`scene.imagerySplitPosition` 重命名为 `scene.splitPosition`；`ArcGisMapServerImageryProvider({url})` 构造不再接受 url，改用 `await ArcGisMapServerImageryProvider.fromUrl(url)`；分割方向枚举用 `SplitDirection`（无 `ImagerySplitDirection`）。
  - 内嵌第二个 `new Viewer(container, {...})` 做鹰眼小地图时：传 `baseLayer: false`（旧 `imageryProvider: false` 已不在类型中），并显式 `imageryLayers.removeAll()` 后再添加影像 provider；`ScreenSpaceEventHandler` 构造参数类型为 `HTMLCanvasElement`，传非 canvas 元素需 `as unknown as HTMLCanvasElement` 强转（运行时支持 HTMLElement）。
  - 罗盘/缩放等需要相机视线焦点的控件：SCENE3D 下用 `getCameraFocus` 逻辑（`new Ray(camera.positionWC, camera.directionWC)` + `scene.globe.pick(ray)`，2D/Columbus 用 `worldToCameraCoordinatesPoint`），或 `IntersectionTests.rayEllipsoid` 求焦点；`Ray.getPoint(ray, t)` 为静态方法。

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while implementing voxel-strata case (V4.8 手写 VoxelProvider 加载体素数据)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium `PrimitiveCollection.remove(primitive)` 内部已调用 `primitive.destroy()`；删除后不要再手动 `destroy()`，否则 double-destroy 抛 `DeveloperError: This object was destroyed`。重建 primitive（如参数变化时）统一用 `remove + 置 undefined`。
  - Cesium 1.144 Voxel 管线：`CustomShader` 构造 options 没有 metadata 字段，voxel 管线自动注入 `fsInput.voxel`（含 `tileCoords`）与 `fsInput.metadata.color` 等（`fromMetadataArray` 写入的 metadata 类型）；拾取用 `scene.pickVoxel`（在 MOUSE_MOVE/LEFT_CLICK 内），`nearestSampling = true` 配合步长 `stepSize` 控制分辨率。
  - `VoxelContent.fromMetadataArray` 写入体素数据需 VoxelMetadata（如 VEC4/FLOAT32 颜色）；标量岩性代码可用 UINT8 元数据通道，拾取后按值映射名称显示。
  - SwiftShader 无头环境下 `pickVoxel` 因 GPU 拾取纹理不可用而不触发，属环境限制；拾取功能以真实浏览器验证为准。

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while implementing drill-strata case (V5.0 多 VoxelPrimitive 分层 + 展开合并)
- Category: Troubleshooting & Debugging
- Instructions:
  - Vue + Cesium：运行时用于 `new X()` 构造的符号必须用 value import（`import { X }`），写成 `import type { X }` 会被编译移除，运行时抛 `X is not defined`（如 `new Cartesian2` 报 ReferenceError）。type-only 仅用于纯类型注解。
  - `VoxelPrimitive.modelMatrix` 的 TS 类型为只读，动态更新（展开/平移）需断言 `(primitive as unknown as { modelMatrix: Matrix4 }).modelMatrix = ...`；构造 options 里直接传不受影响。
  - Cesium entity `label` 无独立 `position` 字段（标签跟随 entity.position），偏移用 `pixelOffset` + `VerticalOrigin`/`HorizontalOrigin` 枚举实现。
  - 多层 VoxelPrimitive 展开/合并技巧：每层独立 primitive + 各自 `show` 控制分层显隐，`modelMatrix = ENU * scale * Translation(0,0,层序号*间距)` 实时改写实现层间拉开/合并，无需重建体素数据；非本层体素 alpha 置 0（见 V5.1 记录，禁止 discard），由体绘制合成器跳过透明采样。

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while fixing drill-strata GL_INVALID_OPERATION (V5.1)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium Voxel 管线禁止在 CustomShader `fragmentMain` 中使用 `discard`：体绘制是单 fragment 沿 ray 累积采样，`discard` 会丢弃整条 ray，导致 ANGLE/D3D11 编译 dynamic pixel shader 失败（`GL_INVALID_OPERATION: Error 0x00000502 ... HRESULT 0x80004005`），帧率崩塌（FPS 个位数）。非本层体素改为 `material.alpha = 0`（体绘制合成器自动跳过 alpha 0 采样）。
  - Voxel 渲染性能与体素总量、primitive 数量、`stepSize` 成正比：多层体素用独立 primitive 会 N 倍放大 raycast 开销；SwiftShader 软件渲染下体素案例 FPS 天然仅个位数（voxel-strata 单层也约 4 FPS），应以真实 GPU 浏览器验收帧率，软件渲染只验证无 GL 错误与交互正确性。

[Project Knowledge Summary]
- Date: 2026-08-30
- Context: Discovered by Agent while refactoring drill-strata (V5.2 instancing → V5.5 user reverted to voxel)
- Category: Build Methods
- Instructions:
  - 钻孔案例地层渲染最终采用「每层一个 VoxelPrimitive 光线步进」共 5 个体素体（用户明确要求用体素实现，V5.5 回退 V5.2 的 BoxGeometry 实例化方案）：每个 provider 生成 gx×gy×gz VEC4 颜色，仅本层体素 alpha=1；纹理数组 z=0 对应模型底部（数组 z 索引与语义深度需翻转：纹理 zi=0 ← 语义 z=gz-1-zi）；拾取用 `scene.pickVoxel`，sampleIndex 反查纹理 z → 深度 `((gz-1-tz)+0.5)/gz*SCALE_Z`，命中高亮直接写在每层独立的 CustomShader uniform（u_selectedTile/u_selectedSample mix 黄色），禁用 discard。
  - `VoxelPrimitive` 的 `shapeTransform` 从 **provider 读取**（`provider.shapeTransform ?? IDENTITY`），不能作为构造参数，也不能通过 primitive 属性改；`modelMatrix` 运行时有 setter 但 TS 类型标 readonly，动态改需 `as unknown as { modelMatrix: Matrix4 }` 绕过。
  - `scene.pick` 返回 `{ primitive, id }`，id 为 GeometryInstance 构造时的 id 对象；对 PerInstanceColorAppearance 的 Primitive 有效（SwiftShader 亦可拾取，与 `pickVoxel` 不同）。
  - Cesium 事件枚举没有 `ScreenSpaceEventType.MOUSE_LEAVE`，鼠标移出清空用 canvas 原生 `addEventListener('mouseleave', ...)`（onBeforeUnmount 时 removeEventListener）。
  - `vite.config.ts` CRESIUM_SYMBOLS 补运行时符号（如 `CylinderGeometry`）时先检查是否已存在于列表中；重复 export const 会触发 `Duplicate declaration` 编译错误（本次误加 ColorGeometryInstanceAttribute/GeometryInstance/PerInstanceColorAppearance 重复项导致构建失败，已去重）。
  - SwiftShader 环境性能天花板：Cesium 空场景 FPS 上限约 12，叠加 Bing 影像/几何内容后 2-4 FPS，属软件光栅固有极限；性能优化是否达标应以真实 GPU 浏览器为准，SwiftShader 只做无错误与交互验证。
  - SwiftShader 下 5 层 VoxelPrimitive 光线步进渲染帧耗时 >200s，`page.screenshot` 与 `scene.render()`+`readPixels` 均无法完成帧合成/读像素，只能做状态读取验证（primitive 数量、shapeTransform/modelMatrix 数值、dims、stepSize）；体素渲染须以真实 GPU 验收。
  - 地层模型坐标约定：ENU local z=0 为地表，钻孔标记置于地表 z=0；地层体素与钻孔岩芯 z = `LIFT - depth`（LIFT=25，顶面凸出地表上方 25m，向下深探 SCALE_Z=80m），避免被不透明 globe 遮挡；拾取深度 = `(z+0.5)/gz * SCALE_Z` 仍以地表为 0 起算；展开间距沿 +z 向上。
  - **双倍缩放陷阱**：几何实例化（BoxGeometry）方案的体素 local 坐标已用 SCALE_XY/SCALE_Z 换算成米（如 cx 范围 ±210），Primitive 的 modelMatrix 只能做 ENU + 平移，不能再乘 `Matrix4.fromScale`，否则地层实际尺寸被再放大 SCALE 倍（V5.4 根因）；而 VoxelPrimitive 方案体素 local 是归一化 0..1，尺寸/抬升必须经 provider 的 shapeTransform（`T(0,0,LIFT-h/2)*S(w,d,h)`），modelMatrix 只留 ENU+展开平移。
  - 相机初始视角须对准模型：模型水平范围约 400m，相机置于其正上方俯视（heading 0/pitch -38°）时模型会整体落在视锥外（偏离视线 >fovy 半角），应置于模型一侧上方朝模型俯视（如正南上方 heading 0 pitch -50°），并用屏幕投影验证角点落入画布。

[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while porting GPU fluid simulation case (V6.0 flood-inundation, ref GitHub chendingwei364/flood)
- Category: Troubleshooting & Debugging
- Instructions:
  - **Cesium 1.144 只支持 WebGL2 GLSL 300 es**：用户 `ShaderSource`（ComputeCommand/DrawCommand 的 fragmentShaderSource、vertexShaderSource）**没有 GLSL 100 自动转换**（Cesium.js 中搜不到 `texture2D`/`gl_FragColor` 字符串），必须手写 300 es：`texture2D(x,uv)`→`texture(x,uv)`、`gl_FragColor=...`→先声明 `layout(location = 0) out vec4 outputColor;` 再赋值、vertex `attribute`→`in`、`varying`→vertex 用 `out`/fragment 用 `in`；否则编译报 `'texture2D' : no matching overloaded function found`/`'gl_FragColor' : undeclared identifier` 且 Rendering has stopped。Cesium 会自动 prepend `#version 300 es` + precision + `OES_texture_float` define，无需手写。
  - `Cesium.Texture` 的 `source` 直接传 `HTMLImageElement`/`HTMLCanvasElement`（`{ image: <img> }` 对象字面量会触发 `texImage2D: Overload resolution failed`）；FLOAT 纹理用 `source: { arrayBufferView: new Float32Array(w*h*4) }`。本项目 `src/cesium-render.d.ts` 的 `TextureSourceOptions` 已加 `image?` 字段并放宽 `arrayBufferView` 为可选，类型不匹配时 `as unknown as never` 绕过。
  - `new Cesium.GeometryAttributes({...})` 无参构造（1.144 不接受对象），逐个赋 `attributes.position/st`；`Cesium.Scene` 公开类型没有 `context` 属性，需 `(scene as unknown as { context: object }).context`。
  - GPU 流体模拟可移植模式（本案例 FloodInundationDemo.vue）：4 个 `ComputeCommand`（`persists:true` + `outputTexture` 每帧在 `preExecute` 重设实现 ping-pong）+ 1 个 `DrawCommand`，全部包成自定义 Primitive 在 `update(frameState)` 里 `frameState.commandList.push`；`ComputeCommand` 输出 RGBA **FLOAT** 1024×1024 纹理存 `(terrainElevation, waterDepth)` 与四方向 `OutFlow`，水位/流量双 pass 交替更新；渲染 pass 用 `BoxGeometry(1×1×1)` + `modelMatrix = ENU×RotX(90°)×Scale(width, thickness, height)`，片元光线步进 `hitBox` 求盒交点、`uv=p.xz+0.5` 采样水位纹理、水面法线反射高光 `pow(dot,20)`。
  - 深度图（灰度归一化高程）接入约定：1024×1024 RGB 灰度图作 `heightMap` Texture（`flipY:false`、北向上），compute shader `texture(heightMap,uv).r` 得 0..1 地形；水源点归一化 `x=(lon-minLon)/(maxLon-minLon)`、`y=1-(lat-minLat)/(maxLat-minLat)`（纬度翻转因 gl_FragCoord 原点左下 + 纹理北在上）；`_relativeToZ=(max-min)/2+min`、`thickness=max-min` 定盒中心/厚度。Cesium 1.144 的 `Pass` 值（OPAQUE=9/TRANSLUCENT=10）在 RenderState/BlendEquation/BlendFunction/CullFace 下仍可用（BlendFunction 类存在）。
  - 无头 SwiftShader 验证 GPU 流体案例：模拟启动（按钮状态）+ shader 编译错误可通过点击「开始模拟」后读控制台捕获；但 4 个 1024×1024 RGBA32F compute pass + 180 步光线步进每帧 >100s，`page.screenshot` 无法完成帧合成，洪水漫延动画/水面反光以真实 GPU 浏览器验收，SwiftShader 只验证无 JS/GL 错误与启动状态。

[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while refactoring flood-inundation + adding flood-depth-simulation case (V6.1)
- Category: Build Methods
- Instructions:
  - 洪水 GPU 模拟内核（GLSL shader 常量、CustomPrimitive、FluidDemo 类、盒体矩阵/四至归一化工具）已抽取为公共库 `src/cases/flood-sim-lib/`（shaders.ts + fluid-demo.ts），四至 `Extent` 由构造函数参数传入；新增同类模拟案例时直接复用，不要复制单文件实现。
  - `VertexArray.fromGeometry` 的 `bufferUsage` 必须传 `BufferUsage.STATIC_DRAW` 枚举；写数字字面量（如 1）会运行时报 `DeveloperError: usage is invalid` 且 Rendering has stopped（V6.1 已踩坑）。
  - `DrawCommand` 构造 options 的 `primitiveType`/`modelMatrix` 字段类型较窄，公共类用 `unknown` 承接时需 `as never` 断言传入（TS2322）。
  - `sampleTerrainMostDetailed` 采样后生成的灰阶 `HTMLCanvasElement` 可直接作为 `Cesium.Texture` 的 source 用作模拟 heightMap（无需静态文件/URL），与 `Resource.fetchImage` 加载图片等价。
  - 深度图生成默认不设默认四至：输入框初始为空字符串，`tryBoundsRectangle` 用 `parseFloat` 校验（Number.isFinite + 西<东、南<北 + ±180/±90 越界检查）；框选矩形完成后自动填充四个输入框由 `setRectangle` 联动。
  - 一体化案例采样完成后自动把 `ui.minElevation/maxElevation` 设为真实采样 min/max ±100，使高程滑杆初始值贴近所选区域真实地形，再手动微调。

[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while fixing flood cases feedback (V6.1.1 高程对齐 + 提示阻塞)
- Category: Troubleshooting & Debugging
- Instructions:
  - flood-inundation 的 EXTENT 区域（85.28~85.61E/28.12~28.57N，西藏那曲）真实地形高程约 1249~6994m，与原固定 4300~5800m 差距大；加载真实地形后必须用 `sampleTerrainMostDetailed`（33×33 网格）采样 EXTENT 真实 min/max 并写入 `ui.minElevation/maxElevation`，使盒体 relativeToZ/thickness 包裹真实地表（V6.1.1 修复）。
  - 全屏 `.status-mask`（`inset:0` + 半透明背景）必须加 `pointer-events: none`，否则常驻提示会拦截地图全部鼠标操作；「场景已就绪」类非错误提示用 `window.setTimeout(3000)` 自动清空（回调内判 viewer 存活），避免遮罩常驻。
   - SwiftShader 无头下 256×256 `sampleTerrainMostDetailed` 需约 13 秒完成，验证脚本等待 <10 秒会误判结果面板未出现；状态读取应先看 `.status-mask` 文本再判断。

[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while fixing flood cases feedback (V6.1.2 盒体四至弧度bug + 非遮罩提示 + 框选实时预览)
- Category: Troubleshooting & Debugging
- Instructions:
  - `EllipsoidGeodesic` 的起终点 `Cartographic(longitude, latitude)` 参数是**弧度**：若直接传四至**度数**（如 `new Cartographic((west+east)/2, south)`），`surfaceDistance` 会把 0.12° 当作 0.12 弧度计算，盒体尺寸放大约 44 倍（V6.1.2 根因，flood-inundation 与 flood-depth-simulation 共用 `fluid-demo.ts` 同时出错）。正确写法：先 `Rectangle.fromDegrees(...)`，再用其 `center`（弧度）与 `rectangle.south/north/west/east`（弧度）构造 `EllipsoidGeodesic`。
  - 声明了实体变量但从未 `viewer.entities.add` 创建时，相关更新函数会直接 return（如 `setRectangle` 里 `if (!rectangleEntity) return`），预览图形永不显示；排查"预览不显示"类问题先确认实体是否真的创建了。
  - 操作提示不要用全屏遮罩：`.status-mask` 应改为顶部居中小提示条（`top:12px; left:50%; transform:translateX(-50%); width:max-content; max-width:380px`），保留 `pointer-events:none`，不遮挡地图操作与视野。
  - 框选矩形预览贴地形：polygon 实体用 `height:0 + heightReference: HeightReference.CLAMP_TO_GROUND + perPositionHeight:false`，MOUSE_MOVE 时 `setRectangle(normalizedRectangle(firstCorner, cursor))` 实时刷新 hierarchy。
  - `DEFAULT_VIEW_RECTANGLE`（本项目 75~140E/0~60N）覆盖过大时，框选拖拽跨越数十度会让深度图采样计算爆炸（SwiftShader 下直接崩浏览器）；场景就绪后应 `camera.flyTo` 到默认四至范围再允许框选。

[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while fixing flood cases not touching ground (V6.1.3)
- Category: Troubleshooting & Debugging
- Instructions:
  - flood 案例的 `simParams`（`SimParams` 对象）在模块初始化时对 `ui.minElevation/maxElevation` 是**值拷贝**，后续 `alignToRealTerrain()`/采样把对齐值写入 `ui` 后，`flushParams()` 必须同步回写 `simParams.minElevation/maxElevation`，否则 `new FluidDemo(...)` 按默认高程（4300~5800）算盒体 `relativeToZ/thickness`，盒体悬浮于真实地形之上，水面不贴地（V6.1.3 根因，两个 flood 案例同受此影响）。
  - 排查"模拟不贴地/悬浮"类问题：先核对盒体 `position.height` 与 `box.dimensions.z`（= thickness = maxElevation-minElevation），再与真实地形采样高程区间对比；若盒体 z 厚远小于真实地形起伏、高度对不上，即为高程参数未同步。





[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while fixing flood cases feedback (V6.1.4 全局提示非遮罩 + 矩形贴地/显隐 + 出水点点击选择)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 的 `ScreenSpaceEventHandler` 若被多处复用会相互污染：`startDrawing()` 复用出水点 handler 注册绘制 LEFT_CLICK、`stopDrawing()` 再 `removeInputAction` 会把出水点选择 action 永久移除，导致生成深度图后点击地图选点失效。修复模式：绘制用独立 `drawHandler`（startDrawing 创建、stopDrawing 销毁），出水点/地图点击用常驻 `handler`（onMounted 注册一次、仅 onBeforeUnmount 销毁）。
  - Cesium `PolygonGraphics.outline/outlineColor/outlineWidth` 在地面多边形（CLAMP_TO_GROUND）上渲染不可靠；需要贴地矩形边框时，用独立的 `polyline` 实体（`clampToGround: true`、5 点闭合）代替 outline。
  - playwright 验证 Cesium 地图点击事件时，`element.dispatchEvent(new MouseEvent('click'))` 无法触发 `ScreenSpaceEventHandler`（它监听 mousedown/mouseup）；必须用 `page.mouse.click(clientX, clientY)` 派发真实鼠标事件，否则点击选点验证会误判为"点击无效"。
  - headless SwiftShader 中 `scene.pickPosition`/`globe.pick`/`camera.pickEllipsoid` 在四至范围内可正常返回（先 flyTo 再验证）；出水点归一化坐标 `(x, y)` 需在 `extent` 已赋值后才可计算。
[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while adding water surface gradient rendering for flood cases (V6.1.5)
- Category: Troubleshooting & Debugging
- Instructions:
  - `fluid-demo.ts` 的 `SimParams` 增加新字段时，必须同步四处：`SimParams` 类型、`simParams` 对象字面量、`flushParams()` 回写、Draw 命令 `uniformMap`（`fluidCommand` 创建处）；漏任一处则 uniform 缺值或运行时不更新。两 flood 案例共用该库，字段需在 `FloodDepthSimulationDemo.vue` 与 `FloodInundationDemo.vue` 同步添加。
  - RENDER_SHADER 中 `smoothstep(0.0, edge, waterDepth)` 的渐变区间若硬编码过小（如 0.05），水面几乎全显示深水色，浅深水色梯度不可见；渐变区间应做成可调 uniform 并在 UI 提供滑杆。
  - headless 下读取 Cesium 自定义 primitive 的 uniform 值：遍历 `v.scene.primitives`（`primitives.get(i)`，判空），找 `p.commandToExecute.uniformMap` 中含目标键（如 `shallow`）的 CustomPrimitive；`scene.commandList`/`_overlayCommandList`/`_computeCommandList` 不一定暴露该 Draw 命令，优先从 primitives 遍历。
  - `scene.render()` 强制渲染后 `_overlayCommandList` 仍可能为空（Draw 命令推入 frameState.commandList 后即消费）；不要依赖命令列表判断绘制命令，直接读 primitive 的 `commandToExecute.uniformMap`。
[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while swapping case card icons (V6.1.6)
- Category: Environment Configuration
- Instructions:
  - 案例卡片 icon 采用 webp 时，将附件复制为 `src/cases/<case>/icon.webp`，`index.ts` 用 `import icon from './icon.webp'` 引用；`.monkeycode-tmp-files/` 下的文件不得被 src 直接引用（构建后目录缺失会失败），必须复制到案例目录。
  - `DemoCard.icon` 为可选字段：新增案例若漏写 icon，卡片将不显示图片；`flood-depth-simulation` 此前即因此无图标，V6.1.6 补上。
  - 更换 icon 后验证：dev server 下 `curl http://localhost:5173/src/cases/<case>/icon.webp` 应 HTTP 200 且字节数等于源文件；headless 读取卡片 `img.naturalWidth/naturalHeight` 确认图片真实解码加载。
[Project Knowledge Summary]
- Date: 2026-08-31
- Context: Discovered by Agent while adding 10 dc-sdk dynamic circle/radar effects (V6.1.7)
- Category: Workflow & Collaboration
- Instructions:
  - 动态圆/雷达类效果可参考 dc-sdk 源码：GLSL 材质位于 `src/modules/material/shader/circle/`（CircleRing/Fade/Blur/Diffuse/Spiral/Pulse/Vary/Wave）与 `radar/`（RadarLine/Wave/Sweep/Outer），材质注册在 `type/circle.js`、`type/radar.js`，属性类在 `property/circle/`；「雷达图片」是 Circle + ImageMaterialProperty + `stRotation` CallbackProperty（`rotateAmount` 正负控制旋转方向），无自定义材质。
  - 新动态效果案例统一走 `src/cases/dc-effects-lib/`：`materials.ts`（Fabric 材质 source + `registerDcEffectsMaterials()` 一次性注册 + `DcCircleMaterialProperty` 通用属性类）+ `entities.ts`（create/update/remove 实体操作，实体 id 前缀 `dc-effect-`）。新增同类材质时只需在 materials.ts 增加 source 与注册条目，实体操作可复用。
  - 给 Entity 的 `ellipse`/`position` 赋值时，`semiMajorAxis/semiMinorAxis/height` 必须用 `new ConstantProperty(...)`，`position` 用 `new ConstantPositionProperty(...)`，直接赋 number/Cartesian3 会触发 vue-tsc TS2322/TS2739 类型错误（Cesium 1.144 的 Entity 图形属性均为 Property 类型）。
  - 自定义材质 Entity 的 id 用材质类型（如 `dc-effect-CircleRingMaterial`），headless 验证实体时应遍历 `viewer.entities.values` 用 `String(e.id).startsWith('dc-effect-')` 查找，而不是按案例目录名拼 id。
  - dev server 必须用 `timeout: 0` 的 background terminal 启动（`timeout_ms` 大于 0 会被自动 kill）；构建用 600000ms 足够。
  - dc-sdk 的部分 GLSL 材质存在死变量问题（如 CircleRing 的 `time` 变量计算后从未参与渲染，导致效果静态），移植后需逐一核对所有 uniform/局部变量是否真正参与 alpha/diffuse 计算，必要时重构（用 `pulse = 0.5 + 0.5 * sin(t * 2.0)` 之类驱动半径呼吸）以产出动画。
  - 雷达类效果如需「范围圈线」，可复用 `RADAR_OUTER_TYPE`（RadarOuterMaterial，同心圆环，uniform repeat/thickness）叠加一个独立圈线实体，id 前缀 `dc-effect-ring-`；圈线开关切换时直接 add/remove 该实体即可。
  - headless 验证动画是否真实在动：进入案例后间隔约 700ms 截两张图，用 Pillow 计算像素差（差值阈值 24 的点数），大于数千即确认动画生效（`/tmp/opencode/diffpx.py`）。
  - `position.getValue(time)` 在 TS 中 cast 签名为 `(time: unknown) => Cartesian3 | undefined`，传 `viewer.clock.currentTime`，否则 vue-tsc 报 TS2554（签名 0 参数 vs 实际 1 参数）。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while adding 3 video-overlay cases (V6.2.0 平面视频/视频融合/视频融合羽化)
- Category: Troubleshooting & Debugging
- Instructions:
  - 视频贴地效果参考 dc-sdk `src/modules/overlay/primitive/VideoPrimitive.js`：`GroundPrimitive` + `PolygonGeometry.fromPositions`（`vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT`）+ `EllipsoidSurfaceAppearance` + `Material.fromType('Image', { image: videoElement })`。视频用 `document.createElement('video')`（muted + loop + playsInline + autoplay），Cesium Material 的纹理 uniform 原生支持 HTMLVideoElement（readyState>=2 时自动建 Texture 并每帧 copyFrom）。
  - 自定义 Fabric 材质注册 uniforms 里的 `image` 不能给 `undefined`：`Material.fromType` 走 `getUniformType(uniformValue)`，`undefined.type` 直接抛 "Cannot read properties of undefined (reading 'type')"；必须给 `image: Material.DefaultImageId` 默认值，创建时再用 `Material.fromType(type, { image: video })` 覆盖。
  - 矩形视频区域按中心经纬度 + 宽高（米）换算四角：`metersPerDegreeLat = PI*6378137/180`，`metersPerDegreeLon = metersPerDegreeLat * cos(latRad)`，用 `Cartesian3.fromDegreesArray` 生成 4 角逆时针数组。
  - GroundPrimitive 几何（位置/宽高）变更需重建（remove + 重新 add），但材质 uniform（透明度/羽化宽度）可直接改 `primitive.appearance.material.uniforms`；自定义材质实例在 `scene.groundPrimitives`（非 entities），查找用 `_dcVideoId` 标记字段遍历 `gps.get(i)`。
  - 透明度实现：Image 内置材质用 `color` 的 alpha（`material.uniforms.color = new Color(r,g,b,alpha)`），自定义融合材质用独立 `opacity` uniform；羽化用 `smoothstep(0.0, featherWidth, edgeDist)`（edgeDist = st 到四边最小距离）在 shader 内计算边缘 alpha 渐变。
  - 视频素材来源 dc-sdk `examples/assets/data/demo.mp4`（536KB），复制到 `public/videos/demo.mp4` 供各案例共享；headless 下视频帧不参与断言，只需验证 primitive/材质类型与 uniform 值。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while swapping video case card icons (V6.2.1)
- Category: Environment Configuration
- Instructions:
  - 数据可视化-视频效果 3 案例的用户新图映射：`video-plane`=image-2（0e0d9fa7，122722B）、`video-fusion`=image-1（1b34c185，122266B）、`video-feather`=image-3（b286ca10，119488B）；仅覆盖案例目录 icon.webp 即可，index.ts 已引用 `./icon.webp` 无需改动。
  - 换 icon 后验证：三个 icon.webp HTTP 200 + headless 卡片 `img.complete && naturalWidth>0`（本例 1240/1238/1236），0 pageerror，构建 EXIT=0。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while upgrading case search to global search (V6.3.0)
- Category: Workflow & Collaboration
- Instructions:
  - 首页搜索实现位于 `src/App.vue` 的 `visibleDemos` computed：关键词非空时跨全部分类匹配 `demo.title` / `demo.description`（`toLowerCase().includes` 大小写不敏感），为空时回退 `demo.category === activeCategory`；搜索时需新增 `searching` computed 驱动面包屑「全局搜索」与标题「搜索 “关键词” N 个案例」。
  - headless 验证全局搜索：在非目标分类下 `page.locator('.search-box input').fill(关键词)` 后读取 `.content-header h1` 与 `.demo-card` 数量，验证跨分类命中、描述命中、空态 `.empty-state`、清空后恢复分类视图，0 pageerror。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while adding 3 wall-effect cases (V6.4.0 基础墙体/流动墙体/流动图片墙体)
- Category: Troubleshooting & Debugging
- Instructions:
  - 墙体效果参考 dc-sdk：GLSL 位于 `src/modules/material/shader/wall/`（WallDiffuse=竖向渐变 `alpha = color.a*(1.0-fract(st.t))*0.8`；WallTrail=栅栏沿 st.t 向上流动 `texture(image, vec2(fract(st.t-time), st.t))`；WallImageTrail=箭头沿 st.s 水平流动 + `st*repeat` 平铺），材质注册在 `type/wall.js`，属性类模板在 `property/wall/`；贴图素材 `fence.png`（64x64）/`space_line.png`（348x64）在 `src/modules/images/`，`arrow.png`（256x256）在 `examples/assets/icon/`。
  - 墙体统一走 `src/cases/wall-effects-lib/`：`materials.ts` 注册 3 种墙体 Fabric 材质 + 通用 `WallMaterialProperty`（kind + color/speed/repeatX/repeatY/image，`getValue(time,result)` 组装 uniform、`definitionChanged` 事件触发每帧刷新），`entities.ts` 提供 `createWallEntity/updateWallEntity/removeWallEntity/rectPositions`（实体 id 前缀 `dc-wall-`）。
  - 墙体 Entity 用 `wall.positions = new ConstantProperty(Cartesian3[])`（含高度）+ `wall.material = new WallMaterialProperty(...)`；矩形墙由 `rectPositions(lon,lat,widthMeters,depthMeters,height)` 按中心经纬度换算 5 点闭合坐标（角度换算 `metersPerDegreeLat = PI*6378137/180`，lon 再乘 `cos(latRad)`），几何更新重建 positions、材质 uniform 直接改 setter 即可。
  - 材质注册 uniforms 的 `image` 必须给 `Material.DefaultImageId` 默认值（同 V6.2.0 教训，`getUniformType(undefined)` 崩溃），创建时用 `Material.fromType(type, { image })` 覆盖。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while swapping wall case card icons (V6.4.1)
- Category: Environment Configuration
- Instructions:
  - 三维特效-墙体 3 案例的用户新图映射：`wall-basic`=image-3（47abf99f，149180B）、`wall-trail`=image-2（53e33ed1，147478B）、`wall-image-trail`=image-1（30a51595，158768B）；仅覆盖案例目录 icon.webp 即可，index.ts 已引用 `./icon.webp` 无需改动。
  - 换 icon 后验证：三张 icon.webp HTTP 200 + headless 卡片 `img.complete && naturalWidth>0`（本例 1234~1238），0 pageerror，构建 EXIT=0。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while adding 5 polyline-effect cases (V6.5.0 材质线/图片轨迹线/流动线/闪烁线/发光轨迹线)
- Category: Troubleshooting & Debugging
- Instructions:
  - 折线效果参考 dc-sdk：GLSL 位于 `src/modules/material/shader/polyline/`（PolylineTrail=`alpha=color.a*fract(st.s-time)` 分段尾迹；PolylineImageTrail=图片沿 st.s 流动 `texture(image, vec2(fract(st.s-time), st.t))`+repeat 平铺；PolylineFlow=`smoothstep(t-percent,t,st.s)*step(-t,-st.s)+gradient` 流动段；PolylineFlicker=整线 `scalar=smoothstep(0,1,time)` 明暗闪烁；PolylineLightingTrail=lighting.png 贴图+`st.t>0.45&&st.t<0.55` 中心亮线），材质注册在 `type/polyline.js`，属性类模板在 `property/polyline/`；贴图 `lighting.png`（512x152）在 `src/modules/images/`，`arrow_1.png`（30x21）在 `examples/assets/icon/`。
  - 线效果统一走 `src/cases/polyline-effects-lib/`：`materials.ts` 注册 5 种 Fabric 折线材质 + 通用 `PolylineMaterialProperty`（kind + color/speed/percent/gradient/repeatX/repeatY/image，`getValue` 按 kind 组装对应 uniform、`definitionChanged` 触发每帧刷新），`entities.ts` 提供 `createPolylineEntity/updatePolylineEntity/removePolylineEntity`（id 前缀 `dc-polyline-`）与 `DEFAULT_LINE_POSITIONS`（北京-天津-济南-郑州-武汉 5 点折线，高度 1000m）。
  - Cesium Entity `polyline` 自定义材质**不能配 `clampToGround: true`**（ground polyline 仅支持内置材质类型），折线需带高度（如 1000m）用普通 PolylineGeometry 渲染；positions/width 用 `new ConstantProperty(...)`，material 传 `PolylineMaterialProperty` 实例。
  - 折线点击地图平移交互：记录 `CENTER`（点击点）相对 `BASE_CENTER`（默认折线质心，约 115.73/36.2）的经纬度偏移，`DEFAULT_LINE_POSITIONS` 每个点加偏移重建 positions，相机视距用约 2600km（折线跨京-鄂约 1100km）。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while upgrading line cases (V6.5.1 材质线多材质 + 流动线多色)
- Category: Troubleshooting & Debugging
- Instructions:
  - dc-sdk 其余折线材质：`PolylineLighting`（发光线）、`PolylineFence`（栅栏线，dashPattern 位掩码虚线+外轮廓）、`PolylineMultiArrow`（多箭头，repeatFactor）、`PolylineDashArrow`（虚线箭头）、`PolylineDirection`（方向线）均注册在 `type/polyline.js`，shader 在 `shader/polyline/`；Fence/DashArrow/Direction 用到 `v_polylineAngle`/`v_width` varying 与 `czm_antialias/czm_gammaCorrect/fwidth/czm_pixelRatio`，Cesium 1.144 + SwiftShader 下可直接照抄编译通过（已 9 种材质切换验证 0 pageerror）。
  - 材质切换类案例（下拉 select 切材质类型）：切换后必须**重建实体**（`createXxxEntity` 内部先 remove 再 add），不能只改 material 属性（Entity geometry updater 按 material.getType 缓存）；切换时先把各材质默认参数写入 refs 再重建。
  - 一条折线多段多色：`entities.ts` 提供 `createColoredLineSegments/updateColoredLineSegments/removeColoredLineSegments`，把完整折线拆成相邻点对（N 点→N-1 段），每段独立实体 `dc-polyline-<baseId>-seg-<i>`，colors 数组按 `i % colors.length` 循环取色，其余材质参数共用同步更新；切换回单色时 `removeColoredLineSegments` 循环清理段实体。
  - 验证脚本多页跳转耗时长（5 案例+多次 selectOption 超 200s），bash 执行需 `timeout` 参数调大（如 300000ms）避免外层 120s 默认超时截断。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while implementing V6.5.2 three dc-sdk effect primitives (电弧球体/光锥/扩散墙)
- Category: Troubleshooting & Debugging
- Instructions:
  - dc-sdk 三维特效 primitive 参考 `dc-sdk-master/src/modules/overlay/primitive/`：电弧球体=`ElecEllipsoidPrimitive`（EllipsoidGeometry radii + maximumCone=PI_OVER_TWO + EllipsoidElectric 材质）、光锥=`LightCylinderPrimitive`（CircleRing/CircleRotate/CylinderFade/CylinderParticles 四材质组合）、扩散墙=`DiffuseWallPrimitive`（WallGeometry + WallDiffuse 材质）。材质 GLSL 在 `src/modules/material/shader/`（ellipsoid/circle/cylinder），Fabric 材质可照抄 Cesium 1.144 编译通过。
  - 3 案例统一走 `src/cases/primitive-effect-lib/` 共享库：`materials.ts` 注册 5 种 Fabric 材质（EllipsoidElectric/CircleRing/CircleRotate/CylinderFade/CylinderParticles）+ `makeCircleImage/makeParticlesImage` canvas 贴图；`elec-sphere.ts/light-cone.ts/diffuse-wall.ts` 提供 create/update/remove（id 前缀 `dc-primitive-`）。
  - 光锥圆柱侧面用 `PolygonGeometry.createGeometry`（perPositionHeight）并直接改写 `polygon.indices` 与 `attributes.st.values`；PolygonGeometry 默认 vertexFormat 已含 st，不可再新增 `{values:[]}` st 属性（报 `DeveloperError: options.componentDatatype is required`）。
  - `EllipseGeometryLibrary` 在 Cesium 1.144 未导出，本地用 `eastNorthUpToFixedFrame` + `Matrix4.multiplyByPoint` 生成 ENU 局部椭圆点。
  - 自定义 PrimitiveCollection 子类加入 scene.primitives 后自动被 `update(frameState)` 驱动无需手动 tick；但独立 Primitive 类（如 diffuse-wall 无 collection）需在 update 里手动 `_delegate.update(frameState)`，且必须实现 `isDestroyed()`（缺了报 `TypeError: primitive.isDestroyed is not a function`）。
  - `vite.config.ts` CESIUM_SYMBOLS 需包含 `PrimitiveCollection`（只有 Primitive 时报 `does not provide an export named 'PrimitiveCollection'`）。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while performing V6.5.3 (光锥/电弧球体 icon 换用户上传图 + 全量清理“基于/参考/移植/仿照”来源表述)
- Category: Workflow & Collaboration
- Instructions:
  - 案例卡片描述与 Demo 内 hint/warn 文案不得出现“基于XXX/参考XXX/移植XXX/仿照XXX/借鉴XXX/参照XXX”等来源表述（不得提及 dc-sdk 等外部库名）；已统一改写为“采用/通过/以/数据驱动”等正向描述。名词性“参考线/参考视图/位置参考”（reference line/view）属于功能描述，保留。
  - 案例卡片 icon 用用户上传图：每个 icon 是一张 256px webp，cp 覆盖到 `src/cases/<case>/icon.webp` 后校验 md5 与上传文件字节一致；替换后需重新构建并在 headless 里确认卡片 `<img>` naturalWidth>0。
  - 文案清理类改动用 headless 全卡片扫描禁用词列表验证：`.demo-card` 逐卡读取 textContent，命中“基于/移植/仿照/复刻/照搬/dc-sdk/借鉴/参照”即报 FAIL。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while implementing V6.5.4 city white-model 3D Tiles case (3DBAG 荷兰全境建筑白模)
- Category: Troubleshooting & Debugging
- Instructions:
  - 公开城市级建筑白模 3D Tiles 数据源：3DBAG 荷兰全境（`https://data.3dbag.nl/v<版本>/cesium3dtiles/lod{22,13,12}/tileset.json`，3D Tiles 1.1 REPLACE，glb 瓦片，CORS `*`，ECEF 坐标免 transform 直接加载）；端点从 3dbag viewer 前端 JS `https://3dbag.nl/js/app*.js` 逆向（搜索 `cesium3dtiles/lod22`），data.3dbag.nl/api/v2 一律 404。
  - 候选源可用性速查：腾讯 `mapapi.qq.com/web/lbs/visualizationApi/demo/data/3dTilesGCJ02/tileset.json`（CORS `*` 可用，但仅约 1MB 太原街区、GCJ02 偏移）；Esri `tiles.arcgis.com` SceneServer/3dtiles/tileset.json 返回假 200（body 是 `{"error":...}`，必须校验 body 而非状态码）；GSI `tiles.gsi.go.jp` 返回 000；`data.3dbag.nl/api/v2/3dtiles/*` 404。
  - Cesium 1.144 3D Tiles API 变更：`tileCacheSize`/`maximumMemoryUsage`/`trianglesLoaded`/`tilesWaitingToLoad` 已移除；内存上限改用 `cacheBytes`+`maximumCacheOverflowBytes`（字节单位）；`tilesLoaded` 语义为 boolean（该视图瓦片是否全部加载，非计数）；瓦片/三角/排队统计在 `tileset.statistics` 对象（`numberOfTilesWithContentReady`/`trianglesLength`/`numberOfPendingRequests`），官方 .d.ts 未声明该属性，需在 `src/cesium-render.d.ts` 用 `interface Cesium3DTileset { statistics: Cesium3DTilesetStatistics }` 声明合并。
  - 案例内加载荷兰全境 tileset 时 `viewer.flyTo(model)` 会拉到国家级视角（瓦片加载少、非城市级效果），应 `camera.flyTo` 指定城市坐标（如阿姆斯特丹 4.9041/52.3676，高度 18000m 倾斜角）；headless SwiftShader 低帧率下性能统计快照偶显 0，属时序问题，验证断言应轮询等待“内存>0 或 瓦片>0”而非固定 sleep。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while implementing V6.5.5 (白模 icon 换用户图 + 自定义着色器/样式+着色器/点光源 3 案例，参考 dc-sdk)
- Category: Troubleshooting & Debugging
- Instructions:
  - 3DBAG lod22 为 3D Tiles 1.1 嵌套 tileset：root 是 Empty3DTileContent，子瓦片 _Tileset3DTileContent 指向 `tileset-5-*.json`，真正的 glb 是 _Model3DTileContent（featuresLength>0，如 1010）。遍历取 feature 必须跳过 Empty/嵌套 content，否则 featuresLength=0/getFeature 返回 undefined。
  - 3DBAG glb feature 属性：`content.getFeature(0).getProperty(name)` 可读 `b3_volume_lod22`/`b3_opp_grond`/`oorspronkelijkbouwjaar`/`b3_h_maaiveld`/`b3_n_nok`；但 `b3_h_nok` 与 `b3_bouwlagen` 返回 null/undefined（Cesium 1.144 读取路径问题），style 分级与属性展示需避开这两个字段，按体量分级。
  - Cesium 1.144 CustomShader 用法：uniforms 声明 `{ u_x: { type: UniformType.VEC3/FLOAT, value } }`（value 类型限定，不能放 getter 函数）；运行期改参用 `customShader.setUniform(name, value)`（VEC3 传 Cartesian3，FLOAT 传 number）。fragmentMain 可读 `fsInput.attributes.positionEC`（builtin 恒可用）与 `fsInput.attributes.normalEC`（有默认值 `vec3(0,0,1)` 兜底）、内建 `czm_view`（view 矩阵，1.144 无 `czm_viewMatrix`）/`czm_viewerPositionWC`/`czm_frameNumber`；Cesium3DTileStyle 的着色结果进入 `material.diffuse`，可再叠加渐变/边缘光。
  - 片元中算建筑高度不要依赖 `czm_approximateEllipsoidHeight`（打包产物 Cesium.js 中未暴露），在 src/lib/white-model-glsl.ts 自实现 WGS84 快速椭球高度函数 `dc_approxEllipsoidHeight`（atan+cos 迭代法）。
  - dc-sdk 参考示例在 /tmp/opencode/dc-sdk-master/examples/model/：`3dtiles_custom_shader.html`（czm_frameNumber 动态光环 + position.z 渐变）与 `3dtiles_style_and_shader.html`（Cesium3DTileStyle 分级 + customShader 叠加）。
  - Cesium Entity 无 isDestroyed()；`entity.position` 赋值需 `new ConstantPositionProperty(...)`；`label.pixelOffset` 类型为 Cartesian2。
  - 白模案例共享设施：`src/lib/use-white-model-tileset.ts` composable（viewer/tileset 加载/LOD 切换/相机定位/性能统计/销毁，`onTilesetReady` 回调注入自定义 shader/style）。
[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while fixing V6.5.7 custom shader 失效（样式+着色器/点光源参数无感，根因对照 Cesium.js L113367-113550/L129810-129835）
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 1.144 CustomShaderPipelineStage.inferAttributeDefaults 只给 `MC|EC` 后缀补默认值：fragment 引用 `normalWC`/`positionWC` attribute 时无默认值 → 整个 custom fragment shader 被禁用（one-time warning `incompatiblePrimitiveFS` "Primitive is missing attribute normalWC, disabling custom fragment shader."），所有 uniform 失效（表现为参数调整无感）。白模 CustomShader 的 fragment 一律用 `normalEC`/`positionEC`；WC 相关计算先 `czm_view * vec4(wc, 1.0)` 变换到 EC。shader 是否生效可用 headless 捕获 `disabling custom` 警告验证。
  - Model 渲染管线顺序：`materialStage → customShaderStage → lightingStage → cpuStylingStage → modelColorStage → handleAlpha`。`tileset.style` 色带走 cpuStylingStage（custom 之后），REPLACE（colorBlendMode）下 `highlight=ceil(blend)=1` → `diffuse *= 1` 不覆盖 custom diffuse、`alpha *= style.a`；style 色在 materialStage 的 `blend(base, featureColor, blend)` 初始化 `material.diffuse`，custom shader 读取后叠加即可。`modelColorStage` 仅在显式设置 `tileset.color` 时编译运行（只设 style 不触发）。style+shader 组合案例 `colorBlendMode` 固定 REPLACE。
  - 点光源类加色光照（Blinn-Phong 漫反射+高光）写 `material.emissive` 可绕过 lightingStage 的二次 PBR 调制直接显示。⚠️ 基色必须取 `material.baseColor.rgb`：白模 glTF 未给 `metallicFactor`（glTF 规范默认 metallic=1.0），Cesium `MaterialStageFS.setMetallicRoughness()` 会执行 `material.diffuse = mix(baseColor, 0.0, metalness)`，使 `fragmentMain` 里 `material.diffuse` 恒为 0（详见 2026-09-17 V6.43 条目）。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.6 国内地图底图 6 案例（cesium-map 移植）
- Category: Troubleshooting & Debugging
- Instructions:
  - cesium-map（github.com/cesiumChina/cesium-map，Apache 2.0）国内底图 provider 已 TS 移植到 `src/lib/cesium-map/`，供高德/百度/谷歌/天地图/腾讯/星图六案例使用；6 provider 均 extends UrlTemplateImageryProvider，百度是唯一重写 requestImage 的（瓦片坐标原点在地图中心：WGS84 分支 y=-y；BD09 分支 x-xTiles/2、yTiles/2-y-1，子域 {s} 固定 '1'）。
  - dev 模式 cesium 走 `vite.config.ts` 的 CESIUM_GLOBAL_SHIM（`window.Cesium` 白名单 re-export），新增 Cesium 符号 import 后必须同步加入 `CESIUM_SYMBOLS`，否则运行时 `does not provide an export named 'XXX'`（SyntaxError）。本次新增了 `ImageryProvider`/`WebMercatorProjection`/`WebMercatorTilingScheme`。
  - `UrlTemplateImageryProvider` 构造里 `this._rectangle = Rectangle.intersection(this._rectangle, tilingScheme.rectangle)`：当 tilingScheme 矩形经度范围略超 ±PI（如 -20037726.37 米反投影为 ±3.1416，而不是精确 ±PI）时，Cesium 1.144 的 `Math.negativePiToPi` 会翻转（>PI 减 TWO_PI、<-PI 加 TWO_PI）使 east<=west，intersection 返回 undefined → provider.rectangle 变 undefined → 渲染抛 `DeveloperError: Expected rectangle to be typeof object` 并弹 errorPanel。修复同原版：super() 后显式 `_rectangle = _tilingScheme.rectangle`（TS 需 cast 访问私有字段）。
  - 移植类时忠实保留原版分支语义（例：百度 WGS84 模式用 BD09TilingScheme、BD09 模式用 WebMercatorTilingScheme，与直觉相反）；d.ts 类型不匹配（`MapProjection.project` 声明返回 Cartesian3、`positionToTileXY` 基类签名不允许 undefined）用 cast / 返回 new Cartesian2() 兜底，不改逻辑。
  - 在线瓦片源验证要点：腾讯 elec 瓦片 content-type 是 `application/octet-stream` 但内容为 JPEG；各源低 level 边缘瓦片会有 400/CORS 警告（如 `gac-geo.googlecnapps.cn`、`rt0/1/2.map.gtimg.com`），属网络层固有行为，headless 验证的 console error 判定需过滤 `Failed to load resource`/`Access to XMLHttpRequest`/`CORS policy`，瓦片成功数按 HTTP 200 计而非 content-type。
  - 天地图/星图 key 采用手动输入模式：mount 后不自动 apply，输入 key + 点「加载底图」才创建 provider（未输 key 时提示）；项目内不硬编码 key。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.6.1（地图底图 icon 换用户图 + 来源表述清理 + 星图地址切换）
- Category: Workflow & Collaboration
- Instructions:
  - 案例展示中不出现其它仓库相关信息、不出现“移植/基于XXX/参考XXX/仿照XXX”类来源表述（用户强调为贯穿整个项目的基本规则，范围覆盖案例卡片、Demo 面板文案与共享库注释）。库目录命名也用中性词（`src/lib/map-providers/`，不用仓库名）。
  - 卡片 tag 用中文功能分类（如「地图底图」「场景工具」「测量」），不使用外部仓库名。
  - 地图底图 icon 对应关系（用户上传图 cp 到 `src/cases/<case>/icon.webp`）：天地图=image-1、高德=image-2、百度=image-3（横向图 1234x656 等，卡片 <img> naturalWidth>0 即生效）。
  - 星图（中科星图）瓦片地址（GeoVisImageryProvider，均需手动 token，无 token 返回 {"code":102,"msg":"token非法或不存在"}）：矢量 `https://api.open.geovisearth.com/map/v1/vec/{z}/{x}/{y}?token={key}`；影像 `https://api.open.geovisearth.com/pj/base/v1/2025/{z}/{x}/{y}?token={key}`（原 tiles{s}.geovisearth.com/base/v1 已废弃）。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.6.2（星图/腾讯/谷歌底图 icon 换用户图）
- Category: Workflow & Collaboration
- Instructions:
  - 6 个地图底图案例 icon 均为用户上传图，映射关系：天地图=image-1、高德=image-2、百度=image-3、星图=image-1、腾讯=image-2、谷歌=image-3；均为横向图（约 1233~1235 x 648~658），cp 覆盖 `src/cases/map-<case>/icon.webp` 后 headless 验证卡片 <img> naturalWidth>0 即生效。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.7（自定义XYZ坐标轴-拖拽平移案例）
- Category: Troubleshooting & Debugging
- Instructions:
  - 【最终定案，勿再引入偏移】Cesium 交互坐标系统一为 **canvas 相对坐标（CSS px）**：`ScreenSpaceEventHandler` 回调的 `position/endPosition`、`viewer.scene.pick()`、`SceneTransforms.worldToWindowCoordinates()` 三者同系，判定/拾取/比较一律不加 `canvas.getBoundingClientRect()` 偏移（早期 V6.7 曾误判 pick/worldToWindow 需要 viewport 坐标并加偏移，导致真实用户“轴上无反应、空白偶发拾取”，V6.7.2 已删除）。仅“canvas 相对 → Playwright 原生鼠标/页面坐标”换算才加 rect 偏移。
  - Cesium MOUSE_MOVE 回调参数是 `{ endPosition }`，LEFT_DOWN/LEFT_UP 是 `{ position }`。
  - 3D gizmo 沿轴平移换算：取轴单位向量 d，用 `worldToWindowCoordinates(center)` 与 `worldToWindowCoordinates(center+d*1m)` 求得"每米像素向量" vpx，鼠标像素位移 dp 沿 vpx 投影 `meters=(dp·vpx)/|vpx|^2`，中心沿固定 d 直线平移；轴方向几乎垂直于屏幕时 |vpx|≈0，拖动无效属正常 gizmo 行为。
  - 拖动期间需 `scene.screenSpaceCameraController.enableRotate=false` 避免相机被左键拖走，LEFT_UP 恢复。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while fixing V6.7.1（XYZ 轴案例真实环境交互不生效）
- Category: Troubleshooting & Debugging
- Instructions:
  - 3D 轴/小目标拾取在真实浏览器中"像素级 scene.pick"体验差：必须叠加屏幕距离兜底——把中心点与轴端点经 worldToWindowCoordinates 投影为屏幕线段，鼠标到线段最短距离 ≤ 容差（约 10~15px）即判定命中，否则按下落空时左键会被相机 rotate 接管，表现为交互失效。
  - Cesium 拖动结束必须兜底：`ScreenSpaceEventHandler` 的 `LEFT_UP` 仅在 canvas 内触发，鼠标拖出 canvas 释放会残留 activeAxis 与 `enableRotate=false`，导致相机左键旋转被永久禁用；需额外监听 `canvas mouseleave` + `window mouseup` + `window blur` 统一结束清理（同逻辑幂等函数）。
  - `SceneTransforms.worldToWindowCoordinates` 的返回类型是 `Cartesian2 | undefined`，TS 需 `?? null` 规整；`screenSpaceCameraController.enableRotate` 可用左键拖拽开关。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while fixing V6.7.2（XYZ 轴坐标系统误判修正）
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 交互坐标系统真相（源码 + headless 像素取证三重交叉确认）：`ScreenSpaceEventHandler.getPosition`（非 document 元素时 `clientX - rect.left`）、`Scene.pick`（`transformWindowToDrawingBuffer` 直接 `windowPosition * xScale`）、`worldToWindowCoordinates`（viewport 原点 0、宽 = canvas.clientWidth）统一为 canvas 相对坐标；轴真实渲染像素位置与 worldToWindow 输出重合（实测 X 端 canvas (982.7,372.5)、Y 端 x[618..627] y[8..363]）。
  - headless 验证脚本必须复刻真实用户：物理鼠标目标 = `canvas.getBoundingClientRect().left/top + worldToWindow(canvas相对)`。把 worldToWindow 输出直接当 Playwright mouse 坐标会导致验证与真实行为脱节（V6.7/V6.7.1 假阳性根源）。
  - 若页面存在覆盖 canvas 的控件（如控制面板），压在其下的轴段/手柄收不到原生事件；验证与交互应选未遮挡的轴段，或用真实鼠标事件流 + `elementsFromPoint` 核对顶层元素。
  - headless mouse.move 高频分步移动存在事件丢弃与轨迹插值误差，判定类验证应把目标设在容差拾取范围内并避免依赖单次精确像素事件。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.8（XYZ 球形坐标轴-拖拽旋转案例）
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 3D 旋转 gizmo 姿态模型：姿态矩阵 `R = Rz(γ)·Ry(β)·Rx(α)`（绕 X 东/Y 北/Z 上），轴方向 `dir = R·basis`（basis 为当地 ENU 基）；沿"被拖轴的当前方向"（body/局部轴）旋转用**右乘** `R ← R·fromRotationX/Y/Z(δ)`（绕自身 X 轴时 X 自身不动、Y/Z 摆动）。
  - 拖轴旋转角度映射：以中心点屏幕投影为枢轴，取"鼠标相对枢轴的极角增量"做角度（差值 wrap 到 ±π 后转度）——圆弧式手感，任意视图方向稳定；每步累加δ（非全程回读避免 >180° 翻转）。
  - 欧拉闭环反解（无漂移）：从 R 三列提取 β=asin(-col0.z)、γ=atan2(col0.y,col0.x)、α=atan2(col1.z,col2.z)，反解角重组矩阵恒等于 R；万向锁（β=±90°）用 asin clamp 兜底。
  - Vue 里用 Record<AxisName,{line,handle,...}> 缓存 Entity 时，初始化必须是 `{line: undefined as unknown as Entity, ...}` 的空实体对象，不能整个元素给 undefined，否则 rebuild→remove 遍历 `axis.line` 报 "Cannot read properties of undefined"。
  - 需求方向与既有坐标系统定案一致：旋转/平移 gizmo 的交互判定直接使用 ScreenSpaceEventHandler 的 canvas 相对坐标（见 V6.7.2 条目）。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.8.1（XYZ 球形旋转案例去掉直线轴只留环形轴）
- Category: Troubleshooting & Debugging
- Instructions:
  - “环形轴”视觉下环即旋转轴，环法线方向 = 被旋转轴方向；拾取命中环/标签后用 scene.pick + “环 72 段采样点投影屏幕求鼠标最近距离 ≤ 容差”兜底（替代直线段投影兜底）。
  - 正俯视下竖直平面环 edge-on 投影为过圆心的横/竖线，与水平环投影十字相交处“点到交点”拾取环不确定，属三维线框 gizmo 固有歧义；倾斜视角椭圆可见正常。headless 验证取点应避开屏幕角 0/90/180/270°（±22°）交叉方向。
   - 去掉直线轴后实体结构收敛为 { ring, label } + origin，轴端标签改挂环上相位点（x 45°/y 135°/z -45°）随环旋转。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.8.2（自定义XYZ编辑坐标轴-平移/旋转，平移+旋转融合单 gizmo）
- Category: Troubleshooting & Debugging
- Instructions:
  - 平移（直线轴+端手柄，V6.7）与旋转（环形轴，V6.8.1）可在同一 gizmo 内共存：拖动状态用 `activeKind`(translate/rotate)+`activeAxis` 显式分流，`onLeftDown/onMouseMove/finishDrag` 只走一条互斥分支，单击命中即锁定本次语义（拖 line/handle/label→平移中心、拖 ring→绕环法线 body 旋转）。平移只改经纬高、姿态矩阵/角度保持；旋转右乘 `R←R·fromRotationX/Y/Z(δ)` 后 `extractAttitude` 回写角度、中心点不动。
  - 融合拾取要区分"点到哪种交互物最近"：`scene.pick` 优先精确命中（返回实体 id，用 id 正则 `^xyze-(line|handle|label|ring)-([xyz])$` 判 kind，ring→rotate 其余→translate）；miss 时屏幕距离兜底在「直线段投影(平移)」与「每环 72 采样点投影(旋转)」之间取全局最小距离且 ≤ 容差，避免 line 与竖直环 edge-on 投影重叠区误判；直线轴必穿垂直环面（±R 交点与环重叠），点击该区域由 scene.pick 实际命中决定。
  - 手柄可见性只在"该轴处于 translate 拖动"时才强制显示，旋转/悬停时仍遵循用户 showHandles 开关（避免旋转中意外冒出被隐藏的手柄）。
  - 验证方法要点：取平移点沿直线段 world 参数 t≈0.62~0.97（避开 ±R 环交点与端手柄）、取旋转点避开屏幕角 0/90/180/270±26° 环投影十字，均须先 `scene.pick` 校验命中目标实体 id 再真正 mouse.down/move/up；平移断言中心经纬度变而三姿态角保持 0°，旋转断言绕Z 输入回写≈拖动角、中心点坐标 live 不变。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while swapping the three XYZ coordinate-axis case card icons (V6.8.3)
- Category: Environment Configuration
- Instructions:
  - 三个 XYZ 坐标轴系列案例用户新图映射：`xyz-axis`（自定义XYZ坐标轴-拖拽平移）=image-1（0a8430c7，138530B，1232×654）、`xyz-rotate`（自定义XYZ球形坐标轴-拖拽旋转）=image-2（a1f855d0，152184B，1233×655）、`xyz-edit`（自定义XYZ编辑坐标轴-平移/旋转）=image-3（c90e6c6d，144516B，1239×636）；均复制到案例目录 icon.webp，index.ts 加 `import icon from './icon.webp'` 与 `icon,` 字段。
  - 验证：dev server `curl /src/cases/<case>/icon.webp` HTTP 200 且字节数与源一致；headless 读卡片 `img.naturalWidth>0`、src 含 icon.webp、complete=true。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.9（大雁塔模型XYZ编辑坐标轴-平移/旋转：把 xyz gizmo 绑到真实 3D Tiles 模型）
- Category: Troubleshooting & Debugging
- Instructions:
  - xyz 编辑 gizmo 可绑到任意真实 georeferenced 3D Tiles 模型：加载时记录锚点 `nativeP0 = tileset.boundingSphere.center`（fromUrl 返回后立即可用，root 头 boundingVolume 已就绪），模型姿态用 `modelMatrix = T(当前中心)·R·T(-P0)`——平移只更新中心、旋转只更新 R（交互分流照搬 V6.8.2）；R=I 且中心=P0 时矩阵恰为单位阵、模型留在原生地理坐标。
  - **基座必须固定取 P0 的 ENU（eastNorthUpToFixedFrame）而非每中心点重算**：真实模型在 ECEF 是刚体、平移不改体轴方向，gizmo 轴=模型体轴恒贴合；若照抄 xyz 系列"rebuildAxes 每中心重算 ENU"会让远距离搬移后 gizmo 与模型错位。
  - gizmo 实体位置全用 `CallbackProperty` 跟随 `currentCenter` → 平移后 gizmo 自动随行、无需重建；gizmo 尺度按 `axisLength≈2.2×R、ringRadius≈1.4×R`（R=boundingSphere.radius）自适应，环/线末端伸出模型包围球才不被模型几何遮挡拾取。
  - 坑：`Cartographic.fromCartesian(Cartesian3.ZERO)`（零向量）会抛错，模块级 currentCenter 初始必须用真实默认点；模型加载后先 `currentCenter=clone(nativeP0)` 再回写经/纬/高 ref（顺序颠倒会抛错且 gizmo 建不起来）。
  - 带模型时验证要点：平移断言 modelMatrix 平移列 ≈ 原点(中心)位移（R=I 时平移列=C-P0）；旋转断言 3×3 旋转块变化且用 `multiplyByPoint(新矩阵, P0)` 回到当前中心（P0 = 中心-平移列，R=I 时）err≈0（模型真实绕中心转、中心坐标 live 不变）。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while assigning the dayanta-xyz case card icon (V6.9.1)
- Category: Environment Configuration
- Instructions:
  - 大雁塔模型XYZ编辑坐标轴-平移/旋转（`dayanta-xyz`）案例用户新图 = image-1（.monkeycode-tmp-files/31ae378f-image-1.webp，125414B，1234×638）；已复制为 `src/cases/dayanta-xyz/icon.webp`，index.ts 加 `import icon from './icon.webp'` 与 `icon,` 字段（此案例在 V6.9 上线时特意留空 icon，见用户要求的"不生成不设置 icon"）。
[Project Knowledge Summary]
- Date: 2026-09-02
- Context: Discovered by Agent while implementing V6.10（空间分析-多边形深度图与等高线：手动绘制多边形→地形采样→深度图+等高线）
- Category: Troubleshooting & Debugging
- Instructions:
  - **dev 模式 cesium 走全局 shim**：vite.config.ts 的 `CESIUM_SYMBOLS` 白名单 + `window.Cesium` global。新案例 import 的 Cesium 符号若不在白名单，dev 下 namespace import 得到 undefined（node 侧 `import('cesium')` 正常、build 正常，仅 dev 页面报运行时错，极难定位）。新增符号须同步加入白名单；V6.10 补充了 `ArcType`/`BlendingState`/`ClassificationType`/`GroundPolylinePrimitive`。
  - **GroundPolylinePrimitive 多实例批处理在本环境报 `BatchTable.setBatchedAttribute: value is required`**（添加后第一帧渲染即抛错，Cesium widget 弹出错误面板遮罩阻断后续交互）。贴地形等高线改用「经典 Primitive + PolylineColorAppearance」方案：每个实例 PolylineGeometry 用 `vertexFormat=PolylineColorAppearance.VERTEX_FORMAT` + `colors`(逐顶点同色) + `colorsPerVertex:true`，位置取 `Cartesian3.fromDegreesArrayHeights([lon,lat, 地形bilinearHeight+offset])` 抬高 offset≈14m 贴合地形，绕开 ground 分类批处理。
  - 采样地形的 `sampleTerrainMostDetailed` 可分批（约 6000 点/批）+ 每批 `await requestAnimationFrame` 让 UI 响应，用 run-token 支持取消；批内改 grid.heights 即可，最后统一 fillGridStats。
  - **逐格 marching squares 出「短线段」时，切勿按单段长度做丢弃过滤**：过短段往往是相邻链之间的连接段，丢弃会在等高线上留下可见断口。正确做法：全部段先收集，再按层做「首尾成链」（坐标桶近邻匹配 + 沿链 walk，闭合环去重首点），整链 RDP 简化后再只滤总长 < 0.12×cell 的数值碎片；多边形边界裁剪段端点要用二分细化收敛到边界交点、起点/终点恰为共享格边交点，才能与相邻格精确成链（默认示例由 47120 段 → 1954 条链）。
  - 空间分析-多边形深度图与等高线（`polygon-depth-contour`）案例用户新图 = image-1（f0e476b0-image-1.webp，106166B，1235×649）；已复制为 `src/cases/polygon-depth-contour/icon.webp`，index.ts 加 `import icon from './icon.webp'` 与 `icon,` 字段（此案例在 V6.10/V6.10.1 上线时特意留空 icon，见"不生成不设置 icon"要求；本次用户迭代反馈提供截图后补齐）。


[Project Knowledge Summary]
- Date: 2026-09-03
- Context: Discovered by Agent while implementing V6.11（空间分析-多边形坡度/坡向：手动绘制多边形→地形采样→坡度图+8 方向坡向箭头）
- Category: Troubleshooting & Debugging
- Instructions:
  - 坡度/坡向纯算法范式（`slope-aspect-lib.ts`，可复用于其他地形分析）：对全采样矩形做节点级中心差分梯度场（`gradE=(hE-hW)/2格宽米、gradN=(hN-hS)/2格高米`，edge 回退单侧差），坡度=`atan(hypot(gradE,gradN))°`；单元格坡向用四角梯度均值聚合，方位角（顺坡向，即下山方向）=`atan2(-gradE, -gradN)`，按 45° 归并为 N/NE/E/SE/S/SW/W/NW 八扇区——注意 E 向西分量、N 向北分量取负才是「下山」指向。多边形只做 inside 裁剪/统计掩膜，梯度场在整个外包矩形上算，边界更连续。
  - 面渲染颜色与箭头渲染：坡度面三角网格沿用 V6.10 的「中心 inside + 边界射线裁剪 + 逐顶点色（Appearance depthTest off）」；批量坡向箭头用 `PolylineColorAppearance.VERTEX_FORMAT` + 每箭头一个 `PolylineGeometry`（`colors`/`colorsPerVertex:true`）实例，5 顶点路径「中心→箭尖→左翼→箭尖→右翼」单实例即可画箭头叉；位置统一用 bilinear 地形高 + offset(≈16m) 贴合地表，避开 Ground 分类批处理崩溃坑。箭头数多时用 stride 抽稀（每 N 格 1 支）。
  - 跨案例复用既有算法库是可行模式（measure-lib/pick 先例）：`polygon-slope-aspect` 直接 import `../polygon-depth-contour/depth-contour-lib` 的网格采样/`rampRgb`/`pointInRing`/`rayRingIntersection` 等；需要把其内部函数加 `export`（如 `rayRingIntersection`）即可，不破坏既有逻辑。

[Project Knowledge Summary]
- Date: 2026-09-03
- Context: Discovered by Agent while implementing V6.11.1 + V6.12（坡度坡向 icon 补齐；新增空间分析-多边形地形压平）
- Category: Troubleshooting & Debugging
- Instructions:
  - 空间分析-多边形坡度/坡向（`polygon-slope-aspect`）案例用户新图 = image-1（f9d8e17f-image-1.webp，98688B，1235×657）；已复制为 `src/cases/polygon-slope-aspect/icon.webp`，index.ts 加 `import icon from './icon.webp'` 与 `icon,` 字段（此案例 V6.11 上线时按"不生成 icon"留空，用户迭代反馈提供截图后补齐）。
  - 新增地形压平案例 `src/cases/polygon-terrain-flatten/`（id `polygon-terrain-flatten`，title `空间分析-多边形地形压平`，无 icon；三目页面若有卡片 `<img>` 懒加载，headless 校验图标前须先 `card.scrollIntoViewIfNeeded()` 再等 ~1s，否则 naturalWidth 读到 0 误报失败）。
  - **Cesium 1.144 的 `Globe.clippingPolygons`/`ClippingPolygon` 只做"裁剪出缺口"，无法把区域抬升/填平到目标高度**（赋值渲染不报错但区域内高度被切走、点高度 std≈278m），"地形压平"不能靠它；V6.12 曾用「半透明整平面 PolygonGeometry + 外立面 Primitive」做视觉假面，用户反馈效果不符，V6.13 改为**修改真实地形数据**实现。
  - 真实地形压平范式（`terrain-flatten-provider.ts`，可复用给任何 quantized mesh 地形）：用 `Object.create(baseTerrainProvider)` 包装原 `CesiumTerrainProvider` 并覆写 `requestTileGeometry(x,y,level,request)`，在 Promise `.then` 阶段（须在 `terrainData.createMesh` 之前，之后私有字段被置空）改写数据。`QuantizedMeshTerrainData._quantizedVertices` 是**已 zigzag 解码**的三通道分离量化值（先 vertexCount 个 u、再 v、再 h，各 0~32767），h=0/32767 对应瓦片 `_minimumHeight/_maximumHeight`——改写顶点高度后**直接按新 min/max 重算 rawH 即可，无需再次 zigzag 增量编码**；同时要回写 `_uValues/_vValues/_heightValues`（upsample 会读取它们）。逐瓦片先用 AABB 判断与多边形包围盒相交再逐顶点 `pointInRing(lonDeg, latDeg)` 改写；该方案是"顶点级真实铲平"，压平区会形成边缘切面。
  - 该案例加载地形用 `createWorldTerrainAsync({requestVertexNormals:false, requestWaterMask:false})`：顶点法线随高度被改会错，整区关掉后明暗一致，省去重编码法线。统计暴露 `readFlattenTerrainStats()`（seen/touchedTiles/flattenedVertices）供状态与 headless 断言「真实改写 N 块瓦片/M 个顶点」。
  - **V6.14 起 provider 改为单例包装 + 可变 flatten state，不要为调参/撤销整体替换 `viewer.terrainProvider`**：`viewer.terrainProvider = 新对象` 会让 Globe 每帧 `beginFrame` 把新引用回灌给 `GlobeSurfaceTileProvider`，setter 检测引用变化即 `invalidateAllTiles()` 把全部已加载瓦片 freeResources，画面黑屏约 1.5–2s（完全复原约 5s）。正确模式：`createFlattenTerrainProvider(base)` 只创建一次并常驻，apply/恢复只 `setOptions({ringDeg,targetHeight}|null)`。
  - 局部瓦片失效正确入口是 `scene.globe._surface`（**`_surface` 本身就是 `QuadtreePrimitive`，持有 `forEachLoadedTile`/`_tileReplacementQueue`；不存在 `_surface._quadtree`**，误引用会让失效函数静默空转）。invalidate 只对 state=2(DONE)、与 AABB 相交、且无已加载相交子瓦片的瓦片 `freeResources()` + `scene.requestRender()`；被释放瓦片下一帧自动重载（`_tilesToRender` 不跌零即无黑屏）。就地改写共享 TerrainData 不会污染 base 缓存——撤销 `setOptions(null)`+局部失效后新请求返回原始高度。
  - 统计坑：`createSampleGrid` 的 `cellLat` 为负（网格行自北向南），算单格面积/体积时须对 `cellLon/cellLat` 取 `Math.abs`，否则填挖方体积符号全反显示"—"。
  - headless 校验已全绿：V6.13 build EXIT=0（`/tmp/build_ptf_v2.log`），`verify_ptf_v2.mjs` 16/16 PASS（`/tmp/opencode/verify_ptf_v2b.log`）：示例区域自动真实压平 12 块瓦片/3382 顶点至 1200.8m、统计含填方量 16412815.16 万 m³ 与填深行；指定高度 200m 下挖生效（10 块/2669 顶点、整平面 200.0m）；恢复原状统计区块隐藏；手动绘制右键闭合自动压平成功；0 关键页面错误。V6.14（provider 单例化+局部失效）回归：`probe_ptf_v3_fix/_restore/_stability.mjs` 显示拖动抬升 4 轮 `_tilesToRender` 恒 18、掉零 0ms、中心高按档更新（1238.75→1348.75）、撤销后回到原始 348.12；`npm run build` EXIT=0（31.53s）。
[Project Knowledge Summary]
- Date: 2026-09-04
- Context: Discovered by Agent while implementing water-depth-extraction 卡片图标补齐（用户提供截图迭代）
- Category: Environment Configuration
- Instructions:
  - `water-depth-extraction`（水深图提取）案例用户新图 = image-1（.monkeycode-tmp-files/df01b465-image-1.webp，104948B，md5 34b61c46d9b7c58e107ec7da7c81affa，1238×647）；已复制为 `src/cases/water-depth-extraction/icon.webp`，index.ts 加 `import icon from './icon.webp'` 与 `icon,` 字段。该案例 index.ts 的 description 以「基于真实地形采样…」开头会命中卡片文案禁用词扫描，需同步改写为「通过真实地形采样…」。
[Project Knowledge Summary]
- Date: 2026-09-04
- Context: Discovered by Agent while starting cesium-geospatial 五效果移植（大气散射/体积云/月球月光/镜头光晕/动态曝光HDR）到 /workspace 案例库（river 先例）
- Category: Build Methods
- Instructions:
  - 参考实现仓库克隆在 `/tmp/opencode/ref_cesium_geo`（GitHub Zhliyun/cesium-geospatial，pnpm workspace：packages/cesium-core + packages/cesium-clouds + apps/demo）。运行时源码已 vendor 到 `/workspace/src/lib/cesium-geospatial/cesium-core`（沿用上游目录：`cesium/`、`glsl/`、`math/`、`celestial/`、`glslIndex.ts`、`index.ts`），整包 `src/lib/cesium-geospatial/` 已通过 `vue-tsc -b` 全量类型门禁。cesium-clouds 包尚未 vendor，属后续里程碑。
  - vendor 化裁剪注意：上游只在测试用的 `cesium/glslangUtil.ts` 依赖 `node:*` 与 glslang 二进制，已在 vendor 时删除（无运行时引用）；`?raw` 的 GLSL 导入类型由各包自带 `raw.d.ts`（`declare module '*?raw'`）满足。
  - 运行时第三方依赖仅 `@petamoriken/float16`（lutLoader 解析 half-float LUT），已加入 package.json。
  - 资产落位：LUT 四个 `.bin`（scattering/higher_order_scattering 各 8MB 等）已拷入 `/workspace/public/geo/luts/`，案例以 `loadAtmosphereLUTs(context, '/geo/luts')` 加载；月面/云资产生成在后续 case 里程碑再拷。
  - dev 环境的 `import ... from 'cesium'` 由 `vite.config.ts` 的 `cesiumDevGlobal` 插件走 `window.Cesium` 全局 shim，且 `CESIUM_SYMBOLS` 白名单决定可用命名导出。新增 cesium-core 引擎后必须把引擎用到的符号补进该数组（已补：`DeveloperError`、`PostProcessStageComposite`、`PostProcessStageSampleMode`、`Simon1994PlanetaryPositions`），否则报「does not provide an export named ...」且 AsyncComponent 静默失败（demo 面板不出现）。新增更多引擎包（cesium-clouds）时若再报缺导出，继续在此数组追加符号。
  - 首个案例 `src/cases/geo-atmosphere/`（id `geo-atmosphere`，「物理大气与动态曝光」，新分类 `geo` 大气环境，注册于 `src/cases/index.ts` 的 categories + demos）。验证脚本 `/tmp/opencode/verify_geo_atmo.mjs` 已 11/11 PASS：卡片/面板出现、`window.__atmoGeoReady` 就绪、无 shader/pageerror、白昼截图亮/彩色像素充足、晨昏/夜晚预设与手动曝光重建无渲染错误。
  - 大气 B 路径场景开关（上游 demo 同款，写死在 `GeoAtmosphereDemo.vue`）：`scene.logarithmicDepthBuffer=true`、`globe.enableLighting=false`（groundLighting 乘子默认开）、`globe.showGroundAtmosphere=false`、`fog.enabled=false`、`baseColor #3a3a3a`、`backgroundColor 黑`、`sun/moon.show=false`、`globe.depthTestAgainstTerrain=true`（createAtmosphereStage 内部强制）。
  - 后续里程碑：cesium-clouds vendor → 云 case；月盘/镜头光晕/HDR 各自 case 复用已 vendor core；每个 case 新增后跑 `verify_*.mjs` headless + `npm run build` 门禁。

[Project Knowledge Summary]
- Date: 2026-09-04
- Context: Discovered by Agent while implementing 新增 fluid-sph 案例（GPU SPH 地形流体模拟）
- Category: Troubleshooting & Debugging
- Instructions:
  - 示例实现（基于 Cesium 的 SPH 地形流体模拟）：4 段 compute（粒子重积分→物理模拟→表面平滑→历史回写）+ 1 段 BoxGeometry 体积光线步进渲染（Fresnel/深水衰减）；粒子 RGBA 用 `packSnorm2x16` 编码局部坐标与速度，FLOAT 纹理 1024²；region 为约 -119.551~-119.466E / 37.738~37.805N（美国约塞米蒂），`generateModelMatrix([centerLon,centerLat,中值高程],[90,0,0],[宽,厚,高])` 锚定真实地形。~~区域高度图用其 static PNG（红通道=归一化高程，1024×1024）加载~~：**该 PNG 内被烤入来源昵称的斜向重复水印，V6.5.1 起已废弃并覆写清除**；默认区域与框选区域统一改为 `sampleTerrainHeights(provider, extent, 256, min(512,aspectRows))` 实时采样真实 Cesium 地形 → 256 图 → 1024² 画布（`FluidSphDemo.vue` 的 `sampleAndStartSimulation`），min/max 由采样结果给出。
  - 本仓库已有结构相同的 GPU 流体管线 `flood-sim-lib/`，可直接复用其 `CustomPrimitive`（compute/draw 通用、`ComputeCommand persists`）；需要把 `flood-sim-lib/fluid-demo.ts` 里的 `class CustomPrimitive`/`CustomPrimitiveOptions` 改成 `export`（零行为变更）。自定义着色器用独立的 `SPH_PRELUDE_GLSL`（`layout(location=0) out vec4 outputColor`）而非 flood 的 COMMAND_SHADER，避免 `const int textureSize`/uniform 重复声明冲突；把参考代码里 `out_FragColor` 全局替换为 `outputColor`。
  - 案例固定区域使用 Cesium World Terrain + Bing（cesium-scene.ts），无需 Ion token 外配；`depthTestAgainstTerrain=true` 保证水面被地形正确遮挡。Vue 面板支持点地移动水源（pickPosition→归一化坐标，y=1-纬度占比）、暂停只停 3 个 compute stage（保留 surface 冻结画面）、重置销毁重建。该案例按「不生成 icon」留空，等用户提供截图后补齐。验证脚本 `/tmp/opencode/verify_fluid_sph.mjs`：水深卡 icon（img naturalWidth>0）、fluid-sph 卡无 icon、demo 打开无 shader/pageerror、暂停按钮切换 14/14 PASS；`npm run build` EXIT=0。
  - V6.5 迭代（来源字样清理、重力默认 1、手动框选贴地矩形、流向箭头开关）后，平滑段 `SURFACE_SMOOTHING_GLSL` 输出 RGBA 改为（water,terrain,平均vx,平均vz），供体积渲染 `FLUID_VOLUME_GLSL` 里的 `flowArrowMask` 采样水面流向箭头；`.x/.y`（水深/地形）语义保持原样。GLSL 陷阱：把 vec2 塞进 vec4 构造函数必须拆成 `.x/.y` 显式标量——`vec4(rho/w,hei/w,vel/w,0.0)` 组件数 1+1+2+1=5 超限，Cesium 报「constructor too many arguments」且渲染随机失败（非必现，先查自身新写构造函数再排查）。改后 headless `verify_fluid_sph_v65.mjs` 22/22 PASS（重力 1.0、箭头勾选/取消、绘制区域进入/退出、暂停/继续）。
  - headless 像素验证注意：Cesium 内画布默认无 `preserveDrawingBuffer`，JS 里对 WebGL canvas 做 `drawImage/getImageData` 读到全黑（`avg=0/max=0`），必须用 Playwright `screenshot()` PNG 再解码比对；且**暂停后改内部 uniform（如流向箭头开关）不会触发重绘**，pause 状态截图 off/on 恒为 0 diff，属正常渲染节流而非着色器 bug——要验证 overlay 需在运行态连续帧采样。流向箭头按设计仅在「水面命中且速度>1e-3」处绘制，水面静止/暂停后速度≈0 时箭头正确地不显示。

[Project Knowledge Summary]
- Date: 2026-09-05
- Context: Discovered by Agent while swapping polygon-terrain-flatten case card icon (user image iteration)
- Category: Environment Configuration
- Instructions:
  - `polygon-terrain-flatten`（空间分析-多边形地形压平）用户新图 = image-1（.monkeycode-tmp-files/9b28d103-image-1.webp，83890B，1232×648）；已复制为 `src/cases/polygon-terrain-flatten/icon.webp`，index.ts 加 `import iconUrl from './icon.webp'` 与 `icon: iconUrl,` 字段（该案例此前按"不生成 icon"留空）。
  - 换 icon 后验证：icon.webp HTTP 200（83890B）+ headless 首页「空间分析」tab 卡片 `img.complete && naturalWidth>0`（1232×648），0 pageerror，`vue-tsc -b` EXIT=0。

[Project Knowledge Summary]
- Date: 2026-09-06
- Context: Discovered by Agent while integrating uploaded MilitaryPlotting 军标库为 21 个新增案例（src/cases/military-plotting-lib/ + 21 个 case 目录，category draw）
- Category: Troubleshooting & Debugging
- Instructions:
  - 军标库 legacy 文件（`legacy/Create*.ts` + `thirdPart/{algorithm,plotUtil,utils,Constants}.ts`）是旧 minified classic script 逐字迁移，依赖 `window.Cesium`/`window.P`/`window.xp` 全局（src/main 已先加载 Cesium 全局故可用）；**Vite 下这些 .ts 以 ESM strict 执行，原脚本的隐式全局赋值会抛 ReferenceError**：`plotUtil.ts` 的 `getBezierPoints`/`getQBSplinePoints` 中 `for (var n = y = 0, ...)`/`var i = y = 0` 需显式声明（`var n = 0, y = 0, g = 0`），否则进攻/燕尾/钳击等曲线箭头算法在渲染回调里抛 `y is not defined` 并停渲染。
  - dev 模式 `import ... from 'cesium'` 只导出 `vite.config.ts` CESIUM_SYMBOLS 白名单符号；新用到 `PolylineArrowMaterialProperty`（restyle 箭头材质判型）时必须把该符号加入白名单数组并重启 dev server，否则运行时 `does not provide an export named ...`、案例面板挂载失败（vue-tsc/build 均正常，仅 dev 暴露）。
  - 另一类 dev-only 陷阱（debug 校验只存在于 Cesium 源码/未压缩版，`npm run build` 压缩时被 pragma 移除，故 build 通过而 dev 运行时抛）：`Polyline` 必须用 `PolylineCollection.add({ positions, width, material })` 创建，**不能 `new Polyline()` 再逐个赋属性**——空构造时 `polylineCollection` 未传入，`_modelMatrix` 为 undefined，构造函数内 `BoundingSphere.transform(_boundingVolume, _modelMatrix)` 立即抛 `Expected transform to be typeof object, actual typeof was undefined`。定位法：报错参数名 `transform` 指向 `BoundingSphere.transform`，反查调用方得 `Polyline.js`（构造/positions setter）；无浏览器时可用 Node 直接 import `@cesium/engine/Source/Scene/PolylineCollection.js` 等源码模块（Source 版保留 debug 校验）做最小复现，无需 WebGL。
  - 集结地（CreateStagingArea）真实交互 = 左键点起点 → 鼠标移动预览 → 右键完成，**不是多点左键**；原始实现用"起点+微偏移孪生点"预置两点并在 MOUSE_MOVE 分支纠错，孪生点在从零点开始的预览里触发退化样条生成异常导致 polygon 恒 undefined（右键报 Cannot set properties of undefined）。改造：LEFT_CLICK 只存起点，MOUSE_MOVE 首次补第二点、此后 pop/push 更新第二点，再走 computeGatheringPlacePoints+createCloseCardinal+calculatePointsFBZ3 闭环（加 undefined/NaN/短于3过滤后写 jjdPoints 再挂 CallbackProperty），右键完成。其余 20 类交互均为多点左键 + 右键完成。
  - 该库 headless 验证范式（可复用）：dev 起着后 playwright chromium-1234 chrome-linux64 headless 点「标记标绘」分类 → 卡片（hasText 标题）→ `.action-button.primary` force 开始 → 用 `.plotting-shell canvas` 中心偏移做左键序列（直线类 3 点、箭头类 3~4 点、旗标 2~3 点、集结地走"单击+移动+右键"）→ 右键结束 → 断言 `.result-message` 出现「已绘制 1 个 <类型>」→ 换 `.swatch` 验证 restyle 无新 error。脚本落 /tmp/opencode/verify*.cjs（global playwright-core），dev 无 pageerror/console.error 即绿。
  - 21 个新 case（free-line…flag-triangle）初始无 icon（用户确认留空），category draw，注册于 src/cases/index.ts；description 以「左键…右键…支持颜色…实时调整」通用交互文案。
  - 2026-09-06 用户补充前三张卡片截图后补齐 icon（其余 18 个继续留空）：`free-line`（自由线-随手手绘线条）=image-1（139084B，1233×650）、`polyline`（折线-连续节点直线）=image-2（96004B，1237×647）、`curve`（曲线-平滑贝塞尔曲线）=image-3（62554B，1235×650）。同往常复制到各 case `icon.webp` 并 index.ts 加 `import icon from './icon.webp'` + `icon,` 字段；headless 校验 draw 分类卡片 `scrollIntoViewIfNeeded` 后 `img.complete && naturalWidth>0` 且无 `.no-image`。
  - 同日再补三张：`polygon`（多边形-逐点圈定区域）=image-1（136628B，1236×651）、`free-polygon`（自由面-拖拽围合区域）=image-2（64816B，1235×648）、`straight-line-arrow`（直线箭头-单段直箭头）=image-3（108212B，1236×646）；至此 21 个 case 中 6 个有 icon，其余 15 个留空。
  - 本机无 cwebp 时 webp 转码用 `python3 -c "from PIL import Image; Image.open(p).convert('RGB').save(o,'WEBP',quality=82,method=6)"`；`.monkeycode-tmp-files/icons/{icon1,icon2,icon3}.zip` 内 PNG 文件名即教案标题，Pillow 批量转后复制为剩余 15 个 case 的 icon.webp（round-rectangle/curve-line-arrow/swallowtail-arrow/right-angle-arrow/attack-arrow/pincer-arrow/flag-inverted-triangle/flag-triangle/flag-curve/flag-regular-triangle/flag-rectangle/bow/sector/regular-polygon/staging-area，naturalWidth 1233~1236），至此军标库 21 个 case 图标 21/21 全齐；headless 校验 `/tmp/opencode/verify_icons15.cjs` 15/15 PASS、`npm run build` EXIT=0。
  - **legacy 库把静态方法当构造器 new（`new Cesium.Cartesian3.fromDegrees(...)`/`new Cesium.EllipseOutlineGeometry.createGeometry(...)`）在 Cesium 1.144 下抛「X is not a constructor」**：CreateRegularPolygon 里每次 mousemove 的半径计算会抛错导致「落中心点后鼠标移动无法实时改变正多边形大小」（仅 LEFT_CLICK 瞬间 30m 初始形、画面红色面几乎不可见但右键仍能 push）。修复：去掉 `new` 直接调用静态方法。像素级 headless 验证范式：落中心点 → 鼠标移到远处截图统计红色像素(r>190&&g<150&&b<160)为 far → 移回近处截图 near，断言 far ≥ 3×near 且 near>0（ratio≈17 达标），右键后 `.result-message` 出现「已绘制 1 个正多边形」。

[Project Knowledge Summary]
- Date: 2026-09-06
- Context: Discovered by Agent while adding rocket-launching case (运载火箭发射, category scene, RocketLaunching.zip port)
- Category: Troubleshooting & Debugging
- Instructions:
  - 新案例 `src/cases/rocket-launching/`（id `rocket-launching`，title 运载火箭发射，category `scene`，无 icon）把 zip 内 `RocketLaunching/czml.js`（1860 行，Vulcan 火箭 2022-07-01T04:00:00Z 发射约 17 分钟到入轨）整体拷为 `czmlData.ts`（首行 `// @ts-nocheck`），Demo 用 `CzmlDataSource.load(czml)` 加载本地对象而非 `?url`；发射场约 `Cartesian3.fromDegrees(-80.653, 28.471, 260000)`。
  - CZML 加载会从 czml 文档 clock 自动设置 viewer.clock 区间；`viewer.clock.clockRange = ClockRange.LOOP_STOP`（属性名是 `clockRange` 非 `range`）；时间比较用 `JulianDate.greaterThanOrEquals`（拼写带 s）；停表（shouldAnimate=false）时改 currentTime 不会触发 clock.onTick，复位后必须手动调一次自己的时间刷新函数，否则 UI 显示旧值。
  - 播放速度=clock.multiplier（5/10/20/50/100 档，20× 全程约 50s）；仿真时间显示用 `JulianDate.toGregorianDate` 手动补零（g.hour 是 number，直接拼不补零会显示 `4:00:00`）。
  - CZML 实体 path/label 开关：`Entity.path.show`/`label.show` 类型是 `Property | undefined`，赋 boolean 报 TS2322，须 `new ConstantProperty(bool)`；且 `rocket.path` 本身可能 undefined，赋值前加 `defined(rocket) && defined(rocket.path)` 守卫。
  - headless 冒烟 `/tmp/opencode/verify_rocket.cjs`：切「场景示例」tab → 点卡 → `.rocket-shell`/`.status-mask` 消失（CZML 就绪）→ 点发射读 `.sim-clock` 断言走动 → 暂停冻结 → 复位回 04:00:00，全程 0 pageerror/console.error；dev server 用 background terminal 且 `timeout_ms` 需 >0 会被到期回收（本次 1h 后被杀需重建）。
  - 案例 Demo 顶层布局必须与同分类先例一致：用 `position: relative; width:100%; height:100%; min-height:320px`（参考 earth-rotation `.rotation-shell`），**不能用 `position:absolute; inset:0`** —— `.case-stage` 自身不是 positioned 祖先，absolute 会脱离案例卡片区直接铺满整个视口（表现为"进来直接全屏、没有布局"）。
  - czml 的 `model.gltf.uri` 用的是 `${window.location.origin}/data/model/launchvehicle/launchvehicle.gltf` 运行时拼接，Vulcan 本体是 3D glTF 模型：必须把素材复制到 `public/data/model/launchvehicle/`（gltf+bin+22 张纹理，3.3M），缺失时 CzmlDataSource 加载阶段抛 `RuntimeError: Failed to load model ... '<' is not valid JSON`（HTML 404 页被当 JSON 解析）；czml 里 `.monkeycode-tmp-files` 之类路径同理会这样失败。
   - 案例卡片 icon 均按用户上传图补齐：rocket-launching icon = 用户 image-1（.monkeycode-tmp-files/95b5e6f2-image-1.png，PNG 1238×649 163346B）→ Pillow webp q82（21672B）→ 复制 `src/cases/rocket-launching/icon.webp` 并在 index.ts 加 `import icon from './icon.webp'` + `icon,`；dev HTTP 200（21672B）+ headless 场景示例卡片 `img.complete && naturalWidth>0`（1238×649）通过，无 `.no-image`、0 pageerror。

[Project Knowledge Summary]
- Date: 2026-09-06
- Context: Discovered by Agent while porting three more zip demos into cases (affect-area 影响区域 / underground-mode 地下模式 / shuttle-line 穿梭流光道路线, zips AffectArea-1/Underground-2/ShuttleLineMaterial-3, cards no icon)
- Category: Troubleshooting & Debugging
- Instructions:
  - **Entity polygon 的 hierarchy 直接 new ConstantProperty(平面 Cartesian3[] 数组) 会在渲染首帧抛 `DeveloperError: positions is required` 并停渲染（Cesium 错误面板遮住整个 case，随后的点击全部被拦）**；必须 `hierarchy: new PolygonHierarchy(positions)`（import { PolygonHierarchy }）。polyline 不受影响，只有 polygon 有此坑。排查手法：Playwright 读 `.cesium-widget-errorPanel` textContent 拿真实报错，再二分注释各 add()。
  - 影响区域（effects）用 CircleGeometry.createGeometry+PolylineGeometry 做扩散环，环上每点各挂一条 `PolylineMaterialAppearance` 材质的小线段实现流光箭头沿环旋转；脉冲扩散面（Pulse）是贴 arrow.png 的 Polygon 填充 + pulse 扩散圆环，箭头贴图需放 `public/data/model/impact-area/`（Pillow RGB q82 webp）供新对象 url 引用。
  - 穿梭流光道路线（effects）：`road.json` 是三维 `[[lng,lat,height]...]` 节点流，用采样点（每段按步长插值）建弧段折线，线宽按高度线性插值，分成 flow 圆头线 + mainline 扁线两层走 `PolylineMaterialAppearance` 的 `Image/Stripe` 素材（ShuttleFlowLine、TintFlowLine 等），trail.png 放 `public/data/model/shuttle-line/`。
  - 地下模式（scene，id `underground-mode`）：引擎缺场景 `scal2gl` 插件、`viewer.scene.getHeight` 不存在，交互脚本引用它/`scene.camera` 地下参数会直接抛错；demo 改为在 `screenSpaceCameraController` 写守卫后直接 camera.setView/flyTo 到地下坐标 + 调 scene.globe 透明度/clippingPlanes 表现剖切（裁剪基于 viewMatrix 逆推，修改可视区域时用 globe.clippingPlanes = new ClippingPlaneCollection 重建），地铁站 gltf/bin/纹理放 `public/data/model/metro_station/`（含 license 副本），postProcessStage = 分层颜色坡度增强。
  - 三个案例均 category 注册 src/cases/index.ts 的 import + four 数组；卡片无 icon 留空。全量 headless 冒烟 `/tmp/opencode/verify_3cases.cjs`：卡片进入→`.status-mask` 消失→逐参数操作（ring 分段/流向/theme select/速度、shuttle 色调/线宽/流速、underground 开关+地下视角 flyTo）→ 0 pageerror/console.error、metro_station/scene.gltf HTTP 200、`npm run build` EXIT=0。
  - 同日用户补三张卡片截图后补齐 icon（.monkeycode-tmp-files/）：affect-area（影响区域-多层扩散光圈）=a186e07b-image-1.webp（1235×647）、shuttle-line（穿梭流光道路线）=3164b30f-image-2.webp（1238×650）、underground-mode（地下模式-地铁站）=3c30bb1b-image-3.webp（1240×650）；复制为各 `src/cases/<id>/icon.webp` 并 index.ts 加 `import icon from './icon.webp'` + `icon,`。headless 校验 `/tmp/opencode/verify_icons3.cjs` 3/3 PASS（naturalWidth 1235/1238/1240，无 `.no-image`、0 pageerror）。注意该 grid 懒加载：卡片需 scrollIntoView 且轮询等 `naturalWidth>0`，否则 headless 里新滚动进视口的卡 icon 可能瞬时 0×0 误报 FAIL。

[Project Knowledge Summary]
- Date: 2026-09-08
- Context: Discovered by Agent while performing V6.22 首屏性能工程优化（案例数增长解耦）
- Category: Workflow & Collaboration
- Instructions:
  - 案例注册机制已改为自动扫描：`src/cases/` 下含 index.ts 且不以 `-lib` 结尾的目录即一个案例，目录名即案例 id（目录 `fog` 的 id 为 `weather-fog` 会触发 warn，应避免）。运行 `npm run sync`（scripts/sync-cases.mjs）重写自动生成文件 `src/cases/manifest.ts`（元数据 + 惰性 loaders），不要再手工在 `src/cases/index.ts` 加 import；predev/prebuild 已自动执行 sync，手工启 vite 时记得先 sync。
  - 首页已与 Cesium 解耦：HTML 不再注入 Cesium script。Cesium.js 由 App.vue 的 `ensureCesium()` 在用户首次 `pointerover` 或打开案例时按需注入（dev 指向 `/cesium/Cesium.js` 全局 shim，build 指向 `dist/cesium/`），`window.Cesium` 就绪前记录一次性等待 promise。案例组件为异步 chunk（manifest 的 caseLoaders），新增案例不再增大首屏加载体积。
  - vite.config.ts 存在 `CESIUM_SYMBOLS` 白名单：dev 模式 import 新的 Cesium 命名导出时必须同步加入该名单，否则报 `does not provide an export named`。
  - 案例 Demo 不再通过 `demo.component` 拿到组件；App 用 `demo.available`（sync 解析 default export 是否含 component 简写属性）判断，打开时经 `loadCaseEntry(id)` + `defineAsyncComponent` 异步渲染，加载期显示 `.case-loading` 遮罩。

[Project Knowledge Summary]
- Date: 2026-09-10
- Context: Discovered by Agent while delivering 日照覆盖分析（sunshine-coverage）与 阴影分析（shadow-analysis）两个 analysis 案例，公共逻辑沉淀到 `src/cases/sunshine-lib/`
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 1.144 `Scene.shadowMap`（ShadowMap）公开可写属性只有 `enabled`/`softShadows`/`size`/`maximumDistance`/`darkness`/`normalOffset`；级联数量 `numberOfCascades` 是私有/仅构造参数（`_numberOfCascades`），运行期不可改；`normalOffsetScale` 不在公开 d.ts 中，赋值会 TS 报错，不要做成 UI 参数。
  - 实体建筑投射阴影：`renderBuildings(viewer, city, opacity, Cesium.ShadowMode.ENABLED)`（render.ts 已加可选第 4 参）；同时必须 `scene.globe.enableLighting = true` 地表才接收阴影（否则 globe 不参与光照/阴影）。
  - 时钟与本地太阳位置对齐：Cesium `SunLight` 由 `clock.currentTime` 的 JulianDate(UTC) 驱动，而项目 `computeSunPosition` 用“当地标准时间”。写时钟前必须把本地 Date 减时区偏移换成 UTC 再 `JulianDate.fromDate`（本案例 tz=8），否则阴影方向与实际太阳/轨迹不符；某一本地时刻对应的 clock 时间用 `JulianDate.addSeconds(baseMidnightJulian, localMinutes*60)` 设置，播放用 `clockStep=SYSTEM_CLOCK_MULTIPLIER` + `multiplier`（1800≈30分钟/秒）+ `clockRange=LOOP_STOP`。
  - `computeContours`（polygon-depth-contour/depth-contour-lib.ts）入参是 `SampleGrid`（字段 `minInside/maxInside`），与分析用的 `SunGrid`（`minValue/maxValue`）不同，需在调用处建适配对象；`computeContours` 依赖行序北→南、`cellLat<0` 的网格约定。
  - 日照覆盖默认参数（7×6 街区、间距 20m、步长 10min）约 1755 节点 × 约 48 时刻，浏览器端秒级完成；异步分帧用逐行 `requestAnimationFrame` 让出主线程。
  - 两案例均无 icon（DemoCard.icon 省略），验证脚本 `/tmp/opencode/verify_sunshine_shadow.cjs`（搜索进入两案例→日照出“区域统计/达标率”→阴影播放暂停切换/帮助面板→0 pageerror）与 `npm run build` 均通过。

[Project Knowledge Summary]
- Date: 2026-09-14
- Context: Discovered by Agent while delivering 滑坡/泥石流 ThreeJS 与 Cesium 双端案例（`src/cases/geo-hazard-lib/`）
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 自定义顶点色 Primitive（`Appearance({vertexShaderSource, fragmentShaderSource})` + `GeometryAttributes.color`）的颜色回调必须输出 0~255 的 sRGB 字节；模型侧 `hexToLinear` 得到的是线性 0~1，需经 `clampByte(255*Math.pow(clamp01(v),1/2.2))` 编码，否则线性值被 Uint8Array 截断为 0，网格整片渲染成黑色（点要素与 Entity 不受影响，可据此判断是否为颜色回调问题）。
  - Entity 标注的可见性用 `entity.show` 控制即可；若在 `label` 配置里再写 `show:false`，只切 `entity.show` 不会让标注出现，需要去掉 label 自身的 show 或用 ConstantProperty 同步。
  - 顶点色 Primitive 实时形变建议按“时间节流（约 0.07s）+ 数值阈值”双条件重建，避免低帧率下每帧重建上百 MB 级几何体。
  - 地质灾害科普文案统一维护在 `src/cases/geo-hazard-lib/knowledge.ts`，按案例导出 `LANDSLIDE_KNOWLEDGE` / `DEBRIS_KNOWLEDGE` / `BARRIER_LAKE_KNOWLEDGE`（block 类型 `p` / `sub` / `table`），Three 与 Cesium 两端案例共用同一份，禁止在 `.vue` 内联复制；新增地质灾害案例时优先复用该知识库与统一的 `.fy-shell` + 右上 `.control-panel` + 左上 `.step-info` + 底部 `.stage-bar` + 左下 `.legend` 面板版式（Three 端也用同一套浮层类名），交互键位（空格播放、方向键调进度/切阶段、点击标注查看解释）需在面板 `.hint` 中提示。

[Project Knowledge Summary]
- Date: 2026-09-15
- Context: Discovered by Agent while fixing 滑坡/泥石流 Cesium 案例村庄、防治工程、降雨不显示（`src/cases/geo-hazard-lib/cesium-base.ts`）
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium `Entity` 的 box/ellipse 等几何图形在本项目 `createMapScene` 的 Viewer 中不渲染（同一实体的 label/polyline 正常），实心构筑物要改用标准几何管线：`Primitive` + 批量 `GeometryInstance({ geometry: BoxGeometry.fromDimensions({dimensions, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT}), modelMatrix, attributes: { color: ColorGeometryInstanceAttribute.fromColor(...) } })` + `PerInstanceColorAppearance`，`modelMatrix = Matrix4.multiply(enu, Matrix4.fromTranslation(局部点 × scale))` 保证与 ENU 对齐，整组可用 `primitive.show` 显隐；`BoxGeometry.dimensions` 顺序为（东向, 北向, 天向），不是（宽, 高, 深）。
  - Cesium 1.144 的 `ParticleSystem` 已无 `gravity` 选项，`BoxEmitter` 的粒子初速方向是“从盒心指向自身位置”（随机四散、不会下落）；要做出降雨必须传 `updateCallback`，每帧用 `Cartesian3.normalize(particle.position, particle.velocity)` 求指向地心方向再乘恒定速度（世界坐标，position/velocity 都是 ECEF）。
  - `ParticleSystem` 的发射与位移用 `frameState.time` 计算 dt，而它来自 `Clock.tick()`；`Viewer` 默认 `clock.shouldAnimate = false` 时 dt 恒为 0，表现为 emissionRate 已设置、粒子数组始终为空、完全看不到雨；案例需显式 `viewer.clock.shouldAnimate = true`。
  - 案例标题/图标等元数据改动后必须先 `npm run sync` 再跑 headless 验证（`src/cases/manifest.ts` 是生成物，dev server 只读它，未同步时按新标题选卡片会一直超时）。

[Project Knowledge Summary]
- Date: 2026-09-15
- Context: Discovered by Agent while implementing 空间分析-深度图提取（rectangle-depth-map）按间距(米)生成与 GeoTIFF 坐标修复
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium `Rectangle`/`Cartographic` 的经纬度字段是**弧度**，而 EPSG:4326 的 GeoTIFF 像元尺度/左上角坐标与世界文件必须是**度**。导出地理栅格前一律 `CesiumMath.toDegrees()`（构造给 `sampleTerrainMostDetailed` 的 `Cartographic` 时再 `toRadians()` 回去）；否则坐标被放大约 57.3 倍，且按"米/度"换算跨度时把弧度当度会算小上百倍、网格退化成 2×2。这是"导入 GIS 坐标范围不对"的根因。
  - 共享 GeoTIFF 编码器已落在 `src/lib/geotiff.ts`：`writeGeoTiffFloat32({width,height,west,north,cellLon,cellLat,values,description})` 写 ModelPixelScale(33550，度/像元，y 取负)、ModelTiepoint(33922，左上角 west,north)、GeoKeyDirectory(34735，GTModelType=2/GTRasterType=1(PixelIsArea)/EPSG=4326)、SampleFormat=3(Float32)；`buildWorldFile()` 生成配套 `.pgw`（像元中心=左上角+半像元）。栅格采用 PixelIsArea：按像元中心采样，栅格范围恰好等于所选矩形。

[Project Knowledge Summary]
- Date: 2026-09-15
- Context: Discovered by Agent while implementing 真实地形堰塞湖模拟（barrier-lake-terrain，真实 World Terrain 采样 + 自定义顶点属性 Primitive）
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 1.144 的 `GeometryAttributes` 类型只声明 `position/normal/st/color/...` 等固定字段，自定义顶点属性（如 `aRise`）直接 `attributes.aRise = new GeometryAttribute({...})` 会报 TS2339；用同一套断言 `new GeometryAttributes() as GeometryAttributes & Record<string, GeometryAttribute | undefined>` 再赋值即可通过 vue-tsc 且运行时正常（自定义 shader 用 `attribute float aRise;` + `varying float v_rise;` 读取）。
  - 在真实地形上叠加规则网格（坝体/滑体/水面）时，不要整体抬升偏移（会悬浮或穿插）。正确做法是额外写一条顶点属性 `aRise = 顶点高程 - 地面高程`，片元 `if (v_rise < 阈值) discard;` 裁掉规则网格中不覆盖地形的区域，只保留贴合的隆起部分。
  - `sampleTerrainMostDetailed` 在陡崖、范围边缘或 Ion 数据缺口处可能返回缺失高程，产生 NaN/异常值，网格会出现规则暗色矩形；加载后需做一次邻域均值迭代填补（多 pass，最后 fallback 全局均值），再用于构建网格与水面高程。
  - 真实地形案例「参数自定义」的时间代价分级：仅改几何参数（坝高/滑体规模等）时只重建 Primitive 网格即可秒级生效；一旦改动采样范围（西/东/南/北四至）必须重跑 `sampleTerrainMostDetailed`，SwiftShader 无头环境约 5~10 秒。验证脚本应等待状态文本（如「场景参数已应用」/「真实地形已就绪」）而非固定 sleep，且要避免连续两次重采样重叠（有 in-flight 标志时第二次会提前返回、参数回落为首次范围）。
   - **不要在 3D 案例里用 `viewer.scene.globe.show = false` 实现「关闭真实地形」**：`createMapScene` 默认关闭 `skyBox`/`skyAtmosphere`，且影像挂在 globe 上，隐藏 globe 后天空盒与影像同时消失，整屏只剩 WebGL 清屏色（全黑）。正确做法是保留 `globe.show = true`，仅把 `viewer.terrainProvider` 换成 `new EllipsoidTerrainProvider()`（关闭时）/换回 World Terrain（开启时），影像继续铺在光滑椭球上；`src/lib/cesium-scene.ts` 已有 `setTerrainEnabled(viewer, enabled)` 可直接复用。注意地形采样仍应用真实 World Terrain provider，不要跟着切换成椭球，否则重采样得到平地高程。
   - 需要天空大气/天空盒时给 `createMapScene(container, callbacks, { skyAtmosphere: true, skyBox: true })`（`useWhiteModelTileset(sceneOptions)` 同参）：内部实现必须把 Viewer 的 `skyAtmosphere`/`skyBox` 选项传 `undefined` 走 CesiumWidget 默认创建路径；传 `true` 会因 `skyAtmosphere.setDynamicLighting is not a function` 报错。默认（不传 options）仍为 `false`，此时 `scene.skyAtmosphere` 为 null，写入 `atmosphereLightIntensity`/`hueShift`/`atmosphereMieAnisotropy` 全部静默无效。
   - 大气参数「调了没反应」的两个几何/数学陷阱：`SkyAtmosphere.hueShift` 沿色环循环，±1 = 整圈旋转=视觉无变化（有效区分区间约 ±0.3~±0.5）；Mie 相位函数含 `(1 − G²)` 因子，`atmosphereMieAnisotropy = ±1` 时 Mie 项恒为 0，且日周光晕需把相机朝向太阳才看得见。滑块范围应避开这两个退化端点，并把观察方式写进提示文案。
  - 地图交互（点选 / 框选 / 标定）实现范式：`new ScreenSpaceEventHandler(viewer.scene.canvas)`，点选用 `LEFT_CLICK` + 复用 `src/cases/measure-lib/pick.ts` 的 `pickCartographic(scene, position)`（返回弧度，需 `CesiumMath.toDegrees`）；框选用 `LEFT_DOWN`+`MOUSE_MOVE`+`LEFT_UP` 取两角屏幕点换算四至，期间必须 `scene.screenSpaceCameraController.enableInputs = false` 阻止左键拖拽旋转地球，结束/取消（Esc）时恢复。标定标记/预览用独立 `CustomDataSource('...')`（`viewer.dataSources.add`）集中 `entities.removeAll()` 重建；贴地标记给 point/label 加 `heightReference: CLAMP_TO_GROUND`，贴地线用 `clampToGround: true`；`label` 不会随 `heightReference` 自动贴地时同样要显式设置。
  - Playwright 选择器默认严格模式（命中多个元素即报错）：控制面板里同类按钮（主/次操作）必须给唯一类名（如 `.action-button.confirm`/`.action-button.ghost`），不要复用 `.action-button.primary` 与其它按钮，否则 headless 点击用例直接失败。

[Project Knowledge Summary]
- Date: 2026-09-15
- Context: Discovered by Agent while iterating 真实地形堰塞湖模拟为「自定义多边形河谷 + 绘制河道中心线 + 河道宽/深」（barrier-lake-terrain）
- Category: Troubleshooting & Debugging
- Instructions:
  - 多点多边形/折线绘制交互：`LEFT_CLICK` 逐点追加顶点（按经纬度 1e-6 去重，避免双click重复）、`MOUSE_MOVE` 传入当前拾取点做橡皮筋预览线、`LEFT_DOUBLE_CLICK` 与 `RIGHT_CLICK` 都注册为结束、`Esc` 取消；顶点数校验（面 ≥3 / 线 ≥2）在结束时做，不足则提示并放弃。绘制期间必须 `screenSpaceCameraController.enableInputs = false`，`endCalib()` 里恢复，并用 `handler.isDestroyed()` 防重复销毁。
  - 用户绘制几何 vs 默认几何要在场景内统一为「派生点集」并缓存：多边形为空时回落到四至矩形四角、河道线为空时回落到 `channelLon` 的南北直线；点集只在配置变更时（`refreshDerived()`）重建一次，之后所有高频查询（如逐行/逐顶点求河道最近距离）直接读缓存数组，避免在渲染循环里反复分配点数组。
  - 自定义河谷多边形 → 场景四至：用多边形外接矩形（bbox）覆盖 `west/east/south/north`，在 `sanitizeConfig()` 内完成推导，使按范围采样的地形网格与多边形天然一致；仅多边形形状变化而 bbox 不变时无需重采样地形，但水面遮蔽需要按点在多边形内（射线法）逐顶点判定。
  - 河道宽/深语义：`riverWidth` 只在「非蓄水的河道形态阶段」把水面限制在以中心线为轴、半宽 = riverWidth/2 的带状范围内（点线最短距离 > 半宽则深度置 0，片元按深度阈值 discard），蓄水成湖后水位高于河床则自动解除带宽限制、铺满整个河谷；`riverDepth` 取代原先硬编码的「河床 +1.2m」水面抬升。坝体溃口下切槽、坝址/河面标注的经度都应改用「中心线在该纬度的经度」而非固定 `channelLon`，否则绘制弯道河道后溃口与标注会偏离河道。

[Project Knowledge Summary]
- Date: 2026-09-16
- Context: Discovered by Agent while adding InfoTip hints to 13 lighting cases and verifying every control actually takes effect (V6.41)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 数组型 uniform 的通用陷阱：`UniformFloatVec2.set()` 用 `Cartesian2.clone`、`UniformFloatVec3.set()` 要求 `.red`(Color) 或 `.x`(Cartesian3)，传裸数组会抛 `Invalid vec3 value for uniform` 并导致 Rendering has stopped。项目约定：`src/lib/lighting.ts` 的 `toCartesian3([n,n,n])`、`Cartesian2.fromElements(x, y, new Cartesian2())`。
  - Cesium `PostProcessStageCollection.tonemapper` 存的是**字符串枚举**（`Tonemapper.ACES === 'ACES'`），不是函数；而 `bloom` / `ambientOcclusion` / `fxaa` 是 stage 对象。内置 stage 不在 `pp.length`/`pp.get(i)` 中，只能通过 `pp.bloom`/`pp.ambientOcclusion`/`pp.fxaa`/`pp.tonemapper` getter 访问；`PostProcessStage.uniforms` getter 返回内部 `_uniforms`，遍历必须用 `Object.getOwnPropertyNames`。
  - SSAO 参数以 Cesium 1.144 源码为准：`createAmbientOcclusionStage` 内层 stage uniform 为 `intensity`/`bias`/`lengthCap`/`directionCount`/`stepCount`/`randomTexture`，合成 stage 为 `ambientOcclusionOnly`；`stepSize`/`blurStepSize`/`intensityCap` 在 1.144 不存在（写入静默无效）。
  - 案例开启实时阴影的正确顺序：`createMapScene` 的 Viewer 构造为 `shadows:false`，案例在 `apply()` 里按 UI 写 `viewer.shadows`（如 `ShadowMode.ENABLED`）；不要在 `onTilesetReady` 里硬编码 `viewer.shadows = false`。
  - 控件生效性验证方法论（可复用，取代像素差判定）：白模瓦片加载抖动会使全画面像素均值漂移（相机位移干扰），不可用于判定参数是否生效；改用「状态快照法」——对控件操作前后 dump Cesium 引擎状态（postProcessStages 及其内置 stage uniforms、3D Tiles `shaderUniforms`、entities、imageryLayers、scene/globe/shadowMap/clock）做 diff，有差异即 WIRED。探针须按案例独立启动浏览器（swiftshader 连续多案例易崩，需崩溃续跑），并等案例自带 `flyTo` 相机稳定后再 `setView` 到约 700 m 近距，否则瓦片不加载、控件看似无效。

[Project Knowledge Summary]
- Date: 2026-09-17
- Context: Discovered by Agent while fixing "返回列表报错" in light-color-grading case (V6.42)
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 1.144 的 `PostProcessStageCollection.remove(stage)` **内部已调用 `stage.destroy()`**（源码 PostProcessStageCollection.js 中 remove 末尾 `stage.destroy()`；removeAll 同理）。案例卸载时若再显式 `stage.destroy()` 会抛 `DeveloperError: This object was destroyed`，表现为点「返回列表」报错。正确写法：只调 `viewer.scene.postProcessStages.remove(stage)`，不要再 destroy。项目内正确范例：weather-sandstorm / weather-rain / weather-snow / lightning / integral-height-fog / fog；参数切换需换 stage 时用 `remove` 后新建 stage 再 `add`（见 volume-cloud）。
  - 排查「离开案例报错」类缺陷：用 playwright 打开案例 → 等 `.lgt-shell canvas` → 点 `.case-back-button` → 捕获 pageerror，可稳定复现 Cesium 销毁类 DeveloperError。

[Project Knowledge Summary]
- Date: 2026-09-17
- Context: Discovered by Agent while fixing "半球光参数调整看不出效果" and adding icons to light-fxaa/light-hemisphere/light-point (V6.43)
- Category: Troubleshooting & Debugging
- Instructions:
  - 白模（3DBAG tileset）在 CustomShader `fragmentMain` 中 **`material.diffuse` 恒为 0**：其 glTF 未提供 `pbrMetallicRoughness.metallicFactor`，glTF 规范默认 metallic=1.0，Cesium 1.144 `MaterialStageFS.setMetallicRoughness()` 因此取 `metalness=1.0` 并执行 `material.diffuse = mix(material.baseColor.rgb, vec3(0.0), metalness)`。环境光/半球光/局部光的基色一律用 `material.baseColor.rgb`（`czm_modelMaterial` 首字段 `vec4 baseColor`，由 `materialStage` 写入）。
  - 局部光照着色器写法（`src/lib/lighting.ts` `LOCAL_LIGHT_FRAGMENT`）：`vec3 base = material.baseColor.rgb; material.diffuse = vec3(0.0); material.emissive = base * (ambient + diffuse) + specular; material.specular = vec3(0.0);`。案例场景 `SunLight.intensity = 0` 时，照度完全由 `material.emissive` 承担；若误用 `material.diffuse` 当基色，所有光照项恒为 0（表现为滑杆与颜色选择器全部无感）。
  - Cesium 模型 PBR 片元管线顺序（定位依据）：`defaultModelMaterial()`（diffuse=0）→ `materialStage()`（写 `baseColor`/`diffuse`/`specular`）→ `customShaderStage()`（`fragmentMain`）→ `lightingStage()`（`color = directColor + material.emissive`，`out_FragColor` 最终取 `material.diffuse`）。
  - 判定「参数无感」是通道失效还是输入为 0 的诊断法（常量替代法）：在页面里基于 `tileset.customShader.fragmentShaderText` 做字符串替换构造变体 —— 把可疑表达式换成常量（`ambient` → `vec3(0.5)`、`base` → `vec3(1.0)`、`emissive` → `vec3(0.5)`），若换常量后画面变化而原表达式无变化，即可断定该输入恒为 0 而非通道无效；每次变体后读 `scene.context.shaderCache.numberOfShaders` 确认新着色器已编译。注意逐段替换后原 shader 末尾的赋值会覆盖前置插入语句。
  - `npm run build`（vite build）在本机 2 核/8 GiB 环境会触发 node 默认堆上限 OOM（`FATAL ERROR: Reached heap limit`，约 1.4 GB）；改用 `NODE_OPTIONS=--max-old-space-size=3072 npm run build` 可成功（约 1m50s）。构建须用 background terminal 并设置 cpu/memory 限制。
  - 复核（2026-09-22，V6 系统DEMO）：以 `background_terminal_create` 设 `cpu_percent=200`、`memory_percent=55`（memory.max 4.28 GiB，叠加运行中的 dev server 峰值 1.13 GiB 仍在总内存 85% 预算内）执行原生 `npm run build` 连续两次成功，实测 vue-tsc + vite 整链路峰值约 2.52 GiB、耗时约 1m45s，无需 NODE_OPTIONS。故优先直接用受限后台终端跑 `npm run build`，仅在出现 `FATAL ERROR: Reached heap limit` 时才加 `--max-old-space-size=3072`。
  - 只想单独做 TS 门禁（不跑 vite）时，可临时建 `.tsconfig.firecheck.json`（`extends: ./tsconfig.app.json` + `include: ["src/cases/<case>/**/*.ts"]`）后 `npx tsc -p .tsconfig.firecheck.json`；因 tsc 不识别 `.vue`，index.ts 里 `import('./XxxDemo.vue')` 的 TS2307 属预期噪音，最终门禁仍以 `npm run build`（vue-tsc）为准。

[Project Knowledge Summary]
- Date: 2026-09-17
- Context: Discovered by Agent while fixing 「实时阴影-法线偏移」开关无效并引发 This object was destroyed（V6.44）
- Category: Troubleshooting & Debugging
- Instructions:
  - Cesium 1.144 阴影接收着色器缓存规则：`getShadowReceiveShaderKeyword()` = `receiveShadow ` + `usesDepthTexture/polygonOffsetSupported/isPointLight/isSpotLight/hasCascades/debugCascadeColors/softShadows/castShadows/isTerrain/hasTerrainNormal`，**不含 `normalOffset`**；而 `createShadowReceiveFragmentShader()` 里 `applyNormalOffset()` 的函数体是否写入偏移语句由编译期的 `bias.normalOffset` 决定。所以运行期改 `scene.shadowMap.normalOffset` 只会置 `dirty` 并复用同关键字缓存，恒定无效；`softShadows` 在关键字内（改它确实会重建），`maximumDistance` / `darkness` / `fadingEnabled` 只是 uniform 值（实时生效），`size` 变更需置 dirty。
  - 阴影法线偏移的可用做法：`shadowMap.normalOffset` 恒保持 `true` 让偏移代码常驻，改用 `_terrainBias.normalOffsetScale`（默认 0.5）/ `_primitiveBias.normalOffsetScale`（默认 0.1）这一运行期 uniform 控制强度（关闭时置 0）。`combineUniforms()` 中 `shadowMap_normalOffsetScaleDistanceMaxDistanceAndDarkness.x` 每帧读取该系数，与 `normalOffset` 布尔值无关。
  - 严禁用「手动 `delete context.shaderCache._shaders[关键字]` + `finalDestroy()`」来强制重建派生着色器：会破坏 Cesium 记账（父项 `derivedKeywords` 仍记录被删关键字、`_shadersToRelease` 未清理、`k7()` 会按关键字递归销毁之后新建的活跃程序），表现为若干帧后 `DeveloperError: This object was destroyed`（`ShaderProgram.throwOnDestroyed` ← `Context.draw`，Rendering has stopped）。此类问题用 A/B 对照（临时禁用可疑重建）定位最快。

[Project Knowledge Summary]
- Date: 2026-09-17
- Context: Discovered by Agent while fixing 海量点实时聚合在倾斜拉近视角下的「视角外数据仍显示」（V6.46）
- Category: Troubleshooting & Debugging
- Instructions:
  - 地球（椭球）上的点/图标要「不在视角内就不显示」，必须同时做三重剔除：① 相机背后（裁剪空间 `clipW <= 0`）；② 视锥之外（NDC 三轴越界）；③ **地平线之外（被地球本体遮挡）**。只做前两项时，带俯角拉近视角会把地球背面的点画到天际线以上的天空区域，`disableDepthTestDistance: Infinity` 会进一步让它浮在最上层。
  - 地平线剔除的稳定判据：把相机与点都除以椭球三轴半径 `radii`（换到缩放空间/单位球），`camScaled · pointScaled >= 1` 可见，`< 1` 被地球遮挡。相机与世界坐标取自 `camera.positionWC`、`scene.globe.ellipsoid.radii`。聚合类图元除逐点剔除外，还要对单元格均值（累加缩放空间坐标的均值）再判一次，否则跨天际线的格子仍会把图标放到地球背面。
  - 验证方法：脚本化设置俯角视角（`camera.setView({ destination, orientation: { heading, pitch, roll } })`），逐图元读取 `scene.primitives.get(i).get(j).position` 后用缩放空间判据 + 大圆距离 `groundDist > sqrt(2Rh + h²)` 交叉核对；广域→拉近的被动触发链路要用真实 `page.mouse.wheel` 复测，确认 `camera.changed`/`moveEnd` 确实触发重算。
  - 该案例的重聚合触发链路：`viewer.camera.moveEnd` + `camera.changed`（`percentageChanged = 0.02`）→ 防抖 60ms → Worker 屏幕空间聚合；Worker 结果按 `requestId === requestSeq` 丢弃过期结果，`running`/`pending` 保证同时只有一次在算。

[Project Knowledge Summary]
- Date: 2026-09-18
- Context: Discovered by Agent while adding the six terrain height-field extraction cases (V6.47)
- Category: Environment Configuration
- Instructions:
  - dev 模式的 cesium 全局 shim（`vite.config.ts` 的 `CESIUM_SYMBOLS`）不仅需补公开 API，也需补 Cesium 内部类：本批新增的 `OrthographicFrustum`、`PassState`、`Renderbuffer`、`RenderbufferFormat` 都必须加入白名单，否则 dev 下报 `does not provide an export named 'XXX'` 且整个案例模块加载失败（vue-tsc/build 均正常）。这些内部类在 `window.Cesium`（Build/CesiumUnminified）上确实存在。后续批次（V6 系统DEMO 林火案例）又补齐了 `GeographicTilingScheme`（栅格专题贴合地形的 tiling scheme）与 `ReferenceFrame`（`CallbackPositionProperty` 的参考系参数）。定位方法：dev 页面只报 module does not provide an export named 'X'，用错误里的符号名逐个补白名单即可，新增案例用到的每个 cesium 值导入都要对照 `CESIUM_SYMBOLS` 检查（`type` 导入会被擦除、不受影响）。
  - 访问未在 cesium 类型声明中导出的内部 API 的稳定写法：`import * as CesiumNamespace from 'cesium'`，再 `const X = (CesiumNamespace as unknown as Record<string, unknown>).X`；对实例方法可用 `(Cls as unknown as { method: (...) => T }).method(...)`。避免 `import { PassState } from 'cesium'`（build 期因无该导出而报错）。
  - `Cartesian3` 没有实例方法 `copy`（只有静态 `clone`/`clone(value, result)` 与 `fromRadians(..., result)`）；写成 `scratch.copy(vec)` 会在运行时抛 `copy is not a function`，`vue-tsc` 也会报 `Property 'copy' does not exist`。
  - 本项目统一的地形高度场契约（`src/cases/terrain-height-lib/grid.ts`）：`heights[row*N+col]`，row0=北、col0=西、取格子中心，无数据填 `NaN`；GPU 读回（FBO / pick 深度）得到的像素原点在左下，必须翻转行序后再写入。
  - Cesium `Rectangle` 内部字段 `west/east/south/north` 为**弧度**；自定义多边形顶点、`pointInPolygon`、`Rectangle.fromDegrees` 等界面/几何层一般用**度**。跨层计算前必须显式 `CesiumMath.toDegrees/toRadians` 统一单位，否则会出现「全部格点被判为区域外 → 结果全 NaN」这类整片失效（V6.47.1：`gridLonLat` 输出弧度与度为单位的顶点比较导致掩膜全灭）。排查方法：看结果统计的 `有效/空洞` 或掩膜像素占比，若掩膜数等于网格总数而原始 min/max 有值，即为单位/判定错误。
  - GeoTIFF 交付本批走自写编码器（`src/cases/terrain-height-lib/geotiff.ts`）：`geotiff` 2.1.3 的 `writeArrayBuffer` 只支持 8 位整数（内部 `BitsPerSample` 默认 `[8]`、`SampleFormat` 默认 `[1]`，传 Float32 会在 `DataView` 写出时抛 `Offset is outside the bounds of the DataView`），无法写浮点地形。自写编码只需：小端 `0x4949`+42、单 IFD、SHORT 单值内联 2 字节 / 其余 4 字节偏移、`ModelTiepoint=[0,0,0,west,north,0]`、`ModelPixelScale=[dLon,dLat,0]`、GeoKeyDirectory（1024/1025/2048/2049/2054）、`SampleFormat=3`、`GDAL_NODATA='nan'`。
  - TIFF 规范要求「总长 ≤4 字节的字段直接内联进 12 字节条目的值字段」（如 ASCII `GDAL_NODATA='nan\0'` 恰 4 字节）；此时若仍写偏移，geotiff.js 读取端会按内联解析把偏移字节当成字符串（读到 `"O\u0001\u0000\u0000"`）。故编码器对 ≤4 字节 ASCII 走内联分支。注意 `geotiff.js` 的 `getGDALNoData()` 对 `'nan'` 会 `parseFloat` 得 `NaN` 后返回 `null`，属读取库行为，文件标签本身正确。
  - GeoTIFF 正确性核验法（node + geotiff.js 读取）：断言 `width/height/size`、`SampleFormat=3`、`BitsPerSample=32`、`GeographicTypeGeoKey=4326`、`GeogAngularUnitsGeoKey=9102`；用 `(east-west)/size == ModelPixelScale[0]`、`(north-south)/size == ModelPixelScale[1]`、tiepoint 落西北角做自洽校验；再断言 `NaN` 像元数等于当次提取的掩膜数、`min/max` 与面板统计一致。

[Project Knowledge Summary]
- Date: 2026-09-18
- Context: 用户要求在项目根目录建立全量案例清单并实时维护
- Category: Workflow & Collaboration
- Instructions:
  - 根目录 `CASE_LIST.md` 记录全部展示案例（序号/案例名称/创建时间/文章输出/文章在线地址），由 `npm run case-list`（`scripts/gen-case-list.mjs`）扫描 `src/cases` 中非 `-lib` 且含 `index.ts` 的目录生成；案例名称取 index.ts 的 title。
  - 创建时间优先取案例 index.ts 的 `updatedAt`，缺失时保留清单中已有值（避免重新生成时因文件系统时间变化而打乱排序），新增案例才回退案例目录 / index.ts 的文件系统时间；文章输出与文章在线地址为人工维护列，重新生成时按案例名称保留，新增案例默认 ❌ 与空地址。
  - 维护约定：新增或移除案例后运行 `npm run sync` 与 `npm run case-list`；每产出一篇案例文章，将对应行文章输出改为 ✅ 并填写文章在线地址（先改 md 再运行脚本即可保留）。

[Project Knowledge Summary]
- Date: 2026-09-18
- Context: Discovered by Agent while batch-optimizing all case card icons
- Category: Build Methods
- Instructions:
  - 案例卡片 icon 统一规范：宽度 300px、高度等比（卡片实际展示尺寸，原始 ~1235px 宽的截图过大）；`src/cases/*/icon.*` 覆盖 webp/jpg/png 三种格式，重编码参数 webp/jpeg quality=82、png compressionLevel=9 + adaptiveFiltering。
  - 强制流程（2026-09-19 用户强调）：每次为案例设置/替换 icon 时，必须同步把上传原图压到 300px 宽再落入 `src/cases/<case>/icon.webp`，禁止直接提交原始大图；`land-use-suitability`、`terrain-roughness`、`terrain-ruggedness-index`、`terrain-wetness-index`、`urban-flood-risk` 曾因直接复制原图（~1236px、80-106KiB）返工。
  - 本机默认无 cwebp/ImageMagick；批量处理用全局 `sharp`（`npm install -g sharp`），ESM 脚本内用 `createRequire(import.meta.url)` + `NODE_PATH=$(npm root -g)` 加载；若 sharp 不可用，可用系统 Python 的 Pillow（`PIL.Image`，LANCZOS 缩放到 300px 宽后 `save(..., 'WEBP', quality=82, method=6)`），已验证本机 `python3` 自带 Pillow 12。
  - 重编码前用 `sharp(p).metadata()` 检查 `pages>1`（动图跳过），仅当原宽 >300 才处理，且新文件更小才覆盖，避免误伤已优化文件。

[Project Knowledge Summary]
- Date: 2026-09-19
- Context: Discovered by Agent while fixing three.quarks particle orientation over Cesium
- Category: Troubleshooting & Debugging
- Instructions:
  - **Cesium.Matrix4 构造函数参数为行优先**（前 4 个参数是第 0 行），但其内部数组存储为列优先；手写 ENU/ECEF 变换矩阵时必须按行优先填写，否则会得到转置矩阵（本项目 three.quarks 粒子整体朝向上下颠倒的根因）。
  - three(x,y,z) -> ENU(x,-z,y)（three +y 向上、+z 指向 ENU 东/北）的行优先矩阵为 `new Cesium.Matrix4(1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1)`；可用模拟投影脚本断言本地 up 方向投影后 ndc.y>0 做数值验证。

[Project Knowledge Summary]
- Date: 2026-09-20
- Context: Discovered by Agent while fixing quarks effect cases freezing on open
- Category: Troubleshooting & Debugging
- Instructions:
  - **three.quarks `prewarm: true` 会同步阻塞**：`ParticleSystem.update()` 首次执行时按 `PREWARM_FPS = 60` 循环 `duration * 60` 次调用自身（`node_modules/three.quarks/dist/three.quarks.esm.js` 中 `if (this.looping && this.prewarm && !this.prewarmed)`），全部在主线程一次性完成。duration 设 300~400 时是 18000~24000 次全粒子 update，案例一打开即卡死。
  - 约定：`duration` 对预热的连续发射系统只影响「loop 周期」与「预热模拟时长」，与视觉寿命无关；需预热时 `duration` 必须压到个位数（本项目统一常量 `PREWARM_DURATION = 4`，见 `src/cases/quarks-effects-lib/{storm,earth}-effects.ts`），loop 重置只清 burst 索引与 behavior 状态、不会杀死已存在粒子。
  - 另需控制默认粒子数：预热成本 ≈ `duration*60 * 粒子数`，粒数过大即使 duration 小也可能明显卡顿；评估性能时按该公式估算。

[User Instruction Summary]
- Date: 2026-09-20
- Context: 用户提交案例代码后明确要求
- Instructions:
  - 除用户明确指令「推送到仓库」外，一律不执行 `git push`，改动仅保留在本地；`git commit` 也仅在用户明确要求提交时执行。

[Project Knowledge Summary]
- Date: 2026-09-21
- Context: Discovered by Agent while fixing 火箭尾焰贯穿箭体 / 火箭朝向异常（showcase-effects.ts buildRocket）
- Category: Troubleshooting & Debugging
- Instructions:
  - **three.quarks `RenderMode.StretchedBillBoard` 的拉伸长度 = `speedFactor * |velocity| * avgSize`，方向是粒子速度的反方向**：`stretched_bb_particle_vert.glsl`（源码 `node_modules/three.quarks/src/shaders/stretched_bb_particle_vert.glsl.ts`）非 skew 分支为 `mvPosition.xyz -= (position.x+0.5)*viewVelocity*(1+lengthFactor/vlength)*avgSize`，`viewVelocity` 已乘 `speedFactor`（`SpriteBatch.ts` 打包 velocityBuffer），且**未归一化**。`speedFactor` 默认须慎用 1：速度 30~70、尺寸 5~10 时单条 streak 可达 150~700 单位，远超箭体（90 单位），表现为「火焰在火箭上方/贯穿箭体、看起来火箭倒置」。修复：把火焰/火花 `rendererEmitterSettings.speedFactor` 调到 0.07~0.1（按「目标尾长 ≈ speedFactor*|v|*size」估算），`lengthFactor` 影响很小（`1+lengthFactor/vlength`≈1）。
  - 火箭朝向本身无需修复：经真实渲染探针测量（`rocket-probe` + `Object3D.project`）确认 nose ndc.y > base ndc.y，箭体一直朝上；「朝向异常」是巨大尾焰 streak 覆盖箭体造成的视觉误判。真实渲染还发现发射台（不透明圆柱）会遮挡其下方的尾焰，故把 `padHeight` 7→4、pad 半径 34/40→26/30、火焰发射点 `baseY-3.5`→`baseY-1`，尾焰才能在点火阶段露出。

[Project Knowledge Summary]
- Date: 2026-09-21
- Context: Discovered by Agent while building headless visual probes for QuarksEffectDemo on Cesium
- Category: Troubleshooting & Debugging
- Instructions:
  - 无头渲染验证本项目的 quarks 案例：dev 模式下 `cesium` 被 `vite.config.ts` 的 `cesiumDevGlobal` 插件改写为全局 shim（`const Cesium = window.Cesium`），而 `index.html` 不含 Cesium.js 标签——`window.Cesium` 由 `App.vue` 在运行时动态 `document.createElement('script').src='cesium/Cesium.js'` 注入。自建探针页面必须①先注入 `/cesium/Cesium.js`（绝对路径，避免子目录页解析成相对路径 404）、②用动态 `import()` 再加载 runner（静态 import 会在 Cesium 就绪前触发 shim 报 `Cannot read properties of undefined (reading 'Appearance')`）。
  - chromium headless + SwiftShader 可在本环境渲染 WebGL2：apt 安装 `libglib2.0-0 libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libdrm2 libxcb1 libxkbcommon0 libasound2`，启动参数 `--no-sandbox --disable-dev-shm-usage --enable-unsafe-swiftshader`（`--use-gl=angle --use-angle=swiftshader` 组合在本机反而 Page crashed）。探针脚本可放 `/workspace/.monkeycode-tmp-files/*.html|.ts`（Vite 直接服务，gitignore 覆盖），页面阻塞 Bing/Cesium 影像请求减负。
  - 探针页可直接 `new QuarksEffectRunner(...)` 并把实例挂到 `window`（TS private 字段运行时仍是普通属性），再在 Playwright 内读 `runner.layer.camera.matrixWorld`、`runner.built.systems[i].particles[j].position/velocity` 做数值断言与 `Object3D.project` 投影验证——比截图肉眼判断可靠。
  - 更省事的集成截图探针（无需自建页面）：`npm install -g playwright` 后直接驱动已装好的 chromium（`executablePath: '/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome'`，避免版本匹配），`page.goto('http://localhost:5173')` → `fill('input[type="search"]', '<案例名>')` → `click('.demo-card')` → 等待 10~25s → `page.screenshot()`。首次启动会因缺库报 `error while loading shared libraries`，除上面那批还需补 `libcups2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libatk1.0-0 libatk-bridge2.0-0`；headless 无 CJK 字体，中文显示为方块属正常。SwiftShader 下 FPS 只有 1~3，不能用来判断真机性能，只能验证「无 pageerror / shader 正常编译 / 画面构图正确」。
  - 探针里真实地球（Cesium globe + Bing 影像）是否出现不稳定：控制台出现 Bing `403` 时整块 globe 瓦片可能一张都不渲染，画面背景为纯黑（连 `globe.baseColor #152b4c` 都没有，因为是按 tile 渲染，无 tile 即无面）；同一批探针里近地视角（星轨、点云地球态）常能正常显示，而高空/远景（黑洞、星云态）易全黑。因此**不能据探针黑背景判定「真实地球缺失」**，应以相机几何是否把地球纳入视锥来推理，或用真实浏览器复验。

[User Instruction Summary]
- Date: 2026-09-22
- Context: 用户指出系统DEMO 模块的案例界面布局与其他模块不一致，要求按完整系统规范重做
- Instructions:
  - 「系统DEMO」分类下的案例必须呈现为**完整业务系统**形态，页面布局符合常规系统规范：自带系统标题栏（系统名/运行状态/工具按钮）、左侧参数与图层侧栏、中间地图主视图、右侧指标与图例面板、底部状态栏（时间轴/播放控制/状态文本），不使用其他模块的「标题区 + 圆角外框 + 悬浮弹窗面板」形式。
  - 实现约定（已落地）：`App.vue` 在案例 `category === 'system'` 时给 `.case-page` 加 `is-system`，由 `src/style.css` 的 `.case-page.is-system *` 规则隐藏 `.case-heading`、把 `.case-content/.case-stage` 改为满屏无内边距无圆角，并在案例页顶栏为系统案例提供「返回案例库」按钮；系统案例组件自身负责铺满舞台并渲染上述系统级区域。非 system 分类案例的原有布局必须保持不变。
  - 后续新增系统DEMO 案例时沿用同一套系统外壳（顶部标题栏 + 左右侧栏 + 底部状态栏）与配色语言，保持模块内视觉一致。

[Project Knowledge Summary]
- Date: 2026-09-23
- Context: Discovered by Agent while headless-verifying the fire-spread system demo (Round③ 北斗网格 / 隔离带 / 算法说明)
- Category: Troubleshooting & Debugging
- Instructions:
  - 本机 headless Playwright 驱动持续渲染的 Cesium 案例页时，侧栏 DOM 按钮的 `locator.click()` 会反复卡在 actionability 检查并超时（即使 `isVisible/enabled/boundingBox` 均正常、`elementFromPoint` 命中的就是该按钮）；改用 `locator.evaluate(el => el.click())` 或 `page.mouse.click(box 中心)` 即稳定生效。range/select 同理，直接 `evaluate` 设 `value` + `dispatchEvent(new Event('input'|'change', {bubbles:true}))`。
  - 同一 headless 浏览器长时间跑「加载案例 + 多次 `page.screenshot`」会累积渲染压力并最终 page crash（报 `Target page, context or browser has been closed`，无 pageerror）。验证脚本应把截图压到 1~2 张、把弹窗开关等断言放在截图之前，每个功能点拆成独立短脚本执行。

[User Instruction Summary]
- Date: 2026-09-24
- Context: 用户在 CESIUM-TREASURE-BOX 项目协作中明确要求
- Instructions:
  - 后续所有回复与推理过程强制使用中文（Simplified Chinese）。
  - 案例代码提交前必须通过 TS 门禁 `npm run build`（`npx vue-tsc -b` 会 OOM）；仅用户明确「推送到仓库」才 `git push`，仅明确要求时才 `git commit`。

