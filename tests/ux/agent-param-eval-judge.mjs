// Agent 参数 / 重试题库的判分器。纯函数：输入「这题的轨迹 + 落下来的草稿计划」，输出逐项判定和三个数的原料。
// 不起 App、不读盘、不连模型，所以能被阳性 / 阴性对照单测夹住（agent-param-eval-judge.test.mjs）。
//
// 一把尺子只有一个家：
//   · 「参数被拒」「同一堵墙撞第几次」直接用 askback-trajectory.mjs 的 annotateRetries（与生产熔断同判据）；
//   · 「草稿计划」从 App 落盘的 `.nomi/runs/*/run.json` 的 generationPlan 读（宿主准入后的真相，不信 Agent 自述）。
//
// 参数键别名（ALIASES）是按目录常见写法猜的，不同模型的键名不同。某类题全红时先看结果里的
// `unmatchedParamKeys`：它列出该镜实际带了哪些参数键。键名对不上是仪器问题，不是产品结论。
import { annotateRetries } from './askback-trajectory.mjs'

/** 写入类工具（算「工具写对率」的分母）。generate 是请示卡，不是入参写入，不在里面。 */
export const WRITE_TOOLS = new Set([
  'draft_shots', 'write_node_text', 'arrange_canvas', 'stage_shot', 'make_artifact',
  'write_script', 'edit_timeline', 'undo', 'delete_from_canvas',
])
/** 「第一个写入动作」的候选：写入类 + generate。 */
const FIRST_WRITE_TOOLS = new Set([...WRITE_TOOLS, 'generate'])

const ALIASES = {
  duration: ['duration', 'durationSec', 'duration_seconds', 'seconds', 'video_duration', 'length'],
  aspect: ['aspect_ratio', 'aspectRatio', 'ratio', 'size', 'image_size', 'video_size'],
  resolution: ['resolution', 'quality', 'image_resolution', 'video_resolution'],
  audio: ['generate_audio', 'audio', 'with_audio', 'sound', 'enable_audio'],
  count: ['n', 'count', 'num_images', 'images', 'batch_size', 'num_outputs'],
}

const norm = (text) => String(text ?? '').trim().replace(/[。.．\s]+$/u, '')

function gcd(a, b) { return b === 0 ? a : gcd(b, a % b) }

/** "1280x720" / "1280*720" → "16:9"；"16:9" 原样；其余 null。 */
function ratioOf(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(text)) return text
  const pixels = /^(\d+)\s*[x*×]\s*(\d+)$/.exec(text)
  if (pixels) { const w = Number(pixels[1]); const h = Number(pixels[2]); const d = gcd(w, h); return `${w / d}:${h / d}` }
  return null
}

const normalizeResolution = (value) => {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '')
  return /^\d+$/.test(text) ? `${text}p` : text
}

/** 从一镜的 parameters 里读某类参数的落地值。读不到返回 undefined。 */
export function readParam(shot, kind) {
  const parameters = shot?.parameters ?? {}
  for (const key of ALIASES[kind]) {
    if (!(key in parameters)) continue
    const raw = parameters[key]
    if (kind === 'duration') { const number = Number.parseFloat(String(raw)); if (Number.isFinite(number)) return number }
    else if (kind === 'aspect') { const ratio = ratioOf(raw); if (ratio) return ratio }
    else if (kind === 'resolution') return normalizeResolution(raw)
    else if (kind === 'audio') { if (typeof raw === 'boolean') return raw; if (/^(true|false)$/i.test(String(raw))) return /^true$/i.test(String(raw)) }
    else if (kind === 'count') { const number = Number.parseInt(String(raw), 10); if (Number.isFinite(number)) return number }
  }
  return undefined
}

function sameValue(kind, actual, wanted) {
  if (actual === undefined) return false
  if (kind === 'duration' || kind === 'count') return Number(actual) === Number(wanted)
  if (kind === 'aspect') return ratioOf(actual) === ratioOf(wanted)
  if (kind === 'resolution') return normalizeResolution(actual) === normalizeResolution(wanted)
  return actual === wanted
}

