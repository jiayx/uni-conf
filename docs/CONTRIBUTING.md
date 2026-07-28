# UniConf 开发指南

## 环境要求

- Node.js 20.19+ 或 22.12+；CI 使用 Node.js 24
- pnpm 11.17+
- 部署时需要 Cloudflare 账户

## 本地启动

```bash
pnpm install
cp apps/worker/.env.example apps/worker/.env
pnpm --filter @uni-conf/worker db:migrate:local
```

分别启动：

```bash
pnpm dev:worker
pnpm dev
```

- Web：`http://localhost:5173`
- Worker：`http://localhost:8787`

本地可以不配置 `API_KEY` 和 `ALLOWED_ORIGIN`。生产环境必须配置两者。

## 常用命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:golden
pnpm build
pnpm catalogs:refresh
```

按包运行：

```bash
pnpm --filter @uni-conf/web test
pnpm --filter @uni-conf/worker test
pnpm --filter @uni-conf/rule-set test
pnpm --filter @uni-conf/types check:protocols
```

Golden path 会从空 D1 应用当前基线，导入代表性配置，验证全部导出格式，再完成备份、清空、恢复和重复导出。

## 代码边界

- `@uni-conf/types`：领域类型和协议注册表
- `@uni-conf/rule-set`：无存储依赖的规则解析/转换
- `@uni-conf/shared`：跨 Web/Worker 的能力和纯函数
- Worker service：数据库、网络、安全和业务状态
- Worker generator：纯配置序列化
- Web：管理交互和服务端结果展示

不要：

- 在 Web 中复制导出器
- 在页面内复制兼容性表
- 在生成器中读取 D1/KV
- 对无法保持语义的规则做猜测性转换

## 编码约定

- TypeScript strict
- 非组件模块优先命名导出
- 用户可见文案使用 i18n
- 页面样式使用设计变量和 CSS Modules
- 表单改动接入统一未保存更改保护
- D1 多行关联写入使用 batch，并在写入前完成全量校验
- 外部 URL 使用统一安全 fetch
- 新能力增加与风险相称的测试；小改动优先跑目标测试，不要求每次都跑完整集成套件

## 修改协议

参考 [PROTOCOL_SCHEMA_SYNC.md](./PROTOCOL_SCHEMA_SYNC.md)。

```bash
pnpm --filter @uni-conf/types generate:protocols
pnpm --filter @uni-conf/types check:protocols
```

同步更新：

- 协议注册表和表单字段
- 输入解析
- 目标生成器
- `EXPORT_CLIENT_CAPABILITIES`
- 协议矩阵测试

## 修改导出格式

参考 [EXPORTER_GUIDE.md](./EXPORTER_GUIDE.md)。能力变化必须更新共享注册表、生成器、产物校验和 Web 标签。

## 修改规则目录

目录定义位于：

```text
resources/rule-set-catalogs.json
resources/rule-set-catalogs/*.json
```

刷新：

```bash
pnpm catalogs:refresh
```

生成结果应提交，保证离线部署时仍有默认规则集。系统默认条目与完整可选目录是两层概念：只有非 `optional` 条目自动写入 D1。

## 修改 D1

当前结构位于 `apps/worker/migrations/0001_initial_schema.sql`。修改结构后重新应用本地迁移，并运行 Worker 数据测试和 golden path：

```bash
pnpm --filter @uni-conf/worker db:migrate:local
pnpm test:golden
```

## 提交前

根据改动范围至少运行目标测试、typecheck 和 lint。影响跨包能力、数据库或导出链路时运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:golden
pnpm build
```

CI 还会运行 coverage。

## 部署

1. 在 Cloudflare 创建 D1 和 KV。
2. 替换 `apps/worker/wrangler.jsonc` 中 staging/production 占位 ID 和 origin。
3. 配置 `API_KEY` secret。
4. 使用 GitHub `Deploy` workflow，先 staging 后 production。

详细步骤见 [OPERATIONS.md](./OPERATIONS.md)。
