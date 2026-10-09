// 对账(harness S6-3,N12 的命门)——「执行的」与「批准的」逐字段比对的纯函数。
// 输入全部显式传入(proposal 的 effectiveArgs + 执行结果 + 画布后态),同入参恒同结果,
// property test「任意批准重放→reconciliation 必 ok」可锁 CI。
// 派生字段白名单(显式声明,§6.3):position(批量网格由渲染层有意 derive,忽略 LLM 像素坐标)/
// categoryId(按 kind 归类,schema 不收 LLM 值)/title 兜底(空标题补「镜头 N」)。
// 白名单外的任何出入都如实报——尤其 modelKey/params 被校验丢弃(plannedNodeMeta 对不可用
// 模型/非法参数回退默认):用户在计划卡上看到并批准了那些 chip,执行悄悄换掉=必须可见。

import { textNodeBody, type TiptapDocShape } from '../../../../electron/shared/canvas/textNodeBody'

export type ReconcileDeviation = {
  /** 人话定位:哪个节点/哪条边(边用节点标题,不是原始 id)。 */
  where: string
  field: string
  expected: unknown
  actual: unknown
  /** 边没连上的人话原因(来自执行侧 skippedEdges:能力不支持/源不可参考/找不到节点)。 */
  reason?: string
  /**
   * 偏差类别(缺省=structure):
   * - structure：本文件结构对账产出(批准 vs 搭出来:连线/字段/模型/参数),detailLine 走「批准 vs 实际」;
   * - content：镜级画面校验(shotVerify)产出(身份/构图/连贯),detailLine 直接显 reason 人话,不套「批准 vs 实际」。
   * 两类共用同一张对账卡,但语气不同(结构=没按计划落地;内容=画面跟设定对不上)。
   */
  kind?: 'structure' | 'content'
  /** content 偏差回指的镜头节点 id(Stage 2 闭环据此决定回灌/重生哪几镜);structure 偏差不填。 */
  shotNodeId?: string
}

/** 执行侧 skip 原因码 → 人话(给对账卡显示「为什么没接上」)。 */
const SKIP_REASON_TEXT: Record<string, string> = {
  unsupported_reference: '所选模型不支持这种参考连接',
  source_not_referenceable: '源节点没有可作参考的产物',
  target_takes_no_input: '目标节点不收输入',
  dangling: '连接的一端节点找不到',
}

export type ReconcileResult = {
  ok: boolean
  deviations: ReconcileDeviation[]
}

export type ReconcileStepInput = {
  toolName: string
  effectiveArgs: Record<string, unknown>
  result: unknown
}

type NodeLike = {
  id: string
  kind: string
  title: string
  prompt?: string
  contentJson?: TiptapDocShape
  meta?: Record<string, unknown>
}

type EdgeLike = { source: string; target: string; mode?: string }

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

