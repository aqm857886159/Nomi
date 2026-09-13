# ComfyUI /object_info 新一代 COMBO 格式对账（方案包 N1）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实施，等 CI + review。

## 先查别人（R6/R31）

1. **ComfyUI 官方源码** `https://github.com/comfyanonymous/ComfyUI/blob/master/comfy_api/latest/_io.py`（真机实测 + GitHub clone 逐行核对，2026-09-11，`comfyanonymous/ComfyUI` main HEAD）：
   `comfy_api/latest/_io.py` `Combo.Input.as_dict`（第 345-386 行）序列化成
   `["COMBO", { options?: string[]|number[], multiselect?, control_after_generate?, image_upload?/image_folder?, remote?: {route, refresh_button, control_after_refresh, timeout, max_retries, refresh} }]`；
   `MultiCombo.Input.as_dict`（第 397-415 行）在此之上多一个 `multi_select: {placeholder, chip}`
   对象。最终写进 v1 兼容 `/object_info` 响应的地方是 `add_to_dict_v1`（第 1923-1926 行）：
   `d[key][i.id] = (i.get_io_type(), as_dict)` —— 元组第一个元素固定是 `io_type` 字符串
   （Combo 的 `io_type="COMBO"`，见类装饰器 `@comfytype(io_type="COMBO")` 第 344 行）。
   老节点（函数式 `INPUT_TYPES`，如 `KSampler`）继续走 `spec[0]` 本身是选项数组的老格式。
   来源：`https://github.com/comfyanonymous/ComfyUI/blob/master/comfy_api/latest/_io.py`
   （clone 于 `/private/tmp/.../scratchpad/ComfyUI`，浅克隆 HEAD）。
2. **docs.comfy.org 数据类型页**（`https://docs.comfy.org/custom-nodes/backend/datatypes`，
   2026-09-11 查）：只写了老格式（`[["a","b"], {}]`），完全没提新一代 `_io.py` 节点的
   `["COMBO", {options}]` 序列化——这也是为什么本次判断不能只查文档，必须起真机实测
   （下方「真机夹具」一节）。**偏差**：本次修复没有照文档写的唯一格式假设走，是因为文档本身
   已经跟不上上游实现；偏差理由是「上游文档滞后于上游代码」，不是我们自己的偏好。
3. **Velorn PR #107**（`https://github.com/VelornLabs/velorn/pull/107`，2026-09-11 查，状态 open）：
   同一类产品（本地优先 AI 创作工具）独立撞到了完全一样的缺陷——标题就是
   "Fix dynamic ComfyUI combo choice parsing"，症状描述："Newer ComfyUI versions can describe
   dynamic choices as `["COMBO", { options: [...] }]`, but the current parser only reads legacy
   choice-array and inline-object shapes"。读了它的 `src/services/comfyObjectInfo.mjs`
   （`extractComboChoicesFromSpec`）：同样用「先判 `Array.isArray(head)`（老格式），
   再判 `head === "COMBO"`（新格式）」的结构，佐证这是判上游形状而非我们编造的私有分支。
   **只借思路不抄实现**：Velorn 把「未知」和「已装 0 个」都压成空数组 `[]`——他们的下游没有
   我们这边 2026 年早先「空数组当不是枚举导致缺件对账沉默」的踩坑历史（见
   `electron/comfyuiObjectInfo.ts` 里「空 combo 列表」那段注释），所以对他们够用；
   对我们不够用，两者必须分开（`extractComboOptions` 返回 `undefined` = 未知，
   返回 `[]` = 已装 0 个），否则会重演同一次沉默失灵。

## 真机夹具（不是构造的）

本机没有现成 `~/ComfyUI`（此前 memory 记录的路径已不在，环境已变化）。本次在
scratchpad 里浅克隆官方 `comfyanonymous/ComfyUI`（`--depth 1`，拿到的是 2026-09-11
的 main HEAD，版本自报 `0.35.0`），Python 3.11 venv 装官方 `requirements.txt`
（纯 CPU、0 自定义节点、0 已装模型文件——不需要下载任何权重就能拿到真实
`/object_info`），`python main.py --cpu --port 8188` 起服务，`curl localhost:8188/object_info`
拿到 928 个类的真实全量响应（1.7MB）。

实测发现：928 个类里 **500 处 combo 输入字段是新格式**（`comfy_api_nodes` 下的云端
API 节点大量使用 `_io.py` 的 V3 schema）。挑出的三个真实样本（原样摘自那份响应，
逐字节保留，测试文件里注了来源）：

- `TripleCLIPLoader.clip_name1/2/3`（模型文件下拉，新格式，本机 0 个 CLIP 文件 →
  `options: []`）——这正是当前索引器完全不认的那类字段。
- `LatentConcat.dim`（非文件枚举，新格式，静态非空 `options`）。
- `LoadImageOutput.image`（纯 `remote` 动态下拉，没有 `options` 字段，
  `remote: {route: "/internal/files/output", ...}`）。
