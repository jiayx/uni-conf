# UniConf 数据模型

当前结构来源是 `apps/worker/migrations/0001_initial_schema.sql`。本文说明当前表的职责、关系和 JSON 字段。

## 关系概览

```text
workspaces
  ├─ sources
  ├─ source_import_runs
  ├─ nodes
  ├─ collections
  ├─ groups
  ├─ rules
  ├─ remote_rule_sets
  ├─ export_configs
  └─ app_settings

sources
  ├─ nodes
  ├─ source_import_runs
  └─ remote_rule_sets (可选来源归属)

collections
  └─ groups.collection_ids

groups
  ├─ groups.group_ids
  ├─ rules.target_group_id
  └─ remote_rule_sets.target_group_id / target_override_group_id

remote_rule_sets
  └─ remote_rule_set_source_health

export_configs
  └─ 通过 JSON ID 列表选择 collections/groups/rules/remote_rule_sets

app_settings
  └─ 每个 workspace 一行，主键同时是 workspace ID
```

## `workspaces`

单管理员部署中的配置隔离单元。默认空间 ID 为 `default`，不能删除；其他空间可以创建、重命名和删除。

`sources`、`source_import_runs`、`nodes`、`collections`、`groups`、`rules`、`remote_rule_sets` 和 `export_configs` 都通过 `workspace_id` 归属空间，删除空间时级联清理。管理 API 使用 `X-Workspace-Id` 选择当前空间，未提供时使用默认空间。公开订阅不依赖该请求头，而是通过导出 Token 自动确定所属空间。

## `sources`

订阅和导入内容的拥有者。

主要字段：

- `type`：`url`、`manual`、`file`、`clipboard`
- `url`：远程订阅地址
- `format`：来源格式或 `auto`
- `enabled`：是否参与有效节点和导出
- `node_count`、`last_updated`、`last_refresh_error`
- `update_interval`：分钟；`0` 继承全局间隔
- `user_agent`
- `tags`：JSON 字符串数组
- `source_groups`：解析到的上游节点组
- `raw_content`：最近一次成功内容，用于显示和失败阶段重试
- 流量与到期字段：`upload_bytes`、`download_bytes`、`total_bytes`、`expire_time`

删除来源会级联删除节点；来源规则集使用 `ON DELETE SET NULL`，避免误删用户已经接管的规则集。

## `source_import_runs`

配置导入的摘要与恢复状态。

- 状态：`running`、`success`、`partial`、`undone`
- 节点模式：`all`、`new-only`
- 保存新增、更新、跳过、规则、规则集和冲突计数
- `refresh_error` 与 `structured_error` 分别对应节点阶段和规则阶段
- `structured_changes` 只保存撤销覆盖所需的非敏感路由字段

该表不保存第二份原始配置、节点地址或凭据。原始内容只属于 `sources.raw_content`。

## `nodes`

解析后的节点。

- `source_id`：必需；手动节点也归属于系统创建的 manual source
- 索引字段：`name`、`protocol`、`server`、`port`、`country`、`country_code`
- 状态：`enabled`、`is_manual`
- `tags`：JSON 字符串数组
- `raw_config`：尽量保留来源客户端的原生对象或 URI 信息
- `parsed_config`：用于搜索、展示和通用转换的规范化字段

导出有效节点要求节点和所属来源同时启用。

`raw_config` 当前可以包含：

```ts
{
  sourceFormat: 'uri' | 'mihomo' | 'singbox' | 'unknown'
  sourceUri?: string
  mihomo?: Record<string, unknown>
  singbox?: Record<string, unknown>
  normalized?: Record<string, unknown>
}
```

生成器优先使用目标客户端原生对象；只有已实现的转换才使用规范化字段。

## `collections`

节点组定义。

- `source_ids`、`node_ids`：JSON ID 数组；空来源数组表示全部来源
- `filters`：`NodeFilter[]`
- `renames`：`NodeRename[]`
- `dedup`：`name`、`server_port`、`protocol_server_port`、`full_config`
- `sort`：`country`、`name`、`source`、`protocol`、`manual`
- `sort_country_order`：自定义国家顺序
- `enabled`

系统维护 `builtin-default-node-pool`，默认通过标签过滤排除高倍率节点。

过滤字段：

`name`、`server`、`protocol`、`country`、`countryCode`、`tag`、`sourceId`

过滤操作：

`contains`、`not_contains`、`regex`、`not_regex`、`equals`、`not_equals`、`in`、`not_in`

重命名操作：

`replace`、`regex`、`prefix`、`suffix`、`strip_emoji`、`standardize_country`、`auto_number`

## `groups`

策略组和内置出口。

