<script setup lang="ts">
import { Close } from '@element-plus/icons-vue'

type Part = { label: string; text: string; type: 'phenomenon' | 'cause' | 'check' | 'solution' }
type Entry = { num: number; title: string; badge?: string; parts: Part[]; code?: string[] }
type Section = { id: string; title: string; desc: string; entries: Entry[] }

const LABEL_TEXT: Record<Part['type'], string> = {
  phenomenon: '现象：',
  cause: '原因：',
  check: '排查：',
  solution: '方案：'
}

const sections: Section[] = [
  {
    id: 'sec-tools',
    title: '一、工具准备：先定位，再动手',
    desc: '在动手优化之前，先用数据定位瓶颈。这三条帮你建立「可度量」的排查习惯。',
    entries: [
      {
        num: 1,
        title: '打开 FPS 与渲染调试面板',
        badge: '现象 → 数据',
        parts: [
          { label: '现象', text: '卡顿说不清是掉帧还是加载慢。', type: 'phenomenon' },
          { label: '排查', text: '开启内置调试信息，用数据代替感觉。', type: 'check' },
          { label: '方案', text: 'FPS 稳定低于 30 走渲染类清单（4–9），FPS 正常但拖动卡顿走数据类清单（10–15）。', type: 'solution' }
        ],
        code: [
          '// 构造时打开',
          "const viewer = new Cesium.Viewer('cesiumContainer', {",
          '  showFramesPerSecond: true',
          '});',
          '',
          '// 运行时打开',
          'viewer.scene.debugShowFramesPerSecond = true;  // FPS',
          'viewer.scene.debugShowGlobeDepth = true;       // 深度缓冲可视化',
          'viewer.scene.debugShowPrimitives = true;       // 图元包围盒'
        ]
      },
      {
        num: 2,
        title: '用 Chrome Performance 录制定位瓶颈',
        badge: '火焰图',
        parts: [
          { label: '现象', text: '分不清是主线程 JS 忙，还是 GPU 渲染慢。', type: 'phenomenon' },
          { label: '排查', text: 'F12 → Performance → 点录制 → 拖动场景 5 秒 → 停止，看火焰图中 Scripting（JS 逻辑）、Rendering（合成）、GPU 三条条带占比。', type: 'check' },
          { label: '方案', text: 'JS 占大头 → 查第 16–20 条；GPU 占大头 → 查第 4–9 条；网络等待（灰色长条）→ 查第 14–15 条。', type: 'solution' }
        ]
      },
      {
        num: 3,
        title: '统计 drawcall 与图元数量',
        badge: '渲染量',
        parts: [
          { label: '现象', text: '知道卡，不知道有多少东西在渲染。', type: 'phenomenon' },
          { label: '排查', text: '通过 viewer.scene.debugShowPrimitives 或 Chrome 的 WebGL 面板查看 drawcall 数量。', type: 'check' },
          { label: '方案', text: 'drawcall 上千且持续增长 → 对象未销毁（第 18 条）；drawcall 高但 primitive 数少 → 单个图元太重（第 12、13 条）。', type: 'solution' }
        ]
      }
    ]
  },
  {
    id: 'sec-render',
    title: '二、全局渲染：让 GPU 少干活',
    desc: '6 条全局层面的渲染优化，从「渲染策略」上降低 GPU 负载。',
    entries: [
      {
        num: 4,
        title: '未开启按需渲染，静态场景 GPU 空转',
        badge: 'requestRenderMode',
        parts: [
          { label: '原因', text: 'Cesium 默认每帧都渲染，场景静止时 GPU 也在满负荷工作。', type: 'cause' },
          { label: '排查', text: '画面不动时，任务管理器 GPU 占用仍居高不下。', type: 'check' }
        ],
        code: [
          "const viewer = new Cesium.Viewer('cesiumContainer', {",
          '  // 只在场景变化时才渲染',
          '  requestRenderMode: true,',
          '  // 兜底帧率，避免操作后疯狂渲染',
          '  targetFrameRate: 30,',
          '  // 超过此变化幅度才触发重绘',
          '  maximumRenderTimeChange: 1.0',
          '});',
          '',
          '// 数据加载、相机移动等主动刷新',
          'viewer.scene.requestRender();'
        ]
      },
      {
        num: 5,
        title: 'resolutionScale / 像素比过高',
        badge: '像素比',
        parts: [
          { label: '原因', text: '默认按设备最大像素比渲染，Retina 屏 2× / 3× 的渲染量是 4～9 倍。', type: 'cause' },
          { label: '排查', text: '清晰度正常但 GPU 占用高；放大截图像素点正常。', type: 'check' }
        ],
        code: [
          '// 方案一：全局缩放渲染分辨率（0.5 即按一半像素渲染，肉眼几乎无差）',
          'viewer.resolutionScale = 0.5;',
          '',
          '// 方案二：构造参数限制上限（1.106+ 版本）',
          "new Cesium.Viewer('cesiumContainer', {",
          '  maximumScaleFactor: 1.5',
          '});'
        ]
      },
      {
        num: 6,
        title: '抗锯齿级别开太高',
        badge: 'MSAA / FXAA',
        parts: [
          { label: '原因', text: 'msaaSamples 每翻倍，GPU 填充率开销大幅上升。', type: 'cause' },
          { label: '排查', text: '边缘平滑但 FPS 低、GPU 占用持续 100%。', type: 'check' }
        ],
        code: [
          '// 优先用 FXAA 或关掉 MSAA，二选一即可',
          'viewer.scene.msaaSamples = 0;   // 关闭 MSAA',
          'viewer.scene.fxaa = true;       // 开启快速近似抗锯齿'
        ]
      },
      {
        num: 7,
        title: '阴影与光照开销过大',
        badge: 'ShadowMap',
        parts: [
          { label: '原因', text: '阴影需要把场景额外渲染多遍（shadowmap），分辨率和光源数量决定成本。', type: 'cause' },
          { label: '排查', text: '关闭 shadowMap 后 FPS 大幅回升。', type: 'check' }
        ],
        code: [
          'viewer.shadowMap.enabled = true;            // 需要时再开',
          'viewer.shadowMap.size = 1024;               // 默认 2048，降至 1024 性能翻倍',
          'viewer.shadowMap.maximumDistance = 2000;    // 缩小阴影可视距离'
        ]
      },
      {
        num: 8,
        title: '视锥 far 平面过大 + 雾效未开启',
        badge: '视锥 / 雾效',
        parts: [
          { label: '原因', text: 'far 设成 100 万米，远处物体全都在渲染列表里，白白剔除不掉。', type: 'cause' },
          { label: '排查', text: '相机平视远处时 FPS 骤降。', type: 'check' }
        ],
        code: [
          '// 收紧远平面，超出范围的物体直接不渲染',
          'viewer.scene.camera.frustum.far = 10000;',
          '',
          '// 用雾效兜底隐藏远处细节，减少 LOD 细化压力',
          'viewer.scene.fog.enabled = true;',
          'viewer.scene.fog.density = 0.0002;',
          'viewer.scene.fog.screenSpaceErrorFactor = 2.0;'
        ]
      },
      {
        num: 9,
        title: '后处理特效叠加过重',
        badge: 'PostProcess',
        parts: [
          { label: '原因', text: 'PostProcessStage（泛光、描边、景深等）每个都是一次全屏 pass，多个叠加帧率成倍下降。', type: 'cause' },
          { label: '排查', text: '逐个 stage.enabled = false，找到影响最大的那个。', type: 'check' },
          { label: '方案', text: '一次最多保留 1～2 个后处理；全屏泛光用低分辨率纹理实现，别叠加同类效果。', type: 'solution' }
        ]
      }
    ]
  },
  {
    id: 'sec-data',
    title: '三、数据与加载：让数据更轻',
    desc: '6 条关于数据组织和加载的策略，从「数据源头」减少渲染压力。',
    entries: [
      {
        num: 10,
        title: 'Entity 数量爆炸，未改用 Primitive',
        badge: 'Entity → Primitive',
        parts: [
          { label: '原因', text: 'Entity 数量级是「给业务用的」，几千个就拖垮帧率；Primitive 是「给渲染用的」，几万个才吃紧。', type: 'cause' },
          { label: '排查', text: 'viewer.entities 数量过千且 FPS 低。', type: 'check' },
          { label: '方案', text: '海量点/线/面改 Primitive（如 PointPrimitiveCollection），或聚合 EntityCluster。', type: 'solution' }
        ],
        code: [
          '// 十万级点位用 PointPrimitiveCollection',
          'const points = new Cesium.PointPrimitiveCollection();',
          'viewer.scene.primitives.add(points);',
          '',
          'for (let i = 0; i < 100000; i++) {',
          '  points.add({',
          '    position: Cesium.Cartesian3.fromDegrees(lon[i], lat[i]),',
          '    color: Cesium.Color.WHITE,',
          '    pixelSize: 3',
          '  });',
          '}'
        ]
      },
      {
        num: 11,
        title: '3D Tiles 的 maximumScreenSpaceError 设太小',
        badge: 'SSE',
        parts: [
          { label: '原因', text: 'maximumScreenSpaceError 控制「屏幕误差容忍度」，默认 16。设成 2～4 会让瓦片疯狂细化，请求量和渲染量爆炸。', type: 'cause' },
          { label: '排查', text: 'Network 面板瓦片请求刷屏、加载后内存持续高位。', type: 'check' }
        ],
        code: [
          'tileset.maximumScreenSpaceError = 32;   // 静态展示 16～32',
          'tileset.maximumScreenSpaceError = 64;   // 动态漫游可放宽',
          'tileset.dynamicScreenSpaceError = true; // 相机动时自动放宽'
        ]
      },
      {
        num: 12,
        title: '模型数据未经压缩 / 优化',
        badge: 'Draco / KTX2',
        parts: [
          { label: '原因', text: 'glTF 顶点数据不压缩、纹理不压缩，网络与 GPU 双重压力。', type: 'cause' },
          { label: '排查', text: '单瓦片模型文件几十 MB；下载耗时占加载时间大头。', type: 'check' },
          { label: '方案', text: 'glTF 转 Draco / Meshopt 压缩几何；纹理转 KTX2 压缩格式；倾斜摄影用 Cesium ion 或离线工具统一生成 3D Tiles。', type: 'solution' }
        ]
      },
      {
        num: 13,
        title: '相同模型被重复加载 N 次',
        badge: '实例化',
        parts: [
          { label: '原因', text: '1000 棵树 = 1000 次 model 加载 + 1000 个 drawcall，完全可以实例化。', type: 'cause' },
          { label: '排查', text: '同 URL 模型反复出现在 Network 面板。', type: 'check' },
          { label: '方案', text: '使用 ModelInstanceCollection 实例化复用 (1.125+)，或用 Cesium3DTileset 承载重复模型。', type: 'solution' }
        ],
        code: [
          "const instances = new Cesium.ModelInstanceCollection({",
          "  url: '/models/tree.glb'",
          '});',
          'viewer.scene.primitives.add(instances);',
          '',
          'instances.add({',
          '  transform: Cesium.Matrix4.fromTranslation(',
          '    Cesium.Cartesian3.fromDegrees(lon, lat, height)',
          '  )',
          '});'
        ]
      },
      {
        num: 14,
        title: '影像 / 地形图层叠加过多或分辨率过高',
        badge: '底图',
        parts: [
          { label: '原因', text: '每个底图图层都在并行请求瓦片；高清影像瓦片 (512/1024px) 数据量成倍。', type: 'cause' },
          { label: '排查', text: 'Network 面板瓦片请求数量与加载时间不匹配。', type: 'check' },
          { label: '方案', text: '按需切换底图而不是全部常驻；非必要不用 1m 分辨率影像；服务端开启 gzip、瓦片走 CDN 缓存。', type: 'solution' }
        ]
      },
      {
        num: 15,
        title: '瓦片风暴：单帧请求过多阻塞',
        badge: '请求风暴',
        parts: [
          { label: '原因', text: '镜头快速飞行时，同一时间发出上千个瓦片请求，浏览器并发连接（每域名约 6 个）全部排队，主线程也被阻塞。', type: 'cause' },
          { label: '排查', text: 'Network 面板出现「请求瀑布」，长时间 pending；服务端抛大量 429。', type: 'check' },
          { label: '方案', text: '控制相机飞行速度与距离；用 camera.flyTo 分阶段而非一口气拉近；提高 maximumScreenSpaceError 减少细节请求；服务端做预缓存。', type: 'solution' }
        ]
      }
    ]
  },
  {
    id: 'sec-code',
    title: '四、代码逻辑与内存：把代码写干净',
    desc: '5 条关于代码质量和内存管理的建议，从「工程层面」根治卡顿。',
    entries: [
      {
        num: 16,
        title: '动态数据重建 Entity，而非更新属性',
        badge: 'CallbackProperty',
        parts: [
          { label: '原因', text: '每帧 entities.add() 创建新对象，几秒钟后场景里有几千个废弃实体在累积。', type: 'cause' },
          { label: '排查', text: 'viewer.entities 数量随运行时间只增不减。', type: 'check' },
          { label: '方案', text: '固定对象、更新属性；高频点位用 CallbackProperty。', type: 'solution' }
        ],
        code: [
          'const marker = viewer.entities.add({',
          '  position: new Cesium.CallbackProperty(function () {',
          '    return Cesium.Cartesian3.fromDegrees(currentLon, currentLat);',
          '  }, false) // false: 不是随时间变化的量，命中缓存',
          '});',
          '',
          '// 只改数据，不重建对象',
          'currentLon = 116.39;',
          'currentLat = 39.91;'
        ]
      },
      {
        num: 17,
        title: 'clampToGround / heightReference 大量使用',
        badge: '贴地采样',
        parts: [
          { label: '原因', text: '贴地物每帧要做地形高度采样（clamp），几千个贴地 billboard 就是几千次射线求交。', type: 'cause' },
          { label: '排查', text: '大量 heightReference: Cesium.HeightReference.CLAMP_TO_GROUND 的实体。', type: 'check' },
          { label: '方案', text: '静态贴地物预采样高度，存为固定 height；动态贴地物数量控制在百级以内，或用 GroundPrimitive 一次性渲染。', type: 'solution' }
        ]
      },
      {
        num: 18,
        title: '定时器、监听器、实体未销毁（内存泄漏）',
        badge: '内存泄漏',
        parts: [
          { label: '原因', text: 'SPA 切页后旧的 setInterval、entities、primitives、事件监听还活着，页面越来越卡。', type: 'cause' },
          { label: '排查', text: 'Performance 录制内存曲线只升不降；viewer.entities 数量在页面切换后未归零。', type: 'check' }
        ],
        code: [
          'function destroyScene() {',
          '  clearInterval(timer);                    // 清定时器',
          '  viewer.entities.removeAll();             // 清实体',
          '  viewer.scene.primitives.removeAll();     // 清图元',
          '  viewer.trackedEntity = undefined;        // 解绑跟踪',
          '  viewer.scene.postUpdate.removeEventListener(fn); // 移除监听',
          '  viewer.destroy();                        // 释放 WebGL 上下文',
          '  viewer = undefined;',
          '}'
        ]
      },
      {
        num: 19,
        title: '高频 setInterval 驱动渲染',
        badge: '渲染循环',
        parts: [
          { label: '原因', text: '用 50ms 的 setInterval 刷新数据或强制渲染，人眼和 GPU 都跟不上，主线程还被打断。', type: 'cause' },
          { label: '排查', text: '代码里找 setInterval / setTimeout 高频调用 + requestRender。', type: 'check' },
          { label: '方案', text: '数据推送按需更新，渲染交给 Cesium 自己的渲染循环；同屏动态对象分帧更新（每帧只更新 1/N）。', type: 'solution' }
        ]
      },
      {
        num: 20,
        title: '每帧回调里做重活',
        badge: 'preUpdate / postUpdate',
        parts: [
          { label: '原因', text: '在 preUpdate / postUpdate / scene.camera.moveEnd 回调里做数组深拷贝、大数组遍历、Cartesian3.fromDegrees 批量转换，帧率直接崩塌。', type: 'cause' },
          { label: '排查', text: '火焰图中 Scripting 段出现锯齿状高频小峰。', type: 'check' },
          { label: '方案', text: '把逻辑丢到事件驱动的回调（moveEnd、数据到达时）而非每帧；坐标转换结果缓存复用；重计算放 Web Worker。', type: 'solution' }
        ]
      }
    ]
  }
]

