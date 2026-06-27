# UniConf 产品需求说明

## 一、产品定位

**UniConf 是一个一站式代理配置管理工具。**

它帮助用户在一个 Web 页面中完成：

```text
订阅管理
节点录入
节点组
节点清洗
策略组组合与出口意图
分流规则编辑
分流策略和远程规则集
多端配置导出
```

最终目标是：

```text
用户只维护一份订阅、节点和规则配置
UniConf 自动生成不同代理软件可用的完整配置文件
```

一句话：

```text
管理一次，导出多端。
```

英文 slogan：

```text
Manage once, export everywhere.
```

## 二、要解决的问题

现在很多用户会同时使用多个代理客户端，例如电脑上用 Mihomo/Clash Verge，手机上用 Loon、Shadowrocket、Stash 或 sing-box。

这些软件的配置格式不同，用户通常需要分别维护：

```text
一套节点订阅
一套策略组
一套分流规则
一套客户端配置
```

这会带来几个问题：

```text
1. 多端规则不同步
2. 节点订阅需要重复管理
3. 手动节点难以统一维护
4. 客户端格式不同，迁移成本高
5. 规则集、策略组、节点组容易混乱
6. 新增一个代理软件时，需要重新写配置
```

UniConf 要解决的是：

```text
把“节点来源、节点组、策略组组合、分流规则”抽象成一份统一配置，再根据目标软件导出不同格式。
```

## 三、目标用户

### 1. 多设备代理用户

这类用户可能同时使用：

```text
Mac / Windows / Linux
iPhone / iPad
Android
路由器 / 软路由 / OpenWrt
服务器
```

他们需要一份配置同步到多个客户端。

### 2. 高级代理用户

这类用户会维护多个订阅源、多个机场、自建节点、备用节点，并希望进行节点筛选、重命名、分组、排序和组合。

### 3. 规则重度用户

这类用户对分流规则有较高要求，例如：

```text
AI 服务走指定节点
流媒体走解锁节点
国内服务直连
广告拦截
下载走特定节点
游戏平台走低延迟节点
公司服务走专用节点
```

### 4. 想替代 Sub-Store 部分能力的用户

这类用户希望不再依赖其他订阅管理工具，而是在 UniConf 里直接完成订阅管理和配置生成。

## 四、产品核心能力

UniConf 的核心能力分为六层：

```text
1. 订阅源管理
2. 节点管理
3. 节点组
4. 策略组组合与出口
5. 分流规则管理
6. 多端配置导出
```

## 四之一、默认智能组合原则

UniConf 的默认体验不是让用户从空白配置开始搭建，而是：

```text
用户只负责提供“节点从哪里来”。
系统负责决定“节点怎么分组、流量怎么走、DNS 怎么解析、配置怎么导出”。
```

第一版默认智能组合的目标流程是：

```text
1. 用户粘贴一个或多个订阅链接
2. 系统解析节点并识别国家 / 地区、倍率、流媒体、解锁、家宽 / 原生特征
3. 系统按国家 / 地区和关键标签自动生成 url-test 节点组
4. 系统启用基础出口和默认业务分流组
5. 系统加载预置远程规则集并分配匹配后使用的出口 / 分流策略
6. 用户选择导出客户端并得到完整配置
```

默认导出配置、自动节点组 / 策略组同步、预置远程规则集初始化由同一条零配置初始化链路维护。概览、设置、导入恢复、订阅源创建、手动节点创建和定时自动刷新都必须复用这条链路，避免某个入口只生成节点但缺少默认规则或导出配置。

自动节点组默认开启，并在节点新增、删除、订阅刷新或设置变更后重新同步。默认只生成 `url-test` 类型，用户可以在设置中额外选择 `select` / `fallback`，也可以关闭自动生成；自动生成的国家 / 地区节点组名称默认包含旗帜 Emoji，设置中可关闭。具体启用哪些国家 / 地区或导入哪些订阅源自带节点组，在“节点组”的自动生成面板里完成，避免让用户手工维护节点组和策略组之间的关系。

### 默认启用的基础目标与节点出口

这些内置组始终存在，不受策略组组合开关影响。它们分成两类：

```text
规则基础目标：
PROXY
DIRECT
REJECT

全局节点出口：
全部节点
节点选择
自动选择
故障切换
```

其中 `PROXY / DIRECT / REJECT` 是规则可以直接命中的基础策略；`全部节点 / 节点选择 / 自动选择 / 故障切换` 是业务策略组可选择的出口候选。

产品交互上，`PROXY / DIRECT / REJECT` 单独展示为“规则基础目标”，不混入业务分流策略组列表，也不要求用户创建：

- `PROXY` 是默认代理出口，系统会自动把节点选择、自动选择、故障切换、全部节点以及国家 / 标签自动节点组放进去。
- `DIRECT` 是直连出口，国内规则、局域网和无需代理的流量直接命中。
- `REJECT` 是拒绝出口，广告、HTTPDNS 等拦截规则直接命中。

导出时需要按客户端语义处理基础出口。以 Mihomo / Stash 为例，`DIRECT` 和 `REJECT` 是客户端内置策略名，不应该额外导出成 `type: direct` / `type: reject` 的 `proxy-groups`；规则和其他策略组可以直接引用这两个内置策略名。sing-box 则会把它们转换成 `direct` / `block` outbound。

业务分流策略组只展示 AI、Streaming、Telegram、GitHub、漏网之鱼等用户真正需要理解和调整的流量意图；这些分流组会自动包含基础出口和可用节点出口，用户不需要手动关联。

