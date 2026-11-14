# 设计卡：Nomi 的小球 / 浮窗 / 停靠换一种存法（人选的、此刻显示的、算出来的分开放）

方向检查：`docs/engineering/direction-checks/2026-11-14-agent-form-shown-vs-stored.md`（第 6 节「换一种做法」，第 7 节用户已定：收起后再点开，回到上次选的摆法；宽窗里系统替你打开 / 收起不记）。

## ★1 用户怎么用

当我在某一页把 Nomi 摆成浮窗或停靠，收成小球去干别的，我想再点开时它回到我上次摆的样子；窗口拉窄时我点开 / 收起只是这一刻，拉宽回来每一页还是我自己摆的样子；我在一页点开，别的页不跟着动。

1. 宽窗，创作页：形态切换选「浮窗」→ 浮窗。
2. 点「缩成小球」→ 小球。
3. 点小球（或 ⌘J）→ 回到浮窗（改存法前回到停靠：收起时摆法丢了）。
4. 窗口拉到 700：停靠的页临时收成小球、浮窗照旧；点开是浮窗；存档一个字节不改。
5. 窄窗里在创作页点开：生成页、分镜页还是各自存的样子（改存法前整窗一份，串页）。
6. 窄窗里生成页被收起、从创作页去画布挑参考图：生成页的 Nomi 摆得出来（机器摆出来，只改此刻，不改存的）。
7. 拉回 1280：各页回到自己存的样子。

不做：不改样子（控件位置、大小、文案、图标、小球默认位置都不动）；不加控件；不做 Esc 关浮窗；不改项目文件的保存内容与时机。

真实任务：
- 创作者在创作页把 Nomi 改成浮窗写稿，收起去看分镜，再点开继续写（场景 1–3）。
- 笔记本 / 分屏窄窗口里在创作页问 Nomi，切到画布再切回（场景 4、5、7）。
- 生成页对话被收起时，从创作页去画布挑参考图（场景 6）。

指标（量具都是常驻测试，跑法 `pnpm exec vitest run src/ui/app-shell/shell`）：
- 主：收起再开摆法丢失 0 格。量具：`ShellAgentHost.formProbe.test.tsx`「宽窗收起再点开」4 页 × 2 摆法 × 3 收法 × 3 开法 = 72 组，加探针表。
- 主：跨页串 0 格。量具：同文件探针表 2 窗宽 × 4 页 × 3 旧存档 × 9 手势 = 216 格，每格切到其余 3 页核对（648 次）；另 216 格「关掉再开」。
- 主：读错那一份 0 处。量具：`agentFormShownVsStored.structure.test.ts`（两个 store 之外读持久化摆法 / 收没收起 / 旧 form → 红）。
- 护栏：打开项目不点就关零写入。量具：`ShellAgentHost.openWritesNothing.test.tsx`（只把种存档的写法换成人的动作，断言一条没松）。
- 护栏：老用户迁移 12 格全对。量具：`agentFormStore.migrate.test.ts`（夹具 `tests/fixtures/old-user-data/agent-form/v0.24.1-local-storage/`）。
- 护栏：窄窗档里除选摆法外存档逐字相等。量具：`agentFormNarrowGestures.test.ts` 6 起点 × 216 条动作序列。

## ★1b 连带界面

不涉及：没有新文案、新回执。⌘\ 仍是「停靠 ↔ 小球」（`docs/engineering/concept-owners/shell.recall-entry.json`），快捷键表里的「收起 / 展开 Nomi」不变。

## ★1c 老用户

- 本机 localStorage 那一串（键 `nomi:shell-agent-form:v1`，0.24.x 存 persist version 1、每页三值 `form`）：升级时用 zustand `persist` 的 `version` + `migrate` 迁成 version 2。`ball` → 收起 + 这一页的默认摆法（生成页浮窗、其余停靠，就是旧版从小球点开会去的地方）；`float` / `dock` → 开着 + 对应摆法；浮窗位置大小、小球位置原样保留；认不出的值、缺页按这一页默认。三个旧值都能映射，没有迁不了的字段。
- 升级那一刻看到的：每页和升级前一样（迁移测试逐格断言此刻显示 = 旧 form）。
- 迁完回写一次 version 2；再读不迁、不回写，逐字相等。
- 退回上一版：旧版读到 version 2 而自己没有 migrate，zustand 丢掉这一串、各页回默认（形态偏好回默认，位置回默认）；不影响项目、模型、设置。代价小，不另做降级兼容。
- 证据：`tests/fixtures/old-user-data/agent-form/v0.24.1-local-storage/`（0.24.1 自己的 store 落的，生成器 `generators/zzAgentFormGen.ts.txt`）+ `src/ui/app-shell/shell/agentFormStore.migrate.test.ts`（3 旧值 × 4 页 = 12 格，加各页不同一份、新用户、认不出的值）。