- 对照：`KSampler.sampler_name` 仍是老格式（函数式节点未迁移），验证新旧格式
  在同一份响应里共存不打架。

## 现役影响（核实后，比原始报告更准确）

事实核对发现：原始报告说「新格式下所有模型文件下拉被判无枚举 → 对账把用户装好的文件
全报缺」这句话的**因果方向反了**。逐行读 `reconcileComfyWorkflow`（改前）：一个字段
没被认成枚举时，`enums.get(inputKey)` 拿到 `undefined`，而 `if (!options || …) continue`
会**跳过**、不产生任何 missing 记录——净效果是「完全不核对」，不是「假报缺」。真正的
现役影响是**反过来的假阴性**：

1. **对账测不出真缺件**：新格式模型文件字段（`TripleCLIPLoader`/`QuadrupleCLIPLoader`/
   `HypernetworkLoader`/`UpscaleModelLoader`/多个 LTXV 系 loader 等，实测共 500 处里
   有相当一部分是这类）引用了本机没有的文件名时，导入阶段完全测不出来，等到用户点
   生成、`/prompt` 执行才报错——这正是「导入面板就说清，不等 execution_error 再猜」
   这条既有设计初衷（见 `reconcileComfyWorkflow` 顶部注释）失效的地方。
2. **下拉烤不出来**：`collectGraphEnumOptions` 同理拿不到这些字段的 `options`，
   画布上呈现的是纯文本框而不是列出真实文件名的下拉，用户只能手抄文件名（P1 提到的
   「让用户手写=离谱」同款摩擦）。

这个更准确的因果关系已经写进 `docs/fixes/2026-09-11-comfyui-combo-format-drift.root-cause.json`
的 `symptom`/`direct_cause` 字段，取代任务书里的原始表述。

## 二轮追加（同日续做）：owner 拍板的「反馈给 Nomi」+ 真机复验

owner 看到本次修复后追问：「会不会还有新格式，之后还要搞？」——追问带出两件事：

1. **owner 拍板的答案**：不能每次都靠人工真机踩一次才发现新格式。改成——真正「没见过的」
   combo 外壳（既不是老格式数组、也不是已知的 `["COMBO", {...}]`/`COMFY_DYNAMICCOMBO_V3`）
   不再默默跳过：`electron/comfyuiObjectInfo.ts` 新增 `ComfyObjectInfoIndex.unknownComboShapes`
   （node class + input key + 原始 spec），`electron/catalog/comfyuiWorkflowImportStore.ts` 的
   `reconcileComfyWorkflowText`/`reconcileComfyWorkflowTexts` 原样带出，
   `src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx`（挂在 ComfyUI 接入卡下的「导入自定义
   工作流」区）在分析完工作流后，如果对账拿到了这类字段，就出一条诊断 + 「反馈给 Nomi」按钮，
   点了打开预填好的 GitHub issue（复用 `src/ui/community/communityLinks.ts` 里唯一一处 issue
   深链拼装 `buildGitHubIssueUrl`，新增 `fields` 参数按 `.github/ISSUE_TEMPLATE/bug_report.yml`
   的字段 id 预填 `what_happened`/`extra`，正文带原始 spec JSON，不含文件路径/密钥）。
   这个诊断挂在「导入/重新检测工作流」这条路径上（本来就要拉 `/object_info` 全量），
   **没有**挂在卡片的轻量健康探测（`comfyuiProbe.ts` 的 `/system_stats` 探测）上——
   刻意不给每次开卡都加一次可能几 MB 的 `/object_info` 拉取，这是权衡后的范围边界，
   不是漏做（写进了根因合同 `residual_risks`）。
2. **拿这台机器上真的在跑的 ~/ComfyUI（0.35.0，装了真实第三方自定义节点）复验**：
   第一轮验证用的是零自定义节点的干净 clone，这轮换成本机真实安装（含 KJNodes 等第三方节点），
   `curl localhost:8188/object_info` 拿到 1188 个类的真实响应，扫出两个第一轮没覆盖到的真实字段：
   - 内置 `CreateVideo.bit_depth`：新格式 `["COMBO", {options: ["auto", 8, 10]}]`——
     字符串和数字混在一个 options 数组里；
   - 第三方 KJNodes `ImageResizeKJ.crop`：老格式 `[["disabled", "center", 0], {...}]`——
     同样的字符串/数字混合，只是外壳是老格式。
   这两个此前会被判「未知」（严格要求纯字符串数组）。核实这是真实、正在用的形态后，
   `classifyComboSpec`（原名 `extractComboOptions`，改名是因为它现在要分辨三种结果而不是
   「有/无」两种）放宽到接受字符串或数字混合元素（数字转字符串，`string[]` 契约不变）；
   真正「没见过」只保留给外壳本身不认识的情况（如虚构的 `SUPER_COMBO_V9`），用手工构造的
   反例覆盖（`electron/comfyuiObjectInfo.test.ts` 的「classifyComboSpec 的没见过外壳判定」块）。
   逐字节摘自这份真实响应的最小样本存进
   `electron/__fixtures__/comfyui-object-info-real-sample.json`（≤50 行，provenance 写在
   文件内 `_provenance` 字段），测试文件读它而不是内联字面量。