### 使用场景组合

系统把策略组组合做成可选的使用场景组合。无论选择哪个组合，基础出口始终保留；组合只决定额外启用哪些业务分流组：

策略组组合卡片需要显式提示固定存在的 `PROXY / DIRECT / REJECT`，并单独列出全局节点出口和额外业务分流组；固定存在的 `PROXY / DIRECT / REJECT` 和全局节点出口也在“基础目标与节点出口”区域展开说明，避免用户误以为选择空组合会移除直连、拒绝、默认代理或节点选择能力。

| 组合 | 推荐 DNS | 额外启用的业务分流组 |
|------|----------|------------------------|
| 空组合 | 智能防污染 | 无业务分流组，只保留基础出口 |
| 极简模式 | 智能防污染 | 漏网之鱼 |
| 默认智能组合 | 智能防污染 | AI、Streaming、Telegram、Social、GitHub、Apple、Microsoft、漏网之鱼 |
| AI 优先模式 | 智能防污染 | AI、GitHub、Developer、Apple、Microsoft、漏网之鱼 |
| 流媒体模式 | 智能防污染 | Streaming、Telegram、Social、Apple、Microsoft、漏网之鱼 |
| 路由器模式 | 兼容优先 | Streaming、Telegram、GitHub、Apple、Microsoft、漏网之鱼 |
| 扩展组合 | 智能防污染 | 默认智能组合 + Crypto、Gaming、Developer |

默认智能组合适合大多数用户，启用这些业务分流组：

```text
AI
Streaming
Telegram
Social
GitHub
Apple
Microsoft
漏网之鱼
```

扩展组合在默认智能组合基础上增加：

```text
Crypto
Gaming
Developer
```

空组合只保留基础出口，业务分流组由用户手动添加。极简模式只暴露代理兜底，适合“不想理解分流，只要国内直连、国外代理、广告拦截”的用户。AI 优先、流媒体模式、路由器模式是更明确的入口，但底层仍然复用同一套规则集、出口排序和导出逻辑。用户切换场景组合时，系统会同步套用该组合推荐的 DNS 模式；之后仍可在设置里手动调整。

无论选择哪种组合，系统都会把基础出口和可用节点组自动放入每个业务分流组，用户不需要手工维护关联关系。

默认候选出口顺序会按业务意图自动排序，因为 select 类型默认使用第一个候选：

```text
PROXY / GitHub / 漏网之鱼 -> 自动选择、节点选择、故障切换、全部节点、国家自动组
AI -> 美国自动、日本自动、新加坡自动、自动选择、节点选择、故障切换
Streaming -> 香港自动、日本自动、新加坡自动、台湾自动、美国自动、自动选择
Telegram -> 新加坡自动、香港自动、日本自动、美国自动、自动选择
```

如果某个国家 / 地区自动组不存在，系统会跳过它并继续使用后面的可用候选。

用户仍然可以在策略组页面为某个业务分流组选择“默认出口”，例如把 `AI` 的默认出口改成 `美国自动` 或把 `Streaming` 改成 `香港自动`。这个选择只保存为意图级偏好：系统同步时把该出口提到候选列表第一位，其余基础出口、全局节点出口和节点组仍自动维护，用户不需要手动建立或维护策略组嵌套关系。自动节点组的偏好使用国家 / 标签 marker 保存，而不是使用临时数据库 id，所以节点变化导致自动组删除再生成后，偏好仍然能指回同一个“美国自动”意图。

### 默认规则出口推荐

预置远程规则集应自动分配到最接近的策略组：

```text
局域网 / 国内域名 / 国内 IP -> DIRECT
广告 / 追踪 / 恶意域名 / HTTPDNS -> REJECT
AI 服务 -> AI
流媒体 -> Streaming
Telegram -> Telegram
国外社交 -> Social
Git 服务 -> GitHub
Apple 代理规则 -> Apple
Microsoft / OneDrive -> Microsoft
加密货币 -> Crypto
游戏平台 -> Gaming
开发服务 -> Developer
其他国外流量 / 兜底 MATCH -> 漏网之鱼
```

如果当前组合没有启用某个专用策略组，规则集回退到 `PROXY`；如果没有显式 MATCH 规则，导出器优先用 `漏网之鱼` 作为兜底，未启用时再回退到 `PROXY`。这样用户切换组合时不会产生悬空规则。

QuixoticHeart/rule-set 是默认远程规则包来源。第一版用 Quixotic 的 Advertising 与 HTTPDNS 规则承担广告、追踪、恶意域名和 HTTPDNS 拦截，并统一分配到 `REJECT`。对于 Quixotic 当前没有独立拆分的 Telegram，系统额外内置 MetaCubeX/meta-rules-dat 的 `geosite/telegram.list`，并把它分配到 `Telegram` 策略组。

预置和内置规则集的目标分流组由系统根据当前策略组组合自动维护，用户界面在分流策略分组和单条规则集上都提供启用 / 停用开关，不提供编辑入口；需要特殊匹配时再添加“补充规则集”。这样用户不需要逐条理解或维护默认规则到策略组的关系，也避免手动修改被下一次默认同步覆盖。

预置远程规则集还会自动写入稳定的优先级顺序，导出时按 `sort_order` 从小到大输出：

```text
私有网络 / 本机规则
广告 / 追踪 / 恶意域名 / HTTPDNS 拦截
国内直连
AI
Telegram
流媒体
GitHub / Apple / Microsoft / Google / 游戏 / Crypto
社交 / 常规代理 / 其他服务
```

