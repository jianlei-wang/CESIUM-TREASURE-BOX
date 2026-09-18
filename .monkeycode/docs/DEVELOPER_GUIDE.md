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

## 新增案例

1. 在 `src/cases/<case-name>/` 创建 Vue 组件和 `index.ts`（目录名即案例 id，避免与 id 不一致）。
2. 运行 `npm run sync`：自动扫描目录生成 `src/cases/manifest.ts`（元数据 + 惰性 loaders），无需手工改动中央文件。以 `-lib` 结尾的目录被识别为共享库自动排除。
3. 使用 `createMapScene` 与 `destroyScene` 管理 Cesium 生命周期。
4. 为需求变更更新 `.monkeycode/specs/` 与 `docs/system-iteration-log.md`。

首页与 Cesium 解耦：Cesium.js 仅在用户首次悬停卡片或打开案例时按需注入，案例组件为异步 chunk，新增案例不影响首屏加载体积。
