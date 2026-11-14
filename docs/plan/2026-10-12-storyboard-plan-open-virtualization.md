# 打开分镜方案（320 行一次性全挂载）：现状与待拍板

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 来源：性能场景 `storyboard-plan-open`（`tests/perf/scenarios/storyboard-plan-open.json`，量具 `tests/perf/document-switch-bench.mjs`）。
> 上游诊断：PR #1179 的 `heavy-document-switch-and-plan-open`。

## 现状数字
- 160 份文稿、第一份下挂 320 镜头方案，冷启后点开方案到 320 行可见：诊断线测得中位 4252ms（3758~5049）；本机并发负载下 5 次中位 19.8~26.1s（基线标 noisy）。预算 1000ms，超。
- 同一规模下，「访问过分镜后切文稿」已由 `<Activity>` 冻结隐藏槽修掉（7370ms → 36ms），但那只是不再重复付这笔挂载费；第一次打开仍要付。

## 为什么没做
- 仓库已有 `@tanstack/react-virtual`（`GenerationListView` 在用），可接。
- 但分镜表（`StoryboardShotTable.tsx`）带分组、多选范围、`querySelector('[data-storyboard-row=…]')` 滚动聚焦、键盘导航，走查里也按 DOM 行数断言；虚拟化会改这些约定。
- `StoryboardShotTable` / `StoryboardPlanEditor` 近 14 天已有 5 个 fix，命中 P1 热点，按规矩要先做类根因复盘（`docs/engineering/direction-check-template.md`）再交用户拍板。

## 要用户拍板的点
1. 要不要虚拟化分镜表。推荐：要，先做复盘。代价：动热点文件，要重写聚焦 / 范围选择 / 走查对 DOM 行的假设。不做的代价：大方案首次打开仍是秒级到十秒级。
2. 若不虚拟化，次选：分批挂载行（先挂首屏，其余空闲时补）。代价：仍要处理上面的聚焦 / 范围选择。
