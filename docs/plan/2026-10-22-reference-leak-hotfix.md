# 设计卡：参考图错发热修（只改发出去的东西）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 线：F-refleak-hotfix · 分支 `fix/reference-leak-hotfix`（基于 origin/main `97eab7bec`）· 花钱类，9 格全填。
> 复盘与原型：`D:/Nomi-b1a/docs/audit/2026-10-22-composer-reference-slots-direction.md` 末节「main 上是否已存在」（#1269 工作区，未进主仓）。
> 根因合同：[docs/fixes/2026-10-22-reference-leak-hotfix.root-cause.json](../fixes/2026-10-22-reference-leak-hotfix.root-cause.json) · 证据：[docs/evidence/2026-10-22-reference-leak-hotfix/](../evidence/2026-10-22-reference-leak-hotfix/README.md)

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

长跑 / 画布 / 新增功能三类是扫描器按路径推出的下限（`runner/catalogTaskActions.ts` 在画布执行器目录），照勾；本次不改时机、不新增交互，对应证据在 PR 正文按「不适用 / 未验证」逐项写明理由。

## 开工三问

1. 14 天修过几次：`node scripts/fix-churn.mjs` 对 catalogTaskActions / archetypeInput / taskParams 未命中热点；**但 `electron/runtime.ts` 是热点**：合入前 14 天已有 6 个 fix（巨壳）。本 PR 对 runtime.ts 只改 1 行（在 `applyHeadlessParamDefaults` 的入参上套一层 `stripReferenceResidueBeforeSend`），逻辑全在独立守卫文件 `electron/tasks/referenceResidueGuard.ts` 与纯函数 `stripReferenceResidue` 里，不改 runtime 的任何分支或状态，所以不另走一轮方向检查；这一概念的方向检查是 #1269 线的复盘（`docs/audit/2026-10-22-composer-reference-slots-direction.md`，main 上还没有），提交 trailer 指向本设计卡。（V-refleak 第 1 轮指出原写法「未命中热点」漏核 runtime.ts，已照实改。）
2. 是不是我们独有：是。「参考按模型 / 方式落哪个槽、只发在用的图」是按镜头花钱的领域语义（`runner/` 在 self-written 领域目录里）；没有通用库做这件事。
3. 补 / 换 / 删：**补**。在现有请求构造上把「只加不清」改成「全集先清、只填声明槽」，主进程加一道剥除。不换的理由：换 = #1269 的「一份有序参考列表 + 唯一推导函数」结构重写，要动节点数据和换模型行为，等用户拍板；热修只止血花错钱。

## 格子