const quickRef: [string, string][] = [
  ['静止时 GPU 高', '按需渲染 / 像素比 / 抗锯齿  4、5、6'],
  ['一拖就卡', '瓦片风暴 / far 平面 / 阴影  8、15、7'],
  ['卡但不掉帧', '网络加载 / 数据体量  11、12、14'],
  ['越用越卡', '内存泄漏 / 对象未销毁  16、18'],
  ['FPS 低但画面简单', '后处理 / 实例化不足  9、13']
]

function scrollTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
}
</script>

<template>
  <div class="pc-page">
    <header class="pc-topbar">
      <div class="pc-brand">
        <div class="pc-brand-mark">C</div>
        <div>
          <p class="pc-brand-name">Cesium酱の百宝箱</p>
          <p class="pc-brand-sub">CesiumJS 卡顿排查清单</p>
        </div>
      </div>
      <button class="pc-back" @click="$emit('close')"><el-icon><Close /></el-icon>返回案例库</button>
    </header>

    <div class="pc-body">
      <aside class="pc-side">
        <div class="pc-side-title">目 录</div>
        <a v-for="sec in sections" :key="sec.id" class="pc-side-item" @click="scrollTo(sec.id)">{{ sec.title.split('：')[0] }}</a>
        <a class="pc-side-item" @click="scrollTo('quick-ref')">附：速查表</a>
      </aside>

      <div class="pc-content">
      <div class="pc-hero">
        <p class="pc-eyebrow">PERFORMANCE CHECKLIST</p>
        <h1>CesiumJS 场景卡顿排查 20 条清单</h1>
        <p class="pc-sub">难度级别：深度 · 核心关键词：性能排查、渲染优化、3D Tiles、内存管理、requestRenderMode</p>
        <div class="pc-meta">
          <span><b>版本：</b>CesiumJS 1.144.0 (Vite)</span>
          <span><b>环境：</b>Chrome + Windows / macOS</span>
          <span><b>使用方式：</b>按序排查，先定位瓶颈再动手改</span>
        </div>
      </div>

      <section v-for="sec in sections" :id="sec.id" :key="sec.id" class="pc-card">
        <h2 class="pc-section-title">{{ sec.title }}</h2>
        <p class="pc-section-desc">{{ sec.desc }}</p>
        <article v-for="e in sec.entries" :key="e.num" class="pc-entry">
          <div class="pc-entry-title">
            <span class="pc-num">{{ e.num }}</span>
            {{ e.title }}
            <span v-if="e.badge" class="pc-badge">{{ e.badge }}</span>
          </div>
          <div class="pc-entry-body">
            <p v-for="(p, i) in e.parts" :key="i">
              <span class="pc-label" :class="'pc-' + p.type">{{ LABEL_TEXT[p.type] }}</span>{{ p.text }}
            </p>
            <div v-if="e.code" class="pc-code">
              <span class="pc-code-tag">JavaScript</span>
              <pre><code><span v-for="(line, li) in e.code" :key="li">{{ line }}</span></code></pre>
            </div>
          </div>
        </article>
      </section>

      <section id="quick-ref" class="pc-card">
        <h2 class="pc-section-title">附：排查速查表</h2>
        <p class="pc-section-desc">按症状快速定位到对应条目，高效排查。</p>
        <div class="pc-table-wrap">
          <table>
            <thead>
              <tr><th>症状</th><th>优先排查清单条目</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in quickRef" :key="i">
                <td><b>{{ row[0] }}</b></td>
                <td>{{ row[1] }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="pc-tip"><b>建议：</b>按表从上到下逐条排查，每改一处用 showFramesPerSecond 记录前后 FPS，确认有效再动下一条。<br />没有银弹，只有权衡——在功能、性能、效果之间找到最佳平衡点。</p>
      </section>

      <footer class="pc-footer">
        <p>CesiumJS 场景卡顿排查 20 条清单 · 在线版 · 按序排查，先定位瓶颈再动手改</p>
      </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pc-page { position: fixed; inset: 0; z-index: 200; display: flex; flex-direction: column; background: linear-gradient(160deg, #0b1a33 0%, #0e2038 55%, #122a4a 100%); color: #dce8f5; }
.pc-topbar { display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 20px; background: rgba(8, 21, 40, 0.92); border-bottom: 1px solid rgba(157, 188, 224, 0.18); backdrop-filter: blur(8px); }
.pc-brand { display: flex; align-items: center; gap: 10px; }
.pc-brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: linear-gradient(135deg, #2f80ed, #38b6ff); color: #fff; font-size: 15px; font-weight: 800; }
.pc-brand-name { font-size: 13px; font-weight: 700; line-height: 1.2; }
.pc-brand-sub { font-size: 10px; color: #7f96b3; line-height: 1.2; }
.pc-back { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid rgba(157, 188, 224, 0.3); border-radius: 7px; background: rgba(47, 128, 237, 0.14); color: #dce8f5; font-size: 12px; cursor: pointer; transition: background 0.2s; }
.pc-back:hover { background: rgba(47, 128, 237, 0.3); }
.pc-body { flex: 1; display: flex; align-items: flex-start; overflow-y: auto; padding: 24px 20px 40px; }
.pc-body::-webkit-scrollbar { width: 8px; }
.pc-body::-webkit-scrollbar-thumb { background: rgba(157, 188, 224, 0.25); border-radius: 4px; }
.pc-side { position: sticky; top: 24px; flex: 0 0 200px; margin-right: 18px; padding: 12px 10px; border-radius: 12px; background: rgba(13, 32, 62, 0.78); border: 1px solid rgba(157, 188, 224, 0.18); }
.pc-side-title { margin: 2px 10px 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: #7f96b3; }
.pc-side-item { display: block; padding: 7px 10px; margin: 2px 0; border-radius: 7px; font-size: 12px; color: #c3d5e8; cursor: pointer; transition: background 0.15s; }
.pc-side-item:hover { background: rgba(47, 128, 237, 0.25); color: #dce8f5; }
.pc-content { flex: 1; min-width: 0; max-width: 1080px; }
.pc-hero { padding: 30px 34px; border-radius: 16px; background: linear-gradient(135deg, rgba(47, 128, 237, 0.2), rgba(20, 42, 82, 0.4)); border: 1px solid rgba(157, 188, 224, 0.22); }
.pc-eyebrow { font-size: 10px; letter-spacing: 0.18em; color: #65d3eb; font-weight: 700; }
.pc-hero h1 { margin: 6px 0 8px; font-size: 26px; font-weight: 800; letter-spacing: -0.3px; }
.pc-sub { font-size: 12px; color: #9fb3cd; }
.pc-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 14px; }
.pc-meta span { padding: 3px 12px; border-radius: 20px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(157, 188, 224, 0.16); font-size: 11px; color: #b8c9de; }
.pc-meta b { color: #65d3eb; }
.pc-card { margin: 0 0 20px; padding: 24px 28px; border-radius: 14px; background: rgba(13, 32, 62, 0.78); border: 1px solid rgba(157, 188, 224, 0.18); }
.pc-section-title { display: inline-block; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 3px solid #2f80ed; font-size: 18px; font-weight: 800; color: #f0f6ff; }
.pc-section-desc { margin-bottom: 20px; padding: 8px 14px; border-left: 4px solid #2f80ed; border-radius: 6px; background: rgba(47, 128, 237, 0.1); color: #9fb3cd; font-size: 12px; }
.pc-entry { margin-bottom: 22px; padding-bottom: 20px; border-bottom: 1px dashed rgba(157, 188, 224, 0.18); }
.pc-entry:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: 0; }
.pc-entry-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-bottom: 10px; font-size: 15px; font-weight: 700; color: #f0f6ff; }
.pc-num { display: inline-block; padding: 1px 10px; border-radius: 20px; background: #2f80ed; color: #fff; font-size: 11px; font-weight: 800; }
.pc-badge { padding: 1px 10px; border-radius: 20px; background: rgba(157, 188, 224, 0.14); border: 1px solid rgba(157, 188, 224, 0.24); color: #9fb3cd; font-size: 10px; font-weight: 500; }
.pc-entry-body { color: #b8c9de; font-size: 13px; line-height: 1.75; }
.pc-entry-body p { margin: 4px 0; }
.pc-label { margin-right: 4px; font-weight: 700; }
.pc-phenomenon { color: #e0a94d; }
.pc-cause { color: #e57373; }
.pc-check { color: #64b5f6; }
.pc-solution { color: #81c784; }
.pc-code { position: relative; margin: 10px 0 6px; border-radius: 10px; overflow: hidden; background: #0d1830; border: 1px solid rgba(157, 188, 224, 0.16); }
.pc-code-tag { position: absolute; top: 8px; right: 14px; font-size: 10px; font-weight: 600; color: rgba(220, 232, 245, 0.35); letter-spacing: 0.5px; }
.pc-code pre { margin: 0; padding: 14px 18px; font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace; font-size: 12px; line-height: 1.65; color: #cfe0f2; white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
.pc-code code { font-family: inherit; color: inherit; }
.pc-table-wrap { margin: 12px 0; overflow-x: auto; border-radius: 10px; border: 1px solid rgba(157, 188, 224, 0.18); }
.pc-table-wrap table { width: 100%; border-collapse: collapse; font-size: 12px; }
.pc-table-wrap th, .pc-table-wrap td { padding: 10px 14px; text-align: left; border-bottom: 1px solid rgba(157, 188, 224, 0.12); }
.pc-table-wrap th { background: rgba(47, 128, 237, 0.16); color: #dce8f5; font-weight: 700; }
.pc-table-wrap td { color: #b8c9de; }
.pc-table-wrap tr:last-child td { border-bottom: 0; }
.pc-tip { margin: 14px 0 0; padding: 10px 14px; border-radius: 8px; background: rgba(101, 211, 235, 0.08); border: 1px solid rgba(101, 211, 235, 0.2); color: #9fb3cd; font-size: 12px; line-height: 1.7; }
.pc-tip b { color: #65d3eb; }
.pc-footer { margin: 8px 0 0; text-align: center; color: #5f7896; font-size: 11px; }
@media (max-width: 860px) {
  .pc-body { flex-direction: column; }
  .pc-side { position: static; flex: none; width: 100%; display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; padding: 10px; }
  .pc-side-title { flex: 1 1 100%; }
  .pc-side-item { padding: 6px 12px; }
}
</style>