### 节点自动处理

订阅刷新后，系统应自动完成：

```text
国家 / 地区识别
排除官网、流量、套餐、过期等提示节点
排除不可识别协议节点
按完整节点配置去重
识别倍率、流媒体、解锁、家宽 / 原生特征并写入节点标签
按国家 / 地区生成 url-test 节点组
按流媒体 / 解锁、家宽 / 原生标签生成专用 url-test 节点组
自动生成节点组默认排除 high-multiplier 高倍率节点
把自动节点组加入业务分流组候选出口
```

节点组列表接口也会在读取时同步一次自动节点组，避免节点已经变化但用户进入节点组页时仍看到旧的国家 / 标签分组。

默认排除的提示节点包括：

```text
官网 / 官方网站 / 用户中心
剩余流量 / 已用流量 / Traffic / Used / Total
套餐 / 到期 / 过期 / Expire
订阅 / 更新订阅 / 重置
倍率说明 / 倍数规则
```

普通节点名里的倍率标记不会被误删，例如 `🇭🇰 HK IEPL 2x`、`US｜Los Angeles｜x1` 会保留。倍率会被识别成节点标签：

```text
🇭🇰 HK IEPL 2x -> multiplier:2x, high-multiplier
US｜Los Angeles｜x1 -> multiplier:1x
日本 倍率: 0.5 -> multiplier:0.5x
```

节点识别标签还包括：

```text
Netflix / YouTube / Disney+ / 流媒体 -> streaming
解锁 / unlock -> unlock
家宽 / residential / ISP -> residential
原生 / native ip -> native-ip
```

节点组可以直接按 `tag = high-multiplier` 排除高倍率节点，或用 `tag contains multiplier:` 做倍率节点筛选。系统也会复用这些标签自动生成专用节点组；自动生成的国家 / 地区节点组、Streaming Auto、Native Auto 默认都会加上 `tag not_in high-multiplier`，避免高倍率节点成为默认出口。自动组生成时也按这个默认过滤后的结果判断是否创建，所以某个国家 / 标签池如果只有高倍率节点，不会生成空节点组。手动节点组不强制排除，用户可以按自己的成本策略调整。

```text
Streaming Auto：匹配 streaming / unlock，优先放入 Streaming 策略组
Native Auto：匹配 residential / native-ip，优先放入 AI 和 Streaming 策略组
```

### 默认节点命名

系统内部保留订阅原始节点名，方便用户排查订阅内容。导出完整配置时，默认使用稳定的智能命名：

```text
地区 - 来源 - 序号
```

例如：

```text
HK - Airport A - 01
HK - Airport A - 02
JP - Airport B - 01
Other - Manual - 01
```

这样多个订阅混合导出时，节点来源和地区都能直接看出来；策略组里的节点引用会同步使用最终导出名，避免出现重复节点名或引用原名失效的问题。

用户也可以在设置里切换导出节点命名模式：

| 模式 | 导出示例 | 适用场景 |
|------|----------|----------|
| 保留原名 | HK 01 | 需要完全保留订阅或节点组重命名结果 |
| 地区 + 序号 | HK - 01 | 只关心地区，想让客户端列表更短 |
| 来源 + 地区 + 序号 | Airport A - HK - 01 | 多订阅混合时需要先看来源 |
| 智能命名 | HK - Airport A - 01 | 默认模式，兼顾地区、来源和稳定排序 |

自动生成的节点组默认使用国家 / 地区代码和 emoji 旗帜命名，例如：

```text
🇭🇰 HK Auto
🇯🇵 JP Auto
🇸🇬 SG Auto
🇺🇸 US Auto
```

自动生成的标签节点组使用意图命名，例如 `Streaming Auto`、`Native Auto`。

自动节点组不是一次性前端生成结果，而是持久设置驱动的后端同步：默认启用并只生成 `url-test` 类型；用户可以在 `select / url-test / fallback` 中多选，也可以取消全部候选来关闭自动节点组。关闭或取消某个候选后，后端同步会删除对应自动节点组出口，不会在下一次节点变化或列表刷新时重新创建。国家 / 地区自动组名称默认带 emoji 旗帜，用户可以关闭旗帜显示。自动生成的节点组不能在普通节点组表单里编辑或删除，只能通过自动生成面板选择启用范围；后端集合接口也会拒绝伪造或修改自动节点组标记。

### 默认 DNS 预设

DNS 不要求用户手写配置，系统提供三档意图选项：

| 模式 | 默认 | 生成逻辑 |
| ---- | ---- | -------- |
| 兼容优先 | 否 | 使用传统 redir-host，不启用 fake-ip，适合路由器和兼容性优先场景 |
| 智能防污染 | 是 | 使用国内可信 DNS 解析国内域名，其他请求走可信 DNS，并启用污染过滤 |
| 高级 fake-ip | 否 | 在智能防污染基础上启用 fake-ip 和常见兼容过滤 |

用户看到的是 `兼容优先 / 智能防污染 / 高级 fake-ip`，导出器负责转换为 Mihomo、Stash、sing-box 等客户端的具体 DNS 字段。

### 默认导出配置

系统会自动创建一个默认导出配置：

```text
名称：默认 Mihomo 配置
格式：mihomo YAML
范围：所有启用节点、节点组、策略组与出口、分流规则和远程规则集
链接：/sub/{default_export_token}/mihomo.yaml
```

