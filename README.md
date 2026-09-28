# UniConf

一次管理，多端导出。

UniConf 是一个面向个人自托管场景的代理配置管理工具。它可以汇总多个订阅和手动节点，统一管理节点组、分流规则和 DNS，并生成不同客户端可以直接使用的配置。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jiayx/uni-conf)

## 主要功能

- 添加并自动刷新多个订阅
- 导入 Clash/Mihomo、sing-box、Base64 订阅和节点 URI
- 手动录入、筛选、启停节点并识别国家或地区
- 按来源、协议、地区和标签组合节点组
- 使用默认代理或默认直连两种基础分流方式
- 为 AI、流媒体、社交、游戏、测速等业务单独选择出口
- 管理手动规则和远程规则集
- 适配不同客户端的协议、规则和 DNS 配置
- 预览、下载配置并生成公开订阅链接
- 创建多个相互隔离的配置空间
- 导出和恢复备份

## 支持的导出格式

| 客户端或格式 | 导出内容              |
| ------------ | --------------------- |
| Mihomo / Clash.Meta | 完整 YAML 配置 |
| sing-box     | 1.14.0 完整 JSON 配置 |
| Loon         | 完整配置              |
| Surge        | 完整配置              |
| Shadowrocket | 完整配置              |
| Quantumult X | 完整配置              |
| Stash        | 完整 YAML 配置        |
| Egern        | 完整 YAML 配置        |
| 节点订阅     | Base64 或明文节点 URI |

## 通用订阅链接

默认配置支持 `/sub/<token>`，根据客户端 User-Agent 导出完整配置。支持 Mihomo / Clash 系、sing-box、Loon、Surge、Shadowrocket、Quantumult X、Stash 和 Egern；无法识别时可通过 `?format=stash` 等参数指定格式。浏览器打开时显示格式选择页面，其他无法识别的请求返回明确错误。

- `/sub/<token>`：自动识别客户端，返回完整配置。
- `/sub/<token>?format=stash`：指定客户端格式，优先于 UA。
- `/sub/<token>?mode=nodes`：只返回 Base64 节点 URI，不包含规则和 DNS。
- `/sub/<token>?mode=nodes&format=nodes_raw`：只返回明文节点 URI。

节点订阅适用于支持节点 URI 的订阅入口，并非各客户端原生的 provider 文件。现有带文件名的订阅地址继续有效，以文件名决定格式；高级配置仍限制为创建时选择的格式。所有链接沿用配置的令牌、启停状态和导出范围。

## 开始使用

1. 按照[部署到 Cloudflare](./docs/CLOUDFLARE_DEPLOYMENT.md)完成部署。
2. 使用部署时设置的访问密钥进入管理页面。
3. 添加订阅或导入已有配置。
4. 检查节点、节点组和分流方案。
5. 在配置导出页面生成客户端订阅链接。

## 文档

- [部署到 Cloudflare](./docs/CLOUDFLARE_DEPLOYMENT.md)
- [使用指南](./docs/PRODUCT_DESCRIBE.md)
- [日常维护与故障处理](./docs/OPERATIONS.md)

## License

MIT
