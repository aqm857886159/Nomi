# 金路径 · 每日走查

> 建立日期：2026-09-05 · 脚本：[`tests/ux/golden-path.e2e.mjs`](../../tests/ux/golden-path.e2e.mjs) · 命令：`pnpm run test:golden`
> 定位：**每天跑一次的门**。红了当天修。M0–M5 矩阵留着当地图（还有哪些地没铺），不当门。

## 为什么是这条路，而不是一张矩阵

矩阵回答「我们做到哪一步了」，门只回答一件事：**昨天还能走通的那条路，今天还走得通吗**。
一条真实用户任务从头走到尾、每步取证，比 36 个分格里的绿灯更能挡住回归——因为回归几乎
总是发生在**衔接处**（规划落到表、表落到画布、画布落到盘、盘再回到屏），而分格测试恰恰
测不到衔接。

一条路能当门的前提是它**不许缩水**：少一步就少一个衔接。所以下面这九步是硬的，改剧本要
改这份文档，不许在脚本里悄悄跳过。

## 剧本（九步，一个字不许缩）

| # | 用户在做什么 | 走的是哪条现役链路 |
|---|---|---|
| ① | 新建空项目 | 项目库「新建空白项目」按钮，不 seed 工程 |
| ② | 在创作区文本编辑器写三句剧本 | `[aria-label="创作文档编辑区"]` 的 TipTap 编辑器 |
| ③ | 显式拆成 3 镜 | 选中正文 → 划词浮条「拆成镜头」→ 常驻 Agent 发 `nomi_canvas_plan(operation=propose_storyboard_plan)` → **人工批准** |
| ④ | 选中第 2 镜 | 分镜表行选中（镜号徽章按钮 `选择镜 2`） |
| ⑤ | 改第 2 镜的一句提示词 | 在分镜页 Agent 面板下指令 → Agent 发 canonical `nomi_canvas_plan(operation=patch_shots)`，`select.indexes=[2]` → **人工批准** |
| ⑥ | 第 2 镜生成一张图片 | 行内「生成镜 2」→ 花钱确认卡 → runner（供应商是本地 loopback fixture，**零额度**） |
| ⑦ | 结果回到该行 | 结果落成画布节点（`meta.shotId`），第 2 行画面格变 `done` |
| ⑧ | 关闭 Nomi 重启 | 真 `app.close()`（断言进程真死），同一份 userData/settings/projects 冷启动 |
| ⑨ | 图和修改仍在 | 先读盘、再从项目库「继续创作」回到分镜页看屏 |

## 每步的断言与截图

截图落在 `.tmp/golden-path-<ts>/NN-*.png`，`report.json` 同目录。

| 截图 | 这一步钉死了什么 |
|---|---|
| `01-new-empty-project` | 空项目建出来了，创作区编辑器可见 |
| `02-agent-gate-enabled` | 走**真实设置 UI** 打开常驻 Agent 后，创作区出现 Agent 面板 |
| `03-script-written` | 三句剧本逐字落进编辑器（`toHaveText` 全等，不是 contains） |
| `04-plan-awaits-approval` | 规划**停在人工批准边界**：提议卡 pending，尚未写入 |
| `05-plan-committed-three-shots` | 批准后盘上是 3 镜，提示词与规划逐条相等；且规划阶段 `fixture.images.length === 0`（规划不花钱） |
| `06-storyboard-three-rows` | 分镜页 3 行；分镜面 Agent 面板在位 |
| `07-shot2-selected` | 第 2 行 `data-selected="true"` **且** 浮条显示「已选 1 镜」（两层，排除「浮条出来了但选的是别人」） |
| `08-patch-awaits-approval` | 改提示词也停在批准边界；**批准前盘上三条提示词逐字未变**（提议没有偷跑） |
| `09-shot2-prompt-patched` | 批准后：第 2 镜提示词变了；第 1、3 镜逐字未变；表上第 2 行也显示新词 |
| `10-generation-awaits-confirm` | 生成前必弹花钱确认卡；**确认前 `fixture.images.length === 0`** |
| `11-shot2-generated` | 第 2 行 `data-storyboard-frame="done"`；结果节点按 `meta.shotId` 归位、`result.url` 是 `nomi-local://`；恰好 1 次图片调用 |
| `12-restart-project-reopened` | 冷启动后从项目库「继续创作」回到**同一个** projectId |
| `13-restart-changes-persist` | 盘上提示词与结果 URL 都在；屏上第 2 行显示新词、`done`、**图片 `naturalWidth > 0`**（真解码，不是只有 src） |

零额度保证：`walk.finish` 收尾会跑 `fixture.assertClean()` —— 出现任何未登记的供应商请求、
或登记了却没发生的请求，都当场报红。`report.paidCalls` 恒为 0。

## 怎么跑

```bash
# 门（CI / 每日）
pnpm run test:golden

# 阳性对照：必须报红
node tests/ux/golden-path.e2e.mjs --positive-control
```

前置：`pnpm run build`（走查跑的是 `dist` / `dist-electron` 的产物，不是源码）。
`test:golden` 自带 `check:electron-install`，但**不**自动构建——改完代码没重新构建，
表现为「跑的是旧版」。

## 阳性对照：证明这道门是活的

