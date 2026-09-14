# `scripts` 层结构评审：聚类键把 298 个工具当成一层

> 📎 结构评审 · 2026-09-15 · 状态：✅ 已交付（结论已落地：本轮只出结论 + 一条可执行的门岗修法，修法本身另派）
> **为什么写这份**：`check:symptom-cluster` 报「模块 `scripts`：2026-09-09 到 2026-09-15 的 7 天里已有 18 份根因合同」，按 R21.2 必须先出这一层的结构评审再继续修。这份不是过闸文书——它给的结论是**这道闸在这个模块上量错了东西**。

## 一、它到底在说什么（先把数字摊开）

`scripts/` 现状：

| 指标 | 值 |
|---|---|
| `scripts/` 下的可执行文件（`.mjs`/`.cjs`/`.py`） | 298 |
| `package.json` 里的 `check:*` 门岗 | 85 |
| 2026-09-09 ~ 09-15 归到模块 `scripts` 的根因合同 | 18 |
| 这 18 份实际碰到的**不同**顶层脚本 | 15 |

那 15 个脚本是：`check-model-schema.ts`、`covers/cover-budget.mjs`、`check-feel.mjs` / `feel-nightly.mjs`、`package-build-stamp.mjs` / `build-electron.mjs`、`check-e2e-launch.mjs`、`vocabularies-baseline.json`、`check-test-waits.mjs`、`check-canvas-gesture-determinism.mjs`、`check-error-surface.mjs`、`door-map.mjs` / `root-cause-contracts.mjs`、`lib/nomiClient.mjs`、`ponytail-review-*.mjs`、`check-announced-card-rendered.mjs`、`run-gates-tests.mjs` / `stamp-gates-ok.mjs`、`check-storyboard-owner.mjs`。

**它们之间没有任何共享状态、共享抽象或共享调用路径。** 封面预算、Electron 打包戳、体感夜跑、分镜 owner 门岗、Ponytail 评审——这不是「同一层被修了 18 次」，是「18 件互不相干的事恰好都住在同一个目录里」。

## 二、结构根因：`moduleKey` 对 `scripts/` 退化成一段

判据在 `scripts/symptom-cluster-lib.mjs:36-42`：

```
if (segments.length >= 3) return segments.slice(0, 2).join('/')   // electron/harness、src/features/…
if (segments.length === 2) return segments[0]                      // scripts/x.mjs → "scripts"
```

两级键对 `src/`、`electron/` 是对的——那两处的目录**就是**层（`src/features/storyboard` 是一个有共享状态的层，同一周被修三次确实是结构信号）。但 `scripts/` 是**扁平**的：298 个工具全在顶层，于是它们共用同一个键。

于是这道闸在 `scripts` 上量的不是「这一层是否反复出问题」，而是「这个目录里住了多少个工具」。工具越多，误报越必然：

- 窗口 7 天、门槛 3 份。按 09-09~09-15 的实际密度（18 份），**任何**一份新的 `scripts/` 合同都会撞红。
- 撞红的人和那 18 份里的其余 17 份毫无关系，他能做的只有写一份「提到 scripts」的文档把闸推开。
- `docs/audit/` 里近一周已经出现同类评审（`11ffa6fc6`「接模型验证 run 失败路径的方案、根因合同与结构评审」、`f1f8fbaf2`「技能索引快照 vs 实时…结构评审」），说明这条路已经在被例行走过。

这正是本仓自己写下的失效形状：**闸门一旦开始拦无辜的人，人就会开始绕过闸门**（`scripts/ponytail-review-hook.mjs` 那轮的原话，也是 `docs/lessons/review-at-the-moment-it-can-land.md` 这次记下的教训）。区别只是这里的「绕过」形式合法：写一份没人会再读的文档。

## 三、结论与修法

**结论**：`check:symptom-cluster` 的判据是对的，`scripts/` 这个键是错的。不要放宽窗口或门槛（那会让它在 `src/` 上也失灵），要把键改准。

**修法（按优先级，均只动 `scripts/symptom-cluster-lib.mjs` 一处判据）**：

1. **扁平目录按文件聚类，不按目录。** `moduleKey` 对配置里登记的「扁平工具目录」（当前只有 `scripts/`，`scripts/lib/`、`scripts/covers/` 等子目录不在内）返回**文件自己**（`scripts/check-feel.mjs`），而不是 `scripts`。这样「同一个门岗一周被修三次」照旧报红——那确实是结构信号（例如 `check-feel.mjs` 在 09-09 一天就收了两份）——而互不相干的工具不再互相拖累。
2. 加规则先验它会红（R17）：造一簇「同一个脚本 7 天 3 份」的夹具断言红，再造一簇「三个不同脚本」的夹具断言绿。
3. 本份评审同时充当第 1 条落地前的过闸依据；落地后应回来把本节状态改成 `✅ 已固化（由 check:symptom-cluster 的文件级键接管）`。

第 2 条的阳性对照现成就有：18 份里唯一真的同类是 `2026-09-09-feel-browser-lane-and-reviewed-findings` 与 `2026-09-09-feel-unregistered-surfaces`——同一天、同一个 `check-feel.mjs`。文件级键会把这一对准确抓出来，其余 13 组是单发。

**本轮不做**：不改判据本身。这条 lane 的任务是 R25 改版（评审时机），动 `symptom-cluster` 的判据是另一件事、另一份合同、另一批夹具——在这里顺手改会让两件事的验证互相污染。派工单据：把上面第 1+2 条作为一条独立任务派出。