function textMentions(text, value) {
  const needle = String(value).toLowerCase()
  const haystack = String(text ?? '').toLowerCase()
  if (haystack.includes(needle)) return true
  // "8k" 也认 "8 K"，"21:9" 也认 "21：9"
  return haystack.replace(/\s+/g, '').replace(/：/g, ':').includes(needle.replace(/\s+/g, ''))
}

/**
 * 从 `.nomi/runs/<id>/run.json` 的 JSON（`{run}` 或 run 本身）归一出镜头表。
 * 字段名集中在这一处：画布 / Run 格式变了只改这里。
 */
export function planShotsFromRun(runJson) {
  const run = runJson?.run ?? runJson
  const plan = run?.generationPlan
  if (!plan) return []
  const rows = Array.isArray(plan.shots) && plan.shots.length ? plan.shots : (plan.candidate ? [{ shotId: 'single', candidate: plan.candidate }] : [])
  return rows.map((row) => {
    const candidate = row.candidate ?? {}
    return {
      runId: run.runId ?? plan.operationId ?? null,
      shotId: row.shotId ?? null,
      title: row.title ?? candidate.title ?? null,
      prompt: String(candidate.prompt ?? ''),
      modelId: candidate.modelId ?? null,
      providerId: candidate.providerId ?? null,
      variantId: candidate.variantId ?? null,
      taskKind: row.taskKind ?? candidate.taskKind ?? null,
      parameters: candidate.parameters && typeof candidate.parameters === 'object' ? candidate.parameters : {},
      references: Array.isArray(candidate.references) ? candidate.references : [],
      included: row.included !== false,
    }
  })
}

/** 多份 Run 合成一张镜头表（按 createdAt 升序）。 */
export function planShotsFromRuns(runJsons) {
  const runs = runJsons.map((item) => item?.run ?? item).filter(Boolean)
  runs.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  return runs.flatMap((run) => planShotsFromRun(run))
}

function check(name, ok, detail) { return { name, ok: Boolean(ok), ...(detail ? { detail } : {}) } }

/** 一条参数期望对一镜判：landed / asked / explained / fail。 */
function judgeParam(spec, shot, ctx) {
  const actual = readParam(shot, spec.kind)
  const wanted = spec.oneOf ?? [spec.value]
  const landed = wanted.some((value) => sameValue(spec.kind, actual, value))
  if (landed) return { ok: true, how: 'landed', actual }
  if (spec.honest) {
    if (ctx.askedUser) return { ok: true, how: 'asked', actual }
    const mentionsAsked = wanted.some((value) => textMentions(ctx.finalText, value))
    const mentionsActual = actual === undefined || textMentions(ctx.finalText, actual)
    if (mentionsAsked && mentionsActual) return { ok: true, how: 'explained', actual }
    return { ok: false, how: 'silent-deviation', actual, unmatchedParamKeys: Object.keys(shot?.parameters ?? {}) }
  }
  return { ok: false, how: 'not-landed', actual, unmatchedParamKeys: Object.keys(shot?.parameters ?? {}) }
}

