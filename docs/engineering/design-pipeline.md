# 设计图流程：探索 → 组件搭建 → 清单 → 实现

日期：2026-10-10（用户拍板）。适用：新界面、改布局。只改单个元素样子的，跳过探索，直接「组件搭建 + 清单」。修 bug 不走这套。

## 为什么有这套

「拍板图有、产品没做」已经发生 4 次（底部加节点条、缩放簇、顶栏居中、分组框头），全是用户自己发现的。
根因：拍板图只是一张画，没人把它拆成「这张图一共有哪几个东西」，漏了没有任何东西会红。
清单把图变成会红的东西：图上每个看得见的元素都有一条记录，每条都要有去处。

用户原话（2026-10-10）：「1.先探索出设计图 2.然后用我们的组件搭建出来 最后形成清单 里面要考虑各种状态和情况 不能因为设计把功能消失了 然后做实现」。

## 四步

1. **探索**：出设计图。可以手画（HTML / 交互 widget），但只准标 `exploration`，不能当实现合同。
2. **组件搭建**：用生产组件（设计实验室的真组件 + 真实宿主数据）照图搭出来。每个元素必须交代三选一：
   - 用现成组件搭成；
   - 要改或新建组件；
   - 样子变了，要用户点头。
   不许悄悄去掉。
3. **清单**：探索图一拍板就生成清单（见下面格式）。清单里每个元素带状态表：空、加载、失败、选中、禁用、悬停、窄窗、长文字、中英、暗色。另外做**旧功能普查**：扫现有产品该屏所有按钮和操作，每项在新设计里必须有去处，否则清单红。
4. **实现**：清单是实现合同。实现时逐条把元素的 status 推到 `implemented`，并给出走查断言。

## 四个子决定（用户全选推荐）

- **清单在探索图拍板时就生成**；第 2 步搭建时每项必须交代去向（上面三选一）。
- **偏差拍板**：用户只看「差异清单 + 两版并排截图」点头，不重看全图。
- **状态全覆盖**：每个元素的状态从组件登记的状态表带出（阶段 B 自动化，阶段 A 手填）；外加旧功能普查。
- **分档**：新界面 / 改布局走完整四步；只改单个元素样子跳过探索、直接组件搭 + 清单；修 bug 不走。

## 清单格式

路径：`docs/design/boards/<日期>/<板名>.board.json`。板源放同目录的 `source/`、`preview/`，候选抽取结果是 `<板名>.candidates.json`（`node scripts/board-extract.mjs` 生成，确定性）。

```
{
  "board": "Main", "approvedOn": "2026-10-08", "stage": "explored" | "built",
  "elements": [{
    "id": "group.header.title-inside",   // 元素 id
    "label": "分组框头：框内左上组名与计数",
    "candidates": ["046-span-..."],       // 认领的候选（板上的文字 / 按钮 / 图标 / 条 / 卡）
    "status": "implemented" | "in-progress" | "missing" | "deferred" | "dropped",
    "owner": "I-groupheader",             // missing / in-progress 必填（PR 号或交接任务名）
    "assertion": "board:Main/group.header.title-inside",  // implemented 必填，且断言名要在 tests/ux 走查里出现
    "states": ["empty", "narrow", "dark", ...],
    "userDecision": { "quote": "...", "date": "..." }      // deferred / dropped 必填
  }],
  "decor": ["..."],                       // 纯装饰候选（说明文字、占位框），不算产品元素
  "functionCensus": [{ "function": "...", "before": "...", "after": "<元素 id>" }]
}
```

## 门岗

- `pnpm run check:board-parity`：先跑单测（`scripts/check-board-parity.node-test.mjs`，每条规则一个反例），再重抽 12 张板的候选、和仓库里的 `candidates.json` 比对，最后跑清单规则。已挂进 `gates:contracts`。
- 清单规则（R1–R8）：每个候选恰好被一个元素或 decor 认领；status 合法；missing / in-progress 有 owner；implemented 的断言名真在走查里；deferred / dropped 有用户原话和日期；旧功能的去处是存在的元素；states 来自词表；PR 认领的元素在合并前有去处。
- 合并前：`scripts/merge-preflight.mjs` 读 PR 正文的 `## 拍板图`（一行一板：`- Main: 元素id, 元素id`），这些元素在 PR 头上必须是 implemented，或带用户原话的 deferred / dropped，否则红。

## 复用的现成件（没有另起炉灶）

- 设计实验室状态登记：`tests/ux/design-lab/labStates.mjs`、`calibration.json`（状态表的来源，阶段 B 接入）。
- PR 判据证据项：`scripts/check-pr-judgement.mjs`、`scripts/pr-body-criteria.mjs`（设计卡、独立验收）。
- 合并前扫描：`scripts/merge-preflight.mjs`（R8 挂在这里）。
- 板抽取用已装的 Playwright（无界面）。

## 阶段

- **阶段 A（2026-10-10 已做）**：流程写进仓库、清单格式、抽取脚本、门岗与单测、12 张板的对账（手填 status，状态来自生产字样探测，待真 App 核）。
- **阶段 B（未做）**：组件状态表自动带出；旧功能普查自动扫描产品；验收单按清单生成；走查断言补齐（当前没有任何 `board:` 断言，所以没有 implemented 元素）。
