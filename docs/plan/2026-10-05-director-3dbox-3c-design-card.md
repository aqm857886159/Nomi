# 3D-BOX 段 3c：手改覆盖层 + 按指令最小改动 + 镜头选中 → Agent 上下文 设计卡

> 状态：🚧 实施中（2026-10-05）。方案正本 `docs/plan/2026-10-04-director-3dbox-phase3.md` §6、§7 第 5 条、§10「3c」行；接 3b 设计卡「给 3c 留的接口」。
> 全部改动在 `NOMI_DIRECTOR_3DBOX` 开关后：`director.write` 只在开关开时注册；编辑器 / 输入框里的新分支都先问 `isDirector3DBoxEnabled()`。开关关时行为与 main 一致。
> 「正在改：镜头 N」标签是新界面：本段只做数据通路，UI 停在样张前（样张由协调会话出，规格见文末）。

改动名：3D-BOX 3c · 线/负责人：L-3c `feat/director-3dbox-3c` · 类别：[可打断][新界面（只到数据通路，UI 待样张）][其他]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在精修里亲手挪了机位 / 人，又对 Agent 说「第二镜改成特写」时，我想只有第二镜的机位按新指令重算、别处手改原样留着，并被明说「第二镜机位你手调过，已按新指令重算，撤销可恢复」，以便放心边聊边手调。步骤：① Agent 交补丁；② 宿主应用补丁，规范化计划不变 → `unchanged`，不重编译、不写画布；③ 有变化 → 整份重编译；④ 从「上次编译的指纹」与「当前工程」算出手改覆盖层（按稳定 id 逐属性）；⑤ 补丁**直接改到**的实体、且新编译真的改了那个属性的手改 → 丢弃，列进 `reorderedOverrides`；其余手改原样重放；⑥ 新旧编译对比，没被直接改到却变了的实体列进 `changedEntities`；⑦ 测量（逐 cut 景别 / 运镜、连续性问题）对「编译 + 覆盖」后的工程测；⑧ Agent 撤销这次 stage_shot → 被丢的手改回来（编辑器开着也回来）。另：精修里点中某镜机位 → 发消息时上下文里带「镜头 N（名字、修订号）」。**不做**：标签 UI（待样张）、镜头条点选成为「选中」（UI，待样张）、多镜选中（数据通路收数组，选择态今天只有单机位）、改编译器内部。**已知坑**：携带分组（人拿着东西）——见文末遗留 ①；覆盖是整属性替换（改了一个路标 = 覆盖整条轨迹）。**真实任务**：T1 3b 的面馆两人戏建好后，在精修里把 `wide` 机位挪近 → 说「最后一镜改成特写」→ `wide` 的手改保留、`reorderedOverrides` 空；T2 在精修里改了最后一镜机位 → 说「最后一镜改成特写」→ 这条手改被丢并列出 → 说「撤销」→ 手改回来；T3 说「已经是正反打了」→ `unchanged`、零写入。 | `applyDirectorWrite.overrides.test.ts`（真画布 store + 真提议事务 + 真补偿撤销）；真 App 走查 `pending-real-app` |
| ★2 谁说了算 | 碰 4 个概念：**手改覆盖层** → 新 `nodes/director/model/planOverrides.ts`（方案 §3 已登记的 owner；纯函数：指纹、推导、分类、重放）；**导演工程唯一写者**沿用 3a/3b（编辑器开着 = 编辑器 store，经 `writeExternalDirectorProject`；关着 = 节点 meta），新增「读当前工程」同一处（`readDirectorSessionProject`）；**编译基线指纹**住在导演节点的计划 meta（`directorPlan.compiledBase`），只由 `applyDirectorWrite` 写；**镜头焦点**（选中了哪镜）owner = 编辑器 store 的 `selection`，经会话登记处只读投影 `readDirectorShotFocus()`，输入框发送时取一次，不存第二份。编译器不知道覆盖层（结构守卫测试走静态 import 图）。 | `node scripts/door-map.mjs writeExternalDirectorProject` → 写 1 扇；`DIRECTOR_PLAN_META_KEY` → 读 2 扇（执行体、预演判据）；`planOverrides.guard.test.ts` |
| ★3 一致与复用 | 指纹复用 `synchronousSha256` + `stableProjectAgentJson`（与计划修订号同一套）；工程规整复用 `normalizeDirectorProject`（指纹两侧都过它，编辑器往返不产生假手改）；测量复用 `sampleDirectorProject` / `measureContinuity` / `summarizeDirectorShots`；「直接改到」复用 3b `planPatch` 的 `touched`；上下文标签复用常驻输入框的 `AgentContextHandle`（`canvasNode` + `custom` 定位器，模型面一个字不加）。不引第三方 diff / CRDT 库：差量粒度是「稳定 id × 顶层属性」，比较就是两个哈希相等，库带不来东西（见「先查别人」）。自写：覆盖层推导与归属规则（领域：哪条手改让位于哪条导演指令）。 | `pnpm run check:self-written`（`nodes/` 已是领域目录） |
| ★4 全状态 | stage_shot 补丁结果：无手改 → 两个列表空；有手改且不冲突 → 重放、`reorderedOverrides` 空；冲突 → 丢弃并列出 `<实体>.<属性>`；连带 → `changedEntities` 列实体 id；`unchanged` → 零写入、列表空；编辑器开着时撤销 → 编辑器当场换回撤销后的工程（不留旧画面、退出时不把旧工程写回去）。镜头焦点：没开导演台 / 没选机位 / 选的不是计划镜头（用户自建机位）→ 不带；选中计划镜头 → 带 1 条。预演时长与镜头时长不一致 → 拒绝并说明（遗留 ②）。文案：只新增给模型看的英文拒绝说明与上下文标题的 zh/en 键。 | 单测；`pnpm run check:i18n` |
| 5 中途表 | 见下表。 | 单测 |
| 6 外部数据与失败 | 外部输入：Agent 的补丁（3b 已校验）、目标视频节点的时长参数（节点 meta 的 `duration` / `durationSeconds`，与主进程 `shotDurationSeconds` 读同两个键）。旧节点（3b 建的，没有编译基线指纹）→ 用当前编译器重编旧计划求基线（一次性迁移，结果写回新指纹）。 | `planOverrides.test.ts` 旧节点用例 |
| 7 性能预算 | 补丁一次：编译 ×1（旧节点 ×2）、指纹 ≈ 实体数 × 属性数个短哈希（3 镜 2 人约 40 实体 × 15 属性）、测量 ×1；目标 < 250ms（记录不阻断）。指纹存盘约 10–20KB / 节点。 | 单测计时打印 |
| 8 真实条件 | Windows 11 本机跑单测与门岗；真窗口、英文界面、最小窗口 = `unverified`（不起可见窗口，标 `pending-real-app`）；真付费：本段不碰付费路径。 | 报告 |
| ★9 验收与回滚 | 验收（另一条线）：跑 `applyDirectorWrite.overrides.test.ts`、`planOverrides*.test.ts`、`directorShotFocus.test.ts`；开关开跑 T1–T3。回滚：revert 本段提交；或构建不开 `NOMI_DIRECTOR_3DBOX`。独立验收：待协调会话指派（验收线 ≠ L-3c）。 | `## 独立验收` |