订阅自动刷新默认开启，用户第一次打开设置页、导出页或直接预览导出时，系统都会确保这个默认配置存在。这样 MVP 可以做到：
默认自动刷新周期为 24 小时；单个订阅源设置了独立更新间隔时，以订阅源设置为准。

```text
粘贴订阅链接 -> 自动刷新订阅 -> 复制默认导出链接
```

第一版导出模板里，Clash Verge Rev 和 OpenClash 明确作为 Mihomo / Clash YAML 的客户端目标展示；底层仍复用统一中间模型和同一个 YAML 导出器，不维护单独业务逻辑。
概览页在没有可用节点时直接提供订阅链接输入框。用户可以一次粘贴一个或多个 URL，多个链接按换行、空格或逗号分隔；前端会拆分成多个订阅源并逐个保存、立即刷新、解析节点、同步自动节点组和默认分流策略。如果订阅刷新失败或没有解析出可导出节点，概览页仍保留订阅输入入口，避免用户被迫进入高级页面排查。有可用节点后概览页直接显示默认订阅链接 `/sub/{default_export_token}/mihomo.yaml`，并提供 Mihomo、Clash / OpenClash、sing-box、Loon 的快捷下载按钮，用户不需要先进入导出配置页才能复制链接或下载常用客户端配置。快速导出区域需要提示默认订阅链接已经包含当前启用的节点、节点组、分流策略和兼容规则集，可以直接复制到客户端使用。快捷下载由前端捕获后端 readiness 错误并显示在当前页面，不把 409 JSON 或文本错误直接打开成新标签。
概览页快捷下载复用默认导出配置的范围设置，但最终格式由下载接口路径决定；例如 `/api/export/download/singbox` 会使用默认范围生成 sing-box JSON，而不是因为默认配置名为 Mihomo 就导出 YAML。
概览页仍保留“粘贴订阅链接、系统自动生成配置、复制默认导出链接”的三步解释；三步入口分别指向订阅源、配置预览和导出配置页，节点组、策略组和规则页作为高级入口保留，但不作为新用户必走步骤展示。
导出页、概览页、下载接口和公开订阅入口复用同一份导出格式文件名映射，避免 Stash、Egern、节点订阅等格式在不同入口出现不同后缀。
导出配置弹窗默认只暴露名称和目标客户端，名称可留空并由系统按目标客户端生成，例如“默认 sing-box 配置”；弹窗顶部需要提示“默认导出完整配置”，让用户知道只选择目标客户端即可。节点组、策略组与出口、手动规则和远程规则集范围折叠到“高级范围设置”。这些范围不选择时就是导出全部启用内容，界面文案直接写成“导出全部启用节点组 / 策略组 / 手动规则 / 兼容规则集”，所以用户不需要理解 include 关系也能直接生成完整配置。
公共订阅响应会复用订阅源刷新时缓存的 `subscription-userinfo` 流量信息；多个启用订阅源会聚合 upload / download / total，并使用最早的 expire，方便客户端继续显示流量和到期信息。

### 配置预览校验

打开配置预览页或切换目标客户端时，系统会自动生成默认配置预览并返回配置校验结果。预览接口错误会作为页面错误单独展示，不会混入配置内容，也不会同时显示“无兼容性问题”。预览页会先显示面向用户的状态摘要：没有阻塞问题时提示“配置可用”；存在问题时按阻塞问题、自动调整项和格式转换提示计数，再展开具体警告。这样用户不需要先读完整 YAML 才知道当前配置能不能用。第一版先覆盖这些问题：

```text
节点数量是否为 0
节点名称是否重复
订阅源最近是否刷新失败
订阅源是否从未成功刷新
策略组是否引用了不存在或未导出的策略组
规则是否引用了不存在或未导出的策略组
规则类型是否兼容当前导出客户端
远程规则集是否引用了不存在或未导出的策略组
远程规则集格式是否兼容当前导出客户端
远程规则集 URL 是否是可下载的 http(s) 地址
DNS 模式是否能被当前导出客户端完整承载
MATCH 是否不在最后
```

其中缺失 MATCH 是默认零配置路径：导出器会自动追加兜底策略，不在预览页提示用户。只有用户显式添加了 MATCH 但没有放在最后时，预览才提示导出时会把 MATCH 放到最后。规则类型部分兼容、远程规则集格式不兼容属于可降级或可跳过问题：导出器会按客户端能力降级，或者跳过目标客户端无法承载的规则并提示用户。DNS 模式兼容性属于降级提示：Mihomo / Clash、Stash、sing-box 可以导出系统托管 DNS；其他客户端或纯节点订阅遇到智能防污染、高级 fake-ip 时会提示 DNS 字段按客户端能力降级或跳过。订阅源最近刷新失败、远程规则集 URL 无法作为 http(s) 下载地址、缺少节点或引用不存在的策略组、规则类型完全不支持属于需要用户处理的问题。

设置里的“显示兼容性警告”直接影响配置预览：开启时返回并展示 warnings，关闭时预览仍生成配置但不返回可隐藏的兼容性 warnings；后端仍会保留缺少可导出节点、目标格式完全无可用节点等 readiness 问题。预览生成成功且没有 warnings 时，页面显示“配置可用 / 无兼容性问题”，让用户确认当前配置可以直接复制或下载。

## 五、订阅源管理

用户可以在 UniConf 中保存多个订阅来源。

### 支持的来源类型

```text
远程订阅链接
手动录入节点
批量导入节点链接
从现有配置文件导入
从剪贴板导入
```

### 远程订阅链接

