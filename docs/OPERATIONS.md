# UniConf 部署与运维

## 运行模型

UniConf 当前是单管理员、自托管服务：

- 一个 Cloudflare Worker 同时提供 SPA、管理 API 和公开订阅
- D1 保存配置
- KV 保存限流计数、规则目录、托管 DNS 资源和规则集转换缓存
- Cron 每五分钟触发一次，但只处理已经到期的订阅和需要刷新的托管资源

备份、节点配置、订阅源和公开导出都可能包含凭据。不要把备份、API Key 或导出 Token 写入日志或公开工单。

## Cloudflare 资源

`apps/worker/wrangler.jsonc` 定义 local、staging 和 production。

远程环境需要：

- D1 database
- KV namespace
- `API_KEY` secret
- 精确的 `ALLOWED_ORIGIN`
- `ENVIRONMENT=production`

将 `REPLACE_WITH_STAGING_*` 和 `REPLACE_WITH_PRODUCTION_*` 替换为真实资源 ID。部署工作流会拒绝仍含占位符的环境。

GitHub environment 需要：

| 名称                    | 类型     |
| ----------------------- | -------- |
| `CLOUDFLARE_API_TOKEN`  | secret   |
| `CLOUDFLARE_ACCOUNT_ID` | secret   |
| `API_KEY`               | secret   |
| `UNICONF_BASE_URL`      | variable |

production 应开启环境审批。

## 首次部署

```bash
pnpm install --frozen-lockfile
pnpm catalogs:refresh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:golden
pnpm build
```

应用数据库并部署：

```bash
pnpm --dir apps/worker exec wrangler d1 migrations apply DB --env staging --remote
pnpm --dir apps/worker exec wrangler deploy --env staging
```

生产环境将 `staging` 替换为 `production`。

推荐直接使用 `.github/workflows/deploy.yml`。该流程会刷新规则目录、运行检查、应用 D1 基线、部署 Worker/静态资源并执行 smoke test。

## 发布流程

1. 影响数据结构时先从当前生产版本导出备份。
2. 合并代码并确认 CI 通过。
3. 手动触发 staging Deploy。
4. 确认 smoke test：
   - `/api/health`
   - `/api/ready`
   - SPA 根路径
   - `/api/auth/check`
5. 对导出器或 Schema 改动，手动验证至少 Mihomo、sing-box 和受影响客户端。
6. 审批 production Deploy。

本地检查已部署环境：

```bash
UNICONF_BASE_URL=https://example.com \
UNICONF_API_KEY=... \
pnpm smoke
```

## Readiness

`GET /api/health` 只表示 Worker 可响应。

`GET /api/ready` 检查：

- D1 可查询
- KV 可读写
- 生产环境已配置 API Key
- 生产环境已配置 Allowed Origin

部署验证使用 readiness，而不是只使用 health。

## D1 与备份

部署流程在发布 Worker 前执行 `wrangler d1 migrations apply`。结构相关发布前应导出备份，并在 staging 验证来源、节点、分流图、默认导出 Token 和各导出格式。

备份导入会在写入前检查版本、表/列、JSON、枚举、唯一键、引用和策略组循环。不要绕过应用直接把未知备份写入 D1。

## 导出档案与 Token

- 默认档案由系统维护，不可删除
- 暂停档案：主订阅和其 Token 范围内的转换 URL 都返回不可缓存的 404
- 恢复档案：继续使用原 Token
- 重置 Token：旧 URL 立即失效
- 认证预览/下载在档案暂停时返回 403

公开订阅响应不做边缘长期缓存，保证节点、规则和暂停状态在客户端下一次刷新时生效。规则集转换产物可以在 KV 中按内容和目标缓存，但每次访问仍先验证 Token 档案的当前状态和范围。

## 远程网络与缓存

所有订阅和规则集 URL 必须是公开 HTTP(S)：

- 禁止 URL 用户名/密码
- 禁止 localhost、本地域名、私网和保留 IP
- 每次重定向重新校验
- 跨 origin 重定向去除敏感请求头
- 限制重定向次数、请求时间和响应大小

Worker 还启用 `global_fetch_strictly_public`。

KV 主要用于：

- API/订阅限流
- 第三方规则目录快照
- QuixoticHeart fake-ip-filter 刷新结果
- 规则集转换产物

规则集来源健康状态由用户在规则集管理页主动检查后写入 D1。过期状态会标为 stale；它不是持续探测服务，也不会在每次配置预览时探测全部 URL。

## 定时任务

Cron 表达式为 `*/5 * * * *`。

一次触发会：

1. 查找并刷新已到期且启用的订阅源
2. 到期时刷新规则目录快照
3. 到期时刷新托管 DNS 真实 IP 例外

全局“自动刷新”开关只控制第 1 项订阅刷新。规则目录和托管 DNS 资源按各自六小时缓存周期维护，避免用户关闭订阅刷新后让导出所需的系统资源永久停更。默认订阅间隔为 240 分钟，Cron 的五分钟只是调度粒度。

## 可观测性

非测试请求记录结构化 `http_request`：

- request ID
- method
- 已脱敏 path
- status
- duration
- environment
- 可用时记录 error code

未捕获异常记录 `worker_error`。订阅 Token 在日志路径中替换为 `[redacted]`。

响应包含 `X-Request-Id`。公开订阅和导出错误还使用稳定的 `X-UniConf-Error-Code`：

| Code                                                    | 含义                           |
| ------------------------------------------------------- | ------------------------------ |
| `subscription_format_invalid` / `export_format_invalid` | 格式未知                       |
| `subscription_unavailable`                              | Token 不存在、已重置或档案暂停 |
| `export_not_ready`                                      | 导出图存在阻断问题             |
| `conversion_incomplete`                                 | 严格转换不完整或转换失败       |
| `rule_set_out_of_scope`                                 | 规则集不属于该 Token 档案      |
| `conversion_target_invalid`                             | 转换目标非法                   |
| `conversion_not_required`                               | 不需要该转换                   |
| `conversion_source_too_large`                           | 上游规则集超过限制             |
| `conversion_upstream_unavailable`                       | 上游不可用                     |
| `conversion_invalid_content`                            | 无法生成保持语义的内容         |
| `artifact_invalid`                                      | 最终配置结构校验失败           |

用户报告问题时优先索取诊断编号，而不是订阅 URL 或完整配置。

## 容量边界

- 管理 API body：25 MiB
- 单个粘贴/上传/远程配置源：4 MiB UTF-8
- 备份总行数：100,000
- 节点批量启停：500 个唯一 ID
- 手动规则批量创建/启停：500 条
- 订阅刷新使用有界并发
- 规则集转换和来源校验使用有界并发与流式大小限制

超过这些规模前，应在 staging 测量 Worker CPU、D1 行数、生成配置大小和 Cron 时长。

## 回滚

代码和静态资源可以回滚到前一个 Worker deployment。回滚后重新验证 `/api/ready`、管理页、默认导出和公开订阅。
