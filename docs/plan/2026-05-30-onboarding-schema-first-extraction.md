# Onboarding 参数抽取：从 curl-only 升级为 schema-first（根治）

> 裁决：已被现行模型发现/设置流程取代；证据：`src/ui/onboarding/OnboardingWizard.tsx:192-224`、`docs/plan/2026-08-16-model-settings-approved-implementation.md:26-32`。

> 日期 2026-05-30 · 触发：kie.ai GPT Image-2 文档 onboarding 后，节点参数严重缺失（aspect_ratio 只有 0~1 个选项、resolution 等参数完全没出现）。

## 1. 根因（已实证）

当前 onboarding 的「参数真理源」是**文档里的 curl 示例 body**：
`fetch_raw_docs → 挑 curl → collectFieldSuggestions(curl.body) → suggested_fields（无 options）→ set_fields`。

curl 示例本质是「最小可跑样例」，不是完整参数契约，因此：

- curl 没带的参数（只在参数表/schema 里）→ 第一步就丢。
- 枚举参数在 curl 里只有一个值 → `options` 永远为空 → 下拉框只有 0~1 项。

实测 `https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image`：

- 是 **Apidog 渲染的 SPA**，服务端 HTML **0 个 `<table>`、0 条可用 curl**。
- 完整契约（`POST /api/v1/jobs/createTask`、`input.prompt`、`input.aspect_ratio` 的 16 个枚举、`input.resolution` 的 1K/2K/4K、各 default/required）**以内嵌 OpenAPI 数据存在 HTML 里**，但是 Apidog 去水化形态（字符串驻留 + 数字引用、JSON-in-JSON 转义，如 `\"4:5\",\"16:9\",\"9:16\"`）。
- `htmlToMarkdown` 第一步 `strip <script>` → 这些内嵌数据**全被剥掉**，agent 根本看不到。
- Apidog 私有 `export-openapi` 接口需鉴权、不通用、不可依赖。

> 结论：根治 = 把真理源从「curl body」换成「参数契约」。契约来源按权威度分层：**内嵌/可解析的 OpenAPI（确定性）> 参数表 > curl ∪ 内嵌数据摘要（LLM 补全，Zod+evidence 约束）**。curl 仅用于确认请求路径/鉴权/模板占位。

## 2. 范围（本轮 v1）

**新增** `electron/ai/onboarding/specExtractors.ts`：

- `extractOpenApiOperations(html, pageUrl): DocOperation[]` —— 确定性路径。
  - 发现干净 OpenAPI：`<script type=application/json>` 内 parse 出含 `openapi|swagger` 且有 `paths` 的对象；或从 `{"openapi"` 起做平衡括号扫描。
  - 对每个 path+method 展开 `requestBody.content[application/json].schema`：解析 `$ref`（指向 `components`）、递归 `properties` 并记录点路径（`input.aspect_ratio`）、`required[]`、`enum→options`、`default`、`type`、string `minLength/maxLength`。
  - 产出 `DocParameter[] = { key, path, type, required, options?, default?, description, evidence }`。
  - 命中场景：Swagger UI / Redoc / Stoplight / 任意内嵌干净 spec。
- `extractEmbeddedParameterData(html): { excerpt: string; found: boolean }` —— 去水化兜底。
  - 收集所有 `<script>` 文本，反转义 JSON-in-JSON（`\"`→`"` 等），抽出「短引号 token 连排（疑似枚举数组）+ 参数名样式 token + 说明句」的去重摘要，封顶大小。
  - 这不是完整 parse，是把 `htmlToMarkdown` 丢掉的字面枚举/参数名/说明**重新浮现**给 LLM。

**改 `fetch_raw_docs`（tools.ts）**：结果新增 `openapi_parameters`（确定性字段，附 evidence）+ `embedded_data_excerpt`（封顶）。

**改 `systemPrompt.ts`**：契约来源优先级 + 强制「输出每一个请求参数（含嵌套 `input.*`）、枚举给全 `options`、给 `default/required`、每个带 evidence；`openapi_parameters` 存在时直接照用、不得删减」。

**测试**：specExtractors 单测（干净 OpenAPI fixture：含嵌套对象 + enum + $ref；Apidog 转义 fixture：恢复 16 个 ratio）；扩展 draft/commit 投影测试确认 options 贯通。