## ★2 谁说了算

- 人选的、要存的（每页摆法 `placement` + 收没收起 `collapsed` + 位置）：`useAgentFormStore`（persist），`src/ui/app-shell/shell/agentFormStore.ts`。
- 此刻怎么显示、不该存的（窗宽、窄窗档里每页的点开 / 收起、每页的机器让位）：`useAgentFormViewStore`（不挂 persist），`src/ui/app-shell/shell/agentFormViewStore.ts`，只有 agentFormStore 能 import 它。
- 算出来的：`shownForm(页)` / `useShownForm(页)`，全仓唯一一处算。证据：`node scripts/door-map.mjs shownForm` 4 扇门，定义只在 agentFormStore；其余 3 处是调用（外壳 2、指向节点 1；门表把调用记作 write 是它的启发式，实为读）。
- 对外只有动作：人的 `openAgent` / `collapseAgent` / `chooseAgentPlacement`（只在 `ShellAgentHost` 里调）；机器的 `machineHold` / `machineRelease`（只在挑参考图、指向节点两处调）。结构测试钉住调用方名单。
- 删掉的：三值 `form` 这一种表示、公开的 `setForm` / `requestForm` / `chooseForm`、死字段 `dockSuppressed` / `setDockSuppressed`、整窗一份的 `narrowShown`、`openFormFor`（外壳和测试里那份抄本）、旧读法 `useEffectiveAgentForm` / `readEffectiveAgentForm` / `effectiveAgentForm` / `shownIgnoringSuppression`。`src` 下 0 处（结构测试同口径扫描，连注释）。
- 没有靠「状态变了」去猜意图：别处叫回仍走 `agentRecallNonce` 显式计数。

## ★3 一致与复用

三条路和取舍照方向检查第 6 节，不重写：`docs/engineering/direction-checks/2026-11-14-agent-form-shown-vs-stored.md#6-三条路对比表--推荐`。选「换一种做法」。复用：zustand `persist` 的 `partialize` / `version` / `migrate`（现成机制）；`declareStoreLifetime`（机器让位登记为 project 级，离开项目清掉）。以前定过的照旧：每页各存各的、窄窗点开 / 收起不改存档（WindowNarrow 板 D2）、一个阈值（narrow.one-threshold，matchMedia 仍只外壳一条）、⌘\ = 停靠 ↔ 小球（concept-owners/shell.recall-entry）。

## ★4 全状态（页 × 存法 × 窗宽 × 动作）

四个页规则相同（探针表逐页跑过），只有默认值不同。「存」= 人选的那份；「写」= 改了存档的哪一项，没写 = 存档逐字相等。窄窗档里「选停靠」是灰的（放不下）。

| 存法 · 窗宽 | 进来时 | 人开（点小球 / ⌘J / 别处叫回） | 人收 | 选浮窗 | 选停靠 | ⌘\ | 机器让开 → 回来 | 机器摆出来（挑参考图） | 切页再回来 | 跨阈值 | 重开应用 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 开着停靠 · 宽 | 停靠 | 停靠（只聚焦）· 没写 | 小球 · 写收起 | 浮窗 · 写摆法 | 停靠 · 没写 | 小球 · 写收起 | 小球 → 停靠 · 没写 | 停靠（已开着，不留覆盖） | 停靠 | 拉窄：小球 | 停靠 |
| 开着浮窗 · 宽 | 浮窗 | 浮窗 · 没写 | 小球 · 写收起 | 浮窗 · 没写 | 停靠 · 写摆法 | 小球 · 写收起 | 小球 → 浮窗 · 没写 | 浮窗 | 浮窗 | 拉窄：浮窗 | 浮窗 |
| 收着（上次停靠）· 宽 | 小球 | 停靠 · 写开着 | 小球 · 没写 | 浮窗 · 写摆法 + 开着 | 停靠 · 写开着 | 停靠 · 写开着 | 小球（已是小球，不留覆盖） | 停靠 · 没写；人一动或跨阈值就清 | 小球 | 拉窄：小球 | 小球 |
| 收着（上次浮窗）· 宽 | 小球 | 浮窗 · 写开着 | 小球 · 没写 | 浮窗 · 写开着 | 停靠 · 写摆法 + 开着 | 停靠 · 写摆法 + 开着 | 小球 | 浮窗 · 没写 | 小球 | 拉窄：小球 | 小球 |
| 开着停靠 · 窄 | 小球（放不下） | 浮窗 · 没写 | 小球 · 没写 | 浮窗 · 写摆法 | 灰 | 小球时：浮窗 · 没写 | 浮窗 → 小球 → 浮窗 · 没写 | 浮窗 · 没写 | 各页各自的 | 拉宽：停靠（窄窗里点的作废） | 小球 |
| 开着浮窗 · 窄 | 浮窗 | 浮窗 · 没写 | 小球 · 没写 | 浮窗 · 没写 | 灰 | 小球 · 没写 | 小球 → 浮窗 · 没写 | 浮窗 | 各页各自的 | 拉宽：浮窗 | 浮窗 |
| 收着（上次停靠）· 窄 | 小球 | 浮窗 · 没写 | 小球 · 没写 | 浮窗 · 写摆法（开没开不写） | 灰 | 浮窗 · 没写 | 小球 | 浮窗 · 没写 | 各页各自的 | 拉宽：小球 | 小球 |
| 收着（上次浮窗）· 窄 | 小球 | 浮窗 · 没写 | 小球 · 没写 | 浮窗 · 没写 | 灰 | 浮窗 · 没写 | 小球 | 浮窗 · 没写 | 各页各自的 | 拉宽：小球 | 小球 |

