# 执行文档:⑤ 拖入 / 连线 → 参考(长尾最后一项,drop-and-wire)

> Rule 4 执行文档。**自包含**——读它 + `CLAUDE.md`(工作流框架 + 纪律)+ `docs/design/2026-06-06-reference-v4-implementation-spec.md`
> 即可接手,不依赖此前长对话。先给用户过目,点头后再执行。

---

## 0. 压缩上下文:参考系统现状(一页接手)

「生成节点参考区」重构已完成绝大部分(全部 push、CI 五门绿 + design-fidelity 22 + modebar 20 + smoke 10):

- **三原语**(`src/workbench/assets/`):`AssetTile`(56px 形态自明块)/ `AssetPicker`(统一选择器,渲染到 `AssetPickerPopover`=BodyPortal,翻转+clamp,不被裁)/ `AssetMention*`(Tiptap 内联 chip + @ suggestion)。
- **节点侧** `AssetReference`(声明式 slot:单帧走画布边、数组 meta-only 合并成一排)+ `NodeParameterControls`(写入逻辑)。
- **prompt**:`PromptEditor`(Tiptap 替 textarea),持久化用 `@[asset:url]` 标记(`promptMentions`),发送投影 `projectPromptForSend` 按 `referenceImageUrls` 数组位置算 `character{N}`(**唯一编号源**)。
- **R1 传输**:`electron` 发送前把 `nomi-local://` 经 vendor 声明的 `assetIngestion`(KIE=免费 base64 上传)转成可达 URL(`catalog/assetLocalization`),真实验证过。
- **已完成长尾**:①删 tile 同步清 chip ②@ 键 suggestion ③tile 拖拽重排 + 浏览全部 ④到上限 toast+灰显。
- **质量门**:`tests/ux/design-fidelity.e2e.mjs`(computed-style/DOM/遮挡断言)、`archetype-modebar.e2e.mjs`(交互走查 20 断言)。

**跨项铁律(本项也守)**:① 一切参考读写经 `referenceImageUrls/VideoUrls/AudioUrls` 数组、统一 `setArrayValue` 写入(单源);
编号只由 `projectPromptForSend` 算;② 程序化改 prompt 必走会持久化的路径(合并进单个 updateNode);③ 合并行按 metaKey 取值防跨槽错位;
④ 弹层/浮层走 BodyPortal 防裁;⑤ 改设计必跑 design-fidelity。

---

## 1. 本项范围

把「加素材」补完整的最后两条画布捷径(规范「三来源 + 两捷径」的两捷径):
- **A 拖文件到节点**:从文件面板 / 桌面拖文件到节点 → 加为参考(按 kind 进对应数组,走 R1 传输)。
- **B 连线 → 参考**:从画布卡拉线到节点 → 加为参考。

**不做**:3D / 结果操作 / 改 character 契约;真实生成花额度(门控、先问)。

---

## 2. 🔴 对抗评审 must-fix(11 agent 评审已给,必须落地)

1. **桌面拖进来的是 `File` 不是 URL**:必须复用现有上传管线 `importImageFilesToGenerationCanvas` / `importWorkbenchLocalAssetFile`
   (`adapters/assetImportAdapter.ts`)拿 hosted(`nomi-local://`)URL,**别直接塞 `data:`**(发送 resolver 会丢)。处理 uploading / 失败态。
   工作区文件拖拽(MIME `application/x-nomi-workspace-file`)用 `parseWorkspaceFileDrag` + `buildWorkspaceFileUrl` 拿 URL(已是 nomi-local)。
2. **drop 走 meta、连线仍走 edge,二者绝不混**:`connectToNode`(store:619)现在建 **edge**,边还管着**视频首尾帧判定 / 上游上下文遍历 / 边渲染**。
   - 单帧槽(首/尾帧)连线 = 持久 edge(**现状已工作**,经 `handleSlotAssignment`),不动。
   - **数组参考(omni)= meta-only**(M6:数组绝不变持久边,否则崩 `(target,mode)` 唯一性 / 回归全能参考)。
     → 连线到「有数组槽的节点」若要支持,必须**写 meta 数组、不画 9 条线**;这要碰 `connectToNode`,风险较高(见 §5 决策)。
3. **不喂巨壳(棘轮)**:`BaseGenerationNode`(1406 白名单)只减不增。**降风险方案(关键)**:onDrop **挂在 `NodeGenerationComposer`(浮动 composer 卡,非巨壳)**
   而非 BaseGenerationNode → **完全避开巨壳手术**。drop 逻辑抽 `useNodeAssetDrop` hook。
