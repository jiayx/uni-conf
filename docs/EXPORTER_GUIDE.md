# UniConf 导出器开发指南

本文说明当前导出架构，以及增加或修改客户端格式时必须同步的实现点。

## 事实来源

- 格式联合类型：`packages/types/src/index.ts`
- 格式列表、文件名、规则兼容性、客户端能力：`packages/shared/src/index.ts`
- 数据构建：`apps/worker/src/export-data.ts`
- 生成器入口：`apps/worker/src/generators/export-renderer.ts`
- 预览/下载：`apps/worker/src/routes/export.ts`
- 公开订阅：`apps/worker/src/routes/subscription.ts`
- 产物校验：`apps/worker/src/services/export-artifact-validation.ts`

不要在 Web 页面、某个生成器或路由里创建第二份格式列表或兼容性表。

## 当前格式

完整配置：

`mihomo`、`clash`、`singbox`、`loon`、`surge`、`shadowrocket`、`quantumultx`、`stash`、`egern`

节点订阅：

`nodes_base64`、`nodes_raw`

每个格式的当前协议和规则集格式能力由 `EXPORT_CLIENT_CAPABILITIES` 描述。它表示 UniConf 已经实现的序列化能力，不等同于目标客户端所有版本理论上支持的功能。

## 导出链路

```text
ExportConfig
 → buildExportData
 → 规则/协议兼容性与引用检查
 → 远程规则集转换预检
 → renderExportData
 → validateRenderedExport
 → preview / download / public subscription
```

三种交付入口必须复用这条链路。不能出现预览正常、下载或公开订阅使用另一套转换逻辑的情况。

## 增加格式

### 1. 注册类型和文件名

更新：

- `ExportFormat`
- `FULL_CONFIG_EXPORT_FORMATS` 或 `NODE_SUBSCRIPTION_EXPORT_FORMATS`
- `EXPORT_FORMAT_FILENAMES`
- `EXPORT_CLIENT_CAPABILITIES`

如果能力对外变化，递增 `EXPORT_CAPABILITY_PROFILE_REVISION`。

### 2. 实现生成器

在 `apps/worker/src/generators/` 中创建专用生成器，并接入 `renderExportData`。

生成器接收已经展开的：

- 节点
- 策略组
- 手动规则
- 远程规则集
- 节点组到最终节点名称的映射
- DNS 策略和规则集转换 URL 等目标选项

生成器不查询 D1/KV，不发网络请求，也不自行决定导出档案范围。

### 3. 只声明已实现能力

协议只有在以下内容完成后才能加入客户端能力注册表：

- 原生语法序列化
- TLS/传输字段的明确映射
- 不支持字段的拒绝或警告
- 代表性协议矩阵测试
- 最终产物结构校验

不能把另一个客户端的节点行改名后当作支持。例如 Surge、Loon、Shadowrocket 和 Quantumult X 各自使用独立序列化语法。

### 4. 规则兼容性

更新 `RULE_COMPATIBILITY`，必要时在 `resolveRuleForExport` 中增加 payload-aware 转换。

级别：

- `full`：当前生成器可以直接保持语义
- `convert`：转换为目标客户端等价指令
- `partial`：只在明确记录的部分语义下可用
- `unsupported`：不输出

“目标客户端可能支持”不足以标为 `full`。必须有当前生成器实现和测试。例如：

- Mihomo、Clash、sing-box、Stash 当前可处理本地 `GEOSITE`
- Surge、Loon、Shadowrocket、Quantumult X、Egern 当前不会输出本地 `GEOSITE`
- Surge/Loon 可通过专用远程规则集来源表达相同域名集合，但这不是 `GEOSITE,<name>` 指令支持

精确矩阵应从 `RULE_COMPATIBILITY` 读取，不在文档复制完整静态表。

### 5. 远程规则集

为格式声明可以直接消费的 `ruleSetFormats`，再检查 `remote-rule-set-resolver.ts` 和 `rule-set-conversion.ts` 是否存在语义保持的转换路径。

转换规则：

- 原生来源优先
- 有目标客户端 `sourceOverrides` 时优先使用覆盖
- 无精确转换时返回 unsupported
- `compatible` 可以交付安全子集并报告跳过
- `strict` 在存在跳过时阻止交付

不要为复合条件、脚本或未知指令做扩大匹配范围的降级。

### 6. DNS

全局只保存 DNS 意图，生成器负责目标语法：

- `resolutionMode`: `single` / `split`
- `additionalRealIpDomains`

当前引擎分类：

- Mihomo/Clash：`enhanced-mode`
- sing-box：DNS server graph
- Loon/Surge/Shadowrocket/Quantumult X/Stash/Egern：目标原生 FakeIP 配置
- 节点订阅：无 DNS

Mihomo 专属 Geo 配置只在 `ruleSetExportFormat === 'mihomo'` 时输出，不能泄漏到 Clash/Stash。

### 7. Web 标签

增加：

- `apps/web/src/core/export/formats.ts`
- 中英文 i18n 标签
- 快速导出和高级档案测试

Web 只选择格式和展示 Worker 返回结果，不实现序列化。

## 生成器共同约束

### 节点与引用

- 只输出节点与来源均启用的节点
- 节点组成员必须经过目标生成器协议过滤
- 节点改名后，所有组引用使用最终名称
- 策略组不能引用未导出的节点或组
- sing-box WireGuard endpoint tag 与 outbound tag 同样参与引用校验

### 兜底规则

完整配置必须有最终路由：

1. 已启用的 MATCH/FINAL
2. 漏网之鱼组
3. PROXY
4. 第一个可用策略
5. 目标客户端直连

节点订阅不生成路由。

### 远程规则集顺序

生成器按系统管理顺序写入远程规则集，并放在兜底规则之前。不能依赖数据库查询偶然返回的顺序。

### 目标客户端注意事项

- Mihomo 的 `DIRECT`/`REJECT` 是内置策略，不生成伪策略组
- sing-box 1.13 使用顶层 WireGuard `endpoints`
- Surge 外部规则集直接写入 `[Rule]` 的 `RULE-SET`
- Quantumult X `[server_local]` 使用原生行语法，不复用 URI 序列化
- Egern 使用其原生嵌套 YAML 对象，不是 Clash flat YAML
- 节点 URI 订阅只承诺 URI 可以表达的协议字段

## 测试

至少覆盖：

- 每个声明支持的协议
- 节点组展开和最终名称引用
- 本地规则转换/省略
- 远程规则集原生来源和转换来源
- DNS 输出
- 空数据与兜底规则
- 无悬空节点、组、规则集引用
- 目标产物解析或 Schema 校验
- 预览、下载和公开订阅一致性

相关测试集中在：

- `apps/worker/src/generators/`
- `apps/worker/src/services/export-*.test.ts`
- `apps/worker/src/routes/export*.test.ts`
- `apps/worker/src/routes/subscription.test.ts`
- `apps/web/src/core/compatibility/`

修改能力注册表后运行：

```bash
pnpm lint
pnpm typecheck
pnpm --filter @uni-conf/worker test
pnpm --filter @uni-conf/web test
```
