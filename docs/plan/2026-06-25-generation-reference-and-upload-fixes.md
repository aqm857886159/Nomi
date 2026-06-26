# 生成画布·参考图/上传链路 系统性修复方案（2026-06-25）

> 起因：用户报两个 bug —— ①连线连到图了但「@放入哪张」选不到那张图；②传图进来有时显示裂图/错误。
> 深挖后发现这俩各是一个「真相源分裂」病灶的症状，附近还有一串同源 bug。本文档梳理全部、定优先级、标体感变化。

## 一、根因（两大病灶）

### 病灶 A：「有序参考图列表」没有单一真相源（症状 = bug①）
同一份「参考图按第几张」的数据，三个消费点各算各的：

| 消费点 | 顺序 | 含连线的图 | file:line |
|---|---|---|---|
| 面板编号 ①②③ | 边在前、上传在后 | ✅ | referenceSlots.ts:106-139 / NodeParameterControls.tsx:369 |
| 实际发给模型 | 上传在前、边在后，去重截到 max | ✅ | archetypeMeta.ts:403-410 |
| **@ 候选 + @ 发送投影 character{N}** | **只有上传** | ❌ | NodeGenerationComposer.tsx:275 / catalogTaskActions.ts:112 |

`resolveReferenceSlots` 本是为收口这个分裂写的（自称「唯一真相源」），但只统一了「显示」，`projectPromptForSend` 和 `buildArchetypeInputParams` 都没复用它。

### 病灶 B：上传/落盘/显示链路缺诊断 + projectId 时序脆弱（症状 = bug②）
- NomiImage（media.tsx:20）无 onError → 一 404 直接裂图、不说人话、不重试。TimelinePreview 图片轨道（:442）、视频节点（BaseGenerationNode.tsx:731）同样缺可见错误态。
- projectId 在冷启动/切项目窗口内由 React effect 慢一拍赋值，OS 拖图不传 projectId（canvasStageDrop.ts:90）完全靠兜底 → 可能写错项目目录 / URL 编错 projectId → 404。
- 上传失败无重试，recoverImportedWorkbenchLocalAssetFile 是恒返回 null 的死 stub（assetUploadApi.ts:82）。

（注：协议编解码不对称 main.ts:466、sanitizeName 放行特殊字符 —— 复查后对真实文件名无害，仅列为低优健壮性项，非裂图元凶。）

## 二、全部 bug 清单（按严重度）

### 🔴 P0（发出去就是错的 / 用户直接撞到）
- **B1**【用户报的】@ 选不到连线图；就算选了，发送时 character{N} 找不到 url → 标记被删成空串 → 描述里指代凭空消失。根因=病灶 A。
- **D1** 变体切换不夹取 resolution：标准变体下选 4k → 切到「快速」变体（只支持 480/720）→ 存量 4k 仍被发出 → 供应商 400/422。(archetypeMeta.ts:252 / NodeParameterControls.tsx:181)
- **C1**【用户报的症状】传图裂图无诊断：NomiImage/预览/视频节点缺 onError → 看到裂图但不知为何、不能重试。根因=病灶 B。

### 🟠 P1（悄悄发错/发空，用户后知后觉）
- **B2** 面板 ①②③（边在前）≠ 发送顺序（上传在前）→ 同时上传+连线时，看到的①和模型收到的 character1 是两张图（张冠李戴）。
- **B4** 连线进来的**视频/音频参考**：面板显示了，发送时被 `accept==='image'` 分支直接丢（archetypeMeta.ts:404）→「连了等于没连」。
- **D3** 通用 `reference` 边连进首尾帧/单帧 i2v 节点：槽里显示已填首帧，发送却为空（两条解析路径口径不一致，referenceSlots.ts:46 vs generationReferenceResolver.ts:49）。
- **C2** projectId 时序：冷启动/切项目瞬间拖图 → 写错项目目录或 URL 编错 projectId → 间歇 404。
- **C3** 上传失败永久 error 无重试入口（>512KB 图和所有视频，recoverFile 死 stub）。

