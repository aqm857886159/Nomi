// 框架接触面门岗的判据本体（R29 第三份必交物，2026-09-07）。
//
// 它守的不变量：**框架公开的每一个字段，我们都对它下过一条裁决**——用了/派生了、当常量钉死了、
// 不用、还是让上游默认值站着。没下过裁决的字段 = 没人看过它。
//
// 起因（2026-09-07 真实事故）：`electron/agentLane/laneTools.mts:175` 对**所有**工具硬写
// `executionMode: 'sequential'`，而 pi 的 `AgentHarnessTool.executionMode` 是逐工具可选的。
// 同一个文件里 `replay` 已经改成从 `mutates` 派生了——**同一行的邻居做对了，这一行没有**。
// 而我们那天早上刚交了一份「参考实现逐层对照」文档（docs/research/2026-09-07-pi-reference-
// implementation-conformance.md），它一个字都没拦住：文档级的对照看的是**层**，看不见**字段**。
//
// 所以判据的粒度必须是字段，而且必须机器化——R28：能让门岗拦的别留给人。
//
// 为什么框架无关（2026-09-07 用户原话：「我希望这个事要成为通用的流程和规则，我们之后可能
// 不是 pi，那之后是其他怎么办？」）：本文件里没有一个 pi 的符号。要对照哪些类型、扫我们代码的
// 哪些锚点，全部来自 `docs/engineering/framework-boundaries.json` 的 `surface` 登记。
// 换框架 = 加一条登记，不改一行判据。

/** 五种裁决。只有这五种——「先不管」不是裁决，它必须写成带到期日的 debt。 */
export const VERDICTS = Object.freeze(['derived', 'constant', 'unused', 'upstream-default', 'debt'])

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/

/**
 * `constant` 的理由必须是领域约束，不是偏好（R29 逐层对照那条规矩的字段版）。
 * 机器判不了「这是不是领域约束」，但判得了「这是不是那几句最常见的偏好套话」——
 * 拦住套话，写的人就得真去想一句别的。
 */
const PREFERENCE_PHRASES = ['更简单', '简单一些', '当时就这么写', '风格', '习惯上', '个人偏好', '暂时先这样']

export const fieldKey = (frameworkId, typeName, field) => `${frameworkId}/${typeName}::${field}`

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 登记表校验。判的是**登记本身合不合法**，与代码无关——
 * 一条缺理由的 `constant` 和一条没登记的字段一样，都等于没人看过。
 */
export function validateSurfaceRegistry(registry) {
  const errors = []
  const frameworks = Array.isArray(registry?.frameworks) ? registry.frameworks : []
  if (frameworks.length === 0) return ['frameworks 必须是非空数组']
  let surfaces = 0
  for (const framework of frameworks) {
    const id = framework?.id
    if (!isNonEmptyString(id)) continue
    const surface = framework.surface
    if (surface === undefined) continue
    surfaces += 1
    if (typeof surface !== 'object' || surface === null) {
      errors.push(`${id}: surface 必须是对象`)
      continue
    }
    if (!Array.isArray(surface.scope) || surface.scope.length === 0) {
      errors.push(`${id}: surface.scope 必须列出要扫的代码路径前缀（锚点在哪儿找）`)
    }
    const sources = surface.sources
    if (!Array.isArray(sources) || sources.length === 0) {
      errors.push(`${id}: surface.sources 必须是非空数组`)
      continue
    }
    const seenType = new Set()
    for (const source of sources) {
      if (!isNonEmptyString(source?.package)) { errors.push(`${id}: surface.sources 每条必须写 package`); continue }
      if (!isNonEmptyString(source?.dtsPath)) { errors.push(`${id}/${source.package}: 必须写 dtsPath`); continue }
      const types = source.types
      if (!Array.isArray(types) || types.length === 0) {
        errors.push(`${id}/${source.package}: types 必须是非空数组（要对照哪些类型由登记给出）`)
        continue
      }
      for (const type of types) {
        errors.push(...validateType({ id, source, type, seenType }))
      }
    }
  }
  if (surfaces === 0) errors.push('至少要有一个框架登记 surface——否则这道门岗什么都不看')
  return errors
}

