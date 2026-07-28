# 协议 Schema 与字段注册表

本文描述已经采用的同步方案，不再记录早期迁移计划。

## 当前上游基线

| 目标     | 依赖                                  | 当前用途                                    |
| -------- | ------------------------------------- | ------------------------------------------- |
| sing-box | `@black-duty/sing-box-schema` 1.13.13 | 生成元数据、类型约束和最终 JSON Schema 校验 |
| Mihomo   | `meta-json-schema` 1.19.29            | 生成协议元数据并核对 Mihomo 类型            |

版本以 `packages/types/package.json` 为准。升级依赖时，当前 sing-box 生成器只保留上游仍支持的 outbound；如果其他客户端生成器仍有独立实现，对应协议可以继续保留在全局注册表中。

## 当前代码结构

`packages/types/src/protocols.ts` 包含：

- `PROXY_PROTOCOL_REGISTRY`
- URI scheme 到内部协议映射
- Mihomo/sing-box 原生类型到内部协议映射
- 手动节点字段注册表
- 上游 Schema 生成元数据

生成文件位于：

```text
packages/types/src/generated/protocol-schema-metadata.ts
```

生成和检查命令：

```bash
pnpm --filter @uni-conf/types generate:protocols
pnpm --filter @uni-conf/types check:protocols
```

`@uni-conf/types` 的 build/typecheck 会自动运行 `check:protocols`，因此提交过期生成文件会使常规检查失败。

## 当前协议注册表

面向用户的主流协议：

- Shadowsocks、ShadowsocksR
- VMess、VLESS、Trojan
- Hysteria、Hysteria2、TUIC、AnyTLS
- NaiveProxy、WireGuard
- SOCKS5、HTTP、HTTPS、SSH、ShadowTLS

内部还保留 `direct`、`reject`、`unknown`。`reality` 是内部非主流占位，REALITY 实际作为 VLESS 等协议的 TLS/握手字段处理，不作为可独立连接的节点协议。

注册表中的协议表示 UniConf 可以识别或保存该节点，不表示全部导出器都能生成它。每个导出器的当前范围位于 `EXPORT_CLIENT_CAPABILITIES`。

## 存储形态

D1 使用少量可查询列：

- `protocol`
- `server`
- `port`
- `name`
- `country` / `country_code`
- `enabled`
- `tags`

协议专属字段保存在 `raw_config` 和 `parsed_config`：

```ts
interface NativeProxyConfig {
  sourceFormat: 'uri' | 'mihomo' | 'singbox' | 'unknown'
  sourceUri?: string
  mihomo?: MihomoNativeProxy
  singbox?: SingboxNativeOutbound
  normalized?: Record<string, unknown>
}
```

`parsed_config` 保存搜索、显示和通用适配所需字段。它不是所有目标格式的完整真相。

## 解析与导出顺序

### 输入

1. 识别 URI、Mihomo 对象或 sing-box outbound/endpoint。
2. 保存能够忠实表达的原生对象。
3. 派生统一索引字段。
4. 对已知能够无损映射的协议，同时生成另一客户端原生对象。

### Mihomo

1. 使用 `raw_config.mihomo`
2. 使用顶层看起来是 Mihomo proxy 的原始对象
3. 使用已实现的 sing-box → Mihomo 适配
4. 使用明确支持的规范化字段
5. 无法表达则省略并产生兼容性提示

### sing-box

1. WireGuard 使用顶层 1.13 `endpoints`
2. 使用 `raw_config.singbox`
3. 使用顶层 sing-box outbound 原始对象
4. 使用已实现的 Mihomo → sing-box 适配
5. 使用明确支持的规范化字段
6. 无法表达则省略并产生兼容性提示

其他客户端使用各自生成器，不从 sing-box/Mihomo 支持状态推断自身支持状态。

## WireGuard

在 sing-box 1.13 中，WireGuard 是 endpoint，不是 outbound。UniConf：

- 从 `type: wireguard` endpoint 的第一个 peer 提取索引用 server/port
- 完整保存 endpoint 和所有 peers
- 导出时写入顶层 `endpoints`
- 将 endpoint tag 纳入 selector、route 和 final 引用检查

不要把 WireGuard 重新加入 sing-box outbound 类型。

## 升级流程

1. 升级上游 Schema 包。
2. 运行 `generate:protocols`。
3. 查看生成元数据和注册表的差异。
4. 删除上游不再支持的 sing-box 类型/字段适配。
5. 只有在对应生成器仍实现时，保留其他客户端的协议能力。
6. 更新手动表单字段、解析器、生成器和能力注册表。
7. 增加协议矩阵与最终产物校验测试。
8. 运行 lint、typecheck 和测试。
