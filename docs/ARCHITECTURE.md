# UniConf 系统架构

本文描述当前仓库结构和运行链路，不记录未来规划。

## 总体结构

```text
浏览器
  │
  ├─ /                 React SPA
  ├─ /api/*            管理 API
  └─ /sub/{token}/*    客户端订阅与规则集转换
  │
Cloudflare Worker (Hono)
  ├─ Workers Static Assets
  ├─ D1：配置和运行状态
  ├─ KV：短期缓存、限流和远程资源缓存
  └─ Cron：到期订阅、规则目录和 DNS 资源刷新
```

生产环境由同一个 Worker 提供 SPA、API 和公开订阅。`wrangler.jsonc` 的 `run_worker_first` 保证 `/api/*` 和 `/sub/*` 先进入 Worker，其他路径由静态资源和 SPA fallback 处理。

本地开发中：

- Vite：`http://localhost:5173`
- Wrangler：`http://localhost:8787`
- Vite 代理 `/api` 和 `/sub` 到 Wrangler

## Monorepo

```text
apps/
  web/                 React 管理界面
  worker/              Hono API、D1 服务、生成器和定时任务
packages/
  types/               领域类型、协议注册表和上游 Schema 元数据
  shared/              跨端常量、客户端能力和兼容性解析
  rule-set/            规则格式识别、二进制解码、检查和转换
resources/
  rule-set-catalogs/   第三方规则仓库的目录映射
scripts/
  generate-rule-set-catalogs.mjs
  smoke-deployment.mjs
docs/
```

依赖方向：

```text
types
  ↑
rule-set
  ↑
shared
  ↑       ↑
worker   web
```

Web 不生成最终配置。它选择目标格式、展示 Worker 的预览结果，并使用 `@uni-conf/shared` 中的能力信息提供一致的表单反馈。

## Worker 分层

### 路由

`apps/worker/src/index.ts` 注册：

- `sources`：订阅链接、配置导入、导入历史、刷新和来源规则集
- `nodes`：节点 CRUD 与批量启停
- `collections`：节点组、组合创建和预览
- `groups`：策略组 CRUD 与排序
- `rules`：手动规则 CRUD、批量创建/启停和排序
- `remote-rule-sets`：规则集 CRUD、来源校验和转换预览
- `rule-set-catalogs`：QuixoticHeart 可选规则目录
- `export`：导出档案、预览和下载
- `dashboard`：概览统计
- `settings`：全局设置
- `data`：备份、校验、恢复和清空
- `initialize`：补齐当前零配置默认数据
- `subscription`：公开订阅与 Token 范围内的规则集转换

### 服务

`apps/worker/src/services/` 负责业务规则：

- 零配置同步和默认导出档案
- 自动节点组与业务分流组
- 默认规则集与目录缓存
- 订阅自动刷新
- DNS 资源缓存
- 安全远程请求
- 导出就绪度、结构校验和规则集转换
- 策略组引用图和数据库写入约束

路由不应复制这些规则，生成器也不负责数据库读取。

### 生成器

`apps/worker/src/generators/export-renderer.ts` 是格式分发入口。当前实现包括：

- Mihomo/Clash 共用 YAML 容器生成器，但保留目标格式标识
- Stash 使用专用 DNS 适配后复用 Mihomo 容器
- sing-box JSON
- Loon
- Surge、Shadowrocket、Quantumult X、Egern
- Base64/明文节点 URI

不同客户端不共享一个最低公分母的节点行语法。每个生成器只序列化能力注册表中已经实现并有测试的协议。

### 规则集包

`@uni-conf/rule-set` 把规则内容能力从 Worker 中抽离，提供：

- 格式检测
- 文本、YAML、JSON 内容检查
- Mihomo MRS 解码
- sing-box SRS 解码
- 规则语义归一化
- 目标格式转换和跳过原因

Worker 负责安全下载、缓存、策略决定和 HTTP 响应；包本身不访问 D1/KV。

## 数据流

### 订阅刷新

```text
URL
 → 公网 URL/重定向安全检查
 → 限时、限大小下载
 → 自动或指定格式解析
 → 过滤信息节点并规范化节点
 → D1 batch 对账当前来源节点
 → 同步自动节点组、策略组和默认规则集
```

来源、节点和摘要在一个受控写入流程中更新。来源关闭后，节点记录仍保留，但不会进入有效节点查询。

### 配置导入

```text
粘贴/文件
 → 解析与数据库差异预览
 → 创建来源和导入记录
 → 原子写入节点阶段
 → 原子写入规则/规则集阶段
 → 零配置同步
```

两个阶段分别记录结果，失败阶段可独立重试。撤销操作只删除仍由该次导入拥有的对象，并使用 compare-and-set 恢复明确接受过的覆盖字段。

### 配置导出

```text
导出档案 + 目标格式
 → 展开所选节点组/策略组引用图
 → 过滤未启用来源和节点
 → 应用节点组变换与命名
 → 解析本地规则兼容性
 → 预检远程规则集及必要转换
 → 生成目标配置
 → 目标格式结构校验
 → 预览 / 下载 / 公开订阅
```

预览、下载和公开订阅复用同一数据构建与生成链路。节点订阅会跳过策略组、规则集和 DNS，因为这些内容不在 URI 订阅中。

### 规则目录

根目录 `resources/rule-set-catalogs.json` 列出目录定义。生成脚本读取每个仓库映射并生成紧凑快照，Worker 将该快照打包为离线初始值。运行时可以从 GitHub 刷新目录并存入 KV。

默认规则同步只创建目录中非 `optional` 的条目；完整 QuixoticHeart 列表仍可在“添加补充规则集”中选择。

## 安全边界

- 生产环境在缺少 `API_KEY` 或 `ALLOWED_ORIGIN` 时 readiness 失败
- `/api/health` 和 `/api/ready` 公开，其他管理 API 使用可选 Bearer Token；生产必须配置
- `/sub/*` 使用导出档案 Token，并有独立 KV 限流
- 管理 API body 上限 25 MiB；配置源内容上限 4 MiB
- 远程 URL 必须是公开 HTTP(S)，禁止 URL 凭据、私网/保留地址和危险重定向
- Worker 启用 `global_fetch_strictly_public`
- 日志中的订阅 Token 会被替换为 `[redacted]`
- 备份和公开配置响应使用 `no-store`

## D1 与迁移

当前 D1 结构定义在 `apps/worker/migrations/0001_initial_schema.sql`。本地开发使用 Wrangler 应用迁移，golden path 从空 D1 验证初始化、导入、导出、备份和恢复。

## 前端结构

- `app/`：路由、鉴权门和应用装配
- `pages/`：页面级数据与交互
- `components/`：布局和可复用 UI
- `core/`：兼容性、表单保护、解析、分流和导出展示逻辑
- `lib/api.ts`：统一 API 客户端与诊断信息
- `store/`：Zustand 状态
- `i18n/`：中英文文案

表单在内容变化后由统一 provider 保护关闭、遮罩、Esc、站内导航和浏览器离开。客户端不会从自然语言错误中推导业务行为；可修复目标由 Worker 返回结构化信息。

## 测试

- 包级单元测试：类型、规则解析与共享逻辑
- Worker：路由、服务、生成器、产物结构和 D1 集成
- Web：页面、组件、store 与核心交互
- Golden path：空 D1 初始化、导入、全部格式导出、备份、清空、恢复和再次导出
- CI：lint、typecheck、test、coverage 和 build

具体命令见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