## 5 中途表

钱：本段全部本地、永不花钱（stage_shot 是 `reversible_local`）。

| 状态 \ 打断 | 用户停 / 拒绝 | 关窗（关项目） | 断网 | 重启 App | 连点 / 重复发 |
|---|---|---|---|---|---|
| A. 补丁待审批 | 拒绝 → 画布、编辑器都不变，手改都在 · 不扣 | 事务过期 → 补偿回滚 · 不扣 | 本地，照常 | 收据停在 preparing → 既有恢复路径补偿 | 第二次带旧 baseRevision → 修订过期拒 |
| B. 补丁已应用（手改有丢有留） | 说「撤销」→ 补偿把导演节点 meta（工程 + 计划 + 指纹 + 预演）整份恢复；编辑器开着时当场重载 | 已落盘；重开看到的是应用后的工程 | 无影响 | 无影响 | 再交同一补丁 → `unchanged` |
| C. 编辑器开着、正在手调 | Agent 写入经唯一外部写口进 store（3a）；手调没停也照样先算覆盖（读 store 当前值，不读 2 秒前的 meta） | 退出时写回的是 store 当前值 | 无影响 | 2 秒自动保存之前的手调丢失（既有行为） | — |

## 先查别人

AI 改动 vs 手改怎么合并，别家 3D / 设计工具的做法：