用户可以添加：

```text
机场订阅链接
Clash / Mihomo 订阅
Base64 普通节点订阅
sing-box 配置订阅
Surge / Loon / Quantumult X / Shadowrocket 类型订阅
```

新增订阅源的默认路径只要求填写订阅链接，支持一次粘贴多个链接并自动拆成多个订阅源。空状态和新增弹窗都应明确提示“只需要填写订阅链接”：保存后立即刷新订阅，自动识别节点、生成节点组、启用默认分流策略和导出配置。即使用户绕过概览页、直接从订阅源页添加链接，后端也会确保默认导出配置、自动节点组 / 策略组和预置远程规则集都已初始化。名称可以留空，系统会从订阅 URL 的域名自动生成；批量粘贴时名称默认留空，让每个订阅源使用自己的域名命名。订阅格式、User-Agent、刷新间隔等字段都有默认值，属于高级调整项，默认折叠，不作为新用户必填项。

### 手动节点

用户可以优先直接粘贴节点 URI，系统自动识别协议、服务器、端口、国家 / 地区和协议字段：

```text
ss://...
vmess://...
vless://...
trojan://...
hysteria2://... / hy2://...
tuic://...
anytls://...
socks5://...
http://... / https://...
```

如果没有 URI，用户也可以逐字段录入节点信息，例如：

```text
节点名称
协议类型
服务器地址
端口
密码 / UUID / 密钥
TLS 设置
SNI
传输方式
备注
标签
```

手动 URI 与订阅解析复用同一套协议解析逻辑；逐字段录入时，系统也会复用共享节点识别逻辑，从节点名称中识别国家 / 地区、倍率等标签。保存后仍写入统一的 `nodes` 数据模型，并参与国家 / 地区自动节点组生成。对于只使用自建节点、没有订阅链接的用户，手动节点创建后也会确保默认导出配置、自动节点组 / 策略组和预置远程规则集已初始化。

### 订阅源操作

每个订阅源需要支持：

```text
启用 / 禁用
手动刷新
自动更新
查看节点数量
查看更新时间
查看订阅状态
编辑备注
删除订阅
```

远程订阅链接创建时默认执行一次刷新，相当于一次请求完成：

```text
保存订阅源 -> 拉取订阅 -> 解析节点 -> 清理提示节点和不可识别协议 -> 自动生成节点组出口候选
```

如果刷新失败，系统仍保留订阅源，并把刷新错误返回给前端展示；用户可以修改链接、格式或 User-Agent 后重新刷新。
订阅源会持久化最后一次刷新错误，手动刷新、创建时刷新、自动刷新失败都会更新该状态；下一次刷新成功后自动清空。
编辑订阅源时，如果 URL、格式或 User-Agent 发生变化，前端保存后会立即触发一次刷新，让用户更换订阅链接后不需要再手动点刷新。

## 六、节点管理

UniConf 需要把不同订阅来源里的节点统一解析为内部节点列表。

### 节点协议覆盖

应优先覆盖常见协议：

```text
Shadowsocks / SS
VMess
VLESS
Trojan
Hysteria / Hysteria2
TUIC
NaiveProxy
WireGuard
Socks5
HTTP / HTTPS
SSH Tunnel
Reality
ShadowTLS
```

### 节点信息字段

每个节点应至少包含：

```text
节点名称
协议类型
服务器地址
端口
来源订阅
国家 / 地区
标签
是否启用
备注
原始配置
解析后的标准配置
```

### 节点操作

用户需要可以：

```text
查看所有节点
按订阅源查看节点
搜索节点
启用 / 禁用节点
删除手动节点
复制节点
编辑手动节点
查看节点详情
```

## 七、节点组功能

这是类似 Sub-Store 的核心能力。

用户可以创建一个或多个“节点组”。节点组是用户可见的出口配置：它包含一组节点过滤和清洗条件，以及 select / url-test / fallback 等节点选择方式，并会作为业务分流组的出口候选。系统内部可以用节点过滤配置和对应出口组共同实现，但用户不需要手动维护这两层关系。

例如：

```text
默认代理节点
流媒体节点
AI 节点
低倍率节点
香港节点
日本节点
美国节点
自建节点
备用节点
```

每个节点组可以从多个订阅源中选择节点。

### 节点组需要支持

```text
选择来源订阅
选择手动节点
节点过滤
节点重命名
节点去重
节点排序
节点标签
节点预览
```

### 节点过滤

支持按照以下条件过滤：

```text
节点名称包含
节点名称不包含
正则表达式
协议类型
国家 / 地区
来源订阅
倍率
标签
是否可用
是否手动节点
```

常见过滤场景：

```text
删除“官网”
删除“剩余流量”
删除“过期”
删除“套餐”
删除“流量”
只保留香港 / 日本 / 新加坡 / 美国节点
排除高倍率节点
只保留自建节点
```

### 节点重命名

支持：

```text
关键词替换
正则替换
地区标准化
去除 emoji
去除多余符号
添加前缀
添加来源名
自动编号
```

例如：

```text
🇭🇰 HK Hong Kong 01 → 香港 01
JP 日本 Tokyo 02 → 日本 02
SG 新加坡 03 → 新加坡 03
```

### 节点去重

系统默认在最终导出阶段按完整节点配置去重。即使导出范围包含全部节点，或者多个节点组里引用了同一个实际节点配置，最终 `proxies` / `outbounds` 里也只保留第一条可用节点，策略组引用会同步使用去重后的导出节点名。

支持按以下维度去重：