没把握、要人看一眼的格：
- 窄窗里在收着的页选「浮窗」：写了摆法、没写开着——拉宽回来是小球，再点开是浮窗。依据是「窄窗里点开不改存下的开没开」（D2），但人可能以为「选了浮窗 = 开着浮窗」。
- ⌘\ 从小球：宽窗是选停靠（照 concept-owners 原定义，不是「回到上次选的」）；窄窗里停靠放不下，只是点开。
- 机器摆出来（挑参考图）没有自动「回来」：挑完对话留在外面，直到人在这一页动一下、跨阈值、或离开项目；重开应用回到存下的样子。

空 / 加载 / 失败 / 取消中 / 过期 / 能力不可用：不适用（纯本机界面偏好，没有异步、没有外部资源）。

## ★9 验收与回滚

验收清单（实现线按它自验，验收线只核这份）：
1. 先锁现状：方向检查第 3 节三条预测写成期望行为测试，改存法前跑红（预测 1 红 2/2；预测 2 今天绿 3/3、按页补丁后红 3/3；预测 3 红 1），改后全绿。`ShellAgentHost.formProbe.test.tsx`「没钉住的三条」。
2. 新表示：人选的（persist）/ 此刻的（不 persist）/ `shownForm` 唯一读；对外只给动作。`agentFormViewStore.test.ts`、`agentFormNarrowTier.test.ts`。
3. 同提交删旧：结构测试「整个 src 里 0 处」。
4. 老用户迁移 12 格 + 再存再读稳定：`agentFormStore.migrate.test.ts`。
5. 常驻探针驱动真组件入口（渲染 `ShellAgentHost`，点真小球、真形态切换、真「⋯」、真快捷键、真叫回计数）：`ShellAgentHost.formProbe.test.tsx`。
6. 结构测试：`agentFormShownVsStored.structure.test.ts`。
7. 走查：`tests/ux` 里量到 Nomi 形态的走查各跑一次，窄窗外壳走查中英各一次。

反例（改坏 → 红，还原 → 绿）：
- 把此刻那份挂上 persist → 结构测试红。
- 调用方直接读持久化字段（如挑参考图改读 `bySurface.generation.collapsed`）→ 结构测试红。
- 窄窗里 `openAgent` 改成写持久化那份 → 探针表与 `agentFormNarrowGestures` 红（打开不写那条只量项目落盘，不覆盖本机偏好）。
- 此刻那份改回整窗一份 → 探针表跨页格红。
- 迁移里把 `float` 映射成停靠 → 迁移测试红。
- 机器让位改成写「开没开」→ 机器让位那组格红。

这一类还会从哪回来：新加一个「问 Nomi」入口（应走叫回计数 → 外壳 `openAgent`；直接调 `chooseAgentPlacement` / 机器动作会被结构测试的调用方名单拦）；新页面（`AgentFormSurface` 加一页，默认值、迁移、探针表的页列表都按类型补齐）；新版本再改存法（version 3 + migrate，夹具加一份 0.25 落的）。

回滚：revert 本 PR 的合并提交。已升级用户的 localStorage 是 version 2，回滚后的代码读不懂会回默认（同 ★1c 退回上一版），不影响项目文件。

独立验收：非四类，不强制；协调定。
