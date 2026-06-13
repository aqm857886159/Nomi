# 2026-06-13 机制层根治计划（承接穿透审计 18 项）

> 输入：`docs/audit/2026-06-13-deep-ui-mechanism-audit.md`（18 项，5 类机制共因）。
> 原则：修机制不修症状——每个切片的验收门里必须有「这类问题不再能从别的入口复发」的结构保证（不变量测试 / 原语收口 / 单一真相源）。
> 并行声明：另一会话正在改 `AgentPlanCard.tsx` / `agentPlanSummary.ts` / `storyboard.test.ts` / `check-file-sizes.mjs`，本计划**不碰这四个文件**；commit 只 add 本计划文件。

## 底层病根（比审计再下钻一层）

审计归了 5 类机制缺口，摸底后可以再收敛成 3 个底层病根：

1. **同一事实存在两份以上代码真相源**（违反 P1 的深层形态）：
   - kind→分类映射有两份且互相矛盾：`generationNodeKinds.ts:82-91`（text/panorama→shots）vs `projectCategoryMigration.ts:61-73`（panorama→scene、text→删除）。A4 的「新建项目被迁移删节点」就是两份真相源打架的直接后果。
   - 镜头编号有两份：AI 计划标题写死「镜头 N」（持久字符串）vs 渲染层 live 按 (y, id随机后缀) 重算（`useNodeRelationships.ts:103-118`）。`data.shotIndex` 字段声明了却全仓零写入（死字段）。A2 整类由此而来。
   - 弹层几何有 4+ 份手写实现（AssetPickerPopover 最全 → OnboardingFloatingPanel 纯常量最弱），A9 是「修在症状层必复发」的实证。
2. **创建路径没有契约**：创建入口不声明 categoryId / workspaceMode / 幂等键，下游（迁移、视图、播种重放）各自猜，猜错就是 A4/A8/A11。
3. **store 真相与呈现层之间没有「落点回报」义务**：跨分类产物、跨分类边、事务回执都是「存在但不可见」（A1/A6/A16），且回执存在模块级内存单槽（`proposalUndo.ts:27`）从不落盘。

## 切片与验收门

### S1 创建/迁移契约统一（A4 + A11 + A8）— P0
- **改**：
  - 删除 `projectCategoryMigration.ts` 内私有 kind→分类映射，统一改调 `getDefaultCategoryForNodeKind`（单一真相源）；kind 可推断时**永不删节点**（删除仅保留给真正非法数据）。
  - `generationCanvasDefaults.ts` 默认节点出生即带 `categoryId`（用同一函数算）。
  - `newProject`（NomiStudioApp.tsx:263）显式 `setWorkspaceMode('creation')`（与 CTA 文案「从一段文字或想法开始」一致）。
  - 项目 record 增加可选 `seedKey`；`tryExample` 以 `seedKey` 幂等：已存在同 seedKey 项目 → 直接打开，不再重复创建；catalog-changed 重放自然失效。
- **结构保证**：不变量测试「`createDefaultWorkbenchProjectPayload()` 过 `migrateProjectRecord` 必须 alreadyMigrated / 零 removed」；「同一 example 连续 tryExample×2 = 1 个项目」。
- **不动**：已有重复示例项目的清理（删用户数据，留拍板）。

### S2 镜头编号 = 存储身份（A2）— P0
- **改**：复活 `data.shotIndex` 为唯一真相源：
  - 参与编号的 kind 收窄为镜头内容（image/video/shot/keyframe）；text/panorama/scene3d/output 不编号。
  - agent 批量落节点按计划顺序写 `shotIndex`（从画布现有 max+1 续）；手动添加 = max+1；与节点标题「镜头 N」同源。
  - 存量项目：迁移链一次性回填（按 y→x→id 排序，与旧观感最接近的确定性顺序）。
  - `buildShotIndexMap` 改读存储值；位置移动/加无关节点不再改号。
- **结构保证**：单测「加 text/panorama 节点不改变既有 shotIndex」「批量创建后 badge 序号 == 计划标题序号」。