4. **统一写入入口**:drop 加素材最终都经 `handleArrayAdd`(已含去重 + 到上限 toast + 单源),不新开第 5 条写路径。
5. **不冒泡到画布新建卡**:节点级 onDrop 必须 `stopPropagation` + `preventDefault`,否则会冒泡到 `GenerationCanvas.handleStageDrop`(它会新建独立 asset 卡)。

---

## 3. 分阶段方案(按 CLAUDE.md 工作流框架)

### Phase A — 拖文件到节点(主价值,低风险,先做)
- 在 `NodeGenerationComposer` 卡根加 `onDragOver`(`types` 含 `Files` 或 workspace MIME 时 `preventDefault` + `dropEffect='copy'` + 高亮态)+ `onDrop`(`stopPropagation` + `preventDefault`)。
- onDrop 解析三类 payload:① workspace 文件(MIME)→ `buildWorkspaceFileUrl` → URL;② OS `Files` → `importImageFilesToGenerationCanvas`(上传拿 hosted URL,处理 uploading/失败);③ 画布卡 payload(若有)。
- 拿到 URL 后按 kind 调当前节点的 `handleArrayAdd`(经回调/事件传进来,或把 drop 逻辑放 NodeParameterControls 暴露的入口)——**复用单源写入**。
- 抽 `useNodeAssetDrop` hook(放 `src/workbench/assets/` 或 `generationCanvasV2/nodes/`),NodeGenerationComposer 只接线。
- 视觉态(见 §4):拖悬停 → 卡高亮 dashed accent + 「松手添加」覆盖提示。

### Phase B — 连线 → 参考(高风险,见 §5 决策后再定)
- 单帧连线:现状已工作(edge → handleSlotAssignment),**保持不动**。
- 数组连线(omni):需 `connectToNode` 命中「目标当前模式有数组槽」时,加进 meta 数组(不画持久边)。**风险**:碰 store + 边语义。
  → 评审建议:要么逐条改下游(边渲染/视频判定/上下文遍历都确认不受影响),要么本期**只做 Phase A,Phase B 留待**(见 §5)。

---

## 4. 新视觉态规格(mockup 没画,这里定 token;判断:状态简单,不单独出 HTML,用 design-fidelity 断言守)

- **拖悬停(drag-over)**:drop 目标(composer 卡)加 `outline-2 outline-dashed outline-nomi-accent outline-offset-[-2px]` + 居中半透明覆盖层
  `bg-nomi-paper/70` 内 `text-nomi-ink-60 text-caption`「松手添加为参考」。离开/松手即移除。动效 150ms。
- **上传中**:沿用 picker 的 uploading 文案/态(「上传中…」);失败 → `showInfoToast` 报错。
- **连线吸附提示**(若做 Phase B):节点高亮可接态——仿现有连线高亮,走 BodyPortal 防裁。
> 若你希望先看 HTML 样张再做,我补一张 v4.1(drag-over 态);否则按上面 token 直接实现 + 走查对账。

---

## 5. 决策(用户已拍板 2026-06-06)

- **D1 = Phase A + B 都做**(拖文件 + 连线)。连线→数组参考:**先证明不破坏现有边语义**(边渲染 / 视频首尾帧判定 /
  `collectNodeContext` 上游遍历)再切;数组走 meta-only 不画 9 条线;单帧连线现状(edge→handleSlotAssignment)不动。
- **D2 = 不出 HTML 样张**,直接按 §4 token 规格实现 + design-fidelity 断言 + 真机走查对账。

---

## 6. 验收门(每步)
- 单测:drop payload 解析 / kind 路由(纯函数部分)。
- `design-fidelity.e2e.mjs`:新增「拖悬停态」断言 + 沿用遮挡断言。
- 走查(`archetype-modebar` 或新 harness):模拟拖文件到 composer → 出参考 tile(Playwright DnD/dataTransfer 模拟;或 dispatch drop 事件)。
- CI 五门绿;`BaseGenerationNode` 行数**不增**(onDrop 不进巨壳);真实生成花额度先问。

## 7. 回滚
先加新 drop 旁路 → 走查通过 → 保留;不动现有 handleStageDrop / 单帧连线。Phase B 若做,先证明边语义不受影响再切。
