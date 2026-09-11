# 结构评审：技能这一份事实，和它的 N 条投影

状态：单一评审者视角，不代表多位独立审批者。触发方式不是排期，是门岗——
`check:symptom-cluster` 报出 `electron/skills` 在 2026-09-07 到 09-11 的 5 天里收到了第 6 份根因合同，
`src` 收到第 3 份。**第三份合同是「这一层的结构不对」最便宜的证据**，所以本文回答的不是「这 6 个 bug 各自怎么修」，
而是「它们是不是同一个结构缺口，缺口在哪一层，以及什么东西能拦住第 7 份」。

范围：`electron/skills`（规范记录与落盘）、以及 `src` 里读它的那几个消费者。
配套评审：[2026-09-11-agent-lane-live-vs-snapshot.md](2026-09-11-agent-lane-live-vs-snapshot.md)（lane 层的寿命裁决，本文第 §3 与它衔接）。

## 1. 这 6 份合同是不是同一类

| 合同 | 它说的根因 | 落在哪条边界上 |
|---|---|---|
| `2026-09-07-skill-manifest-two-owners` | 一个事实两个文件级 owner（SKILL.md frontmatter 与 skill.json），靠优先级选一个 | 记录的**产生**边界 |
| `2026-09-08-curated-media-boundary` | 策展媒体在投影与包传输之间丢了绑定 | 记录 → 包 / 协议 |
| `2026-09-09-skill-library-media-projection` | 展示层 DTO 没保住所有发现型消费者需要的媒体、全文与分类 | 记录 → 渲染层 DTO |
| `2026-09-10-b6-mcp-skill-content` | MCP 投影没保住内容寻址的包边界 | 记录 → MCP 工具结果 |
| `2026-09-11-lane-live-skills-snapshot`（本轮） | lane 的技能索引是开 lane 那一刻的快照，之后不再更新 | 记录 → 模型的系统提示词 |
| `2026-09-07-agent-stage4-dead-file-removal` | 阶段 4 切换后的死文件清理 | —（不属本类，是一次性清理） |

前 5 份是同一类，而且类的形状比每份合同自己说的更大：

> **`SkillRecord` 是规范记录，它有至少 7 个消费者，每个消费者各自决定「带哪些字段、什么时候取」。
> 这 5 份合同就是 5 个消费者各被单独修了一次。** 缺的不是某个字段——缺的是**「投影」这件事没有 owner**：
> 没有一张表说得出每个消费者需要 `SkillRecord` 的哪几个字段、那份投影的寿命是什么、谁验证它没漏。

实核的消费者清单（`git grep readSkillRecords|discoverSkillRecordsFromRoots`，2026-09-11）：

| 消费者 | 入口 | 投影形状 | 寿命 |
|---|---|---|---|
| 渲染层技能库 / Agent 技能菜单 | `electron/skills/skillIpc.ts:106`（`listSkillsForRenderer`） | `SkillListItem` DTO | 每次调用现读；渲染层各存一份 `useState` |
| 模型的技能索引（lane） | `electron/agentLane/laneInstalledSkills.mts` | `LaneSkillIndexEntry` + 可信读根 | **本轮之前是开 lane 一次**；现为每回合一次 |
| MCP 技能资源 | `electron/capabilityCore/mcpSkillResources.ts` | 内容寻址包 | 每次调用现读 |
| 技能写入回执 | `electron/capabilityCore/skillWriteTransportAdapters.ts:138` | 写后重读核对 | 每次写入现读 |
| 提示词库 | `electron/promptLibrary/curatedPrompts.ts:6` | `LibraryPrompt` | 每次调用现读 |
| 预览协议 | `electron/skills/skillPreview.ts:15` + `electron/protocol/localProtocol.ts` | 媒体 URL | 每次请求现读 |
| 执行证据 | `electron/skills/skillExecutionEvidence.ts:14` | 证据条目 | 每次调用现读 |

**好消息（不该被这轮红灯掩盖）**：发现这一层已经收敛成一个 owner
（`discoverSkillRecordsFromRoots`，`electron/skills/skillStore.ts:129`，注释里写明「所有 transport 都调它」），
`skill.json` 那个第二 owner 也已经在 09-07 删除并由 `check:skills-format` 守住。
也就是说**记录的产生**已经只有一个真相源；反复出事的是记录**之后**的那一段。

## 2. 为什么这一类不会自己停

三个放大器，都不报错：

1. **投影是减法，而减掉什么由每个消费者自己决定。** 少带一个字段不会抛异常，只会让某一个下游少知道一件事——
   而发现它的人往往是用户（「卡片上没有封面」「MCP 拿到的包读不出正文」「Agent 说没有这个技能」）。
2. **投影的寿命没有类型。** 一个数组和一个「每次都重读的数组」长得一模一样。lane 那条就是这么漏的，
   而同一份 port 上其实已经有三个字段（`tasks` / `approval.policy` / `systemPrompt`）用注释写过这条纪律。
3. **每条投影各有各的测试，而没有一条测试跨两条投影。** 09-07 真机实拍到的那一幕最能说明问题：
   左边技能库的卡片好好地立着、右边 Agent 的技能菜单一个字都没有它——两边各自的测试都是绿的。

