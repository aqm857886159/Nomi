# MCP 凭据前台导航与宿主配置修复提示

> ✅ 已交付

## 范围

- `integration.open_credentials` 在 GUI RPC 进程中完成持久 handoff 入队后，聚焦/显示主窗口并让渲染层打开模型设置工作区；URL elicitation 判定保持现有协议规则。
- 无法连接 GUI 时保留文字兜底，并明确说明先启动 Nomi。
- 启动时宿主配置修复返回显式 `changed`，仅 changed 时通知渲染层并显示双语 toast。
- 补充能力核单测、真实 Electron UX 走查/宿主级 e2e、实验室登记与截图。

## 不动项

- 不改变 MCP URL/form elicitation 安全判定，不把 key 放进 MCP 参数或结果。
- 不触碰用户真实宿主配置；走查使用 `isoApp.prepareIsolation`。
- 不修改主仓、不更新设计基线、不创建 PR。

## 验收门

1. `open_credentials` 时窗口 focused，设置模型页打开并自动消费对应 handoff；form-only 与 declined 文案包含已打开/需启动信息。
2. 保存凭据后再次 `propose/confirm` 不再要求 key。
3. 修复函数返回 `{ changed, repaired }`；changed=false 不发 toast，changed=true 只发一次双语本地化 toast。
4. `pnpm run gates` 全绿；分支推送前整合最新 `origin/main`。

## 回滚

回滚本分支提交即可；不改持久化 schema，handoff 与配置文件现有格式保持兼容。