function validateType({ id, source, type, seenType }) {
  const errors = []
  const name = type?.name
  if (!isNonEmptyString(name)) return [`${id}/${source.package}: 每个类型必须有 name`]
  if (seenType.has(name)) errors.push(`${id}: 类型名重复：${name}`)
  seenType.add(name)
  const label = `${id}/${name}`
  if (!isNonEmptyString(type.why)) {
    errors.push(`${label}: why 必须写清「为什么这个类型的字段值得逐个裁决」`)
  }
  if (type.kind !== undefined && !['type', 'callParameter'].includes(type.kind)) {
    errors.push(`${label}: kind 只能是 "type"（具名类型）或 "callParameter"（某个导出函数的参数）`)
  }
  const anchors = type.anchors
  if (!Array.isArray(anchors)) {
    errors.push(`${label}: anchors 必须是数组（只消费不构造的类型写 []）`)
  } else {
    for (const anchor of anchors) {
      if (!['jsxElement', 'typeAnnotation', 'callArgument'].includes(anchor?.kind)) {
        errors.push(`${label}: anchor.kind 只能是 jsxElement / typeAnnotation / callArgument`)
      }
      if (!isNonEmptyString(anchor?.name)) errors.push(`${label}: anchor.name 必须写`)
    }
  }
  const fields = type.fields
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    errors.push(`${label}: fields 必须是「字段名 → 裁决」的对象`)
    return errors
  }
  // 没有锚点 = 这个类型我们只消费不构造（回调参数、钩子表：它们没有「对象字面量赋值点」可扫）。
  // 允许 anchors: []，但它买不到 `constant` 的免检——「这里钉了一个字面量」正是最该被机器复核的一句话。
  // `derived` 仍然允许，但降级核对：at 指的文件必须存在，且文件里必须出现这个字段名（见 evaluateSurface）。
  if (Array.isArray(anchors) && anchors.length === 0) {
    const claimed = Object.entries(fields)
      .filter(([, verdict]) => verdict?.verdict === 'constant')
      .map(([field]) => field)
    if (claimed.length > 0) {
      errors.push(`${label}: anchors 为空（只消费不构造），却有 ${claimed.length} 条 constant 裁决`
        + `（${claimed.slice(0, 5).join(', ')}${claimed.length > 5 ? ' …' : ''}）`
        + ' —— constant 声称的是「代码里钉了这个值」，没有锚点就核不了。补锚点，或改判 unused / debt')
    }
  }
  for (const [field, verdict] of Object.entries(fields)) {
    errors.push(...validateVerdict(`${label}.${field}`, verdict))
  }
  return errors
}

function validateVerdict(label, verdict) {
  const errors = []
  if (typeof verdict !== 'object' || verdict === null) return [`${label}: 裁决必须是对象`]
  const kind = verdict.verdict
  if (!VERDICTS.includes(kind)) {
    return [`${label}: verdict 必须是 ${VERDICTS.join(' / ')} 之一，收到 ${JSON.stringify(kind)}`]
  }
  if (kind === 'derived' && !isNonEmptyString(verdict.at)) {
    errors.push(`${label}: derived 必须写 at（派生点 file:line）——说不出在哪儿派生的，就不是派生`)
  }
  if (kind === 'constant') {
    if (verdict.value === undefined) errors.push(`${label}: constant 必须写 value（钉死的那个值）`)
    if (!isNonEmptyString(verdict.reason)) {
      errors.push(`${label}: constant 必须写 reason（**领域约束**级别的理由）`)
    } else {
      const hit = PREFERENCE_PHRASES.find((phrase) => verdict.reason.includes(phrase))
      if (hit) {
        errors.push(`${label}: constant 的 reason 命中偏好套话「${hit}」——`
          + '偏好不是理由（R29）。写清「不这么钉死会违反哪条领域约束」，否则就该判 debt')
      }
    }
  }
  if ((kind === 'unused' || kind === 'upstream-default') && !isNonEmptyString(verdict.why)) {
    errors.push(`${label}: ${kind} 必须写 why（为什么不接这颗开关）`)
  }
  if (kind === 'upstream-default' && verdict.default === undefined) {
    errors.push(`${label}: upstream-default 必须写 default（上游那个默认值是什么）——`
      + '说不出默认值，就不知道自己在依赖什么')
  }
  if (kind === 'debt') {
    if (!isNonEmptyString(verdict.owner)) errors.push(`${label}: debt 必须写 owner（谁在哪个阶段还）`)
    if (!isNonEmptyString(verdict.why)) errors.push(`${label}: debt 必须写 why（为什么现在裁不了）`)
    if (!isNonEmptyString(verdict.due) || !DATE_SHAPE.test(verdict.due)) {
      errors.push(`${label}: debt 必须写 due（YYYY-MM-DD）——登记是有时限的承诺，不是永久豁免（R28）`)
    }
  }
  return errors
}

