# 分镜「生成剩余 / 勾选 / 批量参数」样张截图（现在 → 改后）

- 设计卡：`docs/plan/2026-10-06-storyboard-batch-select.md`（含要用户拍板的 10 条与每条的推荐项）。
- `now/` = `origin/main` 878f4ecc7 上现役组件（改之前截的）；`after/` = 本分支设计实验室屏 `storyboard-batch` 的 31 格。两边都是**现役组件本体**，不是手画：改后的行 / 浮条 / 批量条是改过的真组件，确认框是 Agent 付费卡的计划行（`V4Intervention`），参数面板是画布 `InlineParameterBar`；公共参数集由真档案走真函数 `deriveBulkParamScope` 求出。
- 每张都由实现线亲眼看过（zh-CN 与 en 两轨；暗色与最小窗口 664 各有专格）。零额度，无头浏览器，没起可见窗口。
- 复现：本分支 `npx vite --port <p>` + `node scripts/build-tailwind.mjs` 后打开 `design-lab.html?frame=1&screen=storyboard-batch&state=<id>`；英文轨把 `localStorage['nomi:locale:v1']` 设为 `en`。

## 现在 → 改后

> 注意：`now/` 里行底栏的参数汇总写「自动 · 5s / Auto · 5s」、`after/` 里写「全能参考 · 16:9 · 5s」——这是夹具差异，**不是改动**：`now/` 那批镜头的 modelKey 写成了 `seedance-2-5`（档案对不上，退回默认值），`after/` 用目录里的真 key `bytedance/seedance-2-5`。对照时只看勾选框、结果动作条、浮条 / 批量条 / 确认框。

| 现在（`now/`） | 改后（`after/`） | 看什么 |
|---|---|---|
| `sbb-now-01-dialog` | `sbb-b2-01-dialog` | 现在：「开始生成 · 将生成 4 个素材…」一句话，没有清单；改后：分组清单，参考卡先、镜头后，逐项可去 |
| `sbb-now-02-rows` | `sbb-b5-01-rows` | 现在：对勾 = 本次跳过（第 2 行勾上变淡）；改后：对勾 = 选中（淡蓝底），跳过是标签 + 行菜单；已生成行多一枚「移除结果」 |
| `sbb-now-03-toolbar` | `sbb-b7-02-toolbar-three-models` | 现在：浮条只有「统一模型」；改后：每镜种一组 模型 + 参数汇总，跨 3 个模型只剩比例 |
| `sbb-now-04-toolbar-narrow` | `sbb-b7-04-toolbar-narrow` | 最小窗口 |
| `sbb-now-05-bulkbar` | `sbb-b7-10-bulkbar` | 现在：类型 / 模型 / 时长 / 画幅四个写死的控件；改后：类型 · 各镜种模型 + 参数 · 画幅 |
| `sbb-now-06-bulkbar-narrow` | `sbb-b7-11-bulkbar-narrow` | 最小窗口 |

## 改后全部格

| 组 | id | 内容 |
|---|---|---|
| B2 确认框 | `sbb-b2-01-dialog` | 参考卡 2 张 → 镜头 4 个 |
| | `sbb-b2-02-dialog-removed` | 去掉「后巷」和镜 3 → 按钮「生成 4 项」 |
| | `sbb-b2-03-dialog-no-anchors` | 边界：没有待生成参考卡，不出组标题 |
| | `sbb-b2-04-dialog-many` | 边界：参考卡 3 + 镜头 12，清单自己滚 |
| | `sbb-b2-05-dialog-none` | 边界：全去掉，主按钮灰 |
| | `sbb-b2-06-dialog-narrow` · `sbb-b2-07-dialog-dark` | 最小窗口 664 · 暗 |
| | `sbb-b2-08…12-footer-*` | 页脚五态：平时 / 参考卡阶段 / 镜头阶段 / 参考卡失败镜头未发 / 全部已生成 |
| B5b 行 | `sbb-b5-01-rows` `02-rows-narrow` `03-rows-dark` | 已生成 / 本次跳过 / 选中三种行 · 窄 · 暗 |
| | `sbb-b5-04-row-menu` | 行菜单里的「本次跳过」 |
| | `sbb-b5-06-result-narrow` | 最小窗口下结果动作条（多了一枚图标仍一行） |
| B7 浮条 | `sbb-b7-01-toolbar-same-model` | 同一模型，参数全在，时长不一致 = 混合 |
| | `sbb-b7-02-toolbar-three-models` | 跨 Seedance / Veo / Kling |
| | `sbb-b7-03-toolbar-mixed-kinds` · `04-toolbar-narrow` | 图片镜 + 视频镜各一组 · 窄 |
| | `sbb-b7-05-toolbar-empty` | 边界：公共集为空（含 Hailuo） |
| | `sbb-b7-06/07/08-panel-*` | 点开参数：三模型 / 同模型 / 公共集为空时说明原因 |
| | `sbb-b7-09-toolbar-dark` | 暗 |
| B7 全部镜头条 | `sbb-b7-10…13-bulkbar-*` | 图片 + 视频 · 窄 · 只有 Seedance · 含无参数模型（空） |
