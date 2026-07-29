# 部署到 Cloudflare

UniConf 部署后会使用以下 Cloudflare 服务：

- Workers：运行服务并提供管理页面、API 和订阅地址
- D1：保存订阅、节点、规则和导出配置
- KV：保存缓存和限流数据

可以选择一键部署或命令行部署，两种方式选择一种即可。

## 方式一：一键部署

适合希望通过 Cloudflare 页面完成部署的用户。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jiayx/uni-conf)

### 1. 登录并创建项目

点击上面的按钮，登录 Cloudflare，然后按照页面提示连接 GitHub 或 GitLab。

Cloudflare 会复制 UniConf 仓库，并为项目创建 D1、KV 和 Worker。

### 2. 填写配置

部署页面需要填写：

| 配置             | 说明                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `API_KEY`        | 管理页面的访问密钥。请使用足够长的随机字符串，并妥善保存                          |
| `ALLOWED_ORIGIN` | 部署后的完整访问地址，例如 `https://uni-conf.example.workers.dev`，不要带结尾 `/` |

`API_KEY` 不是配置导出的订阅 Token。订阅 Token 会在创建导出档案时由 UniConf 自动生成。

Workers.dev 地址由项目名称和账号的 Workers.dev 子域组成，Cloudflare 部署页面会显示这两项。

### 3. 开始部署

确认配置后开始部署。Cloudflare 会自动：

1. 安装依赖并构建应用。
2. 初始化 D1 数据库。
3. 部署 Worker 和管理页面。
4. 绑定 KV 和定时任务。

等待部署状态变为成功，然后打开 Cloudflare 显示的访问地址。

### 4. 首次使用

1. 打开部署地址。
2. 输入部署时设置的 `API_KEY`。
3. 进入管理页面并添加订阅。
4. 在配置导出页面生成订阅地址。

### 5. 后续更新

一键部署会在你的 GitHub 或 GitLab 账号中创建仓库，并连接 Workers Builds。后续向该仓库的生产分支推送代码时，Cloudflare 会重新构建并部署。

## 方式二：命令行部署

适合希望自己管理 Cloudflare 资源和发布过程的用户。

### 1. 准备环境

需要：

- Cloudflare 账号
- Node.js 20.19 或更高版本
- pnpm 11.17 或更高版本
- UniConf 源代码

安装依赖：

```bash
pnpm install --frozen-lockfile
```

登录 Cloudflare：

```bash
cd apps/worker
pnpm exec wrangler login
pnpm exec wrangler whoami
```

### 2. 创建 D1 和 KV

在 `apps/worker` 目录执行：

```bash
pnpm exec wrangler d1 create uni-conf-db
pnpm exec wrangler kv namespace create uni-conf-kv
```

保存命令输出中的 D1 `database_id` 和 KV `id`。

### 3. 配置生产环境

编辑 `apps/worker/wrangler.jsonc`，替换 production 中的三个占位符：

| 占位符                           | 填写内容                                                  |
| -------------------------------- | --------------------------------------------------------- |
| `REPLACE_WITH_PRODUCTION_ORIGIN` | 最终访问地址，例如 `https://uni-conf.example.workers.dev` |
| `REPLACE_WITH_PRODUCTION_D1_ID`  | D1 的 `database_id`                                       |
| `REPLACE_WITH_PRODUCTION_KV_ID`  | KV 的 `id`                                                |

访问地址只填写 Origin，即协议、主机名和可选端口，不包含路径，也不要带结尾 `/`。

账号的 Workers.dev 子域可以在 Cloudflare 控制台的 Workers & Pages 页面查看。

### 4. 设置访问密钥

在 `apps/worker` 目录执行：

```bash
pnpm exec wrangler secret put API_KEY --env production
```

根据提示输入管理页面的访问密钥。

不要把访问密钥写入 `wrangler.jsonc` 或提交到 Git。

### 5. 构建并部署

回到仓库根目录：

```bash
cd ../..
pnpm build
pnpm --filter @uni-conf/worker db:migrate:production
pnpm --filter @uni-conf/worker deploy:production
```

部署完成后，Wrangler 会显示访问地址。

### 6. 验证部署

打开以下地址检查服务状态：

```text
https://你的部署地址/api/health
https://你的部署地址/api/ready
```

`/api/ready` 返回成功后，打开管理页面并输入 `API_KEY`。

如果需要执行完整检查：

```bash
export UNICONF_BASE_URL=https://你的部署地址
read -s UNICONF_API_KEY
export UNICONF_API_KEY
pnpm smoke
unset UNICONF_API_KEY
```

### 7. 配置自定义域名

在 Cloudflare 控制台进入对应 Worker，打开域名与路由设置并添加自定义域名。

然后将 `apps/worker/wrangler.jsonc` 中 production 的 `ALLOWED_ORIGIN` 改为新的完整地址并重新部署：

```bash
pnpm --filter @uni-conf/worker deploy:production
```

### 8. 更新现有部署

获取新版本后：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @uni-conf/worker db:migrate:production
pnpm --filter @uni-conf/worker deploy:production
```

数据库结构更新必须先执行 migration，再部署新版本。

## 常见问题

| 现象                                          | 处理方法                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| 无法使用访问密钥登录                          | 确认输入的值与 production 环境中的 `API_KEY` secret 一致                    |
| `/api/ready` 提示 D1 或 KV 不可用             | 检查 `wrangler.jsonc` 中 production 的 D1、KV ID                            |
| `D1_ERROR: no such table` 或 `no such column` | 重新执行 `pnpm --filter @uni-conf/worker db:migrate:production`             |
| 返回 `ALLOWED_ORIGIN` 相关错误                | 检查地址是否包含正确协议和域名，并去掉路径及结尾 `/`                        |
| 页面仍是旧版本                                | 重新执行 `pnpm build` 和 `pnpm --filter @uni-conf/worker deploy:production` |
| 定时刷新没有立即执行                          | 定时任务每五分钟调度一次，只有已经到期的订阅或资源才会刷新                  |

## 相关文档

- [部署后的运维](./OPERATIONS.md)
- [Cloudflare Deploy Buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
- [Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