### 🟡 P2（边角/无提示）
- **B3** slot.max 截断只在发送侧：超 max 的参考图面板全显示、发送悄悄丢（先丢边来源），无 toast。
- **D2** 底栏参数 `flex-nowrap` + 880px 上限漏算「供应商下拉 + negative_prompt 宽输入」→ 多供应商/Wan/Kling 时截断（宽度 bug 回归）。(InlineParameterBar.tsx:128 / NodeGenerationComposer.tsx:221)
- **D4** 连线超额静默丢弃无 toast（手动上传超额有 toast，连线没有）。
- **C4** 跨项目素材库拖图：显示正常但发送/导出读不到字节（renderUrl 内嵌源项目 projectId，localAssetFile.ts:24 projectId 不匹配返回 null）。
- **C5** OS 拖入 >8 张静默截断，第 9 张起无任何提示（assetImportAdapter.ts:174）。

### ⚪ P3（潜伏/健壮性，不急）
- **B5** 同图既上传又连线 → 各消费点去重口径不一，可能「叉一次还在」。
- **D5** 模式互斥的「传输投影」从未实现，靠 buildArchetypeInputParams 兜底；死注释引用了不存在的 `projectArchetypeFrameExtras`（清注释或实现投影）。
- **C6** 协议编解码不对称 + sanitizeName 放行特殊字符（真实文件名无害，做对称化收口即可）。

## 三、唯一要用户拍板的权衡：病灶 A 的「统一口径」

修 B1 必然要给「有序参考图」定一个单一顺序。两个选法：

- **选项一（推荐）= 对齐发送顺序，不改发给模型的字节**：@ 子系统对齐到「上传在前、连线在后」这份已经在发的合并列表。连线图能被 @、发送不再删空。**零回归**——以前能跑通的生成一个字节不变。代价：面板视觉编号（边在前）与 @ 编号（上传在前）在「混用」少见情况下仍不一致 → 单列 B2 后续收口。
- **选项二 = 全统一到面板显示顺序（边在前）**：面板/@/发送三处全统一。最彻底（B1+B2 一起根治），但会**改变**「上传+连线混用」时发给模型的 character1/2 对应 → 用户以前调好的混用镜头重跑结果可能变样。

> 用户只连一根线、不混用时，两选项效果完全相同，B1 都修好。

**【2026-06-25 用户拍板：选项二】** —— 面板/@/发送三处全统一到「连线在前、上传在后」（= resolveReferenceSlots 的顺序）。`resolveReferenceSlots` 升格为四处共用的唯一有序真相源；`buildArchetypeInputParams` 的合并顺序从「上传在前」翻成「连线在前」；`projectPromptForSend` 与 @ 候选都改读这份合并列表。B1+B2 一起根治。用户已知混用镜头重跑可能变样。

## 四、体感变化（用户能看到的）

- B1 修好后：从连线连进来的参考图，打 @ 时**出现在候选里、能选中**；选中后生成不再把指代删空。
- C1 修好后：图加载失败时显示**可读的失败态（带「重试」）**，而不是浏览器裂图图标；控制台/日志能看到到底是哪个 URL、为什么失败（404 Project not found vs 文件不存在）。
- C3：上传失败的节点出现**「重试」按钮**，不用删了重拖。
- D1：切到「快速」变体时，清晰度自动夹取到该变体支持的档位，不再发 4k 被供应商打回。
- B4/D3：连线进来的视频/音频参考、通用 reference 边的首帧，**真的发出去**（连了就有用）。
- B3/D4：参考图超过模型上限时给**明确 toast**（「最多 N 张，多出的没发送」），不再悄悄丢。
- D2：参数底栏多供应商/参数多时**自动换行**，不再截断按钮。

## 五、执行顺序（分轮，每轮独立可验、五门绿、真机走查）