| 格 | 内容 |
|---|---|
| ★1 用户怎么用 | 当创作者在一个节点上试过首帧 / 首尾帧 / 参考图、再切到别的方式或换模型时，我想**界面上看到在用的图就是发给模型的图**，以便钱花在我以为的那次生成上。步骤：放图 → 切方式或换模型 → 参考区显示新方式的槽（没有槽就不显示）→ 点生成 → 供应商只收到参考区里在用的图。**不做**：不改节点数据、不改界面、不改切方式 / 换模型时图怎么搬（那是 #1269）。**已知坑**：旧别名键在「已声明对应槽」的方式下仍会被 resolveGenerationReferences 抬成首帧 / 参考（见格 6 残余）。真实任务：① Seedance 首帧图生试完切文生出一条纯文生（复盘 1a）；② Seedance 全能参考 3 张 → 切首尾帧放两帧（复盘 2a，APIMart）；③ 5 张参考的节点换到 Veo 3.1 落文生（复盘 4）。主指标：发出去的参考地址 ⊆ 参考区在用，按「档案 × 方式」格的比例量，基线见下，目标 0 格漏；护栏：修前「在用且发出」的地址修后一张不少（1088 格对账）。量具：`src/workbench/generationCanvas/runner/referenceSentWithinInUse.property.test.ts`（性质测试 + 本机假上游抓包）。基线（修前漏格 / 总格）：模板参数层 85/148、中转真请求体 53/148、APIMart 9/54（另有首尾帧、视频音频、别名三种起点，全表见证据 README）。注意这几个数是在没经过 `imageEditGuardError` 的渲染层量的，夸大了 main 上的漏；独立验收 V-refleak 用真 `runtime.runTask` 量的修前真漏钱是 **37 行 / 389 行**（中转 1a、APIMart 场景 2 和 3），其余几格在 main 上是被「为免白扣费这次不发」拒掉、文生生不出来，修后这些文生格能正常出片。 |
| ★1b 连带界面 | 无。界面、错误卡、回执文案都不变；只有开发态终端在主进程剥掉残留时多一行 `[nomi:tasks] reference residue stripped …`（打包版不出）。 |
| ★2 谁说了算 | 「这次请求带哪些参考」：渲染层唯一写口 `buildCatalogTaskRequest` → `buildReferenceExtras`（door-map：1 写 2 别名读）；主进程唯一入口 `runtime.runTask` → `stripReferenceResidueBeforeSend`（electron/tasks/referenceResidueGuard.ts，内调纯函数 `stripReferenceResidue` + `logDevDetail`），之后的 4 个 `taskTemplateParams` 读口（同步音频 / Antigravity 预检 / 自定义脚本 / profile HTTP）都在它后面。「通用参考键有哪些」一份：`electron/shared/modelArchetypes/referenceKeys.ts` 的 `GENERIC_REFERENCE_KEYS`，渲染层清除、ComfyUI 参数契约过滤、主进程剥除共用（原来 catalogTaskActions 里那份 Comfy 键表改成从它派生，成员不变）。「当前方式在用的槽值」一份：`orderedSentMediaReferenceUrls` / `buildArchetypeInputParams`（archetypeInput），标准参考面从同一个函数取。不靠猜意图。 |
| ★3 一致与复用 | 复用现有：`currentArchetypeMode`、`orderedSentMediaReferenceUrls`（和 archetypeInput 同一份连线在前、截上限列表）、`readParameterReferenceSlotsContract`（参数槽不清）、`logDevDetail`（开发态诊断）。新文件只有 `referenceKeys.ts`（把已有的键表挪到渲染层 / 主进程都能 import 的纯模块）。没有第二份定义。 |
| ★4 全状态 | 界面不变。请求层：①当前方式声明的槽有值 → 照发（同修前，逐格对账）；②当前方式没声明 → 不发（修前会发）；③声明了但超槽上限 → 只发前 max 张（修前标准参考面不截）；④主进程收到渲染层没清干净的残留 → 剥掉照发其余（不拒发），开发态终端记一行；⑤无档案模型 / ComfyUI 参数契约 / headless 显式参考 → 不动。能力不可用：不适用（没有新动作）。 |
| 5 中途表 | 只改请求体的组装，不新增状态、不改时机：停 / 关窗 / 断网 / 重启 / 连点的行为与花费和修前逐字相同（请求在交之前就组好，剥除是纯函数，不碰 Run、令牌、幂等键）。唯一差别是交出去的那一份少了不该有的图。 |
| 6 外部数据与失败 | 外部来源：各家 mapping body（APIMart `APIMART_*_MODELS`、通用中转 `NEWAPI_*_OP`）读哪些键——测试直接渲染真 mapping。偏差：中转视频 body 只有一个 `image` 位，参考 / 首尾帧方式下只收第 1 张（修前修后一样）。失败时：剥除不拒发；若某方式确实需要图而图都被判成残留（不该发生，性质测试全档案钉住），供应商会按缺图回错，界面照旧显示供应商错误。**残余**：①`resolveGenerationReferences` 在已声明槽的方式下仍会从 `first_frame_url` / `firstFrameRef` / `meta.referenceImages` / `upstreamResultUrls` 兜出首帧 / 参考，参考区不显示——同类「在用多处各算」，交 #1269 的唯一推导函数；②托管同意卡读节点 meta：unverified；③渠道单图上限尺子偏宽（复盘第 4 节）。 |
| ★7 性能 | 不适用：纯 bug 修复，不新增操作；请求组装多一次 O(参考键数 × 参考数) 的过滤，量级几十。 |
| 8 真实条件 | Windows ✓（本机跑全部测试与抓包）；真付费 **unverified**（待协调跑 1–2 条最小量，见 ★9）；英文界面 / 最小窗口 / 键盘：不适用（界面不变）；真规模：全部 148 个收图档案方式格 + 视频音频 + 别名，共 1691 格。 |
| 拍板图清单 | 不适用：pure-bugfix，只改发往供应商的请求体，界面不变。 |
| ★9 验收与回滚 | **验收清单（动手前列全，验收线只核这份）**：①性质测试全绿：`npx vitest run src/workbench/generationCanvas/runner/referenceSentWithinInUse.property.test.ts`（模板参数层 / 中转 / APIMart × 参考 / 首尾帧 / 视频音频 / 别名 + 绕过渲染层两层）；②四个线上场景 + 三个没误伤在本机假上游按收到的字节等号断言；③变异：渲染层去掉「置 undefined」→ 模板参数层与场景 1、4 红；主进程剥除改成原样返回 → 绕过渲染层三条红；④没误伤：1088 格修前「在用且发出」修后一张不少（证据 `property-counts.json`）；⑤回归：`src/workbench/generationCanvas`、`electron/catalog`、`electron/capabilityCore`、`electron/parity` 全量 vitest；⑥真付费（协调跑，只花一条）：复盘场景 2，APIMart Seedance 2.0 fast · 480p · 4 秒 · 无音频，全能参考放 3 张 → 切首尾帧 → 放首、尾帧 → 生成；断言 App 真正发往 api.apimart.ai 的请求体去重后恰好首帧、尾帧两张、3 张残留参考任何形态都没上传没发出（`tests/ux/reference-leak-hotfix.paid.mjs`，判定 `tests/ux/_referenceLeakWire.mjs` 先用真 runTask 零花费验过）。**反例（这类会从哪回来）**：别的方式留下的键（20 个改 modeId 的写口）→ 性质测试四种起点；换模型落文生 → 场景 4；连线多图进单槽 → 场景 3；MCP metadata / 旧工程别名 → 别名起点；渲染层将来回归 → 主进程剥除 + bypass 两层；新档案 → 性质测试按 MODEL_ARCHETYPES 自动展开；新参考键 → 只能加进 GENERIC_REFERENCE_KEYS 才会被两道守覆盖（见残余：加键不进表仍会漏，规则写在 referenceKeys.ts 文件头）。**自验表**：见证据 README「抓包结论 / 性质测试格数 / 变异」三表。**独立验收**：V-refleak 待出。**回滚**：`git revert <本提交>`，无数据迁移、无开关。 |