```text
节点名称
服务器地址 + 端口
协议 + 服务器地址 + 端口
完整节点配置
```

### 节点排序

支持：

```text
按地区排序
按名称排序
按来源排序
按协议排序
按延迟排序
按手动顺序排序
```

## 八、策略组组合与出口

策略组用于决定规则命中后流量走哪里，但产品上要区分两层：

- 基础出口：`PROXY / DIRECT / REJECT`
- 全局节点出口：`全部节点 / 节点选择 / 自动选择 / 故障切换`
- 业务分流策略组：`AI / Streaming / Telegram / GitHub / 漏网之鱼` 等流量意图

节点组本质上是“可被选择的出口候选”，由节点过滤条件和 select / url-test / fallback 等选择方式组成。内置业务分流策略组和用户新增的非节点业务组都会自动包含基础出口、全局节点出口和可用节点组，用户不需要手动把每个节点组绑定到每个业务策略组。

策略组编辑交互不暴露“嵌套哪些策略组 / 关联哪些内置出口”这类关系维护项。用户创建或编辑业务分流组时只需要设置名称、选择方式和测速参数，出口候选由系统自动维护。

常见策略组：

```text
PROXY
AI
Streaming
Social
Apple
Microsoft
Google
Telegram
Game
DIRECT
REJECT
```

### 用户可创建的业务策略组类型

用户新增业务分流组时只暴露这些选择方式：

```text
手动选择
自动测速
故障转移
负载均衡
```

`DIRECT` / `REJECT` 是系统基础出口，不作为用户可创建类型；业务策略组之间的嵌套候选由系统从基础出口、全局节点出口和节点组自动生成，不要求用户手动维护。

### 策略组内容

策略组内容按角色生成：

```text
PROXY：自动包含节点选择、自动选择、故障切换、全部节点和国家 / 标签节点组
业务分流策略组：内置组和用户新增非节点组都自动包含基础出口、全局节点出口和可用节点组
节点组对应的出口策略：引用该节点组筛选出的节点
DIRECT / REJECT：客户端内置出口或对应客户端的直连 / 拒绝 outbound
```

例如：

```text
PROXY 默认优先自动选择
AI 默认优先 Native Auto、美国自动、日本自动、新加坡自动
Streaming 默认优先 Streaming Auto、香港自动、日本自动、新加坡自动
Social 使用 PROXY
DIRECT 使用直连
REJECT 使用拒绝
```

## 九、分流规则管理

用户可以用友好的方式编辑规则，而不是直接写 YAML、JSON 或 INI。

### 规则类型

应覆盖常见规则类型：

```text
完整域名
域名后缀
域名关键词
IP-CIDR
IP-CIDR6
GeoIP
GeoSite
进程名
端口
协议
入站类型
源 IP
目标端口
规则集
最终兜底规则
```

不同客户端支持的规则类型不同，UniConf 应该在产品层提示兼容性。

### 规则字段

每条规则包含：

```text
规则名称
匹配类型
匹配内容
匹配后使用的出口 / 分流策略
是否启用
优先级 / 排序
备注
适用客户端
```

### 规则顺序

规则顺序非常重要，需要支持拖拽排序。

典型顺序：

```text
广告拦截
隐私拦截
私有网络直连
AI
流媒体
社交媒体
Apple
Microsoft
Google
国内域名直连
国内 IP 直连
兜底代理
```

## 十、预置分流策略与规则来源

UniConf 应以内置远程规则集作为默认分流来源，让用户不用从零开始写规则。手动规则只作为用户自建补充，用于无法通过远程规则集表达的少量本地规则；系统不再提供单独的本地规则模板。

### 推荐预置规则分类

```text
AI
Streaming
Social
Apple
Microsoft
Google
Telegram
YouTube
Netflix
Disney+
Prime Video
Spotify
TikTok
Game
Download
Developer
Crypto
PayPal
Banking
China Direct
China IP
Private Network
Advertising
Privacy
Reject
Proxy
Global
```

### 规则来源

可以参考和兼容常见规则集生态，例如：

```text
QuixoticHeart/rule-set
MetaCubeX/meta-rules-dat
blackmatrix7/ios_rule_script
SukkaW/Surge
ACL4SSR
Loyalsoldier/v2ray-rules-dat
ConnersHua/RuleGo
Cats-Team/AdRules
```

例如 QuixoticHeart/rule-set 明确面向 mihomo/clash.meta、Surge、Loon、Stash、Shadowrocket、Quantumult X、Egern 和 sing-box 等多个代理工具提供规则集；其 README 也提到该项目会每天自动构建，并包含不同客户端的规则集目录。([GitHub][1])

## 十一、远程规则集引用

除了系统预置远程规则集，用户还应该能引用自己的远程规则集。

用户可以添加：

```text
规则集名称
规则集 URL
规则集类型
匹配内容类型
匹配后使用的出口 / 分流策略（补充规则集可选，默认 PROXY）
更新周期
是否启用
```

`规则集类型` 表达来源格式和兼容客户端，例如 Mihomo、sing-box、Surge 或纯文本；`匹配内容类型` 表达规则内容语义，例如域名、IP CIDR 或 Mihomo classical。两者不能混在一个字段里，否则纯文本域名列表和 classical 规则列表会在 Mihomo `rule-provider` 导出时被错误地写成同一种 `behavior`。

远程规则集可以用于：

```text
广告拦截
AI 服务
流媒体
国内直连
国外代理
社交媒体
游戏平台
```

## 十二、配置导出

