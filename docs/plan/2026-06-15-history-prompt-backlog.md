# 历史 prompt 综合 backlog（2026-06-15）

> 来源：用户跨三轮抛出的想法倾倒（分镜卡片回看 / 全套设计审查 / skill / 跨项目记忆 / 素材库 / 系统提示词 / 拖拽到画布 / 可编辑时长）。
> 本文档把所有线头对到真实代码现状，分批立项。决策状态逐项标注。
>
> 对账依据：三路 Explore agent 摸底（分镜结构化输出 / 画布导入拖拽 / skill+记忆机制），结论见下表 file:line。

## 0. 现状对账（已摸底）

| 线头 | 现状 file:line | 缺口 |
|---|---|---|
| 分镜结构化输出 | `storyboardPlan.ts:14` + `StoryboardPlanEditor.tsx`，随项目持久化（`workbenchStore.ts:100`）切项目不丢 | ✅ 已有；但是「单份当前草案」，确认落画布即 `setStoryboardPlan(null)`（`StoryboardPlanEditor.tsx:89`），**无最小化收起卡 / 无落地后快照回看 / 无历史版本** |
| 图/视频拖进整个画布 | 画布 stage 已接 drop 但**只放行 image/\***（`GenerationCanvas.tsx:438`）；素材库格子**无 draggable**（`AssetLibraryPanel.tsx:9` 注释标 v1.1 未做）；挂节点参考已支持 image/video/audio（`useNodeAssetDrop.ts`） | ⚠️ ① 视频被 stage drop 挡；② 素材库→画布拖拽未实现 |
| 字幕/标题卡时长可编辑 | 写死 3 秒 `DEFAULT_TEXT_CLIP_SECONDS=3`（`textLayout.ts:145`），创建即定（`timelineTextEdit.ts:28`）。数据层 `endFrame/startFrame` 已支持任意时长；底层 `resizeTextClip`（`timelineTextEdit.ts:67`）就绪 | ⚠️ 缺 UI 入口 + store action（`workbenchStore.ts` 无改时长 action） |
| 产品内 skill | 无「产品内 skill」概念；等价物=三层提示词（`agentChatV2.ts:124` `NOMI_AGENT_IDENTITY`）+ `creationAiModes.ts` 7 模式 + storyboard planner skill + `fixationPromptTemplates.ts` | 需厘清「产品内 skill」定义 |
| 跨项目记忆 | `projectMemory.ts` 刻意 per-project（存 `<项目>/.nomi/memory.json`），大量防串台守卫 | 🔴 与现架构正面冲突，**待拍板** |
| 基础库 / 搜罗素材 | 仅 3 个新建项目模板（`projectTemplates.ts`），无内置素材/角色/风格库 | 🔴 涉及版权来源，**待想清楚**（用户：不着急） |

## 1. 分批与决策状态（用户已选「四批全做」）

### 第一批 · 小修（立刻做，本文档优先项）
范围：
- **A1 时长可编辑**：预览控制条选中文字 clip 时，在「字号/字体」旁加「时长(秒)」控件。
  - UI：照 `TimelinePreview.tsx:683-698` 字号那段平行加，token-only。
  - store：新增改时长 action（复用 `resizeTextClip`，右边缘设 `startFrame + 秒*fps`）。
  - 联动：`computeTimelineDuration` 已订阅 textClips，总时长/播放区间自动重算。
- **A2 拖拽到画布**：
  - 放开 stage drop 的 image-only 过滤，让视频文件也能拖到画布建 asset 节点（`GenerationCanvas.tsx:438`、`assetImportAdapter.ts:124` 的 `filterImportableImageFiles`）。
  - 素材库格子加 `draggable`/`onDragStart`，可从库拖到画布空白处（建独立卡）或拖到节点（挂参考）。
- 验收门：R8 样张对账 + 真机走查（拖一张图/一段视频进画布、改一条字幕时长并看预览总时长变化）。

不动项：节点参考挂载逻辑（`useNodeAssetDrop.ts` 已支持多类型，不改）；时间轴文字轨拖拽（`TimelineTextTrack.tsx` 既有移动逻辑不动）。

### 第二批 · 分镜卡片回看（需先出样张）
目标：解决用户「分镜方案关掉后怎么找回 / 再点入改 / 历史记录」。
- 现状已持久化可回看，缺的是：① 可最小化「收起卡」入口（不占满创作区主列）；② 确认落画布后保留**快照卡**可回看（不再 `null` 即焚）；③（可选）多版本历史。
- 复用范式：生成区 `CommittedProposalCard.tsx`（commit 后存活 + 查看步骤 + 撤销）最接近，但需从会话级升到跨会话持久化。
- 取舍点（出样张时给对比表）：快照卡放创作区还是生成区？历史做几版？
- 流程：brainstorming → 读设计系统 → HTML mockup → 用户拍板 → 实现。

### 第三批 · 跨项目记忆 + 基础库（只想清楚，不立项）
- **决策待定**：方向 A 全局共享真相源 / B 收藏+显式引入(拷贝语义，推荐) / C 内置基础库。用户：「先不定，只聊清楚」。
- **基础库形态待定**：内置 prompt/风格模板库（纯文本安全）vs 内置参考图素材库（版权红线，需用户提供合规源）。用户：「不着急，想想就行」。
- 本批不写任何代码，仅在后续对话里把方案聊透、记入本文档，等用户拍板再升级为立项。
- 关联铁律：P1（不造第二真相源）、P4（通用第一，与具体模型解耦）。

### 独立线 · 全套设计审查
- 范围：所有用户可见面 + 动态输出（页面/卡片/节点/面板/菜单/弹层/分镜方案/agent 卡/toast/空状态…）。
- 方法：R13 真机走查（常驻 UI 驱动，J1–J5 视角）+ 设计 agent 逐面审查 → 产出 `docs/audit/2026-06-15-*.md`（分级问题带 file:line + 优化清单）。
- 与第一/二批解耦，可并行或穿插跑。

## 2. 执行顺序
1. 第一批 A1+A2 小修（出样张 → 拍板 → 实现 → 五门 → 真机）。
2. 独立线设计审查（产出审计清单，喂第二批和后续迭代）。
3. 第二批分镜卡片（brainstorm + 样张 → 拍板 → 实现）。
4. 第三批：随对话聊清楚，回填本文档，待拍板。

## 3. 回滚
- 第一批：纯增量 UI + 一个 store action + 放开一个过滤条件，git revert 单 commit 即回退。
- 其余批次实现前各自补回滚段。