export function reconcileProposal(input: {
  steps: ReconcileStepInput[]
  clientIdToNodeId: Record<string, string>
  nodes: readonly NodeLike[]
  edges: readonly EdgeLike[]
  /**
   * clientId 跨提议解析回退（注入保持纯函数）：connect/set_prompt/delete 若在独立提议里
   * 引用前序提议的 clientId，本批 clientIdToNodeId 查不到 → 必须回退到执行侧同一个全局
   * registry（applyCanvasToolCall.resolveCanvasToolNodeId），否则对账拿计划 id 找不到
   * 真实边/节点，必然误报「执行与批准有出入」（2026-06-12 真机走查 bug A）。
   */
  resolveExternalId?: (raw: string) => string
  /**
   * 地基收口对账（audit 2026-06-16 §1c+§1d）：注入「按当前后态算出『显示出但无对应边』的孤儿数组参考」。
   * 数组参考收口到有序边后，显示出的每个 edge-origin 参考都必须有真实边——若出现「无边有图」的
   * meta-only 孤儿（不该再发生，因连线路径已不写 meta-only），如实报为偏差。注入保持本函数纯 + 不耦合
   * archetype 配置层（resolver 在 runner 层，调用方传入）。缺省（旧调用方/property test）→ 不查、零影响。
   */
  auditOrphanArrayReferences?: (
    nodes: readonly NodeLike[],
    edges: readonly EdgeLike[],
  ) => ReconcileDeviation[]
}): ReconcileResult {
  const deviations: ReconcileDeviation[] = []
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const resolveId = (raw: string): string =>
    input.clientIdToNodeId[raw] ?? input.resolveExternalId?.(raw) ?? raw
  // 边定位用节点标题(人话),缺标题/找不到节点才退原始 id。
  const labelFor = (id: string): string => {
    const title = nodeById.get(id)?.title
    return typeof title === 'string' && title.trim() ? title.trim() : id
  }
  const edgeWhere = (source: string, target: string): string => `「${labelFor(source)}」→「${labelFor(target)}」`
  // 从执行结果取本步跳过的边 + 原因(real id → reason 码),供「为什么没连上」显示。
  const skippedReasons = (result: unknown): Map<string, string> => {
    const map = new Map<string, string>()
    const arr = asRecord(result).skippedEdges
    if (Array.isArray(arr)) {
      for (const raw of arr) {
        const s = asRecord(raw)
        const src = String(s.source || '').trim()
        const tgt = String(s.target || '').trim()
        if (src && tgt) map.set(`${src}→${tgt}`, String(s.reason || ''))
      }
    }
    return map
  }

  const reconcileEdges = (planned: unknown[], skipped: Map<string, string>): void => {
    for (const raw of planned) {
      const edge = asRecord(raw)
      const source = resolveId(String(edge.sourceClientId || edge.source || '').trim())
      const target = resolveId(String(edge.targetClientId || edge.target || '').trim())
      if (!source || !target) continue
      const match = input.edges.find((candidate) => candidate.source === source && candidate.target === target)
      if (!match) {
        const code = skipped.get(`${source}→${target}`)
        deviations.push({
          where: edgeWhere(source, target),
          field: '引用边',
          expected: '已连接',
          actual: '未连接',
          ...(code ? { reason: SKIP_REASON_TEXT[code] ?? code } : {}),
        })
        continue
      }
      // T1：批准的边语义（mode）必须原样落地；计划未指定 mode 则通配（向后兼容旧轨迹）；
      // 落地侧 mode 缺省视作通用参考（'reference'），与计划里的显式 reference 等价。
      const plannedMode = typeof edge.mode === 'string' && edge.mode ? edge.mode : undefined
      if (plannedMode && (match.mode ?? 'reference') !== plannedMode) {
        deviations.push({ where: edgeWhere(source, target), field: '边语义', expected: plannedMode, actual: match.mode ?? '(通用参考)' })
      }
    }
  }

  for (const step of input.steps) {
    if (step.toolName === 'create_canvas_nodes') {
      const planned = Array.isArray(step.effectiveArgs.nodes) ? step.effectiveArgs.nodes : []
      planned.forEach((raw, index) => {
        const plan = asRecord(raw)
        const clientId = typeof plan.clientId === 'string' && plan.clientId ? plan.clientId : `#${index + 1}`
        const where = typeof plan.title === 'string' && plan.title.trim() ? plan.title.trim() : clientId
        const realId = input.clientIdToNodeId[clientId]
        const node = realId ? nodeById.get(realId) : undefined
        if (!node) {
          deviations.push({ where, field: '节点', expected: '已创建', actual: '不存在' })
          return
        }
        if (typeof plan.kind === 'string' && plan.kind !== node.kind) {
          deviations.push({ where, field: '类型', expected: plan.kind, actual: node.kind })
        }
        if (typeof plan.prompt === 'string' && plan.prompt !== (node.prompt ?? '')) {
          deviations.push({ where, field: '提示词', expected: plan.prompt, actual: node.prompt ?? '' })
        }
        // title:批准了非空标题必须原样落地;空标题的「镜头 N」兜底在白名单内。
        if (typeof plan.title === 'string' && plan.title.trim() && plan.title.trim() !== node.title) {
          deviations.push({ where, field: '标题', expected: plan.title.trim(), actual: node.title })
        }
        // 计划卡上用户过目的模型/参数 chip:执行被校验丢弃/替换 → 如实报(不在白名单)。
        const meta = asRecord(node.meta)
        if (typeof plan.modelKey === 'string' && plan.modelKey.trim() && meta.modelKey !== plan.modelKey.trim()) {
          deviations.push({ where, field: '模型', expected: plan.modelKey.trim(), actual: meta.modelKey ?? '(回退自动选)' })
        }
        const plannedParams = asRecord(plan.params)
        for (const [key, value] of Object.entries(plannedParams)) {
          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
          // 只在模型 meta 真写入的前提下比参数(模型整体回退时上面已报,参数不再逐个刷屏)。
          if (typeof plan.modelKey === 'string' && meta.modelKey === plan.modelKey.trim() && meta[key] !== value) {
            deviations.push({ where, field: `参数 ${key}`, expected: value, actual: meta[key] ?? '(默认值)' })
          }
        }
      })
      // 同计划携带的边（节点+边一次批准）：与节点同步对账，带上执行侧跳过原因。
      reconcileEdges(Array.isArray(step.effectiveArgs.edges) ? step.effectiveArgs.edges : [], skippedReasons(step.result))
      continue
    }

    if (step.toolName === 'connect_canvas_edges') {
      reconcileEdges(Array.isArray(step.effectiveArgs.edges) ? step.effectiveArgs.edges : [], skippedReasons(step.result))
      continue
    }

    if (step.toolName === 'set_node_prompt') {
      const nodeId = resolveId(String(step.effectiveArgs.nodeId || '').trim())
      const prompt = typeof step.effectiveArgs.prompt === 'string' ? step.effectiveArgs.prompt : ''
      const node = nodeById.get(nodeId)
      if (!node) deviations.push({ where: nodeId, field: '节点', expected: '存在', actual: '不存在' })
      else if ((node.prompt ?? '') !== prompt) {
        deviations.push({ where: node.title || nodeId, field: '提示词', expected: prompt, actual: node.prompt ?? '' })
      }
      continue
    }

    if (step.toolName === 'set_node_text') {
      const nodeId = resolveId(String(step.effectiveArgs.nodeId || '').trim())
      const node = nodeById.get(nodeId)
      const wanted = typeof step.effectiveArgs.text === 'string' ? step.effectiveArgs.text : ''
      if (!node) deviations.push({ where: nodeId, field: '节点', expected: '存在', actual: '不存在' })
      else {
        const actual = textNodeBody({ contentJson: node.contentJson })
        // 接在后面时只核对「新写的那段」落在正文末尾；覆盖则整段相等。
        const ok = step.effectiveArgs.mode === 'append' ? actual.endsWith(wanted.trim()) : actual === wanted.trim()
        if (!ok) deviations.push({ where: node.title || nodeId, field: '正文', expected: wanted, actual })
      }
      continue
    }

    if (step.toolName === 'delete_canvas_nodes') {
      const nodeIds = Array.isArray(step.effectiveArgs.nodeIds) ? step.effectiveArgs.nodeIds : []
      for (const raw of nodeIds) {
        const nodeId = resolveId(String(raw || '').trim())
        if (nodeId && nodeById.has(nodeId)) {
          deviations.push({ where: nodeId, field: '节点', expected: '已删除', actual: '仍存在' })
        }
      }
      continue
    }
  }

  // 地基收口断言：显示出的每个数组参考都有对应已提交边（治「无边有图」meta-only 孤儿，§1c）。
  if (input.auditOrphanArrayReferences) {
    deviations.push(...input.auditOrphanArrayReferences(input.nodes, input.edges))
  }

  return { ok: deviations.length === 0, deviations }
}