## 3. 不动什么

- 不动节点渲染层（`parseModelParameterControls`/`NodeParameterControls`）—— options/嵌套已端到端支持，只是上游没填。
- 不动 mapping 的 v3 形状、async 门禁（PR1/PR2）。
- 不引入 headless 浏览器、不依赖任何平台私有接口。
- 不删 curl-blueprint —— 它仍是请求路径/鉴权/模板的真理源（规则 1：这是增强不是并行版本）。
- 不在父目录操作；所有命令 `cd .../impl-v0.6.0 &&`。

## 4. 回滚策略

纯增量：新模块 + `fetch_raw_docs` 结果加字段 + 提示词改文案。回滚 = revert 该 commit；catalog 数据无 schema 变更，已 onboard 的模型不受影响（meta 在 commit 时重建）。

## 5. 验收门

- `pnpm build` tsc 干净；新老 onboarding 测试全绿。
- specExtractors 单测：干净 OpenAPI fixture 还原全部参数 + enum；Apidog 转义 fixture 的摘要里能搜到全部 16 个 aspect ratio 与 1K/2K/4K。
- 真机：重新 onboard kie GPT Image-2 后，节点上 `aspect_ratio` 下拉框含 16 项、出现 `resolution`（1K/2K/4K），参数数量与文档一致。

## 5b. 真机复盘 + v2 根治（同日，trace 实证）

v1 上线后真机重跑 kie GPT Image-2,仍 `partial`、参数只有 `aspect_ratio` 单选项 `auto`。trace 实证三个根因:

1. **digest gate 写错（致命）**:`needDigest = tables===0 && curls===0 && openapiOps===0`。kie doc **有 1 个 curl**(最小样例),于是 digest 被 gate 掉、根本没触发;干净 OpenAPI 解析对去水化 store 返回 0 → agent 手里只剩那个 curl → 1 参数 1 选项。「curl 存在但不全」恰恰是 Apidog 的常态,旧 gate 把恢复路径关死了。
2. **digest 即便触发也太吵**:24KB 噪音(clientConfig/navbar/`_4955` 引用),`promptTokens` 飙到 114857,LLM 宁可走 curl 捷径也不挖。
3. **异步步数不足**:返回 taskId 属异步,需 step 5b 接 query;`toolCalls:10` 撞 maxSteps 顶,加上一次 404 自愈,step 5b 没跑完 → `partial`。

**v2 修复(已实现+测试):**

- 新增 `extractDehydratedParameters(html): DocOperation[]`:确定性解析 Apidog 去水化图。识别签名 = enum 值串**紧前面是纯数字引用数组** `[2050,...,2065],`(枚举标签的 deref 数组),前置标识符落在**生成参数词表**(`GEN_PARAM_NAME`,锚定精确匹配)。真机 81 个 enum-run 噪音中精确捞出 `aspect_ratio`(16 值 default=auto)+`resolution`(1K/2K/4K),0 误报。还从 `"method","post","path","/x"` 干净串恢复方法+路径。
- `fetch_raw_docs`:`structuredOps = openapiOps.length ? openapiOps : extractDehydratedParameters(text)`,**无条件跑**、喂进同一个 `openapi_parameters` 通道。digest 降级为「结构化也为空」时的最后兜底(消除 token 暴涨)。
- maxSteps 默认 10→14(main.ts + agent.ts);systemPrompt 预算文案同步。
- systemPrompt `openapi_parameters` 描述补「或从去水化 SPA store 恢复」。
- 测试:`extractDehydratedParameters` 5 个新单测(method/path 恢复、两个真参数全选项、噪音 run 拒绝、evidence、空输入)。33 文件 / 292 测试全绿(+5)。

> Rule 1:digest 不是被并行保留,而是明确降级为兜底;结构化解析是新真理源,curl 仅管路径/鉴权。

## 5c. 跨平台压测 + 通用化（同日，多文档实证）

方法论:抽取层是确定性的,可不跑 LLM/key 直接对真实 HTML 跑全套抽取器,精确复现 agent 所见。拿 kie 视频文档(seedance/v1-pro/grok)+ 3 个**非 kie 中转站**(Replicate/fal.ai/piapi)压测,每个问题都收敛成**通用规则**(不做按平台 whack-a-mole)。

