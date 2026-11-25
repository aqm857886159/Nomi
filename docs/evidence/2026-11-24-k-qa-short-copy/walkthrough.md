# `ReconcileDeviationCard` 单镜未校验行内短文案统一真窗口走查证据

- 实现线：`k-qa-copy-impl`
- 基线对比：在 `#1630`（`docs/evidence/2026-11-22-qa-verdict-honesty/after-zh.png`、`after-en.png`）已批准上线的单镜与多镜未校验卡片基础上，将单镜行内按钮从 `重新审片 / 照用此镜`（`Re-check / Use shot`）统一收口为与多镜行内一致的短词条 **`重审 / 照用`**（**`Re-check / Use`**），并同提交删除冗余词条 `recheckOne` / `acceptOne`；多镜底栏整卡按钮 `全部重审 / 照用这 N 镜`（`Re-check all / Use all N`）保持不变。
- 驱动方式：真实隔离 Electron 进程 + 回环供应商夹具（`createRuntimeWalk`：新建空白项目 → 进入生成画布 → 1 镜草稿确认并真实落点画布图像节点 → 经 `production.verify-shots` 触发真实审片请求收到不可解析回复落入 `invalid_verdict_json` 未校验态 → 经真实「设置 → 通用」切换浅/深外观与中/英文界面 → 最终点击行内短按钮 `Use` 确认卡片收起）。

## 真窗口实测读回值与截图索引

| 状态 | 语言 (`document.documentElement.lang`) | 外观 (`data-mantine-color-scheme`) | 顶栏计数句 | 行内两颗按钮实测文本 | 截图文件 |
|---|---|---|---|---|---|
| 中文浅色 | `zh-CN` | `light` | `1 镜没审成，不代表已通过  查看原因` | `重审` · `照用` | `after-zh-light.png` |
| 中文深色 | `zh-CN` | `dark` | `1 镜没审成，不代表已通过  查看原因` | `重审` · `照用` | `after-zh-dark.png` |
| 英文浅色 | `en` | `light` | `1 shot not checked, not confirmed as passing  Why` | `Re-check` · `Use` | `after-en-light.png` |
| 英文深色 | `en` | `dark` | `1 shot not checked, not confirmed as passing  Why` | `Re-check` · `Use` | `after-en-dark.png` |

## 改前 vs 改后并排对照图

- `before-vs-after.png`：左侧为 `#1630` 合入态（`重新审片 / 照用此镜`、`Re-check / Use shot`），右侧为本次统一后（`重审 / 照用`、`Re-check / Use`）。按钮紧凑不抢行宽，视觉密度与多镜列表行完全一致。
