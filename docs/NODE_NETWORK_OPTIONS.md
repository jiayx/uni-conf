# 节点 UDP 与 QUIC 选项

节点编辑器中的 `UDP Relay`、`Block QUIC` 均可选择「客户端默认 / 开启 / 关闭」。未指定时保留客户端默认行为；显式关闭会保存为布尔值 `false`。旧节点无需迁移数据库。

统一字段存放在 `parsedConfig.extra.udp`、`parsedConfig.extra.blockQuic`。导入时兼容 `udp-relay` / `udp_relay` 和 `block-quic` / `block_quic`，识别布尔值、0/1、true/false、on/off。`auto` 等非布尔策略不转换为布尔值。

以下为 2026-10-18 核对结果及当前导出器的映射。具体选项仍受节点协议限制。

| 客户端 | UDP 设置 | 节点级 QUIC 设置 |
| --- | --- | --- |
| [Loon](https://nsloon.app/en/docs/Node/) | `udp=true/false`；补齐 VMess、VLESS 输出 | `block-quic=true/false`；WireGuard 文档未列出此选项，暂不输出 |
| [Surge](https://manual.nssurge.com/policies/udp.html) | SS、SOCKS5 使用 `udp-relay=true/false`；VMess、Trojan、AnyTLS、Snell v3+ 等自动支持 UDP，无法用该参数关闭 | [通用策略参数](https://manual.nssurge.com/policies/parameters.html) `block-quic=on/off` |
| [Stash](https://stash.wiki/en/proxy-protocols/proxy-types) | `udp: true/false` | `block-quic: "on"/"off"`；移除导出器原有的全局 `PROTOCOL,QUIC,REJECT`，避免覆盖节点设置及直连流量 |
| [Egern](https://egernapp.com/docs/configuration/proxies/) | 支持该开关的协议输出 `udp_relay: true/false`；Hysteria2、TUIC、WireGuard 没有对应开关 | `block_quic: true/false`；HTTP(S) 文档未列出该字段 |
| [Mihomo](https://wiki.metacubex.one/config/proxies/) | `udp: true/false`，包括原生配置和手动节点 | 未提供通用节点参数映射，使用分流规则控制 |
| [sing-box](https://sing-box.sagernet.org/configuration/outbound/shadowsocks/) | 支持 `network` 的出站通过 `network: "tcp"` 禁用 UDP；开启时解除 TCP 限制。AnyTLS、WireGuard 没有这个出站开关 | 没有同名出站选项，需通过路由规则控制 |
| [Quantumult X](https://raw.githubusercontent.com/crossutility/Quantumult-X/master/sample.conf) | 保留 `udp-relay=true/false` 输出 | 官方示例提供的是全局 `udp_drop_list` 中的 QUIC 控制，未确认节点级开关，不输出 `block-quic` |
| [Shadowrocket](https://apps.apple.com/us/app/shadowrocket/id932747118) | 保留现有协议的 UDP 参数输出；部分协议的开关尚未映射 | 未找到可确认节点级语法的官方文档，暂不输出该参数 |
| URI / Base64 节点订阅 | 部分 URI 可以携带 `udp`，SS/SSR/VMess/SOCKS5 的当前导出器不携带 | 没有统一的节点级 QUIC 参数，不加入自定义参数 |

已设置但导出器无法表达的选项会作为兼容性提示展示。不会为了模拟节点开关而添加影响其他节点的全局规则。

UDP 指的是节点转发应用 UDP 流量的能力，与 Hysteria2/TUIC 等协议自身使用 UDP/QUIC 连接服务器不同。关闭应用 QUIC 不代表关闭节点协议本身的 QUIC 传输。