| 平台 | 路径 | 发现 → 通用修复 |
|---|---|---|
| kie 视频(3 个) | 去水化 | 泛化良好(aspect_ratio/resolution/duration 跨模型都对) |
| kie grok-t2v | 去水化 | `x-apidog-enum` 扩展键泄漏进选项 → **ref 数组长度 == 枚举基数**,选项串截断到 ref 数 + 过滤 `^x-` 扩展键 |
| **所有 kie curl** | curl | URL 含未解码 `&#x27;` → **真机 404 尾随 `&` 的真正根因**;`decodeEntities` 只认 `&#39;` 十进制 → 补通用十六进制/十进制数字实体(`&#xHH;`/`&#NNN;` via `fromCodePoint`),`&amp;` 放最后避免二次解码 |
| Replicate | OpenAPI ✓ | envelope/response 字段(`id/webhook/created_at/webhook_events_filter`)混进参数 → **扩 `WIRING_KEY` denylist**(callback/webhook/created_at/id/status/urls/version...),一处同时管 OpenAPI + 去水化两条路径;保守只删「在任何提供商都绝不是生成参数」的字段 |
| fal.ai | 都没命中→digest | Next/RSC store,Apidog ref 签名不匹配 → 暂走 digest 兜底;深修=跟随链接抓 `openapi.json`(R2) |
| piapi.ai | table+curl+去水化 | 有真 `<table>`,agent 走表格路径,基本 OK;curl 用 `x-api-key` 头(blueprint 路径已支持) |

**本轮新增修复(均带测试):**
- `extractDehydratedParameters`:选项截断到前置 ref 数组长度 + 过滤 `^x-[a-z-]+$` 扩展键。
- `decodeEntities`:支持任意十六进制/十进制数字实体,`&amp;` 移到最后。
- `WIRING_KEY`:扩为 envelope/wiring 全集。
- 测试:+2(grok x-apidog-enum 截断、kie `&#x27;` curl 解码)。33 文件 / 294 测试全绿。

> 方法论沉淀:抽取层确定性 → 可离线对任意真实文档回归,这是「持续优化但每次都通用泛化」的工程支点,不必每次都真机跑 agent。

## 5d. 真机再复盘：onboarding 起不来 + spec-only 参数发不出（同日）

用户重启后真机重试，报两个新症状：

1. **onboarding 直接起不来**：wizard 报「还没有配置用来阅读文档的 AI」。根因：onboarding agent 的 LLM（dm-fox gpt-5.5）**只**靠 `NOMI_ONBOARDING_AGENT_*` 三个环境变量配置，renderer 从不传 `payload.agent`，而 `pnpm dev`/`pnpm start` 脚本**从不加载** `.secrets/agent.key`。手动 `export` 一旦忘记（重启常态），agent 配置即丢 → 连不上。这也解释了为什么用户「明明有 GPT-5.5」却被告知没有 AI：GPT-5.5 在 `.secrets` 里躺着，但没人把它喂进 env。
   - **通用修复**：`scripts/dev-electron.mjs` + `scripts/start-electron.mjs` 启动时自动读 `.secrets/agent.key`，套用文档化的 dm-fox 默认值（`https://dm-fox.rjj.cc/codex/v1` / `gpt-5.5` / `openai-compatible`）。已 `export` 的 env 永远优先（手动覆盖仍生效）。无 key 时 dev 打印告警而非静默失败。
2. **spec-only 参数选了发不出**：agent 只 templatize curl 里出现过的参数，spec 补出来的 `resolution`/`duration` 在节点上能选，但 `mappingCreate.body` 里没有 `{{request.params.<key>}}` 槽 → 选了等于没选。
   - **通用修复**：`mergeMissingParamsIntoBody(body, fieldKeys)`（curlBlueprint.ts，纯函数）。从 body 里既有的 `{{request.params.*}}`/`{{request.prompt}}` 占位符**反推参数所在嵌套层**（如 kie 的 `input`），把缺失的 field key 注入同一层；已存在的字面值就地 templatize；不硬编码任何平台 body 形状。`commitOnboardedModelToCatalog`（runtime.ts）在 `upsertModelCatalogMapping` 前对 create.body 做一次对账。
   - 测试：`curlBlueprint.test.ts` 7 个新单测（kie 嵌套注入 / 纯函数不变 / prompt-container 兜底 / 扁平 body / 字面值就地 templatize / 全有时 no-op / 非对象原样）。302 测试全绿。

