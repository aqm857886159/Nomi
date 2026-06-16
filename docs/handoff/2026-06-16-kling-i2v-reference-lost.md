# 交接：可灵 i2v 参考图没用上（#4，需真实请求体复现）

> 2026-06-16 用户真机 bug。**严重（白烧额度）**：可灵 v3 图生视频，参考图 + 提示词，生成结果与两者**完全无关**。
> 用户已确认：生成那一刻**就是图生视频模式、图在槽里**（排除了「t2v 模式回落」假设）。

## 现象
- 模型：可灵 v3（modelKey `kling-v3`，archetypeId `kling-3.0`，经 apimart）。
- 操作：连一张「三体」图 → 视频节点（i2v 模式）+ 提示词「打击三体」。
- 结果：出了个无关的「功夫男人」视频。→ **图没进请求体**（最可能 image_urls 为空 → 可灵纯文生）。

## 已排除（静态追踪，全部"看着对"）
1. **键名四环一致**：i2v image_ref 槽 inputKey=`image_urls`（`kling.ts:57`）→ buildArchetypeInputParams 产 `image_urls`（`archetypeMeta.ts:277`）→ apimart Kling i2vBody 读 `{{request.params.image_urls}}`（`apimartVideos.ts:96`）→ 可灵真实 API 字段也是 `image_urls`。
2. **构造层 meta 路径已测**：`catalogTaskActions.test.ts` 的「接入即验证」遍历测试覆盖 kling i2v + 槽值进请求，**通过**。
3. **边图也传了**：`catalogTaskActions.ts:77` 把 `referenceImages`（meta+边超集）传给 buildArchetypeInputParams。
4. **边图收集不挑 mode**：resolver 只显式处理 first_frame/last_frame/style/character/composition_ref，**但** `collectNodeContext`（`nodeContext.ts`）收**所有上游** result.url（不看 edge.mode）→ resolver `:79` 推进 referenceImages。所以即便边是通用 'reference' mode，三体图也应进 referenceImages。
5. **本地化配了**：apimart 有 curated assetIngestion（upload-multipart `/v1/uploads/images`，`assetLocalization.ts:CURATED_ASSET_INGESTION`），nomi-local 图应被上传成 72h 公网 URL。

## 结论：静态全对 → 必须抓真实请求体（接入即验证）
所有路径都说 image_urls 应该有图。bug 在**运行时实际请求**，静态看不出。**下一步（定）**：
1. 真实 Kling v3 i2v 生成一次，**主进程埋点抓发给 apimart 的真实 body**（参考 `tests/ux/seedance-apimart.e2e.mjs` + memory `real-generation-e2e-loop`）。看 `image_urls`：
   - **为空** → 图在 resolver/构造前就丢了（复现时 dump `resolveGenerationReferences` 输出 + node.meta + edges）。重点查：边路径下 referenceImages 到底有没有三体图（collectNodeContext 实际收没收）。
   - **有但是 nomi-local://** → 本地化没在发送前跑（查 runtime 调 localizeAssetsForVendor 的时机 + 是否覆盖 archetypeInput.image_urls）。
   - **有且是公网 URL** → 可灵 vendor 侧没用上（对照官方 i2v 字段，可能要 image_url 单数 / 别的结构）。
2. 拿到真相再修根因 + 锁回归断言。**别静态盲修**（会白烧更多额度）。

## 相关 file:line
- 档案：`src/config/modelArchetypes/kling.ts:57`（i2v image_ref 槽）
- 构造：`src/workbench/generationCanvas/nodes/controls/archetypeMeta.ts:277`
- 边图传入：`runner/catalogTaskActions.ts:77`
- 上游收集：`model/nodeContext.ts` collectNodeContext + `runner/generationReferenceResolver.ts:79`
- catalog body：`electron/catalog/apimartVideos.ts:96`
- 本地化：`electron/catalog/assetLocalization.ts`（localizeAssetsForVendor + CURATED_ASSET_INGESTION.apimart）
- 真实 E2E 范式：`tests/ux/seedance-apimart.e2e.mjs`