### S3 布局步距 derive（A3，T4 复验+根治）— P0
- **现状确认**：T4 后 `trajectoryLayout.ts` 仍 hardcode 列 420/行 320（video 420×340 → 列贴边、行重叠 -20px），网格回退仍 360/260；避让只推 Y 原点。
- **改**：列宽 = 该层最大节点宽 + GAP；列内 y 逐节点累加（h+GAP），不用统一行距；网格回退格子尺寸由批内最大节点尺寸 derive。
- **结构保证**：单测用真实 `DEFAULT_NODE_SIZE` 跑 19 节点混合批 + 画布已有节点，断言任意两节点 AABB 零重叠。

### S4 懒加载容错域（A5）— P1
- **改**：新增 `ChunkBoundary`（局部 ErrorBoundary + chunk 失败识别 + 「重试」重挂载 + 降级文案），包住 12 个 React.lazy 点位的 Suspense；3D 编辑器失败只降级该节点卡，工作区失败只降级该工作区。
- **结构保证**：单测模拟 lazy reject，断言兄弟区域照常渲染。

### S5 设计系统原语：确认框 + 锚定弹层（A7 + A9）— P1
- **改**：
  - `src/design` 新增 promise 风格 `confirmDialog()/promptDialog()`（DesignModal 皮），全局 host；**同 commit 删除全部 11 处 `window.confirm/alert/prompt`**（6 文件）。
  - 抽 `AnchoredPopover` 原语（以 AssetPickerPopover 几何为蓝本：实测尺寸/上下翻转/左右 clamp/max-height 滚动），AssetPickerPopover 改用之（删旧）；OnboardingFloatingPanel/Drawer 高度收口到单层（实测视口 clamp + 内滚），修 1366px 溢出。
  - 画布坐标系内的 NodeGenerationComposer/SelectionGeneratePopover 属容器锚定类，**本切片不迁**（不同坐标空间，强迁是假统一），在原语文件注释声明边界。
  - 设计系统文档补 confirm/popover 规范条目。
- **结构保证**：design-fidelity 增断言——双供应商展开后模型设置面板 bottom ≤ 视口、「添加模型」可见可点；删除项目弹的是应用内确认框（E2E 从此能测删除链路）。

### S6 「存在的必须可见」（A1 + A6 + A16 + A15）— P0/P1
- **改**：
  - 回执持久化：`CommittedProposalRecord` 随 conversations.json 落盘（带 projectId 校验），reload 后「整笔撤销」仍在。
  - 回执明细：`stepLabels` 改用 `describeToolCallSummary/Detail` 产出逐节点行（标题+落点分类），不再与 summary 同句重复。
  - 落点回报：确认计划 toast/回执按分类分组报数（「3 个定妆 → 角色/场景」），点击跳转 `setActiveCategoryId`；CategoryTree 对刚收到节点的分类自动展开。
  - A15：video 占位区分「未连首帧边」vs「已连、上游未生成」（读入边存在性，不只读 result url）。
- **不动（留拍板）**：跨分类引用边的画布内可视化（需 R8 样张，见「留拍板」）。

### S7 P2 收尾（A10 + A12 + A13 + A14）
- A10：项目库「过滤后为空」空态（含一键清搜索/切 tab）。
- A12：按钮语义对齐实际行为（生成**选中**），文字/aria/title 三处统一；（实测当前已 disabled-on-zero，审计复核）。
- A13：`catalogStore/catalogCommit` 的 labelZh 兜底从裸 modelKey 改为人话化（保真名词根，仅排版），根因点收口。
- A14：面板标题「助手」→「创作助手 / 生成助手」，与入口词一致。

## 留拍板（R3 对比表，不在本计划内动手）

**① 跨分类引用边可视化（A1 深水区）**
| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| A 节点引用 chip | 镜头卡上显示「引用：主人公定妆」小 chip，点击跳到该节点 | 节点卡新增 UI 区，需样张+对账 |
| B 跨分类幽灵锚 | 跨分类边在视图边缘画半截线+头像锚点 | 画布渲染层改动大，易喧宾夺主 |
| C 只做 S6 落点回报 | 回执/toast 知道去哪找，画布不画 | 引用关系仍不可视，仅可达 |

**② 拆镜头 prompt 语言（A18）**
| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| A 双语：中文展示+英文生成 | 计划卡/节点显示中文意译，生成仍用英文 | 每节点多一次翻译产出，token 略增 |
| B 跟随 UI 语言纯中文 | 全中文可校对 | 部分视频模型英文效果更好 |
| C 维持英文 | 现状 | 中文用户无法校对已批准内容 |

