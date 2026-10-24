# 开发指南

## 启动

```bash
npm run dev
```

## 构建验证

```bash
npm run build
git diff --check
```

## 质量门禁

```bash
# lint + 格式检查 + 依赖审计 + 许可证白名单 + lockfile 一致性
npm run quality

# 构建结束后单独复核 bundle 预算（npm run build 已自动调用）
npm run bundle:check
```

`npm run build` 为 Vite 构建分配 3 GB 堆，随后执行 `scripts/check-bundle.mjs`：入口 JS 上限 400 kB / gzip 150 kB，初始 CSS 上限 120 kB，任意懒加载 chunk 上限 800 kB / gzip 250 kB。超限直接失败，避免首屏或单个案例无约束膨胀。

`lint` 覆盖演示产品内核（`src/cases/presentation-studio-lib`）、`App.vue`、运行时配置、质量脚本与测试，历史案例目录不参与门禁以免制造批量无关改动。`audit` 仅拦截 high/critical，`xlsx` 0.18.5 无 npm 修复版本且只解析用户选择的本地工作簿，已在 `scripts/security-audit.mjs` 中登记为例外；`licenses` 允许宽松许可证及带宽松分支的双许可（如 `MIT OR GPL-3.0-or-later`），禁止单独使用的 GPL/AGPL/SSPL/MPL/EPL。CI 使用 `npm ci` 安装并以该门禁作为构建前置条件。

## 输出与回归测试

```bash
# Schema、时间轴、轨道和工程包纯函数自检
npm run test:studio

# 安装浏览器后运行画面黄金图、逐帧确定性和真实编码解码测试
npx playwright install --with-deps chromium firefox
npm run test:output

# 双浏览器矩阵
E2E_BROWSERS=chromium,firefox npm run test:output

# 画面基线变更后更新黄金图
npm run test:output:update
```

`test:output` 使用本机 `ffmpeg`/`ffprobe` 校验实时导出文件；缺少工具时实时测试会跳过。黄金图基线位于 `tests/output/output.spec.mjs-snapshots/`，仅由 Chromium 维护，Firefox 共享逐帧与编码断言。

## 性能与可观测性

演示产品在运行时维护三个只读诊断入口，便于在浏览器控制台或 Playwright 中取证：

- `window.__STUDIO_DIAGNOSTICS__`：最近 200 条结构化事件，覆盖 `resource`、`storage`、`orchestration`、`export` 四条链路，包含时间、级别和上下文。
- `window.__STUDIO_LONG_TASKS__`：Chromium 下超过 50 ms 的主线程长任务样本，最多保留 100 条。
- `window.__STUDIO_BOOT_MS__`：从创建 Vue 应用到首帧挂载的耗时。

场景图层、地形、3D Tiles、影像加载失败，存储读写降级/损坏，工程导入/保存/恢复，以及导出的启动/取消/失败都会写入诊断事件。生产排查时先读取该数组，再结合 `storageDiagnostics()` 的配额信息定位问题。

## 可靠性与长时运行

```bash
# 断网 + 服务失效下的编辑器长时运行，默认 30 秒
SOAK_SECONDS=120 npm run test:soak
```

`tests/soak/soak.spec.mjs` 会阻断所有非本机请求，打开演示编辑器，循环播放、单帧步进和步骤切换，并记录诊断事件、主线程长任务与页面异常。`.github/workflows/soak.yml` 每周一自动运行 120 秒版本，失败时上传 `test-results/`。

## 容器部署

```bash
# 构建镜像，BASE_URL 同时影响 Vite 资源前缀
docker build --build-arg BASE_URL=/ -t cesium-studio .

# 运行时注入公共配置，无需重新构建前端
docker run -p 8080:80 \
  -e APP_TITLE="Cesium酱の百宝箱" \
  -e API_BASE_URL="" \
  -e CESIUM_ION_TOKEN="" \
  cesium-studio
```

本项目保持纯前端实现，工程数据保存在浏览器 IndexedDB/localStorage，导出在浏览器内完成。涉及云端同步、协作、素材管理或视频编码的外部能力统一使用本地模拟数据或浏览器内处理，不引入后端服务、数据库或 Docker 运行依赖。

`nginx.conf` 对 `assets/` 使用一年 immutable 缓存，对 `runtime-config.js` 禁用缓存，SPA 路由回退到 `index.html`。`docker/entrypoint.sh` 在容器启动时重写 `runtime-config.js`。

## 新增案例

1. 在 `src/cases/<case-name>/` 创建 Vue 组件和 `index.ts`（目录名即案例 id，避免与 id 不一致）。
2. 运行 `npm run sync`：自动扫描目录生成 `src/cases/manifest.ts`（元数据 + 惰性 loaders），无需手工改动中央文件。以 `-lib` 结尾的目录被识别为共享库自动排除。
3. 使用 `createMapScene` 与 `destroyScene` 管理 Cesium 生命周期。
4. 为需求变更更新 `.monkeycode/specs/` 与 `docs/system-iteration-log.md`。

首页与 Cesium 解耦：Cesium.js 仅在用户首次悬停卡片或打开案例时按需注入，案例组件为异步 chunk，新增案例不影响首屏加载体积。
