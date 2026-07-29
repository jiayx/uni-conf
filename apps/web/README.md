# @uni-conf/web

UniConf 的 React 单页应用。页面只负责管理数据、展示兼容性和调用导出接口；节点、规则和完整配置的最终序列化由 Worker 统一完成。

## 页面

- `/`：概览、当前状态和快速导出
- `/sources`：订阅链接、配置导入和导入历史
- `/nodes`：节点搜索、筛选、批量启停和手动节点
- `/collections`：节点组、过滤、重命名、去重和自动节点组设置
- `/groups`：基础出口、业务分流场景、默认出口和自定义策略组
- `/rules`：手动规则、排序和批量启停
- `/remote-rule-sets`：系统规则、补充规则集、来源覆盖和转换预览
- `/export`：默认导出、高级导出档案、配置预览、就绪度和转换报告
- `/settings`：界面、分流、DNS、刷新和数据备份设置

## 开发

从仓库根目录运行：

```bash
pnpm dev
pnpm --filter @uni-conf/web test
pnpm --filter @uni-conf/web typecheck
pnpm --filter @uni-conf/web lint
pnpm --filter @uni-conf/web build
```

开发服务器默认监听 `http://localhost:5173`，并将 `/api` 和 `/sub` 代理到 `http://localhost:8787`。

## 约束

- 用户可见文案放在 `src/i18n/zh.json` 和 `src/i18n/en.json`
- 页面通过 `src/lib/api.ts` 访问 Worker
- 导出格式、规则兼容性和客户端能力来自 `@uni-conf/shared`
- 带有实际改动的表单接入统一的未保存更改保护
- 样式使用全局设计变量和 CSS Modules，避免在页面内复制基础弹窗或表单行为