1. **第 1 轮（用户报的两个 + 各自根因）**：B1（@ 单一口径，按**选项二**）+ C1（onError 诊断+占位）+ C2（projectId 收口）。
   - ✅ B1+B2 已做：`mergeOrderedReferenceImageUrls`/`orderedSentImageReferenceUrls` 单源（连线在前），buildArchetypeInputParams 翻转顺序、catalogTaskActions @ 投影、NodeGenerationComposer @ 候选三处共用；archetypeMeta.test.ts 扩测，五门绿。
   - ✅ C1 已做：NomiImage 加 onError → 可读占位「加载失败」+ 控制台打失败 URL（一处修全局图片渲染点）。
   - ✅ C2 已做：NomiStudioApp hydrate/切换/清空三同步点补 `setDesktopActiveProjectId`，关掉切项目时序窗口。
   - ✅ C6 顺带：main.ts 协议解码改逐段对称（健壮性）。
   - ⏳ **C3 留 Round 1b**：上传失败重试需先在节点留住 File 引用（更大的 UX 改动），单列。
   - ⏳ **R13 真机走查**：@ 候选含连线图、裂图占位 两处待真机截图人眼验。
2. **第 2 轮（附近最危险的静默发错）** ✅ 已交付(59140d6)：
   - ✅ D1 变体切换夹取越界清晰度(clampMetaToModeParams 通用派生)
   - ✅ B4 连线视频/音频参考分流喂对槽(resolver 新增 referenceVideos/Audios + buildArchetypeInputParams 按 accept)
   - ❎ **D3 经探针验证为非 bug**：reference/undefined 模式边经 fallback 已正确填 firstFrameUrl，agent 报告漏算 fallback，不改。
3. **第 3 轮（提示/边角）** ✅ 部分已交付：
   - ✅ C4 跨项目拖图导出读不到：根因=readNomiLocalAsset(信 URL 自带 projectId,生成侧能跑) vs absolutePathFromLocalAssetUrl(当前 projectId 强匹配,导出侧失败) 口径不一致;加 absolutePathFromLocalAssetUrlAnyProject 统一,导出侧改用。
   - ✅ C5 >8 张截断 + 上传失败：导入结果加 skippedOverLimitCount/failedCount，canvasStageDrop 聚合成 toast(不再静默)。
   - ✅ D5 死注释清理：archetypeMeta 注释引用了不存在的 projectArchetypeFrameExtras → 改指 buildArchetypeInputParams(真正做互斥处)。
   - ✅ **D2 参数栏**：先 flex-wrap 止血,用户看了说换行丑→重设计。**根因=底栏摊平横排不 scale**(多供应商 Seedance 8+ 控件)。出可点样张(3 方案)→**用户拍板方案 B·主次分层**:模型/变体+前 2 常调参数(比例/清晰度)内联,其余(时长/种子/音频/供应商)收进「更多」Mantine Popover。真机复量 cardW 880(裁切)→678(单行无裁切),「更多」弹层竖排收纳正常。INLINE_PARAM_MAX=2 是分层线(通用,按档案声明序)。**全程先量后改再复量**(治本 violations.log 那条盲改宽度坑)。
   - ✅ **D4 连线超额 toast**：completeNodeConnection 用 resolveReferenceSlots 判断新边有没有落进槽 fill,没落=槽满→明提示「参考槽已满(最多N)」。
4. **第 4 轮（潜伏/健壮性）** ✅ 全做完：
   - ✅ C6 编解码对称化(Round 1 顺带，main.ts)。
   - ✅ **B5 去重**：同 url 既上传又连线时,断边一并清 meta 同 url 上传(否则重现成 upload「叉一次还在」),合成一次持久化保 undo 原子。
   - ✅ **C3 上传失败重试**：抽 uploadAndApplyAssetToNode 单源(初次+重试共用)+pendingRetryImports 留住失败 File+retryLocalAssetImport;BaseGenerationNode 错误态「重试」按 meta.retryableImport 分流(导入失败→重新上传 vs 生成失败→重跑)。File 内存态重启清(重启后仍 error 文案引导重导)。

每条修复守三闸：根因 P2 / 五门 R11 / 真机走查 R13；TDD 先写测试（referenceSlots.test.ts、promptMentions.test.ts 已存在，扩它们）。
</content>
</invoke>