UniConf 最终要导出完整配置文件，而不是只导出规则片段。

完整配置应包含：

```text
节点
策略组
分流规则
远程规则集
基础网络配置
DNS 配置
日志等级
客户端特定选项
```

## 十三、需要覆盖的常用代理软件

UniConf 应按优先级覆盖以下代理软件和配置生态。

### 第一优先级：主流核心与通用格式

```text
Mihomo / Clash.Meta
Clash Premium / Clash 格式
sing-box
Surge
Loon
Shadowrocket
Quantumult X
Stash
Egern
```

QuixoticHeart/rule-set 和 Sub-Store 这类生态项目通常都围绕这些客户端提供规则集或订阅管理能力，说明它们是当前代理配置生态中的常见目标格式。([GitHub][1])

### 第二优先级：桌面端常用软件

```text
Clash Verge Rev
Clash Nyanpasu
Clash for Windows 兼容配置
ClashX / ClashX Pro 兼容配置
Mihomo Party / Clash Party
FlClash
GUI.for.Clash
ClashN
V2rayN
NekoRay
Hiddify
```

Mihomo 官方文档列出了多个第三方客户端，如 Clash Verge Rev、Clash Nyanpasu、FlClash、GUI.for.Clash、ClashN、OpenWrt Nikki 等，用于不同平台的 Mihomo / Clash 生态使用。([虚空终端][2])

### 第三优先级：移动端常用软件

iOS / iPadOS：

```text
Surge
Loon
Shadowrocket
Quantumult X
Stash
Egern
sing-box for Apple / SFI / SFM
Clash Mi
Nextin
sing-box VT
```

App Store 相关页面中，Quantumult X、Stash、Shadowrocket、Loon、Egern、Clash Mi、Nextin、sing-box VT 等经常互相出现在同类推荐中，可作为 iOS 代理客户端生态的常见覆盖对象。([App Store][3])

Android：

```text
sing-box for Android / SFA
Clash Meta for Android
FlClash
V2rayNG
NekoBox for Android
Hiddify
Surfboard
Matsuri
SagerNet
```

sing-box 官方文档说明 SFA 可以在 Android 上管理和运行本地或远程 sing-box 配置文件，并提供 TUN 等平台功能。([Sing Box][4])

### 第四优先级：路由器 / OpenWrt / 网关场景

```text
OpenClash
Nikki / OpenWrt Nikki
PassWall
PassWall2
SSR Plus+
ShellCrash
HomeProxy
Mihomo TProxy
sing-box on OpenWrt
```

这些场景通常更关注：

```text
规则集性能
二进制规则集
DNS 分流
透明代理
旁路由
TUN / TProxy
自动更新
低内存占用
```

Mihomo 文档中也列出了 OpenWrt Nikki、FullCombo Shark、OpenWrt NekoBox 等第三方客户端/前端。([虚空终端][2])

### 第五优先级：协议型客户端

```text
V2Ray
Xray
v2ray-core
sing-box core
Shadowsocks-libev
Shadowsocks-rust
Trojan-Go
Hysteria
Hysteria2
TUIC
NaiveProxy
Brook
```

这些更偏底层核心或单协议客户端。UniConf 可以优先把它们作为节点协议支持，而不是优先作为完整配置导出目标。

## 十四、不同软件的导出目标

UniConf 需要区分“完整配置导出”和“兼容格式导出”。

### 完整配置导出

优先支持：

```text
Mihomo / Clash.Meta
sing-box
Surge
Loon
Stash
Quantumult X
Shadowrocket
Egern
```

### 兼容订阅导出

面向：

```text
Clash Verge Rev
Clash Nyanpasu
FlClash
ClashX
ClashN
OpenClash
Nikki
Mihomo Party
```

这些通常可以消费 Mihomo / Clash 格式配置。

### 节点订阅导出

面向：

```text
V2rayN
V2rayNG
NekoBox
Hiddify
SagerNet
Matsuri
Surfboard
```

这些更适合导出节点链接集合，例如：

```text
ss://
vmess://
vless://
trojan://
hysteria2://
tuic://
```

## 十五、用户界面结构

产品页面建议分为几个主要模块：

```text
1. Dashboard
2. Sources
3. Nodes
4. Node Groups
5. Policy Templates
6. Rules
7. Routing Policies
8. Export
9. Preview
10. Settings
```

### Dashboard

显示整体状态：

```text
订阅源数量
节点数量
启用节点数量
规则数量
上次更新时间
导出链接
最近错误
```

### Sources

管理订阅源：

```text
添加订阅链接
添加手动节点
批量导入
刷新订阅
查看订阅状态
```

### Nodes

查看所有节点：

```text
搜索
过滤
启用 / 禁用
按地区查看
按来源查看
查看协议
查看延迟
```

### Node Groups

创建节点组：

```text
选择订阅源
过滤节点
重命名节点
排序节点
预览结果
```

### Policy Templates

管理策略组组合与默认出口意图：

```text
选择策略组组合
查看基础出口
查看业务分流策略组
添加额外业务策略
为业务分流组选择默认出口
```

### Rules

编辑分流规则：

```text
添加规则
选择匹配类型
选择匹配后使用的出口 / 分流策略
调整规则顺序
启用 / 禁用规则
```

### Routing Policies

管理预置和补充远程规则集：

```text
查看默认分流策略
按分流策略或单条规则集开启 / 关闭
添加补充远程规则集
为补充规则集选择匹配后使用的出口 / 分流策略（不选则默认 PROXY）
```

