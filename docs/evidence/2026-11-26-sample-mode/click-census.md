# 按钮普查：Seedance 2.5 样片模式（2026-11-26）

只列这次新出现、或者行为变了的可点目标。生成框、参数面板、版本卡其它按钮的行为没变，由各自原有走查覆盖。
走查 = `tests/ux/sample-mode.walk.mjs`（站名见各行）；截图在本目录 `zh-light/`、`en-dark/`。

| 设计来源 / 组件 | 变体 / 状态 | 无障碍角色 + 名称 | 用户动作 | 预期的界面状态和副作用 | 测试 ID | 证据 |
|---|---|---|---|---|---|---|
| 板 SampleMode `sample.picker-row` / 模型菜单 `NomiSelect` 选项（目录行 `doubao-seedance-2.5-sample`） | 视频节点 · 菜单打开 · APIMart 已连 | option「Seedance 2.5（样片模式）」/ "Seedance 2.5 (Draft mode)"，说明「480p 低成本试片 · 满意后出 1080p · 最长 30 秒」 | 点击 / ↑↓ + Enter | 菜单收起；生成框模型格写全名不省略；参数面板清晰度只剩 480p；不发请求 | `[data-nomi-select-option-label]` | 走查 menu 站（与「Seedance 2.5」相邻、图标 outerHTML 相同）；`01-menu`、`02-params` |
| 同上 | 能力不可用（没连 APIMart / 父模型下线） | option 置灰 + 原因 | 点击 | 跟父行同一条不可用规则（今天的 `picker.disabled-row`），下一步去连接页；不发请求 | 同上 | 单测 `electron/shared/videoCapabilities/sampleMode.test.ts`（档案由父档案推出，可用性随父行） |
| 板 `sample.send-price` / 生成框发送键 `ComposerBar` | 选了样片行 · 算不出价 | button「生成素材」，读屏说明「暂时估不出这次用量」 | 点击 | POST 1 次，请求体带 `draft: true` + `resolution: 480p`；节点进入生成中；钮上不印数、不印 0 | `button[data-bar-segment="generate"]` | 走查 sample 站；`03a-sample-generating`、`03-sample-ready`、`vendor-requests.*.json` |
| 板 `sample.hd-button` / `NodeSampleRow` → `MakeFinalButton` | 样片就绪 · 第一次 | button「出 1080p 高清版」（字「出高清」），读屏说明「暂时估不出这次用量」 | 点击 | 不弹框；POST 1 次，键集合恰为 `{model, draft_task_id, resolution}`；右边立刻换成「高清生成中」，样片照常可见；落地进第 2 版「高清版」并成主图 | `[data-sample-make-final]` | 走查 hd 站；`04-hd-in-flight`、`05-versions` |
| 同上 | 这条样片已出过高清（切回第 1 版） | 同上 | 点击 | 弹「再发一次」确认框（见下两行），此时不发请求 | `[data-sample-make-final]` | 走查 second 站；`06-confirm` |
| 同上 | 出高清在路上 | 无按钮，`role=status`「高清生成中」 | — | 点不到，不会重复发 | `[data-sample-final-progress]` | 走查 hd 站 |
| 板 `sample.confirm-second-hd` / 现成 `SpendConfirmDialog`（只换文案） | 第二次出高清 · 框打开 | dialog「这条样片已经出过 1080p 高清版」；button「取消」 | 点击 / Esc | 框关；POST 数不变；版本数不变；焦点回到「出高清」 | `[data-spend-confirm-action="cancel"]` | 走查 second 站（取消、Esc 各一次） |
| 同上 | 同上 | button「再出高清」（价可印时带金币和数） | 点击 / Enter | POST +1，请求体同第一次出高清；进第 3 版 | `[data-spend-confirm-action="confirm"]` | 走查 second 站 |
| 板 `sample.expiry-chip` + `sample.expiry-tooltip` / `NodeSampleRow` 有效期小标 | 剩 ≥2 小时 / <2 小时 / 已过期 | 文字「样片 · 剩 N 天 / 小时 / 分钟」「样片 · 已过期」，悬停说明 | 悬停 | 只出说明（为什么、下一步），不发请求；剩不到 2 小时换提醒色 | `[data-sample-expiry]`、`[data-sample-expiry-hover]` | 走查 expiry 站（拨渲染进程的钟）；`08-expiry-warning`、`09-expired`；单测 `NodeSampleRow.test.tsx` |
| 板 `sample.redraft-button` / `NodeSampleRow` → `RedraftButton` | 样片已过期 · 节点还在样片行 | button「重拍样片」，读屏说明同发送键 | 点击 | 和生成框 ↑ 同一个口：同一组设置再花钱时现成「再发一次」确认会先问；发出去的是样片（`draft: true`、480p、不带旧样片号） | `[data-sample-redraft]` | 走查 expiry 站；替身对过期样片号回 400 |
| 板 `sample.version-hd` / 版本卡 | 铺开版本 · 第 2 张 | 卡上小标「高清版」/ "HD version"；工具条「设为主图」 | 悬停 → 点「设为主图」 | 切回第 1 版（样片）时节点下方那一行回来；切到高清版时那一行不在 | `[data-version-card]`、`[data-toolbar-action="set-primary"]` | 走查 hd / second 站 |
| 板 `sample.plain-480p` / 普通 Seedance 2.5 | 选 480p 出完 | 没有这一行、没有「出高清」 | — | 请求体不带 `draft` | `[data-sample-row]` 数 0 | 走查 plain 站；`07-plain-480p` |