function judgeShotSpec(each, shot, ctx, label) {
  const out = []
  for (const spec of each.params ?? []) {
    const r = judgeParam(spec, shot, ctx)
    out.push(check(`${label}:${spec.kind}=${spec.oneOf ? spec.oneOf.join('|') : spec.value}`, r.ok, `${r.how}${r.actual !== undefined ? ` (实际 ${r.actual})` : ''}${r.unmatchedParamKeys ? ` 参数键 ${JSON.stringify(r.unmatchedParamKeys)}` : ''}`))
  }
  if (each.promptVerbatim !== undefined) out.push(check(`${label}:提示词逐字`, norm(shot.prompt) === norm(each.promptVerbatim), `实际「${shot.prompt}」`))
  if (each.promptContainsAll) {
    const missing = each.promptContainsAll.filter((word) => !shot.prompt.toLowerCase().includes(word.toLowerCase()))
    out.push(check(`${label}:提示词保留要素`, missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : undefined))
  }
  if (each.promptLongerThan !== undefined) out.push(check(`${label}:按要求润色（比原文长）`, shot.prompt.length > each.promptLongerThan, `长度 ${shot.prompt.length}`))
  if (each.modelLike) out.push(check(`${label}:点名模型`, new RegExp(each.modelLike, 'i').test(`${shot.modelId ?? ''} ${shot.title ?? ''}`), `实际 ${shot.modelId}`))
  if (each.variantLike) out.push(check(`${label}:点名变体`, new RegExp(each.variantLike, 'i').test(shot.variantId ?? ''), `实际 ${shot.variantId}`))
  if (each.refsMin !== undefined) out.push(check(`${label}:参考素材≥${each.refsMin}`, shot.references.length >= each.refsMin, `实际 ${shot.references.length}`))
  return out
}

/**
 * @param {object} input
 * @param {object} input.task        题库里的一题
 * @param {Array}  input.calls       这一题「被测那句话」之后的工具调用（含入参 / isError / resultText），按时序
 * @param {string} input.finalText   这一题最后一条助手正文
 * @param {Array}  input.shotsBefore 被测那句话之前的镜头表（预演之后）
 * @param {Array}  input.shotsAfter  结束时的镜头表
 * @param {string[]} input.cardsAnswered 跑器答过的卡（'spend:declined' 等）
 */