**③ 存量重复示例项目清理**：删除几十个重名项目属删用户数据，S1 只杜绝新增，存量等拍板（可给一键合并工具）。

## 执行顺序与门

S1 → S2 → S3（P0 链）→ S6 → S4 → S5 → S7。每切片独立 commit；push 前五门全过（filesize / lint:ci / typecheck / test / build）；UI 可见切片（S5/S6/S7）完成后按 R13 真机走查补验。

## 回滚

全部切片纯前向 commit、互相独立，按 commit revert 即可；S1 的 schema 新字段 `seedKey` 为可选字段，旧数据零影响；S2 的 shotIndex 回填只增字段不删数据。

---

## 执行结果回填（2026-06-13）

| 切片 | commit | 状态 | 结构保证 |
|---|---|---|---|
| S1 契约统一（A4/A8/A11）| 5cae327 | ✅ 完成 | 不变量测试「默认 payload 过迁移必 alreadyMigrated」；seedKey 穿透 Electron manifest 链路；addNode 总闸兜底 categoryId |
| S2 编号身份化（A2）| 653c13a | ✅ 完成 | 「加无关节点不改号 / 回填幂等 / kind 收窄」3 组测试；顺手删了 canvasSnapshotNormalizer 里默认画布第二份拷贝（A4 又一入口）|
| S3 布局 derive（A3）| 2d81fc1 | ✅ 完成 | 19 节点混合批 AABB 零重叠断言（审计实测场景复刻）；gridPosition 常数步距删除 |
| S6 可见性（A1/A6/A15/A16）| 69c0dd1 | ✅ 完成 | 回执随 conversations.json 落盘 + parse 校验；逐节点明细 / 分类跳转 chip / CategoryTree 自动展开 / video 占位双态 |
| S4 容错域（A5）| 208a6bd | ✅ 完成 | lazyWithChunkBoundary 原语，12 个 lazy 点位全迁；importWithRetry 测试 |
| S5a 确认框（A7）| adf058d | ✅ 完成 | 11 处 window.confirm/alert/prompt grep 归零；设计系统 §3.5 落禁用规范 |
| S5b 锚定弹层（A9）| — | ⏸ 待复验 | 现版 OnboardingFloatingPanel 已有 maxHeight+内滚+zIndex 4000（与审计采样的 T2 版不同），**需真机复验是否仍溢出**再决定是否抽 AnchoredPopover；当前并行会话占着工作树+dist，按 R13 清场要求押后 |
| S7 P2 收尾（A10/A12/A13/A14）| 3391514 | ✅ 完成 | humanizeModelKey 测试；过滤空态 data-library-filter-empty 可断言 |

**留拍板项已拍（2026-06-13 用户决策）**：
- **A18 prompt 语言 → 纯中文**（✅ 已实现）：用户选「连喂模型的也必须中文」（已知并接受部分国外视频模型中文理解可能掉画质的代价）。改 `skills/workbench-storyboard-planner/SKILL.md`，prompt 硬约束从「必须英文」翻为「必须中文」，镜头语言/运镜术语示例同步中文化。至此三个建节点 agent 语言统一（generation/fixation 本就跟随用户语言/中文）。**注**：creation skill「提示词模式」仍输出英文——那是用户主动要提示词去 MJ/SD/Veo 用、不自动塞节点，不在 A18 范围，未动。验证：skill 是 LLM 指令，单测验证不了产出语言，待 eval/真机走查确认。
- **A1 跨分类边可视化 → 认方向，后面专门做一版**（⏸ backlog）：方案 A（镜头卡角上「引用了谁」chip + 点击跳转），单独排 UI 切片走完整 R8 样张流程，不混机制根治。
- **存量重复示例清理 → 先不做**：根因 S1 已堵（seedKey 杜绝新增），存量是纯历史观感问题，优先级最低，以后想清随时再说。

**A17 缩略图空占位**：根因已定位（缩略图只来自生成结果 url，无画布截图机制），独立产品决策，未列入本轮。

**欠的验证**：R13 真机走查（确认框/回执 chip/占位文案/空态的体感 + A9 复验 + A3 在真实 19 节点批上的视觉确认）——并行会话在同一工作树持续 commit+重建 dist，现在跑常驻驱动必踩 stale-chunk 伪 bug（审计干扰声明同款），待工作树安静后执行。