### Export

生成导出链接：

```text
Mihomo YAML
Clash YAML
sing-box JSON
Surge CONF
Loon CONF
Shadowrocket CONF
Quantumult X CONF
Stash YAML
Egern YAML
节点订阅
```

### Preview

预览生成结果：

```text
查看完整配置
查看不同客户端差异
检查规则顺序
检查策略组引用
检查不兼容规则
```

## 十六、兼容性检查

UniConf 需要告诉用户：

```text
这条规则哪些客户端支持
哪些客户端不支持
是否需要降级转换
是否会丢失信息
是否需要改写为其他规则
```

例如：

```text
PROCESS-NAME 可能在部分客户端不兼容
GeoSite 在不同客户端支持方式不同
sing-box route rule 和 Clash rules 表达方式不同
Loon / Surge / Quantumult X 的脚本能力不同
Shadowrocket 对复杂策略组能力有限
```

产品层需要给用户明确提示：

```text
完全兼容
部分兼容
需要转换
不支持
```

## 十七、导入能力

为了降低迁移成本，UniConf 应支持从已有配置导入。

### 支持导入

```text
Clash / Mihomo YAML
sing-box JSON
Surge CONF
Loon CONF
Shadowrocket CONF
Quantumult X 配置
Stash 配置
普通节点订阅
Base64 节点订阅
```

导入后尽量拆分为：

```text
订阅源
节点
策略组
规则
远程规则集
```

如果无法完整解析，至少保留原始配置。

## 十八、分享与协作

用户应可以生成分享链接。

### 分享类型

```text
只读分享
可编辑分享
导出订阅链接
公开模板
私有模板
```

### 导出链接示例

```text
/sub/abc123/mihomo.yaml
/sub/abc123/clash.yaml
/sub/abc123/singbox.json
/sub/abc123/surge.conf
/sub/abc123/loon.conf
/sub/abc123/shadowrocket.conf
/sub/abc123/quantumultx.conf
/sub/abc123/stash.yaml
/sub/abc123/egern.yaml
/sub/abc123/nodes.txt
```

## 十九、权限与安全需求

因为用户会保存订阅链接和节点密码，产品必须重视隐私。

需要支持：

```text
私有配置
编辑权限控制
导出链接密钥
导出链接重置
敏感信息隐藏
敏感信息确认后显示
配置备份
配置删除
```

用户应该能随时：

```text
删除项目
删除订阅
重置分享链接
停用导出链接
导出自己的完整数据
```

## 二十、MVP 范围

第一版建议做小而完整。

### MVP 必须有

```text
1. 添加远程订阅链接
2. 添加手动节点
3. 查看节点列表
4. 远程订阅创建后默认刷新并解析节点
5. 自动识别国家 / 地区、倍率和常见标签
6. 自动生成国家 / 标签节点组
7. 规则基础目标：
   - PROXY
   - DIRECT
   - REJECT
8. 全局节点出口：
   - 全部节点
   - 节点选择
   - 自动选择
   - 故障切换
9. 策略组组合：
   - AI
   - Streaming
   - Telegram
   - Social
   - GitHub
   - Apple
   - Microsoft
   - 漏网之鱼
10. 预置远程规则集并自动分配匹配后使用的出口 / 分流策略
11. 配置预览和兼容性警告
12. 导出完整 Mihomo / Clash、sing-box、Loon 等配置
13. 生成默认固定订阅链接
```

### MVP 可以暂缓

```text
账号系统
多人协作
节点测速
复杂 DNS
复杂 TUN
高级脚本
规则市场
完整反向导入
所有客户端全量兼容
```

## 二十一、后续版本规划

### V1：完整可用

```text
订阅源管理
默认导出配置
自动节点组
基础出口和策略组组合
预置远程规则集
配置预览和兼容性警告
Mihomo / Loon / sing-box / Surge / Shadowrocket / Quantumult X / Stash / Egern 导出
节点订阅导出
订阅自动刷新
```

### V2：增强兼容

```text
更完整的客户端特性映射
远程规则集内容校验
导出结果结构化校验
配置导入和差异对比
节点测速
规则 Diff
```

### V3：高级能力

```text
自定义策略组
自定义模板
分享模板
规则市场
高级 DNS / TUN
脚本规则
```

### V4：产品化

```text
账号系统
团队协作
配置版本历史
模板市场
公开配置库
高级权限
付费功能
```

## 二十二、最终完整需求一句话

```text
UniConf 是一个运行在 Web 上的一站式代理配置管理工具，用户可以保存远程订阅链接、手动录入节点、创建节点组、清洗和重命名节点、选择策略组组合、调整默认出口意图，并将同一份配置导出为 Mihomo/Clash、sing-box、Surge、Loon、Shadowrocket、Quantumult X、Stash、Egern 等常用代理软件可用的完整配置文件或节点订阅。
```

[1]: https://github.com/QuixoticHeart/rule-set?utm_source=chatgpt.com "rule-set - 面向mihomo/clash.meta、surge、loon、stash"
[2]: https://wiki.metacubex.one/en/startup/client/client/?utm_source=chatgpt.com "Third-party tools/client - mihomo docs"
[3]: https://apps.apple.com/id/app/quantumult-x/id1443988620?platform=iphone&see-all=customers-also-bought-apps&utm_source=chatgpt.com "Quantumult X - You Might Also Like - App Store - Apple"
[4]: https://sing-box.sagernet.org/clients/android/?utm_source=chatgpt.com "sing-box for Android"