- Unity Prefab 实例覆盖：[Prefab instance overrides](https://docs.unity3d.com/Manual/PrefabInstanceOverrides.html)——实例上被改过的属性永远优先，资产改了别的属性照常传下来。我们「连带变化照常重放手改」同这条；**不同**在于导演指令直接点名的那一项以指令为准（Unity 是覆盖永远赢，要人手点 Revert）。理由：用户刚说「第二镜改成特写」，就是在明确撤回他对第二镜的手调；手改被丢会列出并可撤销。
- Figma 组件实例覆盖：[Apply overrides to instances](https://help.figma.com/hc/en-us/articles/360039150733-Apply-overrides-to-instances)——主组件改了被覆盖的属性，实例保留覆盖；可逐属性 Reset。我们借「逐属性」粒度与「可逐条恢复」（我们的恢复是撤销那次补丁）。
- OpenUSD 分层组合：[Glossary · LIVRPS strength ordering](https://openusd.org/release/glossary.html)——同一属性多层意见，强层覆盖弱层，弱层（引用进来的资产）更新后强层意见照旧叠在上面。我们的「编译结果 = 弱层，手改覆盖层 = 强层，编译器不知道强层」就是这个结构；按稳定 id（USD 的 prim path）寻址也是同一前提。
- 通用 JSON diff / 协同库（jsondiffpatch、Automerge）：前者按数组下标或 objectHash 做深 diff，后者是 CRDT；我们的差量只需要「稳定 id × 顶层属性」的相等比较，接库不消灭任何自写代码，反而多一份规则。不接。

## 遗留两件的决定

**① 携带分组的点选**：实查 `useViewportPicking` → `findEntityFromObject` 取命中网格往上**最近**的实体标记，人的胶囊拾取体在人的节点里，所以今天点人就是选人；携带分组没有网格，只能在大纲里选。定为：**点人选人、分组只在大纲里选**（保持现状，加特征测试钉住）。代价如实写：人和手里的东西都挂在分组下、走位轨迹在分组上，在精修里拖这个人只挪人、东西留在原处。根治要么「拖人时改到它的携带分组」（编辑器拖拽目标规则），要么放宽编辑器「父级只能是分组」让人直接当父级（编辑器不变量）——两条都是编辑器规则变更，交协调会话定，不在 3c 做。覆盖层这边：手改按工程里真实的实体 id 记（人 `actor:x`、分组 `carry:actor:x`），`actor:x` 被直接改到时它的携带分组一并算直接改到；补丁让「拿 / 不拿东西」翻转时，走位类属性在人和分组之间转写（两者在不携带时语义相同），人在分组里的局部偏移无法等价转写 → 丢弃并列出。

**② 预演 8 秒 vs 镜头 6 秒**：编译器 ①（#990）没修，编译时长仍是 `max(镜头窗口末, 走位窗口末)`，`stage_shot` 也不看目标镜头时长。修在最早的边界：`stage_shot` 新建（带 `shotNodeId`）和补丁（导演节点有目标镜头）时，目标视频节点声明了时长 → 计划时长必须与它一致（容差 0.05 秒），否则拒绝（`compile_failed`，说明「这一镜 6 秒，计划到 8 秒结束：把镜头和走位压进 0–6 秒，或先用 draft_shots 把这一镜改成 8 秒」）。以镜头时长为准，宿主不替模型缩放时间。没声明时长的节点不拦。预演挂好之后再改镜头时长：由花钱闸复核（见文末「方向检查（花钱闸复核时长）」）。

## 方向检查（遗留 ② 的修复碰到热点）

`node scripts/fix-churn.mjs` 命中：`directorPreviewState.ts` 14 天内第 4 个 fix、`nodes/director/agent/` 目录第 13 个、编译器目录第 15 个（编译器已有类根因分析 `docs/plan/2026-10-05-director-compiler-root-cause.md`，舞台模型五步已合）。本段的 ② 修复**不碰编译器**，只在 `stage_shot` 执行体加一道准入，并在预演判据里加一个读镜头时长的函数。

0. **一句话根因**：「预演挂到哪一镜」这件事有两个时长来源——计划自己的窗口和那一镜声明的时长——挂接时没有任何一处把两者对齐，于是谁也不知道对方。
1. **归类**：8 秒预演挂到 6 秒镜头（3b 第 5 跑）→ 直接原因：`createPlan` / `patchPlan` 只看计划自己的时长（`compiled.duration`），从不读目标节点 → 类：跨对象的一致性没有准入点。`directorPreviewState.ts` 此前 3 个 fix（花钱闸认镜头读错标记、单镜草稿读不到、视频参考种类）是同一个「预演 ↔ 镜头」接缝上的不同事实，各有收据，不是同一缺陷反复。
2. **为什么一直出现**：预演是导演节点的产物，时长是视频节点（候选）的参数，两边各有写者；挂接核心只管「怎么挂」，不管「能不能挂」。
3. **预测**：① 不加准入，Agent 每次「做个 N 秒镜头 + 预演」都有概率出现不等长（模型规划镜头时不看节点时长）——单测 `遗留 ②` 两条；② 预演挂好后再改镜头时长，仍会不等长——本段不拦，写在已知缺口；③ 手动在节点上改时长的路径同 ②。
4. **靶子独立性**：不涉评测分数。
5. **P0**：领域约束（预演与镜头一一对应），没有现成方案。
6. **补 / 重写 / 删**：补（在唯一写入口 `applyDirectorWrite` 加一道准入，读同主进程 `shotDurationSeconds` 一样的两个键）。不重写编译器、不改挂接核心。花钱闸的事后复核需要读主进程候选时长（跨进程），列为后续。
7. **用户要权衡的核心**：以镜头为准意味着 Agent 偶尔要多改一轮计划；换来的是挂上去的预演永远和要付费生成的那一镜一样长。

## 方向检查（花钱闸复核时长，协调会话 10-05 追加）

`fix-churn` 命中：`laneExtendedDesktopPorts.ts` 14 天第 7 个 fix、`generationTransportAdapters.ts` 第 7 个、`src/workbench/capability/` 第 17 个、`laneDesktopTools.ts` 第 3 个。这几处是 Agent `generate` 出卡前预检的同一条通道，近期的 fix 分属不同事实（付费卡、试跑预算、单镜读取、参考种类），本刀不加新通道、不加第二个判据。

0. **一句话根因**：花钱闸只问「预演好没好、候选带没带它」，没问「它和要付费生成的那一镜一样不一样长」；镜头时长归候选（主进程草稿账本），预演时长归导演节点（渲染端），两边没有任何一处比对。
1. **归类**：预演挂好后 `draft_shots` 改了这一镜时长 → 直接原因：预检只读候选的参考素材 → 类：预演 ↔ 镜头的一致性只在写入时（stage_shot）检查，付费时不复核。
2. **为什么一直出现**：候选可以在预演就绪后任意被改（draft_shots / 付费卡改参数），写入时的检查管不到之后。
3. **预测**：① 付费卡上改时长后再出卡 → 同一预检拦住（同一个 `generate` 预检入口）；② 画布单节点 ↑（按节点参数付费）没有走这条预检——不在本刀，见下；③ 预演渲染前的旧 ready 记录没有 `durationSeconds` → 不比（未知不拦）。
4. **靶子独立性**：不涉评测分数。
5. **P0**：领域约束（按镜头的花钱语义），候选时长读唯一 owner `shotDurationSeconds`，没有现成方案。
6. **补 / 重写 / 删**：补。主进程原有的只读口 `readShotReferenceAssetIds` 改名为 `readShotCandidateFacts`，同一次 read 读出参考素材与时长（两样事实不会来自两版草稿）；同一条 `director.preview-blocks` 通道多带 `candidateDurations`；判据仍只住 `directorPreviewBlocksForOperation`，多一个原因 `duration_mismatch`；预演写回 ready 时记下渲染出的时长（帧数 / 帧率）。只写进提示词的预演不比（参考视频不随载荷走）。
7. **用户要权衡的核心**：改了镜头时长就得让预演跟上（重做预演或把时长改回），否则不出卡；换来的是付费那一刻参考视频和镜头一定一样长。

已知缺口（不在本刀）：画布单节点 ↑ 的主进程准入（`appIntegrationCanvasShot`，按节点参数付费）只认 rendering / failed，不比时长。它属于「画布单镜 Run」概念，发动机收敛线正在改，排到那条线或 3c 之后。

## 后续：携带物挂到人身上（遗留 ① 的 (b)，协调会话 10-05 定，3c 之后单独一个 PR）

**为什么**：今天人和手里的东西一起挂在携带分组 `carry:actor:<名>` 下（编辑器不变量「父级只能是分组」），走位轨迹住在分组上；精修里点人选人、拖人只挪人，手里的东西留在原处。(b) 让人直接当父级，东西挂在人身上，拖人东西跟着走，走位回到人自己身上。

**改法**：
1. 编辑器不变量放宽为「父级是分组或角色」：`directorProject.ts#normalizeDirectorProject`（今天剥掉非分组父级）、`storeEntityActions.ts`（`groupObjects` / `ungroupObjects` / 改父级、删父级时子物体去向）、`sceneObjectGraph.ts`（父链世界坐标已按父链合成，确认角色作父时用角色根节点的变换，不用骨骼）。
2. 编译器 `compiler/stageRelations.ts#carryGroups` 改为把携带物 `parentId` 直接设成持有者，不再造 `carry:` 分组；人的落点、朝向、走位留在人身上。编译器热点（14 天 15 个 fix）——改前先补特征测试钉住 I5「携带物跟手」与 carriedDrift = 0。
3. 覆盖层：`planOverrides.ts` 的携带转写（`retarget`、`CARRY_PREFIX`、`directlyOwned` 里的 `carry:` 一项）同 commit 删掉；旧工程里已有的 `carry:` 分组按迁移处理（重编译时消失，分组上的走位手改转写到人身上——转写规则今天已有，改成只读旧数据的一次性迁移）。
4. 渲染：`DirectorEntities.tsx` 的 `ObjectNode` 已按 `parentId` 嵌套，角色节点下挂子物体；手的位置今天是分组局部的固定偏移，改到角色局部后要不要跟骨骼手（右手骨）走，样张 / 真机看一眼再定（先固定偏移）。

**要回归**：
- 大纲（场景树）：角色出现展开箭头、子物体缩进；拖拽改父级、解组、删人时信的去向；锁定 / 隐藏沿父链继承。
- 测量：`directorEvalMeasurement` 的物体世界姿态（`evaluatedSceneObject` 父链合成）、`directorSpatialAudit` 的 I5 携带物跟手、`spatial.carried`（今天映射到携带分组）改成映射到持有者；景别实测的主体选择（`directorShotSummaries#subjectAt`）不能把信当主体。
- 编辑器往返：编译产物经 `loadProject` → `exportProject` 后深相等（父级不再被剥）。
- 撤销：编辑器 50 步快照与覆盖层推导（父级变化也是一条手改）。
