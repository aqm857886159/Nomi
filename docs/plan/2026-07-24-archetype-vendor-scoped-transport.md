# 档案投影不吞标准参考面（治「中转接档案名模型丢参考」整类）

## 背景 / 根因

微信用户反馈：通用中转站接入 `gpt-image-2`，接入测试能出图、同 key 其他软件能出图，唯独画布生成报「未开启生图功能」（中转侧报错）。复现料（用户中转配置+可读报错截图）拿不到，机制改为**全链路实追**钉死（下述每条都有 file:line）：

- 档案按**身份** pattern 匹配（`gptImage2.ts:28` identifierPatterns），**vendor-blind**——任何叫 gpt-image-2 的模型（含用户自定义中转拉取的）都被套上按 kie/apimart 契约写的档案。
- ~~模型名覆写~~（**初判有误，已实追证伪**）：中转模板的 model 钉 `{{model.modelKey}}`（`newapiTransport.ts:50/74/122`），原名照发；archetypeInput 的 kie 枚举名只进 params 袋、中转模板不引用 → 无害。
- **真害 = 档案投影吞掉标准参考键**：档案分支下 `referenceInputParams` 只返回 `{...archetypeInput}`（`electron/catalog/archetypeInput.ts:25`），gpt-image-2 的参考投成 kie 键 `input_urls`；而中转 i2i 模板吃的是 `reference_images`（multipart `newapiTransport.ts:133`）/ `chat_image_parts`（chat 多模态）→ **两个都空**。结果：中转上撞档案名的模型，图生图请求不带图发出（multipart 缺 image 被中转拒——「未开启生图功能」这类）或静默丢参考变文生图。
- 分叉解释「测试过、画布挂」：接入测试 = t2i 走 `/v1/images/generations`（不吃参考键）→ 过；画布常见用法 = 连参考图 i2i → 走 edits/chat 路带空图 → 挂。
- 另有次级污染：档案的 16 档 aspect_ratio/1K-2K-4K resolution 流进中转 paramMap，与拉取参数面不一致。

修法不依赖用户复现料：**标准参考面永远在场、档案投影叠加其上**（终版见「方案」；初版「vendor 门」被既有测试证伪，过程见「否决方案」）。通用中转链路对非档案名模型已被真机验证（relay-multipart 2026-07 真机 34s 出图），修完档案名模型走同一条被验证的键位。

## 事实核查（已实查，非记忆）

- kie 种子**不带**显式 `meta.archetypeId`（`kie*.ts` 全查无），全靠身份 pattern → 门控不能走「显式声明才生效」，会打断 kie。
- apimart/agnes/dreamina/modelscope/codex 等种子带显式 archetypeId；但节点 meta 残留（`meta.archetype` 记录）在换模型后仍可能指向旧档案（#52 已在换模型时清理，存量仍有）→ 门控必须 vendor 优先、盖过显式 id。
- `resolveArchetypeForModel` 调用点 17 处，5 处漏传 `vendorKey`（NodeGenerationComposer:261、generationRunController:419/439/452、nodeAssetDrop:44）→ 把 `vendorKey` 升为必传，编译器逼出全部调用点（P2：漏传致「发送路拿未特化档案、与 UI 分裂」这一类在类型层灭绝）。

## 方案（终版 —— 初版 vendor 门被既有测试证伪后转向，过程留痕见下「否决方案」）

**单一不变量：标准参考面永远在场，档案投影叠加其上、绝不独占参考通道。**

1. 渲染层 `buildReferenceExtras` 档案分支：补回标准 camelCase 面（`firstFrameUrl`/`lastFrameUrl`，
   `referenceImages` 原本就有）与 `archetypeInput` 并存；首/尾帧按**当前模式声明的槽**门控
   （活边优先、meta 兜底）——M2 互斥在标准面同样生效，否则「首帧模式残留尾帧」的 §2 坑2 会从
   标准键复活（kie 同名 token 渲进 body）。
2. electron `referenceInputParams`：标准键（`first_frame_url`/`reference_image_urls`/`reference_images`…）
   **先建**，`archetypeInput` `Object.assign` 叠加（同名键档案权威）。由此 `chat_image_parts`/
   `image_url`/multipart `reference_images` 对档案模型也能派生 → 中转改图带图、i2v 首帧进 wire。
   内置家零影响：它们的 body 只引用自家声明键（`input_urls`/`volcengine_*`…），多出的标准键不进 body。
3. `ArchetypeModelLike.vendorKey` 升必传（可 null）：曾 5 处调用点漏传 → 发送路拿未特化档案、与 UI 侧
   分裂；类型层逼全部调用点表态。generationRunController 三处顺势收口到 `resolveTaskArchetype` 单源。
   vendor **不改变解析结果**（供应商无关识别是设计特性）。
4. `comfyui-local` 特判维持在 `resolveTaskArchetype`（workflow 图纸模型永不套档案，PR#52 原语义）。

## 否决方案（试过、被证据推翻，留痕防再走弯路）

- **全局 vendor 授权门**（自定义中转一律不套档案）：实现后全量测试抓出反例——`seed-tts` 档案
  就是给「任意中转」写的（参数按 OpenAI 兼容 body 设计）、`useModelOptions.archetype.test`
  钉死「中转接 Seedance 同样注入档案控件」。档案在中转上是**故意的能力面**，病灶只是投影吞键，
  不是档案本身 → 撤门、改修投影层。
- **modelEnum 覆写致中转不认模型名**（我最初的机制判断）：实追证伪——中转模板 model 钉
  `{{model.modelKey}}`（newapiTransport.ts:50/74/122），枚举名进不了 body。

## 验收

1. 新回归测（两侧钉死不变量）：
   - 渲染层 `catalogTaskActions.test.ts`：中转 gpt-image-2 i2i → `archetypeInput.input_urls` 与标准
     `extras.referenceImages` 并存；kie 行为零变化；档案视频 first 模式 → 标准 `firstFrameUrl` 在场、
     残留尾帧仍被 M2 门掉。
   - electron `taskParams.test.ts`：`input_urls` 与 `reference_images`/`chat_image_parts`/`image_url`
     并存；同名键档案权威。
   - 解析层 `index.test.ts`：vendor 不改变解析（seed-tts/中转 Seedance 特性钉死）。
2. 既有全量测试全绿（内置家不受影响的证明；seedTts/useModelOptions 两套曾被 vendor 门打红=反例证据）。
3. 五门全过 → push main。

## 回滚

单 commit revert 即回原状；无数据迁移、无格式变更。
