# 日常维护与故障处理

首次部署请阅读[部署到 Cloudflare](./CLOUDFLARE_DEPLOYMENT.md)。

## 更新 UniConf

### 一键部署

一键部署创建的仓库已经连接 Workers Builds。将上游新版本同步到自己的生产分支后，Cloudflare 会自动重新部署。

部署完成后打开管理页面，确认订阅刷新和配置预览正常。

### 命令行部署

获取新版本后，在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm run deploy
```

`pnpm run deploy` 会先应用 D1 migration，再部署 Worker 和管理页面。

## 客户端配置

更新服务或修改分流设置后，在客户端刷新订阅并重新加载配置。客户端的全局或订阅覆写可能覆盖 UniConf 输出的 DNS、TUN 和策略组设置。

### 分流和规则下载

默认代理模式按业务规则、国内域名、国内 IP 兜底的顺序分流，最终未匹配流量走 PROXY。国内 IP 兜底使用 `cncidr-resolve`；sing-box 和 Quantumult X 使用上游对应的原生 `cncidr` 文件，sing-box 在该规则前执行真实 IP 解析。

公开 GitHub Raw 规则地址统一转换为 `testingcf.jsdelivr.net` 地址，文件格式按客户端选择。自定义非 GitHub 地址、带认证信息或查询参数的地址、GitHub Release 下载地址以及 UniConf 转换接口使用原地址。服务端规则格式转换从原始来源获取内容。

CDN 可用性取决于实际网络，分支缓存可能比源站更新滞后。Mihomo 和 sing-box 的规则下载使用基础代理出口；规则中的 DIRECT / PROXY 则决定匹配流量的出口。

### DNS 和健康检查

| 客户端 | DNS 与接管 | 默认代理健康检查 |
| --- | --- | --- |
| Mihomo | 国内域名使用国内 DoH，其他真实解析经基础代理组查询境外 DoH；节点和直连出口使用独立国内 DNS。TUN 接管 UDP/TCP 53，启用 TCP 并发连接。 | HTTPS，默认地址要求 HTTP 204 |
| sing-box | FakeIP A 查询、国内 DNS 和经代理的境外 DNS；以 `hijack-dns` 接管 DNS 流量。 | HTTPS |
| Surge | 国内 DNS、原生域名转发和端口 53 DNS 接管。 | HTTPS |
| Loon | 国内 DoH 和原生 FakeIP / real-ip。 | HTTPS |
| Shadowrocket | 国内 DNS、代理 fallback 和客户端原生 DNS 接管。 | HTTPS |
| Quantumult X | 国内 DoH、占位 IP 和远端解析。 | 全局 HTTPS |
| Egern | 国内 `proxy_nameservers` 与普通 DNS forward 分离，使用原生 DNS 接管。 | HTTPS |
| Stash | 国内 DoH 和原生 FakeIP。 | HTTP |

自定义健康检查地址按原值输出。网络连通性探测与代理健康检查是两项独立设置。节点 URI 订阅只包含节点，不包含 DNS、分流或健康检查配置。

Mihomo 没有基础代理组时使用国内 DNS。内网域名应按实际网络设置 hosts 或专用 DNS。托管 Fake-IP 排除集合用于真实解析，不能替代直连规则。

DNS 接管只作用于进入客户端隧道的流量，应用内置 DoH 不属于端口 53 接管范围。IP 规则是否触发解析由该规则的 `no-resolve` 设置决定。

客户端配置参考：[sing-box DNS](https://sing-box.sagernet.org/configuration/dns/rule/)、[Surge 测速](https://manual.nssurge.com/tools/testing.html)、[Loon](https://github.com/Loon0x00/LoonManual/blob/master/docs/cn/general.md)、[Quantumult X](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf)、[Egern DNS](https://egernapp.com/docs/configuration/dns/)、[Stash 测速](https://stash.wiki/en/proxy-protocols/proxy-benchmark)。

## 修改管理端访问密钥

在仓库根目录执行：

```bash
pnpm exec wrangler secret put API_KEY --env production
```

输入新的访问密钥后，重新打开管理页面并使用新密钥登录。

修改管理端访问密钥不会改变已有的客户端订阅链接。

## 备份和恢复

在“设置 > 数据管理”中可以：

- 导出当前数据
- 校验并恢复备份
- 清空当前配置

建议在以下操作前导出备份：

- 更新 UniConf
- 大批量调整节点或规则
- 恢复其他备份
- 清空配置

备份包含订阅地址、节点凭据和导出 Token。不要公开上传、发送或粘贴完整备份。

## 订阅刷新

默认自动刷新间隔为 240 分钟。定时任务每五分钟检查一次，但只刷新已经到期的订阅。

订阅没有按预期刷新时，依次检查：

1. 全局自动刷新是否开启。
2. 该订阅是否启用。
3. 该订阅是否设置了独立刷新间隔。
4. 在订阅页面手动刷新是否成功。
5. 上游订阅地址是否仍然有效。

停用订阅后，其中的节点不会参与节点组和配置导出。

## 远程规则集

远程规则集必须使用公开的 HTTP 或 HTTPS 地址，不能使用：

- 带用户名和密码的 URL
- localhost 或本地域名
- 私网或保留 IP 地址

规则集无法下载时：

1. 在浏览器中确认原地址可以访问。
2. 检查 URL 是否发生失效或重定向。
3. 在配置预览中检查规则集来源和转换提示。
4. 如果目标客户端提供原生规则集格式，可以为该客户端设置原生来源。
5. 如果转换后会丢失规则，选择其他来源或使用严格模式阻止导出。

## 配置导出和订阅 Token

### 暂停

暂停导出档案后，其订阅链接停止提供配置。恢复后继续使用原链接。

### 重置 Token

重置后旧链接立即失效。需要将新链接重新添加到客户端。

### 客户端无法更新

依次检查：

1. 导出档案是否被暂停。
2. 客户端中的订阅链接是否完整；通用链接无法识别客户端时，使用 `format` 参数或固定格式链接。
3. Token 是否已经重置。
4. 配置预览是否存在阻断问题。
5. 严格转换模式是否检测到无法转换的规则。

不要公开发送完整订阅链接。需要排查问题时，优先提供页面显示的诊断编号。

## 服务状态

可以通过以下地址检查部署状态：

```text
https://你的部署地址/api/health
https://你的部署地址/api/ready
```

- `/api/health` 成功：站点可以响应请求。
- `/api/ready` 成功：部署所需的服务和配置均可使用。

如果页面可以打开但 `/api/ready` 失败，请查看返回内容并按以下项目检查。

## 常见问题

| 现象                                          | 处理方法                                                       |
| --------------------------------------------- | -------------------------------------------------------------- |
| 无法使用访问密钥登录                          | 确认输入的是管理端 `API_KEY`，而不是导出订阅 Token             |
| 提示缺少 `API_KEY`                            | 重新设置 production 环境的访问密钥                             |
| `/api/ready` 提示 D1 或 KV 不可用             | 检查 Cloudflare 中对应资源以及 `DB`、`KV` binding 是否正常     |
| `D1_ERROR: no such table` 或 `no such column` | 执行 production 数据库更新命令后重新部署                       |
| 页面仍显示旧版本                              | 等待当前部署完成；命令行部署时重新执行构建和部署               |
| 配置预览被阻止                                | 根据预览中的错误修正节点、节点组、规则引用或规则集转换问题     |
| 订阅链接返回不存在                            | 检查档案是否暂停、Token 是否重置，以及客户端是否仍在使用旧链接 |
| 远程订阅或规则集偶尔失败                      | 手动重试；持续失败时检查上游地址、DNS 和重定向                 |

## 自定义域名变更

管理页面和 API 使用当前请求的同源地址，更换自定义域名后无需更新 Worker 配置。
