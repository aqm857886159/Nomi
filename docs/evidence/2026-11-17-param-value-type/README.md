# 参数值进门统一：真窗口证据（2026-11-17）

设计卡：[docs/plan/2026-11-17-param-value-type.md](../../plan/2026-11-17-param-value-type.md)。

条件：真窗口（Electron 构建），中文、英文各走一遍；修前用主分支构建，修后用本分支构建。空白隔离资料目录，网闸开着，RunningHub 指向本机回环假服务（不连真供应商、不花钱）。「收到」指回环假服务记下的请求体。窗口 1280×800，浅色。

## 截图

| 文件 | 看什么 |
|---|---|
| before-zh-storyboard-clicked-12-panel-open.png | 主分支：分镜行参数面板里点了 12，高亮仍在 5 |
| before-zh-storyboard-after-close.png | 主分支：关面板后行上「自动 · 720p · 5s」；收到 `duration: "5"` |
| before-en-storyboard-after-close.png | 主分支英文：行上 "Auto · 720p · 5s" |
| after-zh-storyboard-clicked-12-panel-open.png | 修后：面板里 12 高亮（面板开着时摘要不跟，是参数面板原有设计，关面板才更新） |
| after-zh-storyboard-after-close.png | 修后：行上「自动 · 720p · 12s」，存 `durationSec 12`；收到 `"12"` |
| after-zh-storyboard-veo-4s.png | 修后：分镜行 Veo 3.1 点 4，行上「720p · 4s」；收到 `"4"` |
| after-zh-storyboard-switch-to-veo-still-5s.png | 没修的旧问题（主分支同样）：先选 5 秒再换 Veo 3.1，行上仍 5s，实际发 `"8"`，见 PR「没做的」 |
| after-zh-canvas-node-12s.png | 修后：画布新视频节点 Seedance 2.0 点 12，底栏「16:9 · 720p · 12s」，存数字 12；收到 `"12"` |
| after-zh-old-canvas-node.png | 修后：按 0.24.1 落盘形状手写的旧节点（存字符串 `"12"`）显示 12s，发 `"12"`，盘上不改写 |
| after-zh-old-storyboard.png | 修后：旧形状分镜 `durationSec 0 + "12"` 行上 12s、`5 + "12"` 行上 5s，场次头 17 s；「生成剩余」发 `"12"` / `"5"` |
| after-en-storyboard-after-close.png | 修后英文：行上 "Auto · 720p · 12s"；收到 `"12"` |
| after-en-canvas-node-12s.png | 修后英文：画布节点底栏 12s；收到 `"12"` |
| after-en-old-storyboard.png | 修后英文：旧形状分镜行上 12s / 5s，场次头 "2 shots · 17 s" |

没截的：窄窗（界面没变，只是显示的值变了）；约价（RunningHub 没有价目，真窗口里没有约价可看，约价读的值由 `electron/parity/paramValueType.parity.test.ts` 覆盖）。

## 按钮普查（这次走到的可点目标）

这一刀不新增、不改任何可点目标，只让点了的值真正生效。下表是真窗口里实际点过的目标，七个字段对照。

| 目标 | 设计来源 / 组件 | 变体 / 状态 | 角色 + 名称 | 用户动作 | 预期界面状态和副作用 | 测试 ID / 选择器 | 证据 |
|---|---|---|---|---|---|---|---|
| 分镜行参数摘要 | 参数面板摘要 pill（`InlineParameterBar`，未改） | 收起 → 展开（`aria-expanded`） | button，名称「生成参数」/ "Generation parameters" | 点 | 面板挂在 body 上展开；不写数据 | `[data-parameter-summary]` | before / after `*-clicked-12-panel-open.png` |
| 面板里时长档位「12」 | 参数面板分段选择 `NomiSegmented`（未改） | 未选 → 选中 | radiogroup 里的 radio，名称「12」，`aria-checked` | 点 | 12 高亮；镜头存 `durationSec 12`（修前：高亮留在 5，存 `durationSec 5` + `params.duration "12"`） | `[role=radio][aria-checked]` | after-zh-storyboard-clicked-12-panel-open.png |
| 关闭面板后的分镜行摘要 | 同上 | 展开 → 收起 | button | 点面板外 | 行上显示所选秒数（修后 12s，修前 5s） | `[data-parameter-summary]` | `*-storyboard-after-close.png` |
| 分镜行生成 | 分镜行生成键（未改） | 可点 → 生成中 | button，名称「生成镜 1」 | 点 | 新建视频节点 `meta.duration` 为所选秒数，请求体发所选秒数（修后 `"12"`，修前 `"5"`） | `aria-label="生成镜 1"` | 回环请求记录；设计卡「实现结果」 |
| 分镜行模型菜单 | 模型菜单（未改） | 收起 → 展开 → 选中 Veo 3.1 | button，名称「模型」；选项 role=option | 点、选 | 换模型；时长按现有规则落（先选 5 再换 Veo 仍显示 5s，旧问题未修） | `button[aria-label="模型"]`、`[role=option]` | after-zh-storyboard-switch-to-veo-still-5s.png |
| 画布节点参数摘要与时长档位 | 同一套参数面板（未改） | 收起 → 展开 → 选 12 | button / radio | 点 | 底栏 12s，存数字 12，发 `"12"` | `[data-parameter-summary]`、`[role=radio]` | `after-*-canvas-node-12s.png` |
| 「生成剩余」 | 分镜底栏批量生成（未改） | 可点 → 确认卡 → 生成中 | button，名称「生成剩余」 | 点、确认 | 旧形状两镜发 `"12"` / `"5"`；保存后镜头 `durationSec 12 / 5`、`params {}` | 按钮文字「生成剩余」/ "Generate Remaining" | `after-*-old-storyboard.png` |

## 体验成绩单（一页）

- 场景：分镜行或画布节点改时长后生成（RunningHub Seedance 2.0 / Veo 3.1，回环假服务）。
- 完成：修后中文 4/4 条路（分镜 12、分镜 Veo 4、画布 12、旧形状项目）、英文 4/4 条路（同样四条）；失败 0。
- 主指标「点的秒数 = 行上显示 = 发出的秒数」：修前走了两条路，分镜 12 不一致（行上 5s、发 `"5"`）、画布 12 一致，中英相同（实测，回环请求记录）→ 修后 4/4 条路一致，中英相同（实测，回环请求记录）。机器数另见对拍：45 个能发的数字档下拉 × 214 个选项，不一致 0（`electron/parity/paramValueType.parity.test.ts`）。
- 护栏：Design Lab 165 格相对主分支 0 格变化；6 条花钱阻断走查本机零额度全过；报文对照 2028 例意料之外的不同 0 例。
- 最大摩擦与决定：先选 5 秒再换只有 4/6/8 的模型，行上 5s、实际发 8 秒（主分支同样）。这刀不修，另开一刀让显示和发送读同一个门。
- 没验证的：真付费、Windows、键盘全程、窄窗、退回 0.24.1 打开、约价在真窗口里的样子。
- 真人数：没有真人走查，SEQ / 误点 / 回退 / 求助均为 null。