/**
 * 逐字段比对。
 *
 * @param declared  Map<`${frameworkId}/${typeName}`, string[]>  从 `.d.ts` 机器抽出来的字段名
 * @param assignments Map<fieldKey, Array<{file,line,literal,text}>>  我们代码里对这个字段的赋值点
 * @param today     YYYY-MM-DD
 *
 * 四类红（对应 R29 第三份必交物的四条）：
 *   ① `.d.ts` 有、登记没有 —— 升级加了字段就会红，这正是要的那声警报；
 *   ② 登记 `derived`，代码里却是字面量（或压根没人赋值）—— 就是 executionMode 那条；
 *   ③ 登记有、`.d.ts` 已无 —— 陈旧登记，上游删了字段而我们还在对着空气裁决；
 *   ④ `debt` 过期。
 * 外加两条同族的：`constant` 的值和代码对不上、`unused`/`upstream-default` 其实被赋值了。
 */
export function evaluateSurface({ registry, declared, assignments, today, fileExists = () => true, readFile = () => null }) {
  const errors = []
  const warnings = []
  const stats = { fields: 0, byVerdict: Object.fromEntries(VERDICTS.map((v) => [v, 0])) }
  for (const framework of Array.isArray(registry?.frameworks) ? registry.frameworks : []) {
    const surface = framework?.surface
    if (!surface || !Array.isArray(surface.sources)) continue
    for (const source of surface.sources) {
      for (const type of Array.isArray(source.types) ? source.types : []) {
        const typeKey = `${framework.id}/${type.name}`
        const names = declared.get(typeKey)
        if (!names) {
          errors.push(`${typeKey}: 抽不出任何字段（${source.dtsPath} 里没有这个导出，或类型解析失败）`
            + ' —— 抽空了却放行，等于门岗静默失效，所以这里必须红')
          continue
        }
        const fields = type.fields ?? {}
        const declaredSet = new Set(names)
        for (const name of names) {
          if (Object.prototype.hasOwnProperty.call(fields, name)) continue
          errors.push(`${typeKey}.${name}: 上游有这个字段，登记表里没有它的裁决`
            + `\n      → ${source.package} 的接触面变了（升级加字段，或首次登记漏了）。`
            + '逐个裁决：derived / constant / unused / upstream-default / debt')
        }
        for (const [name, verdict] of Object.entries(fields)) {
          stats.fields += 1
          if (VERDICTS.includes(verdict?.verdict)) stats.byVerdict[verdict.verdict] += 1
          if (!declaredSet.has(name)) {
            errors.push(`${typeKey}.${name}: 登记表里有它，${source.package} 的 ${type.name} 已经没有这个字段`
              + ' —— 陈旧登记（上游删了/改名了），删掉这条或跟着改名')
            continue
          }
          const label = `${typeKey}.${name}`
          const anchoredType = Array.isArray(type.anchors) && type.anchors.length > 0
          if (verdict.verdict === 'derived' && isNonEmptyString(verdict.at)) {
            const at = verdict.at.split(':')[0]
            if (!fileExists(at)) {
              errors.push(`${label}: derived 的 at 指向的 ${at} 不存在 —— 指不到的派生点等于没派生`)
            } else if (!anchoredType) {
              // 只消费不构造的类型没有赋值点可扫，但「at 那个文件里连这个字段名都找不到」仍然抓得住
              // 最常见的那种陈旧：接线挪走了，登记还留在原处。核的是最后一段（`a.b.c` 核 `c`）。
              const segment = name.split('.').pop()
              const source = readFile(at)
              if (typeof source === 'string' && !source.includes(segment)) {
                errors.push(`${label}: derived 指向 ${verdict.at}，但那个文件里根本没有「${segment}」`
                  + ' —— 接线挪走了而登记留在原处（无锚点类型只核得到这一层，所以这一层必须核）')
              }
            }
          }
          // 没有锚点的类型是**我们只消费、不构造**的（回调参数、钩子表）。那种类型没有「赋值点」
          // 可扫，所以只核对字段清单与到期日；这条限制必须明说，不能让读者以为它也被逐行核过。
          const sites = anchoredType ? assignments.get(fieldKey(framework.id, type.name, name)) ?? [] : null
          if (sites) errors.push(...checkAgainstCode({ label, verdict, sites }))
          if (verdict.verdict === 'debt') {
            if (typeof verdict.due === 'string' && DATE_SHAPE.test(verdict.due) && verdict.due < today) {
              errors.push(`${typeKey}.${name}: debt 已于 ${verdict.due} 到期仍未裁（owner ${verdict.owner}）`
                + ' —— 要么下真裁决，要么带理由重定到期日')
            } else {
              warnings.push(`${typeKey}.${name}: 待裁（debt，${verdict.due} 到期，owner ${verdict.owner}）：${verdict.why}`)
            }
          }
        }
      }
    }
  }
  return { errors, warnings, stats }
}