> 注：`recordInfo is null` 422 是上一轮 **partial 模型**遗留的 query 阶段问题（URL 没带 `?taskId=`），依赖一次干净 re-onboard 才能拿到新 trace 定位；不在本次盲改范围。

## 5e. 9 文档跨平台真机抽取扫描（同日，`scripts/probe-extract-matrix.ts`）

为回答「到底修完没有」，对 9 个**真实**中转站文档 live-fetch HTML、跑全套确定性抽取器（agent 在 `fetch_raw_docs` 里看到的一模一样），不跑 LLM、不花钱：

| 文档 | HTML | 走哪条路 | 抽到的参数 | 评 |
|---|---|---|---|---|
| kie GPT Image-2 (image) | 379KB | 去水化 | aspect_ratio[16], resolution[3] | ✅ |
| kie Seedance v1-pro (video) | 383KB | 去水化 | aspect_ratio[6], resolution[3], duration[2] | ✅ 视频参数泛化 |
| kie Grok-imagine t2v | 381KB | 去水化 | resolution[2] | ✅ x-apidog 截断正确（该模型枚举参数本就少）|
| kie Seedream v4 (image) | 386KB | 去水化 | image_size[9] | ✅ 词表泛化（非 aspect_ratio）|
| kie Z-Image (image) | 384KB | 去水化 | aspect_ratio[5] | ✅ |
| Replicate veo-3 | 106KB | OpenAPI | seed,image,prompt,duration[3],resolution[2],aspect_ratio[2],generate_audio,negative_prompt | ✅ |
| Replicate flux-pro | 142KB | OpenAPI | seed,width,height,prompt,aspect_ratio[10],image_prompt,output_format[3],output_quality,safety_tolerance,prompt_upsampling | ✅ |
| **kie Hailuo 02 t2v** | 383KB | curl 兜底 | — | ⚠️ spec **懒加载**，HTML 里 0 个参数 token（0 snake_case、0 枚举串）|
| **fal.ai flux-pro** | 333KB | digest 兜底 | — | ⚠️ Next/RSC，spec 不在初始 HTML |

**本轮发现并修（均通用，带测试）:**
- Replicate `context`（nullable object 信封）+ `output_file_prefix`（平台输出命名，每个模型都有、从不是生成参数）混进参数 → 扩 `WIRING_KEY` denylist。
- Replicate 同一 `/predictions` 被抽出**两次**（页面把 spec 渲染在 `<script>` + inline 两处）→ (a) `findOpenApiRoots` 的 root 签名从「仅 path keys」改为「path keys + 大小指纹」，否则更全的第二份会被误当重复丢掉；(b) `extractOpenApiOperations` 末尾按 method+path 去重、保留字段更多的那份。
- 测试 +3（context/output_file_prefix 过滤、richer-op 去重）。304 测试全绿。

**结论（诚实版）:** 7/9 文档参数抽取完美泛化（kie 去水化 5 个 + Replicate OpenAPI 2 个）。**2/9（Hailuo、fal.ai）的 spec 根本不在服务端 HTML 里**（懒加载/RSC），不是 parser bug——字节不在，没法解析。这正是 R2（跟随链接抓真 spec 端点）要解决的，是独立的一块工作，不在本轮。

> 方法论沉淀：`probe-extract-matrix.ts` 是这个反复出问题领域的离线回归台——以后加平台/改 parser，先对它跑一遍，不用每次真机烧钱跑 agent。

## 5f. R2 落地：跟随链接二次抓取懒加载 spec（同日）

懒加载 SPA（fal.ai 的 Next/RSC、部分 Redoc/Swagger 页）不把 spec 嵌进服务端 HTML，而是客户端再去抓一个 `*openapi*.json` / `swagger.json` URL。内联抽取必然为空，唯一出路是**二次抓取那个 spec URL**。