export function judgeTask({ task, calls, finalText = '', shotsBefore = [], shotsAfter = [], cardsAnswered = [] }) {
  const expect = task.expect ?? {}
  const annotated = annotateRetries(calls.map((call) => ({
    toolCallId: call.toolCallId ?? call.id, name: call.name, args: call.args, isError: call.isError === true,
    resultText: call.resultText ?? call.text ?? '', hasResult: true,
  })))
  const writes = annotated.filter((call) => WRITE_TOOLS.has(call.name))
  const writesAccepted = writes.filter((call) => call.errorKind !== 'arg_rejected')
  // 重试：同一工具、上一次调用被拒后的再次调用。
  let retries = 0
  const lastRejected = new Map()
  for (const call of annotated) {
    if (lastRejected.get(call.name) === true) retries += 1
    lastRejected.set(call.name, call.isError)
  }
  const burst3 = annotated.some((call) => call.isError && call.attempt >= 3)
  const askedUser = annotated.some((call) => call.name === 'ask_user')
  const ctx = { askedUser, finalText }
  const checks = []

  const firstWrite = annotated.find((call) => FIRST_WRITE_TOOLS.has(call.name) || call.name === 'ask_user')
  if (expect.firstWrite === 'none') {
    checks.push(check('只问不做：没有写入类调用', writes.length === 0 && !annotated.some((c) => c.name === 'generate'), writes.map((c) => c.name).join(',')))
  } else if (expect.firstWrite) {
    // 允许先读后写：读类工具（look_at_*、list_models、read_*）出现在 firstWrite 白名单里就算对路；
    // 但必须有至少一个白名单里的写入类动作，或者合法地转问。
    const wroteExpected = annotated.some((call) => expect.firstWrite.includes(call.name) && (FIRST_WRITE_TOOLS.has(call.name)))
    checks.push(check('选对工具', wroteExpected || (askedUser && expect.allowAsk !== false), `首个动作 ${firstWrite?.name ?? '无'}`))
    const firstActual = annotated.find((call) => FIRST_WRITE_TOOLS.has(call.name))
    if (firstActual) checks.push(check('第一个写入动作在白名单内', expect.firstWrite.includes(firstActual.name), firstActual.name))
  }
  for (const name of expect.mustCall ?? []) checks.push(check(`调用了 ${name}`, annotated.some((c) => c.name === name)))
  for (const name of expect.mustCallAccepted ?? []) checks.push(check(`${name} 至少一次被准入`, annotated.some((c) => c.name === name && !c.isError)))
  if (expect.noGenerate) checks.push(check('说了先别生成就不调 generate', !annotated.some((c) => c.name === 'generate')))
  if (expect.spendCardShown) checks.push(check('停在付费确认卡', cardsAnswered.some((card) => card.startsWith('spend'))))
  if (expect.retryMax !== undefined) checks.push(check(`重试≤${expect.retryMax}`, retries <= expect.retryMax, `实际 ${retries}`))
  checks.push(check('同一错误未连发 3 次', !burst3))

  // 草稿计划
  const resolvedByAsk = askedUser
  const plan = expect.plan
  if (plan) {
    const included = shotsAfter.filter((shot) => shot.included)
    if (plan.count !== undefined) {
      const okCount = included.length === plan.count
      checks.push(check(`镜头数=${plan.count}`, okCount || (resolvedByAsk && included.length === 0), `实际 ${included.length}`))
    }
    if (plan.countOrParam) {
      const wanted = plan.countOrParam.value
      const byShots = included.length === wanted
      const byParam = included.length >= 1 && included.every((shot) => sameValue('count', readParam(shot, 'count'), wanted))
      checks.push(check(`张数=${wanted}（镜头数或 count 参数）`, byShots || byParam || (resolvedByAsk && included.length === 0), `镜头数 ${included.length}`))
    }
    if (plan.sameModel) checks.push(check('全部镜头同一模型', new Set(included.map((s) => `${s.providerId}/${s.modelId}`)).size === 1 && included.length > 0))
    if (plan.each) {
      if (!included.length && !resolvedByAsk) checks.push(check('有草稿可核', false, '没有任何镜头落下来，也没转问'))
      included.forEach((shot, index) => checks.push(...judgeShotSpec(plan.each, shot, ctx, `镜${index + 1}`)))
    }
  }

  // 改已有镜头：只许动被点名的那一镜的那些字段
  const edit = expect.edit
  if (edit) {
    const targetBefore = shotsBefore[edit.shotIndex]
    const targetAfter = shotsAfter[edit.shotIndex]
    checks.push(check('镜头数没变', shotsAfter.length === shotsBefore.length, `前 ${shotsBefore.length} 后 ${shotsAfter.length}`))
    if (!targetAfter) checks.push(check('目标镜头还在', false))
    else {
      checks.push(...judgeShotSpec({ params: edit.params, promptVerbatim: edit.promptVerbatim }, targetAfter, ctx, `镜${edit.shotIndex + 1}`))
      for (const field of edit.unchangedFields ?? []) {
        checks.push(check(`镜${edit.shotIndex + 1}:${field} 没被顺带改`, targetBefore && JSON.stringify(targetBefore[field]) === JSON.stringify(targetAfter[field]), `前 ${JSON.stringify(targetBefore?.[field])} 后 ${JSON.stringify(targetAfter[field])}`))
      }
      for (const kind of edit.unchangedParams ?? []) {
        checks.push(check(`镜${edit.shotIndex + 1}:${kind} 没被顺带改`, targetBefore && readParam(targetBefore, kind) === readParam(targetAfter, kind), `前 ${readParam(targetBefore ?? {}, kind)} 后 ${readParam(targetAfter, kind)}`))
      }
    }
    if (edit.othersUnchanged) {
      const changed = shotsBefore.map((shot, index) => index).filter((index) => index !== edit.shotIndex
        && JSON.stringify([shotsBefore[index].prompt, shotsBefore[index].parameters, shotsBefore[index].modelId])
          !== JSON.stringify([shotsAfter[index]?.prompt, shotsAfter[index]?.parameters, shotsAfter[index]?.modelId]))
      checks.push(check('别的镜头没被动', changed.length === 0, changed.length ? `被动了：镜${changed.map((i) => i + 1).join(',')}` : undefined))
    }
  }

  // 越界取值：不许落下越界值；落了合法值 / 转问 / 明说，三选一
  if (expect.boundary) {
    const { kind, value } = expect.boundary
    const landedBad = shotsAfter.filter((shot) => shot.included && sameValue(kind, readParam(shot, kind), value))
    checks.push(check(`没有把越界的 ${kind}=${value} 落到草稿`, landedBad.length === 0 || textMentions(finalText, value), landedBad.length ? `镜${landedBad.length} 带了越界值，正文${textMentions(finalText, value) ? '说明了' : '没说'}` : undefined))
    const anyShot = shotsAfter.some((shot) => shot.included)
    const explained = textMentions(finalText, value)
    checks.push(check('收尾：落了合法值、或转问、或明说做不到', anyShot || resolvedByAsk || explained, '没草稿、没转问、正文没提这个值'))
  }

  const passed = checks.every((item) => item.ok)
  return {
    id: task.id,
    passed,
    checks,
    failed: checks.filter((item) => !item.ok).map((item) => item.name),
    writeCalls: writes.length,
    writeAccepted: writesAccepted.length,
    retries,
    burst3,
    askedUser,
    calls: annotated.map((c) => `${c.name}${c.isError ? '✗' : ''}`),
  }
}