最后那条「重启后修改仍在」如果读的是内存、或者根本没读到东西，它会**永远绿**
（[vacuous-probe-passes-forever](../lessons/vacuous-probe-passes-forever.md)）。所以：

`--positive-control` 在 app 关掉之后、重启之前，把盘上第 2 镜的提示词改回旧值。
**合格的对照 = 恰好红在 `重启后盘上第 2 镜的提示词丢了` 这一条**（退出码 1）。
脚本会自己判：红在别处会打印「阳性对照红错了地方」；居然没红会打印「阳性对照失效」。

实测（2026-09-05，本机 macOS 15.5 / Electron 43.4.1）：

```
· ⚠️ 阳性对照已注入：盘上第 2 镜提示词被改回旧值，重启断言必须报红
✅ 阳性对照成立：破坏落盘后，「重启后盘上第 2 镜的提示词丢了」这条断言如期报红 —— 这道门是活的。
  Expected: "GOLDEN_PATCHED：逆光下的侧脸，尘埃在光柱里浮动，安静的近景。"
  Received: "书架前的女孩侧影，手指抽出一本旧诗集，中近景。"
```

对照组**只跑到那条盘断言为止**，这是设计如此：app 关着时改 `project.json`，重开会被
产品的外部改动守卫拦住（界面显示「另一台电脑有新版本」）——那是**正确行为**，但会让红
落在错误的位置。所以盘断言排在开工程之前。

## 红了怎么分类

按下面顺序问，第一个命中的就是分类。**不要跳过第 1 条**：仪器坏了会伪装成产品坏了。

### 1. environment（环境）— 不改代码
- 报「Nomi 走查启动失败 / 等了 60000ms 没等到窗口」→ 先 `pnpm run build`。
- 报大量超时且本机同时跑着别的 suite → 先 `pgrep -fl vitest; uptime`，并行会把耗时放大到像真挂
  （[flaky-test-check-other-worktrees-first](../lessons/flaky-test-check-other-worktrees-first.md)）。
- Electron 被 macOS 判为损坏 → [electron-xprotect-false-positive-resign](../lessons/electron-xprotect-false-positive-resign.md)。
- 判据：**同一个 commit 换一台干净环境重跑就绿** = environment。

### 2. test-infra（尺子坏了）— 改走查，不改产品
- 报「Unconsumed expectations / unexpected request」→ fixture 登记与真实调用对不上，是尺子的账。
- 报某个选择器点不到，而截图里那个东西明明在 → 锚点漂了。修之前先 `grep -rn '<那个选择器>' tests/ scripts/`，
  同一个死选择器在别处正制造假绿（[dead-selector-lies-both-ways](../lessons/dead-selector-lies-both-ways.md)）。
- 报 `Received: null` 一类的竞态 → 缺一个「等状态到位」的条件等待。
- 判据：**产品在真机上手跑一遍是对的，只有脚本红** = test-infra。手跑必须真手跑，别靠推理。

### 3. product（产品坏了）— 当天修，走根因流程
- 盘上的东西丢了 / 改错了行 / 提议在批准前就写了 / 花钱确认卡不弹 —— 这些都是产品。
- 走 `.agents/skills/root-cause-remediation/SKILL.md`（P2）；`recurring` 或高风险路径补 v3 合同（R21）。
- **不要顺手改这份走查让它变绿**——那是把门拆了。

## 发现（走查过程中冒出来的，未在本刀修复）

- **[test-infra，已在本刀修掉]** `screenshotSettled` 等的是几何/动画安定，**不等图片解码**。首版第 13 张截图
  拍到一个空白画面格（图其实好好的，只是还没画上去），而断言只比了 `img` 的 `src` 字符串，
  照样绿——典型的「证据非确定 + 断言比错东西」。现在断言改成读 `naturalWidth`，取证在它之后。
  这条对**所有**要拍图片的走查都成立，值得日后固化进 `_assert.mjs`。
- **[product，未修]** 结果节点上的 `node.shotIndex` 是**画布内的序数**，不是镜号：第 2 镜的结果节点
  `shotIndex === 1`（因为它是画布上的第一张）。名字叫 `shotIndex` 却不是 shot 的 index，
  任何按它找镜头的代码都会静默匹配不到、看起来像「产品没落节点」。本走查改用
  `meta.shotId` 归位（那才是 `storyboardNodeBinding` 声明的绑定键）。建议后续重命名或收敛。
- **[product，未修 · 无害]** app 关闭期间外部修改 `project.json`，重开时项目库正确地提示
  「另一台电脑有新版本」并拦住打开。行为是对的；记在这里是因为它会**改变任何写盘型 fixture 的姿势**——
  想模拟「写丢了」，断言必须排在重新打开工程之前。

## 边界（这条路故意不覆盖什么）

- 不覆盖真实供应商、真实额度、任何 API key（供应商是本地 loopback）。
- 不覆盖视频镜、参考卡（锚）、批量生成、时间轴与导出——那些各有自己的走查。
- 不覆盖打包态（跑的是开发构建）。打包态的毕业清单另见 `docs/plan/2026-09-03-m5-packaged-graduation.md`。
- 第 ② 步的发布闸：`agentHostEnabled` 现在默认关，走查用真实设置开关打开。
  **这个闸删掉后，`stepEnableAgentGate` 连同调用点一起删掉**，脚本里已留同样的注释。