- `extractSpecLinks(html, pageUrl)`（`specExtractors.ts`）：扫描 HTML 里的候选 spec URL（相对 + 绝对，必须含 `openapi`/`swagger`/`api-docs` 且形如文档 URL），对 `pageUrl` 解析成绝对地址，去重 + 截顶。精度优先：不抓任意 `.json` 资产（避免在 i18n/config blob 上浪费请求）。
- `fetch_raw_docs`（`tools.ts`）：当内联 `extractOpenApiOperations` / `extractDehydratedParameters` 都为空时，逐个 `hardenedFetch` 这些 spec URL，对返回 JSON 跑 `extractOpenApiOperations`，命中即喂进**同一个 `openapi_parameters` 通道**。best-effort，单个失败试下一个。
- 测试：`specExtractors.test.ts` +6（fal 相对 URL 解析、绝对 swagger、根相对、去重截顶、忽略通用 `.json`/散文提及、空页）。`probe-extract-matrix.ts` 增加 R2 跟随分支。

**结论（诚实版，真机扫描复核）：**
- **fal.ai flux-pro**：内联 0 → R2 跟随 `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/flux-pro` → 解析出 10 个参数（含 `output_format[2]`、`safety_tolerance[6]`、`image_size`）。✅ 本轮新覆盖。
- **kie Hailuo（Apidog）**：页面唯一对外 spec 链接是品牌静态资产（`assets.apidog.com/.../brand/openapi`，无 ops）；真 spec 端点是私有/鉴权的 detail XHR，公网拿不到。R2 无害穿过（无 ops → 落到既有 curl 路径，与之前一致）。**Apidog 这类没有公开 spec URL 的，R2 也覆盖不了——需要鉴权，不在能力范围内，如实告知。**

9 文档扫描：8/9 命中结构化路径（OpenAPI/去水化/R2），Hailuo 走 curl。

## 5g. 真根因：onboarding 不用 catalog 里已配的文本模型（同日，真机截图实证）

用户重启后**仍**报"还没有配置用来阅读文档的 AI",但"模型设置"里明明有 **GPT-5.5（dm-fox）文本模型**。根因不是启动脚本——是**读文档的 onboarding agent 走的是一套独立的环境变量配置(`NOMI_ONBOARDING_AGENT_*`)，根本没去用用户在 catalog 里配的那个文本模型**。用户视角"我明明有 GPT",代码里是两套东西 → 断点。

修法（通用、对分发友好、不依赖 env/.secrets）：

- `runtime.ts` 新增 `resolveOnboardingAgentFromCatalog()`：从 catalog 找第一个 **enabled 的 text 模型** + 其 vendor(baseUrl/providerKind) + 解密后的 key，组装成 onboarding agent 配置。key 在 main 进程内解密、不外泄。
- `main.ts` `nomi:onboarding:start` 的 agent 解析优先级改为：① `payload.agent`（Lab CLI 的 `--agent-*` 显式覆盖）→ ② **catalog 文本模型（产品主路径，dev/打包一致）** → ③ `NOMI_ONBOARDING_AGENT_*` env（仅 dev/headless/首启 bootstrap 兜底，无 UI）。
- 报错文案改为引导"在「模型设置」里添加一个文本模型"。`OnboardingWizard` 提示同步。

实证：用户 catalog = `gpt-5.5 / dm-fox`（text, enabled）+ dm-fox vendor（`https://dm-fox.rjj.cc/codex/v1`, openai-compatible, bearer, key 已存 safeStorage）。catalog 路径产出的 agent 配置与原 env 默认值**完全一致**（dm-fox gpt-5.5）——所以这就是用户期望的"用我配的那个 GPT 读文档"。**这也顺带解决了打包版**：打包 app 没有启动脚本/.secrets，但有 catalog → 现在能正常 onboarding。

> Rule-1 说明：env 路径降为最低优先级、纯 bootstrap/headless 通道（无 UI、首启加第一个文本模型前需要它），不是用户可见的重复功能；payload.agent 是 Lab CLI 的合法编程入口（独立 code path）。catalog 是唯一产品来源。

## 6. 后续（不在本轮）

- ~~把 spec-only 参数合并进请求 body 模板~~（已在 5d 完成）。
- ~~R2 跟随链接二次抓取懒加载 spec~~（已在 5f 完成；fal.ai 覆盖，Apidog 私有端点除外）。
- R3 探针：对仍为空的 enum 发非法值，从 4xx 错误回显补全（Apidog 这类拿不到 spec 的最后兜底）。
