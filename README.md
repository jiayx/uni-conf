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
| Mihomo       | 完整 YAML 配置        |
| Clash        | 完整 YAML 配置        |
| sing-box     | 完整 JSON 配置        |
| Loon         | 完整配置              |
| Surge        | 完整配置              |
| Shadowrocket | 完整配置              |
| Quantumult X | 完整配置              |
| Stash        | 完整 YAML 配置        |
| Egern        | 完整 YAML 配置        |
| 节点订阅     | Base64 或明文节点 URI |

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