## 3. 本轮做了什么（以及刻意没做什么）

做了三件，都在「投影」这条线上，不是又修一个字段：

- **lane 这条投影收了一个 owner**：`LaneSkillIndexSource`（`electron/agentLane/laneInstalledSkills.mts`）
  同时产出索引、可信读根与提示词段，三样出自同一次刷新，于是「模型看得见」与「模型读得到」不可能分叉。
- **寿命变成一条规则而不是一个字段的属性**：`laneHost` 的 `systemPromptForRun` 规定
  「系统提示词在每个回合边界整体重新求值一次、回合内不变」，任何随设置/磁盘变化的段落自动跟上。
- **写盘的变更信号收了一个发出点**：`electron/skills/skillLibraryBroadcast.ts` 挂在
  `importSkillPackageToUserDir` / `deleteUserSkill` 上，于是三个写入者（面板导入、拖拽、Agent 的
  `author_skill`）不必各自记得喊一声；`src` 那边原来两处本地派发同 commit 删除，只留 `NomiRouterApp` 一个接线点。

**刻意没做**（避免把评审做成又一次逐件修补，也避免在一次 bug 修复里塞一个新框架）：

- 没有给 `SkillRecord` 加一层「投影注册表」。它是正确方向，但它是一次结构改造，要自己的方案与拍板，
  不该搭在一条 bug 修复的车上。见下一节的待派。
- 没有给技能目录加 fs watcher：它会带来自己的一族问题（编辑器写临时文件引发的抖动），
  而 lane 侧因为改成每回合重扫，实际上已经对外部改动实时了。

## 4. 关于 `src` 这一簇：先说清它有多少是真的

`src` 被报出三份合同（`2026-09-08-catalog-liveness`、`2026-09-11-mcp-onboarding-defects`、本轮），
但 `src` 这个模块键 = **整个渲染层**，粒度太粗——三份分别落在模型目录、MCP 接入提示与技能库，
子系统互不相干。**所以这一簇里有相当一部分是门岗粒度的产物，不是「渲染层结构不对」的证据，这一点必须先承认。**

但它们之间确实有一条真的共线，而且只有两条（catalog 与 skills）共享：

> **渲染层对主进程事实的缓存，失效信号各自发明一套 `window` 事件，而「谁负责派发」没有规定。**
> `nomi-model-catalog-changed`（`src/NomiRouterApp.tsx:38`）与 `nomi-skill-library-changed`
> （`src/workbench/skillLibrary/skillLibraryChanged.ts:15`）是同一个范式的两份实例。
> 模型目录那一份的派发点在主进程（`electron/catalog/validateCandidateCredential.ts:92`），是对的；
> 技能那一份此前只在渲染层派发，于是主进程里的第三个写入者一个字都传不出来——本轮把它对齐成前者。

**这一条现在是两处一致的范式，但仍然只是范式，不是防线**：第三个需要失效信号的渲染层缓存出现时，
没有任何东西逼人回答「你的派发点在哪一侧」。这也是下一节待派的第二条。

## 5. 待派（本轮不做，单独派工 + 单独裁决）

1. **技能投影登记表**：一张机器可读的表，登记每个 `SkillRecord` 消费者需要哪些字段、投影的寿命
   （每次现读 / 每回合 / 装配期常量）、以及验证它的那条测试。现成的位置是 R29 的 framework-surface
   逐字段裁决（`docs/engineering/framework-boundaries.json` + `pnpm run check:framework-surface`）——
   它今天只登记框架公开的字段，把我们自己这份规范记录的字段也纳进去，`SkillRecord` 加字段即红。
   这是唯一能拦住第 7 份合同的东西；在它落地之前，本轮留下的只是 lane 那一条投影的单点棘轮。
2. **渲染层失效信号的派发侧规定**：凡是渲染层缓存主进程的事实，失效信号必须由主进程发出
   （写那一层，不是某个调用入口）。两处已一致，写成门岗才算防线（R28）。
3. **跨投影的一致性测试**：当前每条投影各有各的测试，没有一条跨两条。09-07 那一幕
   （技能库有、Agent 菜单没有）与本轮那一幕（菜单有、模型索引没有）都是这条缝里漏出来的。
   本轮的 `tests/ux/lane-live-skills.walk.mjs` 是第二条跨缝走查（第一条是 `skill-import-real-use.walk.mjs`），
   但它们是按 bug 长出来的，不是按投影矩阵铺的。

## 6. 证据与限制

- 消费者清单来自 2026-09-11 的 `git grep`，是那一刻的实核；`electron/skills` 与 `src` 两簇的成员清单来自
  `pnpm run check:symptom-cluster` 的输出，不是人工挑的。
- 本文**没有**复核那 5 份合同各自的修复是否正确——它只判「它们是不是同一类」。
- `2026-09-07-agent-stage4-dead-file-removal` 只是因为 scope 里带了 `electron/skills/skillStore.ts`
  才落进这一簇，它是阶段 4 切换的死文件清理，不能拿它充当「这一层老在坏」的证据。
- 第 4 节关于 `src` 的结论明确承认了粒度问题：那一簇不能整簇当作结构证据，只有 catalog 与 skills
  这两份之间那条共线是真的。