## 做法（已实施）

- `electron/comfyuiObjectInfo.ts` 新增纯函数 `extractComboOptions(spec)`：
  - 老格式（`spec[0]` 本身是数组）：逻辑与改前一致（含「空数组仍是枚举」的既有语义）。
  - 新格式（`spec[0] === "COMBO"`）：从 `spec[1].options` 取值；`options` 缺失
    （remote-only / DynamicCombo）→ 返回 `undefined`（「未知」，不是「已装 0 个」）；
    `options` 是字符串数组或数字数组都收（数字转字符串，保持下游 `string[]` 契约）。
  - `multiselect`/`MultiCombo` 的 `options` 形状与单选完全一致，先当普通枚举收
    （TODO 不做多选值语义——reconcile 侧本来就按 `typeof value === "string"` 过滤，
    多选实际值是数组，天然不会被误判成需要校验的标量，不需要专门分支）。
- `reconcileComfyWorkflow` / `collectGraphEnumOptions`（`electron/catalog/comfyuiWorkflowImport.ts`）
  **未改动**——它们只消费 `enumsByClass`，索引器修好后自动拿到正确数据，验证了
  「单一入口」的设计（唯二两个消费方 `comfyuiLocal.ts`/`comfyuiTemplates.ts` 同理自动生效，
  见根因合同 `same_class_entry_points`）。

## 验收（先红后绿）

`electron/comfyuiObjectInfo.test.ts` 新增两个 describe 块：
- 用上面的真机三样本 + KSampler 对照验证 `parseObjectInfoIndex`；
- `git stash` 只暂存 `electron/comfyuiObjectInfo.ts` 的修复、保留新测试跑一次
  （6 个新断言全红：对账漏报 3 条 missing、下拉烤不出来、多选枚举收不到)，再
  `git stash pop` 复原修复后全绿（19/19），证据见本次改动的测试文件本身
  （不是额外产物文件——按 vitest 惯例复跑即可复现）。
- 手工构造的 MultiCombo 夹具逐字引用 `_io.py` 第 397-415 行，测试注释里写明。

## 不动项

- 不改 `reconcileComfyWorkflow`/`collectGraphEnumOptions` 本体（无需改，见上）。
- 不做 MultiCombo 的多选值语义（TODO，记在代码注释里，不在本次范围）。
- 不改 `docs.comfy.org` 相关的任何官方文档（不归我们管）。
- 不追加 check:standard-formats 登记（这是我们自己读远端 API 响应做内部对账，
  不是我们自己发布/生产的格式，R31 管的是「我们对外读写的格式」，这次是纯读取
  上游已有的两种格式，不产生新格式分叉）。
- 不把「反馈给 Nomi」诊断挂到 `comfyuiProbe.ts` 的轻量健康探测（`/system_stats`）上——
  那条路径是每次开卡/点「重新检测」都会跑的高频路径，加一次可能几 MB 的 `/object_info`
  拉取是不对等的代价；诊断只挂在本来就要拉全量 `/object_info` 的工作流导入/对账路径上，
  写进了根因合同 `residual_risks` 当已知范围边界，不是漏做。

## 验收门

- `pnpm run typecheck` 全绿。
- `electron/comfyuiObjectInfo.test.ts`、`electron/catalog/comfyuiWorkflowImport.test.ts`、
  `electron/catalog/comfyuiWorkflowImportStore.test.ts`、`electron/comfyuiTemplates.test.ts`、
  `src/ui/community/communityLinks.test.ts` 全绿。
- `pnpm run check:i18n` 全绿（新增 `onboardingProviders.comfyWorkflow.unknownComboShapes`/
  `reportUnknownShape` 两条 zh-CN/en 键对齐）。
- 真实 Electron 走查 `node tests/ux/comfy-unknown-combo-feedback.walk.mjs`（先
  `pnpm run build`，走查跑的是编译产物不是源码）：真实点「模型设置」→「本地 ComfyUI」→
  展开「导入自定义工作流」→ 粘贴工作流 → 分析 → 对一台本地假 ComfyUI 服务器对账，
  截图存 `docs/plan/2026-09-11-triage-board-evidence/combo-unknown-shape.png`，并拦截
  `window.open` 校验「反馈给 Nomi」打开的 issue 深链里 `what_happened`/`extra` 确实带上了
  node class 和原始 spec JSON。
- `python3 scripts/with-gates-lock.py -- pnpm run gates` 全绿。
- R21 v3 根因合同 `docs/fixes/2026-09-11-comfyui-combo-format-drift.root-cause.json` 通过
  `check:root-cause-contracts`。
