# 执行日志：P0+P1 通用素材系统(自主执行)

> Rule 4 执行文档 + 边做边勾的进度账。背景见 `2026-06-06-composable-node-execution-plan.md`(主计划)、
> `2026-06-06-reference-at-and-sources.md`(原语)、样张 `2026-06-06-reference-at-v4.html`。
> 用户(2026-06-06)授权**自主执行 + 自测 + 自验收**,不逐步打断。本文记录实际步骤、关键决策、验证证据。

## 范围(这一轮做什么)

把"加素材/参考"从三套 bespoke 收成一套通用原语,并接进生成节点:
- **P0** 通用素材原语:`src/workbench/assets/`(assetPool ✅ + AssetTile + AssetPicker + 节点级 onDrop)。
- **P1** 参考槽归一:`AssetReference`(声明式 slot 驱动)替换三套加素材 UI;@ 内联引用(Tiptap);R1 传输契约。

## 不动什么(本轮边界)

- 3D(Scene3D)自成体系;结果操作(裁剪/旋转)非素材输入;接入页 OnboardingWizard 体验重做(独立轨)。
- character1 的**模型契约不变**——只是从用户眼前藏起来,发送前才出现。
- 单帧槽的 edge+meta 双写沿用;数组槽 meta-only 沿用(M6,数组**绝不**变持久边)。

## 关键决策 / 发现(随做随记)

- **D1 tile 尺寸以 v4 样张为准 = 56px(`w-14 h-14`)**。交接文档写的"48px"是旧 v3,已被 v4 覆盖。
- **D2 界面组件不写渲染单测**:项目无 testing-library、vitest=node 环境。纯逻辑(assetPool/搜索过滤)单测;
  视觉/体感**靠 Playwright 走查 + 样张并排对账**(规则 13/8 AFTER)。
- **D3 AssetRef 渲染地址 vs 传输地址分离**(R1):renderUrl 界面用(nomi-local 不保证 vendor 可达),
  传输地址不存储、发送时由 origin 现算。已落地于 P0.1。
- **🔴 D4 R1 修法待调研(交接文档描述不准)**:"把本地素材推给 vendor 变成可达 URL"的能力**现在不存在**;
  `hardenedFetch`/`importRemoteAsset` 是**往里搬**的、方向反了。需先查 KIE/vendor 支持哪种喂法
  (上传接口拿临时 URL? base64 内联?),再实现发送侧转换。属 P1,不卡 P0。**真实生成花额度仍先问用户。**
- **D5 巨壳约束(规则 12)**:节点级 onDrop 要接进 `BaseGenerationNode`(1406,白名单只减不增)——
  drop 逻辑抽独立 hook,接线若净增就同步从该文件抽等量代码,确保基线不涨。

## 验收门(每个 chunk)

CI 五门(filesize/lint≤98/typecheck/vitest/build)全绿 + Rule 11 自 commit/push。
用户可见(界面)→ 落地后 Playwright 走查 + 和样张 v4 并排对账(规则 8 AFTER)。

## 回滚

每步"先加新原语旁路 → 走查通过 → 切换 → 删旧";旧路保留到新路验证通过才删。

## 进度清单

- [x] **P0.1** assetPool 地基(AssetRef 契约 + useAssetPool 派生 selector + 7 单测) — e43608b
- [ ] **P0.2** AssetTile(56px,图/视频缩略+播放三角/音频波形,编号/删除,token + Tabler)
- [ ] **P0.3** AssetPicker(搜索 + 画布行 + 项目最近网格[可滚]+浏览全部 + 上传 + 拖入),消费 useAssetPool
- [ ] **P0.4** 节点级 onDrop(独立 hook,守巨壳基线)
- [x] **P1.1** AssetReference(声明式 slot 描述符:form=single|array / persistAsEdge / numbered / max,R5)。
  纯展示 + 回调驱动,消费 AssetTile + AssetPicker。
- [x] **P1.2** 接生成节点 + 删旧三套(inline frame 菜单 ~106 行 + 源视频 ~30 行 + ReferenceSlots 整文件)。
  NodeParameterControls 649→559(净删 90);写入逻辑复用已验证的 handleSlotAssignment/handleArrayAdd…
  (单帧连边 / 数组 meta / 源视频 meta 按 slot 描述符分派);新增"选项目素材作单帧来源"路径(setSingleFrameUrlMeta)。
  ReferenceSlots.tsx 删除(规则 1)。
- [ ] **P1.3** 连线→参考管道(数组 meta-only 不画线)——连线加参考留待(现 picker 已覆盖画布/项目/上传三源)。
- [x] **走查自验收**:`archetype-modebar.e2e.mjs` 17 断言全过(模式切换 / 尾帧槽 / **经新 picker 上传角色图→①徽标** /
  character 提示 / HappyHorse 4 模式 / 设置弹层 / Fast 同族);`smoke.e2e.mjs` 10 断言(主链路回归)。截图人眼确认渲染对齐样张意图。
- [x] **R1 传输(通用方案)**:vendor 声明 `assetIngestion`(upload-url / inline-base64 / none)+ 通用解析器
  `assetLocalization`(递归扫 nomi-local、按 strategy 解析、去重替换,全注入可单测)+ KIE 作首个 upload-url
  实现(免费 base64 端点 → data.downloadUrl)+ 接进 `executeProfileOperation` 发送前。文件侧抽 `localAssetFile`,
  runtime 净缩 2632→2623。13 单测。**通用第一:加新 vendor=多声明一份,通用层不改。**
  ✅ **真实验证通过(零额度)**:`tests/ux/r1-upload-verify.mjs` 在真 app 内 safeStorage 解密用户 KIE key →
  上传 → 拿回 `https://tempfile.redpandaai.co/...`(code 200)→ GET 回 HTTP 200 image/png。
  本地素材 → 公网可达 URL → 真可取回,传输层对真实 KIE 跑通(上传免费)。
  ⏳ 唯一剩项:一次**完整生成**端到端(KIE 真去 fetch 该 URL 出片)= 花额度,待用户拍。
- [x] **@ 内联引用(Tiptap,R6)** ✅:工程核心(`promptMentions` 持久化 `@[asset:url]` + 发送投影单源)+ 编辑器 UI
  (`PromptEditor` 替 textarea、`AssetMentionNode/Chip` 内联 chip、点 tile 插入)+ @ 键 suggestion
  (`AssetMentionSuggestion`,@tiptap/suggestion@3.23.5 版本对齐,候选 = referenceImageUrls 单源,下拉走 body)。

### 长尾(多 agent 对抗评审定的顺序,每项按 must-fix 改进后实现)
- [x] **① 删 tile 同步清 chip**:`removeMention`(整串精确匹配删全部 + 共享 collapse)+ meta/prompt 合并单 updateNode(原子+持久)。
- [x] **② @ 键 suggestion**(见上)。
- [x] **③ tile 拖拽重排 + picker 浏览全部**:`moveArrayItem` 单源重排(同 metaKey 守卫)+ `nomi-open-files-panel` 事件开文件面板。
- [x] **④ 每类型上限 toast + 灰显**:`showInfoToast`(无 Undo)+ picker `atLimitKinds` 灰显,单源计数。
- [ ] **⑤ 拖入 / 连线 → 参考**:见独立执行文档 `docs/plan/2026-06-06-drop-and-wire-execution.md`(含压缩上下文 + 评审 must-fix
  + 降风险方案:onDrop 挂 NodeGenerationComposer 非巨壳)。**待用户拍板 D1/D2 后执行。**