function renderSites(sites) {
  return sites.map((site) => `${site.file}:${site.line} → ${site.text}`).join('；')
}

function checkAgainstCode({ label, verdict, sites }) {
  const errors = []
  const literals = sites.filter((site) => site.literal)
  const dynamic = sites.filter((site) => !site.literal)
  if (verdict.verdict === 'derived') {
    if (sites.length === 0) {
      errors.push(`${label}: 登记为 derived，但在 surface.scope 的锚点里找不到任何赋值`
        + ' —— 派生点已经没了（或 at 指向的代码被删了），改判 unused / upstream-default')
    } else if (dynamic.length === 0) {
      errors.push(`${label}: 登记为 derived，代码里却是**写死的字面量**：${renderSites(literals)}`
        + '\n      → 这就是本门岗存在的那条 bug（laneTools.mts:175 的 executionMode）：'
        + '框架逐项可选，我们对所有实例硬写同一个值。'
        + '\n      要么真的从输入派生，要么改判 constant 并给出领域约束级别的理由')
    }
  }
  if (verdict.verdict === 'constant') {
    if (dynamic.length > 0) {
      errors.push(`${label}: 登记为 constant，代码里其实是随输入变的：${renderSites(dynamic)}`
        + ' —— 改判 derived（裁决落后于代码，比没裁决更危险：它让人以为看过了）')
    } else if (literals.length === 0) {
      errors.push(`${label}: 登记为 constant（值 ${JSON.stringify(verdict.value)}），锚点里根本没人给它赋值`
        + ' —— 改判 unused / upstream-default')
    } else {
      const want = normalizeValue(String(verdict.value))
      if (!literals.some((site) => normalizeValue(site.text) === want)) {
        errors.push(`${label}: 登记的常量是 ${JSON.stringify(verdict.value)}，代码里写的是 ${renderSites(literals)}`
          + ' —— 有人改了值没改登记（登记漂移）')
      }
    }
  }
  if (verdict.verdict === 'debt' && dynamic.length > 0) {
    // 债还了要从账上销掉（棘轮只减不增，和 framework-boundary 的债基线同一条规矩）。
    // 不加这条的话，一格早已接好的字段会顶着「待裁」的黄一直挂到到期日，
    // 而黄字读起来和真欠着一模一样——那正是「登记漂移」最容易活下来的地方。
    errors.push(`${label}: 登记为 debt，代码里其实已经派生了：${renderSites(dynamic)}`
      + ' —— 这条债已经还了，把裁决改成 derived（债还了不销账 = 登记漂移）')
  }
  if ((verdict.verdict === 'unused' || verdict.verdict === 'upstream-default') && sites.length > 0) {
    errors.push(`${label}: 登记为 ${verdict.verdict}（不接这颗开关），代码里却在赋值：${renderSites(sites)}`
      + ' —— 陈旧裁决，改判 derived / constant')
  }
  return errors
}

/** 值比对只做空白归一 + 引号归一：`"Shift"` 与 `'Shift'` 是同一个值，`{ a: 1 }` 与 `{a:1}` 也是。 */
export function normalizeValue(text) {
  return String(text).replace(/"/g, "'").replace(/\s+/g, '').trim()
}
