# 模型能力一处声明（第 2 刀）：GPT-6 Astra / 6.1 Sol 改走 Responses 协议

```
改动名：模型能力一处声明 · 第 2 刀        线/负责人：实现线（Mac，I-gpt6-responses）        类别：[其他]（不碰花钱 / 长跑 / 可打断 / 新界面；付费冒烟只验收，不是功能）
```

决策：D-1122-model-meta-declaration（协议只写在行声明 `meta.textProtocol` 一处，缺省回落供应商的 `providerKind`）；D-1122-gpt6-responses-no-ab（官方推荐的协议就是对的，不做 A/B，只用一次 APIMart 管道付费冒烟当接入验收）。第 1 刀设计卡：`docs/plan/2026-11-22-model-meta-declaration.md`，它「留给后面」里写的漏斗整份替换风险（第 141 行）本刀一并解决。

## 先查别人（★0）

- [OpenAI 迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses)（已抓下来读，存 `tmp/I-gpt6-responses/openai-migrate.txt`）· Chat Completions 仍受支持、新项目推荐 Responses；GPT-6 Astra / 6.1 Sol 的工具调用必须走 Responses；`store: false` 时每条推理条目自带 `encrypted_content`，下一轮要原样回放 · **确认了**要改的只有文档点名的两行；**改了**「Terra / Luna 要不要跟着改」的答案：文档没写它们必须走 Responses，不改（对拍证明这两行请求零差异）。
- [APIMart Responses 文档](https://docs.apimart.ai/en/api-reference/texts/openai/responses.md)（存 `tmp/I-gpt6-responses/apimart-responses.md`）与 [APIMart Chat 文档](https://docs.apimart.ai/en/api-reference/texts/general/chat-completions)（存 `apimart-chat.md`）· 同一个中转同时开 `POST /v1/chat/completions` 与 `POST /v1/responses`（Bearer，支持 function calling）；文档没有对 GPT-6 两行写与 OpenAI 相反的话 · **确认了**两边不冲突，可以只靠 `textProtocol` 在行上选路；**没查到**：中转是否原样回传 `encrypted_content`、不带 `include` 时是否接受回放——只有付费冒烟能答（见 ★9「未验证」）。
- pi-ai 0.85.1 `node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js:138-140`（收到响应时把整条 reasoning 条目 JSON 存进 `thinkingSignature`）与 `:581-586`（下一次请求里把它原样放回 `input`）、`dist/transform-messages.js:68-93`（同模型的 thinking 块保留，不丢）、`dist/api/openai-responses.js:253-270`（`include` / `reasoning` 只在 `model.reasoning` 为真时才发） · **确认了**回放是 pi 自己做的，我们没有绕开、也没有再写一份：本刀没有任何回放代码，只写测试钉住它；因为本刀不给行加 `reasoning`，`include: ["reasoning.encrypted_content"]` 不发，靠上游默认带 `encrypted_content`（`store: false` 的默认）——这是 ★9 里那条「未验证」。
- [#1140](https://github.com/aqm857886159/Nomi/pull/1140)（推理档位，Yang-86，开）与 [#1477](https://github.com/aqm857886159/Nomi/pull/1477)（原生多模态，dreamcolor234，开）· `gh pr diff` 只读看过：#1140 是推理档位选择（第 3 刀的事）、#1477 是音视频输入（第 4 刀）；两者里涉及协议的只有「`openai-responses` 作为一种 `kind` 被映射、`max_output_tokens` 字段名」，仓库里已经有 · **确认了**协议部分没有可直接取用的新东西，没有照用代码，所以提交里不加合作者行；档位与音视频留给后两刀再读。
- 第 1 刀已落地的读法 `electron/ai/vendorModelConnection.ts:38`（`readModelDeclaration` → 缺省回落 `vendor.providerKind`）· 现成 · **确认了**本刀不新增读法，只写一格声明。
- 出口：不涉及：本刀不新增、扩大或挪动任何会挡住人的保护（不拒绝、不加锁、不等待）。

## ★1 用户怎么用

**当**创作者用 GPT-6 Astra / GPT-6.1 Sol 让 Agent 做带工具的多步任务（读剧本 → 改 → 再读），**我想**请求走 OpenAI 官方推荐的 Responses 协议，上一轮的推理条目原样回放、工具照常调对，**以便**多步任务不丢推理、不因协议不对而报错或工具调用写错。

1. 内置 APIMart 管道里选 GPT-6 Astra / 6.1 Sol → `nomiModelConfigFor` 读这一行的 `meta.textProtocol`（`openai-responses`）→ 请求去 `…/v1/responses`；
2. 多步工具任务 → 每一步 pi 把上一步返回的推理条目放回 `input`，我们不碰；
3. 拆镜头等单发、画布文本节点流式、Agent 对话三条路都经同一个 `nomiModelConfigFor`，所以这两行的**三条路**都改走 Responses（这是有意的：同一行不该一半走 Chat 一半走 Responses）；
4. 其余所有行（含同族 Terra / Luna）：请求逐字节不变。

**不做什么**：不加推理档位、不给任何行加 `reasoning` / `thinkingLevelMap` / `compat`（第 3 刀）；不碰音视频（第 4 刀）；不改设置界面；不写第二份回放；不改价目。

**已知坑**：①这两行上高级区手选的协议不再生效（行声明优先，因为文档说这两行只有 Responses 能调工具；没声明的行仍照手选）；②中转是否真回传 `encrypted_content`、不带 `include` 是否接受回放，本机无法证明，只有付费冒烟能答；③这两行以前在 Chat 上跑得出来的会话历史，换协议后由 pi 重新按 Responses 格式组请求，不迁移任何已存数据。

**真实任务**：
- A：Agent 对话选 GPT-6.1 Sol，三步带工具（读全文、读选区、回一句话）→ 3 次请求全去 `/v1/responses`，第 2、3 次请求里带着前面返回的推理条目，2 次工具调用都对；
- B：v0.24.0 / v0.24.1 老用户升级后，这两行协议自动变成 Responses，别的行（含他们自建中转上 o1 / kimi 等怪癖行）请求不变；
- C：设置页保存这一行（带一份不含声明的 `meta`）后仍走 Responses——声明在漏斗里按键合并，不被冲掉。

| 目标 | 信号 | 指标（比例） | 量具 | 基线 → 目标 |
|---|---|---|---|---|
| 这两行请求去 Responses | 请求层网址 / 请求体形状 | 去 `/v1/responses` 的请求 / 这两行的全部请求（Agent lane + 单发 + 流式 + PDF） | `electron/agentLane/gpt6Responses.test.ts` + 金样 `tests/fixtures/model-request-parity/requests.json` | 0%（主线全去 Chat）→ 100% |
| 其余行不变 | 出网请求逐字节对拍 | 零差异的（调用方 × 行）/ 全部（82 行 × 4 路） | `electron/agentLane/modelRequestParity.test.ts` | 主线录 → 100%（只重录这两行） |
| 回放不丢 | 多步里后一次请求带着前面返回的推理条目 | 返回过的推理条目中，在之后每次请求里原样出现的 / 返回过的 | 回放测试（上文）+ 付费走查 `tests/ux/agent-gpt6-responses-real.paid.mjs` | 本机假上游：未验证：缺量具（主线上没有 Responses 路）→ 本机 100%；真上游：未验证：等协调跑 |
| 声明不被冲 | 写入方少带声明键后行上声明 | 保留下来的声明键 / 行上原有声明键 | `electron/catalog/modelDeclarationFunnel.test.ts`、`gpt6Responses.test.ts` | 0%（主线整份替换）→ 100% |

### ★1b 连带界面

不适用：不改回执、错误卡、通知、任务列表的任何文字；设置页里「协议」那一格对这两行不再影响请求，但该格仍显示连接的默认协议，本刀不改它（要不要在设置里标出「此模型固定走 Responses」是界面问题，留给后面，需先出拍板图）。

### ★1c 老用户

- **模型行**：不需要新迁移。启动种子对账（`seedBuiltins.ts reconcileModels`）本来就会把种子行 `curatedMeta` 与 `MODEL_DECLARATION_KEYS` 里的键补到已有行上，所以升级后第一次启动，这两行就带上 `textProtocol`（证据：`gpt6Responses.test.ts`「升级前已落盘的行（没有 textProtocol）读目录 + 启动种子对账后补上」覆盖已落盘行；「老用户升级（真实 v0.24.0 / v0.24.1 目录）」用 `tests/fixtures/old-user-data/` 里两份真实旧版目录升级，这两份目录里还没有 GPT-6 行，所以种子对账新增的行直接带声明、请求去 `/v1/responses`，目录里原有的文本行协议一个不变）。
- **手选过协议的连接**：用户在设置里给 APIMart 连接手选过协议的，对没声明的行仍生效（照第 1 刀口径不动）；这两行声明优先——这是有意的取舍，因为它们在 Chat 上工具调用本来就不被官方支持。
- **退回上一版**：新键是行 `meta` 里一格可选键、目录版本不变、没有新收据。用 v0.24.1 的真实代码（`git archive v0.24.1` 抽到 `tmp/I-gpt6-responses/old-v0241/`）读升级后的目录：读得起、211 行一行不丢、版本号正常、这两行旧代码的协议回到 `openai-compatible`（= 升级前的样子，旧版本来就不认这格）（证据：`tmp/I-gpt6-responses/logs/downgrade-proof.json`，脚本 `downgrade-proof.mts`）。
- **删掉的旧东西**：没有按名字或按供应商给 GPT-6 定协议的名字表 / 特例分支（`git grep -n -i "gpt-6" -- electron ':!*.test.*'` 只有种子行、价目和 `seedModelIdentity.ts` 的旗舰身份名单，无协议判断）；漏斗里「整份替换 `meta`」的写法同提交换成按键合并。

## ★2 谁说了算

- **概念** `catalog.model-text-declaration`（第 1 刀登记）：协议唯一读法 `readModelDeclaration`、唯一写初值 `withModelDeclarationDefaults`；本刀新增的 `metaForUpsert`（`electron/catalog/modelDeclarationDefaults.ts`）是漏斗按键合并的唯一实现，只被 `applyModelUpsert` 调用。
- **「协议」归谁**：GPT-6 两行的协议由行 `meta.textProtocol` 一处说了算（写在 `apimartTexts.ts` 种子行上，`RESPONSES_DECLARATION` 一个常量，两行共用）；别处不得再按名字 / 供应商判协议。
- **回放归谁**：pi-ai（`openai-responses-shared.js`），我们不写。
- **「1」靠什么保持**：别处读不到别的来源（`nomiModelConfigFor` 只经 `readModelDeclaration`）+ 测试里「全部内置文本行：只有 Astra / Sol 带 `textProtocol`」的结构断言（反例 m4 红）+ 对拍。
- **门表**（`node scripts/door-map.mjs`）：`applyModelUpsert` 经 `upsertModelCatalogModel`、`mutateCatalog` 的 `tx.upsertModel`、`importModelCatalogPackage` 三个口进入，漏斗是它们共同的最早边界，修在这里；写入方后果表见 `tmp/I-gpt6-responses/callers.md`（本刀结论：没有一个写入方依赖「少带的声明键被冲掉」）。
- **不靠「东西不见了」猜意图**：是，没有。

## ★3 一致与复用

- **以前定过**：D-1122-model-meta-declaration（照做）；D-1122-gpt6-responses-no-ab（照做，不做 A/B）；D-1117-data-fix-no-version-bump（照做，不升目录版本、不加收据）；D-1031-old-users（照做）；D-1030-relay-ai-path（AI 接入写进来的行带不带 `textProtocol` 照现在的样子，漏斗按键合并后不会被冲掉）；D-1122-reasoning-protocol-delegated（读过 #1140 / #1477，无可直接用的协议部分，见 ★0）；D-1122-p0-whole-block-wording（这一整块归官方协议 + pi-ai，照它们做）。
- **三条路**：沿原方向修（继续留在 Chat 上给 GPT-6 打补丁）——官方文档写明工具调用必须走 Responses，否；**换做法（行声明一格 `textProtocol`，pi 的 Responses 路自带回放）——选**；删掉（不支持这两行）——创作者最想用的新模型直接没了，否。
- **方向检查**：`node scripts/fix-churn.mjs` 对本刀改动实跑：「方向检查：未命中热点」，所以提交说明不需要 `Direction-Check:` trailer。仍按 P1 自查：这一刀是换（整份替换 → 按键合并，同提交删掉整份替换的写法），不新增特例分支，名字 / 供应商判协议的特例一个都不加。
- **复用**：pi-ai 的 `openai-responses` 路（含回放）、第 1 刀的 `readModelDeclaration`、种子对账的 `curatedMeta` 补键、已有的本机假上游（`tests/agent-runtime/httpFixture.mts`，本刀只给它加一种「Responses 推理条目」输出，默认字节不变）。

## ★4 全状态

- 空（行上没声明）：协议 = 连接的协议，与今天一样；
- 成功：请求去 `/v1/responses`，推理条目回放；
- 失败（`meta.textProtocol` 形状不对）：读法当没声明，走连接的协议（第 1 刀已保证）；上游不认 `/v1/responses` 或拒绝回放（4xx）：报错原样给创作者，不静默回退到 Chat（回退 = 并行路径，且 Chat 上这两行工具调用本来就不被支持）；
- 加载 / 部分成功 / 取消中 / 过期：不适用：不碰请求的生命周期，取消链不变；
- 能力不可用：不适用：不新增要外部资源才做得了的动作。

## ★9 验收与回滚

**判据（两种没做成的版本都红，两种都红才往下做）**：
- 请求层与回放测试（`electron/agentLane/gpt6Responses.test.ts`；写目录的漏斗 / 升级 / 真实旧版目录几组按测试世界规矩放在目录主人的家 `electron/catalog/gpt6ResponsesUpgrade.test.ts`，合计 16 条）：Astra / Sol 各一条 Agent lane 多步任务（本机假上游：第 1、2 次响应各带一条推理条目 + 工具调用，第 3 次是文字）——3 次请求都去 `/v1/responses`，第 2 次请求里有第 1 次的推理条目、第 3 次里有前两次的，工具调用 2 次都对；单发也去 `/v1/responses` 且 pi 的 `api` 是 `openai-responses`；Terra / Luna 等同族行仍去 Chat；名字撞车的中转行（同名不同供应商）不被带着变；漏斗 / 升级 / 手选协议各有断言。
- 「什么都不做」（本分支去掉 `RESPONSES_DECLARATION` 等价于主线）：5 条失败 / 2 条通过（7 条），日志 `tmp/I-gpt6-responses/logs/red-1-do-nothing.log`，**红**。
- 「全部拦下」（Responses 请求一个都发不出去，反例 m5）：8 条失败，日志 `logs/m5-all-blocked.log`，**红**。
- 保险（`electron/agentLane/modelRequestParity.test.ts`）：82 行 × 4 路逐字节对拍，只重录这两行（网址 `/v1/chat/completions` → `/v1/responses`、请求体换成 Responses 形状：`messages` → `input`、`image_url` → `input_image` 等）；其余 80 行与主线金样零差异（`logs/merge-golden.log`、`logs/parity-before-after.txt`）。
- 付费走查（只写不跑真钱；取代要明文 Key 的旧冒烟脚本，已删）：`tests/ux/agent-gpt6-responses-real.paid.mjs`，经付费总闸 `_paidRun.mjs` 在真应用里跑，Key 由应用自己解密、脚本和人都不碰。免费演练命令：`NO_PROXY=127.0.0.1,localhost NOMI_TEST_NETWORK_GUARD=1 NOMI_PAID_REHEARSAL=no-key node tests/ux/agent-gpt6-responses-real.paid.mjs`。真付费命令：`NOMI_SPEND_OK=1 node tests/ux/agent-gpt6-responses-real.paid.mjs`（用本机真实资料里的 Key，不设 APIMART_API_KEY）；预计 3 次大脑请求。判据逐项打出（R1–R10）：请求都去 `/v1/responses`、恰好 3 次、两次响应各返回推理条目、第 2/3 次请求原样带回、都不带 `include`、中转站收了回放、两个工具结果都不是错误、最后一句话到了；上游一条推理条目都没返回时判「部分」、不算过。**付费走查这一条：未验证：等协调跑。**

**反例（改坏 → 红、还原 → 绿；脚本 `tmp/I-gpt6-responses/mutations.py`，每次还原后核对文件哈希）**：

| 反例 | 结果 | 证据 |
|---|---|---|
| m1 两行协议改回 Chat（去掉行声明） | 13 条失败 / 25：请求层、升级补键、漏斗、结构断言、对拍三路全红 | `logs/m1-rows-back-to-chat.log` |
| m2 回放条目被丢（发请求前删掉 `input` 里的 reasoning） | 2 条失败：两行的多步回放测试红（其余全绿，说明红的就是回放） | `logs/m2-replay-dropped.log` |
| m3 漏斗改回整份替换 | 5 条失败：声明被冲掉的 3 条单测 + 设置页保存后仍走 Responses 的 2 条 | `logs/m3-funnel-whole-replace.log` |
| m4 Terra 也带上声明（别的行被带着变） | 6 条失败：Terra 仍走 Chat、结构断言、对拍 4 路 | `logs/m4-sibling-carried.log` |
| m5 Responses 请求全部拦下 | 8 条失败：两行的 lane + 单发、对拍 4 路 | `logs/m5-all-blocked.log` |

还原后三组测试全绿（`logs/green-1.log` 之后再跑的最终结果见 PR 正文）。

**同类会从哪里回来**：新增一行也要走 Responses → 只写一格 `meta.textProtocol`，不改运行时；漏斗之外的写入方整份覆盖 `meta` → 只有漏斗一个写口，种子对账每次启动补键；新协议值 → `readModelDeclaration` 只认三种；旧版数据 → 老用户测试 + 退回证明；中转不回传推理条目 → 付费冒烟会判「部分」，那时再决定要不要给这两行加 `reasoning`（第 3 刀）。

**回滚**：revert 本提交；写进行里的 `textProtocol` 旧版不认识会忽略，不用清；金样同提交还原。

**独立验收**：本刀不属于四类，不强制；验收线编号由协调指派，不与实现线相同。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能