/** 汇总三个数 + 分类。`results` = judgeTask 的输出（可判的题）；`unscorable` = 起始态搭不起来的题 id。 */
export function summarize(results, unscorable = [], tasks = []) {
  const n = results.length
  const writes = results.reduce((s, r) => s + r.writeCalls, 0)
  const accepted = results.reduce((s, r) => s + r.writeAccepted, 0)
  const retries = results.reduce((s, r) => s + r.retries, 0)
  const ratio = (a, b) => (b === 0 ? null : a / b)
  const familyOf = new Map(tasks.map((t) => [t.id, t.family]))
  const catalogDependent = new Set(tasks.filter((t) => t.catalogDependent).map((t) => t.id))
  const byFamily = {}
  for (const r of results) {
    const family = familyOf.get(r.id) ?? '?'
    byFamily[family] ??= { tasks: 0, passed: 0 }
    byFamily[family].tasks += 1
    if (r.passed) byFamily[family].passed += 1
  }
  const withoutCatalog = results.filter((r) => !catalogDependent.has(r.id))
  return {
    scoredTasks: n,
    unscorableTasks: unscorable,
    toolWriteRate: { value: ratio(accepted, writes), accepted, total: writes },
    turnSuccessRate: { value: ratio(results.filter((r) => r.passed).length, n), passed: results.filter((r) => r.passed).length, total: n },
    turnSuccessRateWithoutCatalogDependent: { value: ratio(withoutCatalog.filter((r) => r.passed).length, withoutCatalog.length), total: withoutCatalog.length },
    avgRetries: { value: ratio(retries, n), total: retries, max: Math.max(0, ...results.map((r) => r.retries)) },
    sameErrorBurst3Tasks: results.filter((r) => r.burst3).map((r) => r.id),
    byFamily,
  }
}

const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`)
export function formatSummary(summary) {
  return [
    `工具写对率   ${pct(summary.toolWriteRate.value)}  (${summary.toolWriteRate.accepted}/${summary.toolWriteRate.total} 次写入一次过准入)`,
    `回合成功率   ${pct(summary.turnSuccessRate.value)}  (${summary.turnSuccessRate.passed}/${summary.turnSuccessRate.total} 题整题通过；去掉依赖目录的题 ${pct(summary.turnSuccessRateWithoutCatalogDependent.value)})`,
    `平均重试数   ${summary.avgRetries.value === null ? 'n/a' : summary.avgRetries.value.toFixed(2)}  (共 ${summary.avgRetries.total} 次，单题最多 ${summary.avgRetries.max})`,
    `同一错误连发≥3次的题  ${summary.sameErrorBurst3Tasks.length} 题 ${summary.sameErrorBurst3Tasks.join(',')}`,
    `不可判（起始态没搭起来） ${summary.unscorableTasks.length} 题 ${summary.unscorableTasks.join(',')}`,
    ...Object.entries(summary.byFamily).map(([family, v]) => `  ${family}: ${v.passed}/${v.tasks}`),
  ].join('\n')
}