- 类型：`select`、`url-test`、`fallback`、`load-balance`、`direct`、`reject`
- `collection_ids`：引用节点组
- `group_ids`：引用其他策略组
- `builtins`：`DIRECT` / `REJECT`
- 健康测试字段：`test_url`、`interval`、`tolerance`、`lazy`
- `is_builtin`：系统维护组
- `sort_order`

初始基线包含：

- 基础目标：PROXY、DIRECT、REJECT
- 业务组：AI、Streaming、Social、GitHub、Google、Apple、Microsoft、Speedtest、Crypto、Gaming、Broker、Developer
- 全局节点出口：全部节点、节点选择、自动选择、故障切换

运行时同步会根据场景、节点和出口偏好维护这些组。写入服务会检查引用存在性和循环。

## `rules`

有序手动规则。

- `type`、`payload`
- `no_resolve`
- `target_group_id`
- `enabled`
- `sort_order`
- `compatibility`：创建/更新时计算的客户端兼容性快照

兼容性的实时事实来源仍是 `@uni-conf/shared`；导出不会只信任数据库里的旧快照。

## `remote_rule_sets`

远程规则集配置。

- `url`、`format`、`behavior`
- `preset_source` / `preset_id`：系统目录条目标识
- `source_overrides`：各完整配置客户端的原生来源 URL
- `source_id` / `source_rule_set_key`：订阅源自带规则集的归属
- `source_missing`：刷新后上游定义是否消失
- `target_group_id`：系统/导入默认目标
- `target_override_group_id`：用户显式目标覆盖
- `update_interval`：小时
- `enabled`、`sort_order`

有效目标为 `target_override_group_id ?? target_group_id`。目标覆盖是明确的用户意图，不依赖把整组规则集拖到另一个顺序位置。

格式：

`mrs`、`clash`、`mihomo`、`singbox`、`surge`、`loon`、`shadowrocket`、`quantumultx`、`egern`、`stash`、`text`

行为：

`domain`、`ipcidr`、`classical`

## `remote_rule_set_source_health`

用户主动校验某个规则集全部来源后保存的运行状态：

- `checked_at`
- `expires_at`
- `result`：默认来源、目标原生来源、计数和问题的 JSON

该表是可丢弃的运行数据：

- 修改来源、格式、行为、覆盖或更新间隔时失效
- 不进入配置备份
- 过期结果只作为陈旧证据展示，不等同于持续健康监控

## `export_configs`

导出档案。

- `format`
- `token`
- `enabled`
- 四类 JSON 范围：节点组、策略组、手动规则、远程规则集
- `rule_set_conversion_policy`：`compatible`、`strict` 或 `NULL` 继承全局
- `extra_config`：预留的目标格式扩展对象

每个配置空间都有自己的系统默认档案，由服务自动创建，不可删除，只允许暂停/恢复。它可以针对任意请求格式生成全量配置。高级档案固定一个格式并使用自己的范围。

## `app_settings`

每个配置空间一行，主键为对应的 `workspaces.id`。

| 字段                           | 当前含义                                                            |
| ------------------------------ | ------------------------------------------------------------------- |
| `language`                     | `zh` / `en`                                                         |
| `theme`                        | `system` / `light` / `dark`                                         |
| `unmatched_traffic_policy`     | `proxy`（默认代理）/ `direct`（默认直连）                           |
| `routing_policy_scenarios`     | 业务场景 ID 数组                                                    |
| `routing_outlet_preferences`   | 业务组到稳定出口标识的映射                                          |
| `export_node_naming_mode`      | `original` / `region_sequence` / `source_region_sequence` / `smart` |
| `dns_resolution_mode`          | `single` / `split`                                                  |
| `dns_real_ip_domains`          | 用户额外真实 IP 域名                                                |
| `default_export_token`         | 当前默认公开档案 Token                                              |
| `show_compatibility_warnings`  | 是否展示非阻断兼容性提示                                            |
| `rule_set_conversion_policy`   | 全局 `compatible` / `strict`                                        |
| `enable_auto_refresh`          | 到期订阅源的后台刷新开关                                            |
| `auto_refresh_interval`        | 默认订阅刷新间隔，当前默认 240 分钟                                 |
| `auto_node_groups_enabled`     | 自动国家/标签节点组开关                                             |
| `auto_node_group_types`        | `select` / `url-test` / `fallback`                                  |
| `auto_node_group_keys`         | 已选择的国家/标签键；`NULL` 表示全部候选                            |
| `auto_node_group_include_flag` | 自动组名称是否显示旗帜                                              |

## 备份

备份包含配置表，不包含 `remote_rule_set_source_health`。当前备份格式版本为 8，导入前会验证：

- Schema 版本
- 表和列白名单
- 必填字段与枚举
- JSON 字段结构
- 唯一 ID 和 Token
- 外键式引用
- 策略组循环

备份包含 `raw_config`、`parsed_config` 和订阅内容，因此包含凭据，必须按秘密文件处理。
