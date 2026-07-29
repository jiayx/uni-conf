# UniConf

一次管理，多端导出。

UniConf 是一个面向个人自托管场景的代理配置管理工具。它把订阅源、节点、节点组、分流方案、手动规则、远程规则集和导出档案统一保存在 Cloudflare D1 中，再由 Worker 生成目标客户端可直接使用的配置或节点订阅。

## 当前能力

- 添加并刷新远程订阅链接，支持自定义格式、User-Agent 和刷新间隔
- 从 Clash/Mihomo YAML、sing-box JSON、Base64 或原始 URI 文本导入配置
- 预览导入差异，处理节点、规则和远程规则集冲突，并保留可撤销的导入记录
- 手动录入节点，按名称识别国家/地区，批量筛选和启停节点
- 使用来源、节点、协议、国家/地区、标签等条件组合节点组
- 自动维护默认节点池、国家/地区节点组、基础出口和业务分流组
- 管理有顺序的手动规则和远程规则集，支持目标覆盖和客户端原生来源
- 使用 QuixoticHeart 规则目录提供系统默认规则及可选补充规则；Broker 规则用于对应业务场景
- 预览、校验、下载完整配置，并通过带 Token 的公开订阅链接交付
- 备份、校验、清空和恢复当前版本的 D1 配置数据

## 导出格式

| 导出              | 类型                                 |
| ----------------- | ------------------------------------ |
| Mihomo            | 完整 YAML 配置                       |
| Clash             | 完整 YAML 配置                       |
| sing-box          | 完整 JSON 配置，按 1.13 稳定结构生成 |
| Loon              | 完整配置                             |
| Surge             | 完整配置                             |
| Shadowrocket      | 完整配置                             |
| Quantumult X      | 完整配置                             |
| Stash             | 完整 YAML 配置                       |
| Egern             | 完整 YAML 配置                       |
| Node Subscription | Base64 或明文节点 URI                |

“支持导出”表示 UniConf 已实现对应生成器，不代表不同客户端能表达完全相同的节点协议、DNS 和规则语义。预览接口会基于当前实现的能力注册表报告转换、省略和阻断项；严格模式下，不完整的规则集转换会阻止交付。

## 技术结构

- React 19、Vite 8、React Router 8、Zustand、i18next
- Hono、Cloudflare Workers、Workers Static Assets
- Cloudflare D1 持久化配置，KV 缓存规则目录、DNS 资源和规则集转换结果
- TypeScript 7、Oxlint、Vitest
- 独立的 `@uni-conf/rule-set` 包负责规则集识别、解析和转换，包括 Mihomo MRS 与 sing-box SRS

## 本地开发

要求 Node.js 20.19+（推荐 24）和 pnpm 11.17+。

```bash
pnpm install
pnpm --filter @uni-conf/worker db:migrate:local
pnpm dev:worker
pnpm dev
```

- Web：http://localhost:5173
- Worker：http://localhost:8787
- Vite 会把 `/api/*` 和 `/sub/*` 转发到本地 Worker

常用检查：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:golden
pnpm build
```

## 文档

- [当前产品能力](./docs/PRODUCT_DESCRIBE.md)
- [系统架构](./docs/ARCHITECTURE.md)
- [数据模型](./docs/DATA_MODEL.md)
- [导出器开发](./docs/EXPORTER_GUIDE.md)
- [协议 Schema 同步](./docs/PROTOCOL_SCHEMA_SYNC.md)
- [本地开发与贡献](./docs/CONTRIBUTING.md)
- [部署与运维](./docs/OPERATIONS.md)

## 当前边界

- 单管理员、自托管，不包含账号、成员、团队协作和细粒度权限系统
- 一个部署可以维护多个相互隔离的配置空间，适合同时管理自己的配置和朋友的独立配置；朋友只使用各自的公开订阅链接
- 规则集转换只做能够保持语义的转换；无法准确表示的指令不会被猜测性降级
- 规则正文由第三方规则仓库维护，UniConf 只维护目录映射、内置快照和缓存

## License

MIT
