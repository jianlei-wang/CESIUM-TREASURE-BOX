# 案例浏览量统计与运营后台需求文档

## Introduction

为「Cesium酱の百宝箱」增加案例浏览量统计能力：每张案例卡片底部右侧展示该案例的累计浏览量，每次打开案例演示时累加一次并持久化。同时提供独立的运营后台，用于查看浏览量总览、趋势、分类分布与逐案例明细。浏览量与后台服务随现有系统一起启动与部署。

## Glossary

- **案例（Case）**：`src/cases/<case-id>/index.ts` 注册的演示条目，由 `id` 唯一标识。
- **浏览量（View Count）**：某个案例被打开演示的累计次数。
- **浏览量服务（View Service）**：新增的 Node.js 服务，提供浏览量写入、查询与后台统计接口。
- **运营后台（Admin Console）**：访问 `/admin/` 的独立管理页面，用于查看统计数据。
- **管理员口令（Admin Token）**：访问运营后台与后台接口所需的共享密钥。

## Requirements

### Requirement 1：案例卡片展示浏览量

**User Story:** AS 案例库访客，I want 在案例卡片底部右侧看到该案例的浏览量，so that 我能判断案例的受欢迎程度。

#### Acceptance Criteria

1. WHILE 浏览量服务可访问，the 案例库 SHALL 在每张案例卡片底部右侧展示该案例的累计浏览量。
2. WHEN 案例库加载或切换分类、执行搜索时，the 案例库 SHALL 批量获取当前可见案例的浏览量。
3. IF 浏览量服务不可访问，the 案例库 SHALL 隐藏浏览量徽标并保持案例浏览、搜索与演示功能正常。
4. The 案例库 SHALL 以 `万` 为单位展示大于等于 10000 的浏览量，并保留一位小数。

### Requirement 2：打开案例累加浏览量

**User Story:** AS 案例库访客，I want 每次查看场景都记录一次浏览，so that 统计数据反映真实访问热度。

#### Acceptance Criteria

1. WHEN 访客打开一个可演示案例，the 案例库 SHALL 向浏览量服务提交一次该案例的浏览事件。
2. WHEN 浏览量服务接受浏览事件，the 浏览量服务 SHALL 将该案例的累计浏览量加一，并更新首次浏览时间、最近浏览时间与当日浏览量。
3. WHEN 浏览量服务拒绝或无法处理浏览事件，the 案例库 SHALL 保持案例演示正常打开，并回滚界面上的乐观计数。
4. The 浏览量服务 SHALL 只接受符合 `^[a-z0-9][a-z0-9-]{0,63}$` 的案例标识。
5. WHILE 同一来源在一分钟内提交的浏览事件超过 120 次，the 浏览量服务 SHALL 返回 429 并停止累加。

### Requirement 3：浏览量持久化

**User Story:** AS 案例库维护者，I want 浏览量在重启后仍然存在，so that 统计结果可以长期累积。

#### Acceptance Criteria

1. The 浏览量服务 SHALL 将浏览量数据持久化到数据文件，默认路径为 `data/case-views.json`。
2. WHEN 浏览量发生变更，the 浏览量服务 SHALL 在 500 毫秒内将最新数据原子写入数据文件。
3. WHEN 浏览量服务收到终止信号，the 浏览量服务 SHALL 在退出前完成一次数据落盘。
4. The 浏览量服务 SHALL 永久保留每个案例的累计浏览量，并按保留天数参数清理每日明细。
5. IF 数据文件缺失或内容不可解析，the 浏览量服务 SHALL 以空数据启动并继续提供写入与查询能力。

### Requirement 4：运营后台总览

**User Story:** AS 案例库维护者，I want 在一个后台页面查看浏览数据总览，so that 我能快速了解案例热度。

#### Acceptance Criteria

1. WHEN 管理员通过口令验证访问 `/admin/`，the 运营后台 SHALL 展示累计浏览量、今日浏览量、近 7 天浏览量、有浏览量记录的案例数。
2. The 运营后台 SHALL 展示最近 7、14 或 30 天的每日浏览量趋势。
3. The 运营后台 SHALL 展示浏览量前 10 的案例排名。
4. The 运营后台 SHALL 展示按案例分类聚合的浏览量分布。
5. WHEN 管理员触发刷新或开启自动刷新，the 运营后台 SHALL 重新获取统计数据。
6. The 运营后台 SHALL 支持按案例标题、标识与分类检索明细，并支持按浏览量、最近浏览时间与标题排序。
7. The 运营后台 SHALL 支持将当前统计结果导出为 CSV 文件。

### Requirement 5：后台访问控制

**User Story:** AS 案例库维护者，I want 后台与统计接口受口令保护，so that 浏览数据不会被任意访客读取。

#### Acceptance Criteria

1. The 浏览量服务 SHALL 通过 `ADMIN_TOKEN` 环境变量读取管理员口令。
2. IF `ADMIN_TOKEN` 未设置且数据目录不存在口令文件，the 浏览量服务 SHALL 生成随机口令并以 `600` 权限保存到数据目录，同时在启动日志中输出口令。
3. IF 请求未携带有效口令，the 浏览量服务 SHALL 对 `/api/admin/*` 返回 401。
4. WHILE 同一来源在一分钟内登录校验失败超过 20 次，the 浏览量服务 SHALL 返回 429。
5. The 运营后台 SHALL 将口令保存在当前标签页会话中，关闭标签页后清除。

### Requirement 6：随现有系统启动与部署

**User Story:** AS 案例库维护者，I want 浏览量服务与前端一起启动和部署，so that 我不需要维护额外的手工步骤。

#### Acceptance Criteria

1. WHEN 执行 `npm run dev`，the 开发环境 SHALL 同时启动 Vite 开发服务器与浏览量服务，并由 Vite 将 `/api` 代理到浏览量服务。
2. WHEN 执行 `npm run build`，the 构建流程 SHALL 生成运营后台静态页面与案例目录数据。
3. WHEN 以 Docker 方式部署，the 容器 SHALL 在单一端口同时提供静态站点、`/api` 接口与 `/admin/` 页面。
4. The 浏览量服务 SHALL 支持通过 `PORT`、`VIEWS_DATA_FILE`、`VIEW_RETENTION_DAYS`、`STATIC_ROOT` 环境变量调整运行参数。
