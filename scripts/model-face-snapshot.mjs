/**
 * 模型面的**逐字节快照**：20 个动词广播出去的那份 JSON Schema，加上说明书里模型读得到的每一句话。
 *
 * 为什么它要单独存在（不是 `check:tool-face` 的一部分）：那道门量的是语义与一致性（描述只有一个
 * owner、同组动词互相点名…），它**允许**字段与描述在满足那些规则的前提下变化。投影化这一刀换的是
 * 模型面的**真相源**（手写 → 从宿主契约 schema 派生），而换真相源的验收尺只有一条：**模型看到的东西
 * 逐字节没变**。这个模块就是那把尺子的序列化器，`check-model-face-frozen.mjs` 与交付证据都从它来。
 */
/** 键序稳定：对象按键名排序递归重建，数组保持原序（目录顺序是合同，见 `verbDeclarations.ts` 文件头）。 */
export function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) {
      const child = stableSort(value[key])
      if (child !== undefined) out[key] = child
    }
    return out
  }
  return value
}

/**
 * 一个动词的模型面 = 发布出去的 JSON Schema + 说明书里模型真正读得到的那几项。
 * 函数字段（`prepareArguments` / `semanticInputOf`）不进快照：它们不是模型看得到的东西。
 */
function modelFaceOf(verb, { toPublishedJsonSchema, toModelFacingToolSpec }) {
  const spec = toModelFacingToolSpec(verb)
  return stableSort({
    name: spec.name,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    promptGuidelines: spec.promptGuidelines ?? null,
    examples: spec.examples ?? null,
    effect: spec.effect,
    nextAction: spec.nextAction,
    effectGroups: spec.effectGroups ?? null,
    internalGroup: spec.internalGroup ?? null,
    profiles: spec.profiles ?? null,
    profileReason: spec.profileReason ?? null,
    contractId: spec.contractId,
    alsoCovers: spec.alsoCovers ?? null,
    aliasBoundInput: spec.aliasBoundInput ?? null,
    mcpTransportFields: spec.mcpTransportFields ?? null,
    execution: spec.execution,
    publishedJsonSchema: toPublishedJsonSchema(verb.schema),
  })
}

/** 全部 20 个动词的模型面，按目录顺序（顺序本身是合同：它是提示词与 `tools/list` 的前缀）。 */
export async function captureModelFace() {
  const { VERB_DECLARATIONS } = await import('../electron/shared/agentCapabilities/verbDeclarations.ts')
  const { toPublishedJsonSchema } = await import('../electron/shared/agentCapabilities/modelVisibleJsonSchema.ts')
  const { toModelFacingToolSpec } = await import('../electron/shared/agentCapabilities/modelFacingTools.ts')
  const tools = VERB_DECLARATIONS.map((verb) => modelFaceOf(verb, { toPublishedJsonSchema, toModelFacingToolSpec }))
  return { verbCount: tools.length, tools }
}

export function serializeModelFace(face) {
  return `${JSON.stringify(face, null, 2)}\n`
}
