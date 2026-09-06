// 框架边界门岗的判据本体（R29）。抽成 lib 是为了能被 node-test 直接喂假仓库，
// 而不用在真仓库里造违规文件——门岗自己的测试如果只能靠真实代码验证，它就永远只测得到
// 「今天的存量」，测不到「明天新增一条会不会红」。
//
// 判据形状（和 check:heavy-path / check:batch-machines 同一套棘轮）：
//   登记表（docs/engineering/framework-boundaries.json）声明「框架提供了什么能力」→
//   「仓库里出现哪些符号/路径就说明我们自己又写了一份」；
//   基线（scripts/framework-boundary-baseline.json）把现存的自研版本登记成**债**，只减不增，
//   每条债必须绑一份收敛方案文档和一个到期日——到期不清零就报红。
//
// 为什么身份要带命中数而不是只带路径：只存路径会放过「删掉这文件里的一处、同 commit 再加一处」。
// 为什么不存行号：行号随无关改动漂移，会让基线天天要改，改多了就没人看了。

const IDENTITY_SEPARATOR = '::'

/** 抹注释必须逐行等高（不改总行数，否则报出来的 file:line 点开是别的地方）。 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

export function identityOf(frameworkId, capabilityId, ruleId, file) {
  return `${frameworkId}/${capabilityId}/${ruleId}${IDENTITY_SEPARATOR}${file}`
}

function fail(message) {
  const error = new Error(message)
  error.isRegistryError = true
  return error
}

/** 登记表本身也要被拦：一条没有 provides/evidence 的规则等于没做过研究。 */
export function validateRegistry(registry) {
  const errors = []
  const frameworks = registry?.frameworks
  if (!Array.isArray(frameworks) || frameworks.length === 0) {
    errors.push('frameworks 必须是非空数组')
    return errors
  }
  const seenFramework = new Set()
  for (const framework of frameworks) {
    const id = framework?.id
    if (typeof id !== 'string' || !id.trim()) { errors.push('每个框架必须有 id'); continue }
    if (seenFramework.has(id)) errors.push(`框架 id 重复：${id}`)
    seenFramework.add(id)
    if (!Array.isArray(framework.packages) || framework.packages.length === 0) {
      errors.push(`${id}: packages 必须列出真实的包名`)
    }
    if (typeof framework.fourColumnTable !== 'string' || !framework.fourColumnTable.trim()) {
      errors.push(`${id}: fourColumnTable 必须指向那份「它提供/我们用了/我们另写了/我们拆散了」四列表`)
    }
    const capabilities = framework.capabilities
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      errors.push(`${id}: capabilities 必须是非空数组`)
      continue
    }
    const seenCapability = new Set()
    for (const capability of capabilities) {
      const capId = capability?.id
      if (typeof capId !== 'string' || !capId.trim()) { errors.push(`${id}: 每个能力必须有 id`); continue }
      if (seenCapability.has(capId)) errors.push(`${id}: 能力 id 重复：${capId}`)
      seenCapability.add(capId)
      const label = `${id}/${capId}`
      if (typeof capability.provides !== 'string' || !capability.provides.trim()) {
        errors.push(`${label}: provides 必须写清框架提供的是什么`)
      }
      if (typeof capability.evidence !== 'string' || !capability.evidence.trim()) {
        errors.push(`${label}: evidence 必须是 file:line 或文档 URL（研究结论要能被复核）`)
      }
      if (!Array.isArray(capability.scope) || capability.scope.length === 0) {
        errors.push(`${label}: scope 必须列出扫描路径前缀`)
      }
      const rules = capability.forbidden
      if (!Array.isArray(rules) || rules.length === 0) {
        errors.push(`${label}: forbidden 必须是非空数组`)
        continue
      }
      const seenRule = new Set()
      for (const rule of rules) {
        const ruleId = rule?.id
        if (typeof ruleId !== 'string' || !ruleId.trim()) { errors.push(`${label}: 每条规则必须有 id`); continue }
        if (seenRule.has(ruleId)) errors.push(`${label}: 规则 id 重复：${ruleId}`)
        seenRule.add(ruleId)
        if (typeof rule.why !== 'string' || !rule.why.trim()) {
          errors.push(`${label}/${ruleId}: why 必须写清「自研它会失去框架的什么」`)
        }
        try {
          new RegExp(rule.pattern, 'g')
        } catch {
          errors.push(`${label}/${ruleId}: pattern 不是合法正则：${rule.pattern}`)
        }
      }
    }
  }
  return errors
}

/**
 * 扫描。`sources` 是 Map<相对路径, 源码>，由调用方决定读哪些文件——
 * 这样测试可以喂一个三文件的假仓库，跑得比真扫描快，也不依赖真实代码长什么样。
 */
export function scanSources(sources, registry) {
  const hits = new Map()
  for (const framework of registry.frameworks) {
    for (const capability of framework.capabilities) {
      for (const rule of capability.forbidden) {
        const pattern = new RegExp(rule.pattern, 'g')
        for (const [file, raw] of sources) {
          if (!capability.scope.some((prefix) => file.startsWith(prefix))) continue
          const source = stripComments(raw)
          pattern.lastIndex = 0
          let match
          let count = 0
          let firstLine = 0
          while ((match = pattern.exec(source)) !== null) {
            count += 1
            if (count === 1) firstLine = source.slice(0, match.index).split('\n').length
            if (match[0] === '') pattern.lastIndex += 1
          }
          if (count === 0) continue
          hits.set(identityOf(framework.id, capability.id, rule.id, file), {
            identity: identityOf(framework.id, capability.id, rule.id, file),
            framework: framework.id,
            capability: capability.id,
            rule: rule.id,
            file,
            line: firstLine,
            hits: count,
            provides: capability.provides,
            why: rule.why,
          })
        }
      }
    }
  }
  return hits
}

/**
 * 启发式一条（2026-09-07 加，advisory 不阻断）：文件名或导出符号命中框架能力词 → 提醒。
 *
 * 为什么要它：上面的 forbidden 正则认的是**具体写法**（`SessionManager.inMemory(`），
 * 换个符号名重写一份同样的能力它一个都抓不到。词表认的是**这件事本身**——
 * 一个新文件叫 `sessionSnapshotStore.ts`、导出 `createRetryQueue`，不管它怎么写，
 * 都该有人问一句「框架里是不是已经有了」。
 *
 * 为什么只出 warning：这类启发式的死因是误报，一道天天红的门岗等于不存在（R17 教训）。
 * 升红的条件写死在登记表的 advisory.promotion 里，不靠谁记得。
 *
 * `files` = Map<相对路径, 源码>（只喂本次改动的文件）；`exemptions` = Set<相对路径>。
 */
export function advisoryCapabilityHits({ files, watchWords, exemptions = new Set() }) {
  const words = (watchWords ?? []).map((word) => String(word).toLowerCase()).filter(Boolean)
  if (words.length === 0) return []
  const notices = []
  for (const [file, raw] of files) {
    if (exemptions.has(file)) continue
    const source = stripComments(raw)
    const basename = file.split('/').pop() ?? file
    const symbols = new Set()
    for (const match of source.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      symbols.add(match[1])
    }
    const haystacks = [{ kind: '文件名', text: basename }, ...[...symbols].map((symbol) => ({ kind: '导出符号', text: symbol }))]
    const seen = new Set()
    for (const word of words) {
      for (const haystack of haystacks) {
        if (!haystack.text.toLowerCase().includes(word)) continue
        const key = `${word}::${haystack.text}`
        if (seen.has(key)) continue
        seen.add(key)
        notices.push({ file, word, kind: haystack.kind, where: haystack.text })
      }
    }
  }
  return notices
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 棘轮比对。四种红：
 *   ① 新增一份自研版本（命中不在债里）——这就是本门岗存在的理由；
 *   ② 同一处债变多（命中数超过登记数）——挡住「修一处、同 commit 加一处」；
 *   ③ 债已经还了/变少了，基线没跟着降——棘轮只减不增，降了必须写回来；
 *   ④ 债过期（due < today）或登记不全（缺 plan/due）——登记是有时限的收敛承诺，不是永久豁免（R28）。
 */
export function evaluate({ hits, baseline, today }) {
  const errors = []
  const debt = baseline?.debt
  if (!Array.isArray(debt)) return ['基线的 debt 必须是数组']
  const byIdentity = new Map()
  for (const entry of debt) {
    const identity = entry?.identity
    if (typeof identity !== 'string' || !identity.includes(IDENTITY_SEPARATOR)) {
      errors.push(`债条目缺少合法 identity：${JSON.stringify(entry)}`)
      continue
    }
    if (byIdentity.has(identity)) errors.push(`债条目重复：${identity}`)
    if (!Number.isInteger(entry.hits) || entry.hits < 1) errors.push(`${identity}: hits 必须是正整数`)
    if (typeof entry.plan !== 'string' || !entry.plan.trim()) {
      errors.push(`${identity}: plan 必须指向收敛方案文档（欠账没有方案 = 永久豁免）`)
    }
    if (typeof entry.due !== 'string' || !DATE_SHAPE.test(entry.due)) {
      errors.push(`${identity}: due 必须是 YYYY-MM-DD 到期日`)
    } else if (entry.due < today) {
      errors.push(`${identity}: 债已于 ${entry.due} 到期仍未清（方案 ${entry.plan}）——要么清掉，要么带理由重定到期日`)
    }
    byIdentity.set(identity, entry)
  }
  for (const hit of hits.values()) {
    const entry = byIdentity.get(hit.identity)
    if (!entry) {
      errors.push(`新增自研版本：${hit.file}:${hit.line} 命中 ${hit.framework}/${hit.capability}/${hit.rule}`
        + `\n      框架已提供：${hit.provides}\n      自研代价：${hit.why}`
        + '\n      先补四列表（R29）再谈写码；确属必要就登记进 scripts/framework-boundary-baseline.json 并绑方案与到期日')
      continue
    }
    if (Number.isInteger(entry.hits) && hit.hits > entry.hits) {
      errors.push(`${hit.identity}: 命中数从 ${entry.hits} 涨到 ${hit.hits}（棘轮只减不增）`)
    }
  }
  for (const [identity, entry] of byIdentity) {
    const hit = hits.get(identity)
    if (!hit) {
      errors.push(`基线里的债已不存在：${identity} —— 请从 scripts/framework-boundary-baseline.json 删掉这条（棘轮只减不增）`)
      continue
    }
    if (Number.isInteger(entry.hits) && hit.hits < entry.hits) {
      errors.push(`${identity}: 命中数已降到 ${hit.hits}，基线仍写 ${entry.hits} —— 请把基线降到 ${hit.hits}`)
    }
  }
  return errors
}

// ─── 第二份必交物：参考实现逐层对照（R29，2026-09-07 用户拍板）───────────────────
//
// 四列表回答的是「框架提供什么 / 我们用了没有」——它按**能力清单**走，而清单是我们自己列的，
// 天生只包含已经想到的那些。参考实现（框架自带的 coding agent、官方 example、demo 应用）
// 回答的是另一个问题：**一个把这套框架用对了的完整实现长什么样**。把它逐层拆开摆在旁边，
// 「我们压根没想到还有这一层」才会显形——那一格四列表永远不会有，因为没人会给自己不知道的东西列一行。
//
// 目标不是一致：桌面创作、审批花钱、画布/分镜/时间轴这些领域约束本来就要求我们不同。
// 目标是**每一处不同都是看过它的做法之后有理由地不同**，而不是没看过就自己长成了另一个样子。
// 所以判定只有三档，且「有意不同」必须给出领域约束级别的理由，「没想到」进实施阶段的前置门。

/** 九层。裁剪允许（不是每个框架都有全部九层），但只能从这九个里选，不许自造一层绕过。 */
export const REFERENCE_CONFORMANCE_LAYERS = Object.freeze([
  '工具',
  '转录渲染',
  '会话',
  '上下文',
  '模型与花费',
  '控制流',
  '扩展 API',
  '观测与测试',
  '安全',
])

/** 四列。少一列这张表就退化成读后感：没有「判定」就没有结论，没有「补在哪个阶段前」就没有下一步。 */
export const REFERENCE_CONFORMANCE_COLUMNS = Object.freeze([
  '它怎么做',
  '我们怎么做',
  '判定',
  '若没想到补在哪个阶段前',
])

const CONFORMANCE_HEADING = '参考实现逐层对照'
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function debtIndex(registry) {
  const index = new Map()
  const errors = []
  const debt = registry?.referenceConformanceDebt
  if (debt === undefined) return { index, errors }
  if (!Array.isArray(debt)) return { index, errors: ['referenceConformanceDebt 必须是数组'] }
  for (const entry of debt) {
    const id = entry?.id
    if (typeof id !== 'string' || !id.trim()) {
      errors.push(`referenceConformanceDebt 条目缺 id：${JSON.stringify(entry)}`)
      continue
    }
    if (index.has(id)) errors.push(`referenceConformanceDebt 条目重复：${id}`)
    index.set(id, entry)
  }
  return { index, errors }
}

function checkDebtEntry(entry, today, errors) {
  const id = entry.id
  if (typeof entry.doc !== 'string' || !entry.doc.trim()) {
    errors.push(`${id}: 债条目的 doc 必须指向那份对照文档将要落到的路径（欠账要指得出交付物）`)
  }
  if (typeof entry.why !== 'string' || !entry.why.trim()) {
    errors.push(`${id}: 债条目的 why 必须写清「为什么现在还没出这张表」`)
  }
  if (typeof entry.due !== 'string' || !DATE_ONLY.test(entry.due)) {
    errors.push(`${id}: 债条目的 due 必须是 YYYY-MM-DD 到期日（登记是有时限的承诺，不是永久豁免）`)
  } else if (entry.due < today) {
    errors.push(`${id}: 参考实现对照已于 ${entry.due} 到期仍未交（约定落点 ${entry.doc}）`
      + '——要么把表交出来，要么带理由重定到期日')
  }
}

/** 版本比较只做「数字段逐位比大小」，够用且不引依赖；比不动就当没落后（宁可漏报也不误报）。 */
export function isVersionBehind(recorded, installed) {
  if (typeof recorded !== 'string' || typeof installed !== 'string') return false
  const parse = (value) => {
    const core = value.trim().replace(/^[\^~>=<\s]+/, '').split(/[-+]/)[0]
    const parts = core.split('.').map((part) => Number.parseInt(part, 10))
    return parts.every((part) => Number.isInteger(part)) && parts.length > 0 ? parts : null
  }
  const a = parse(recorded)
  const b = parse(installed)
  if (!a || !b) return false
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return right > left
  }
  return false
}

/** 文档形状检查：标题在不在、声明的层在不在、四列在不在。判的是形式不是内容——内容归人验收。 */
export function checkConformanceDoc({ id, doc, layers, source }) {
  const errors = []
  if (!source.includes(CONFORMANCE_HEADING)) {
    errors.push(`${id}: ${doc} 里找不到「${CONFORMANCE_HEADING}」那一节（这张表就是本条登记的交付物）`)
  }
  for (const layer of layers) {
    if (!source.includes(layer)) errors.push(`${id}: ${doc} 缺「${layer}」这一层`)
  }
  for (const column of REFERENCE_CONFORMANCE_COLUMNS) {
    if (!source.includes(column)) {
      errors.push(`${id}: ${doc} 缺「${column}」这一列——四列少一列，表就退化成读后感`)
    }
  }
  return errors
}

/**
 * 参考实现对照的登记校验。
 *
 * `docExists(path) -> boolean`、`readDoc(path) -> string`、`installedVersions` = { 包名: 已装版本 }。
 * 全部由调用方注入，测试才能喂一个不存在的仓库跑完整判据（门岗自己的测试不许依赖真实存量）。
 *
 * 红：登记框架既没有 referenceConformance 又不在债里 / 债缺 doc·why·due 或已过期 /
 *     两边同时登记 / 已交的那份缺字段、文档不存在、文档缺层或缺列 / 裁剪出了九层之外的层 /
 *     capabilityInventory 里的包既没被任何框架覆盖又没登记成债。
 * 黄（advisory）：登记的 upstreamVersion 落后于 node_modules 里实装的版本。
 */
export function evaluateReferenceConformance({ registry, today, docExists, readDoc, installedVersions = {} }) {
  const errors = []
  const warnings = []
  const frameworks = Array.isArray(registry?.frameworks) ? registry.frameworks : []
  const { index: debt, errors: debtErrors } = debtIndex(registry)
  errors.push(...debtErrors)

  const covered = new Set()
  for (const framework of frameworks) {
    const id = framework?.id
    if (typeof id !== 'string' || !id.trim()) continue
    for (const pkg of Array.isArray(framework.packages) ? framework.packages : []) covered.add(pkg)

    const declared = framework.referenceConformance
    const owed = debt.get(id)
    if (owed && declared) {
      errors.push(`${id}: 既登记成债又声称已交（referenceConformance 与 referenceConformanceDebt 只能有一边）`)
      continue
    }
    if (owed) { checkDebtEntry(owed, today, errors); continue }
    if (!declared || typeof declared !== 'object') {
      errors.push(`${id}: 缺 referenceConformance —— 接框架的第二份必交物是「参考实现逐层对照」`
        + '（把它自带的 coding agent / 官方 example 逐层拆开摆在旁边）。'
        + '还没做就登记进 referenceConformanceDebt 并绑到期日，不许静默省掉')
      continue
    }
    const layers = Array.isArray(declared.layers) && declared.layers.length > 0
      ? declared.layers
      : REFERENCE_CONFORMANCE_LAYERS
    for (const layer of layers) {
      if (!REFERENCE_CONFORMANCE_LAYERS.includes(layer)) {
        errors.push(`${id}: layers 里的「${layer}」不在九层之内 —— 裁剪可以，自造一层绕过不行`)
      }
    }
    if (typeof declared.verifiedAt !== 'string' || !DATE_ONLY.test(declared.verifiedAt)) {
      errors.push(`${id}: referenceConformance.verifiedAt 必须是 YYYY-MM-DD（对照是有时效的：上游一发版就可能过期）`)
    }
    const recorded = declared.upstreamVersion
    if (typeof recorded !== 'string' || !recorded.trim()) {
      errors.push(`${id}: referenceConformance.upstreamVersion 必须写下对照时上游的版本号`)
    }
    const doc = declared.doc
    if (typeof doc !== 'string' || !doc.trim()) {
      errors.push(`${id}: referenceConformance.doc 必须指向那份对照文档`)
    } else if (!docExists(doc)) {
      errors.push(`${id}: referenceConformance.doc 指向的 ${doc} 不存在 —— 指不到的文档等于没写`)
    } else {
      errors.push(...checkConformanceDoc({ id, doc, layers, source: readDoc(doc) }))
    }

    for (const pkg of Array.isArray(framework.packages) ? framework.packages : []) {
      const installed = installedVersions[pkg]
      if (isVersionBehind(recorded, installed)) {
        warnings.push(`${id}: 对照做在 ${pkg}@${recorded}，node_modules 里已是 ${installed}`
          + ` —— 上游发版意味着参考实现可能变了，重跑一遍逐层对照并更新 verifiedAt/upstreamVersion`)
      }
    }
  }

  const inventory = registry?.capabilityInventory?.packages
  for (const pkg of Array.isArray(inventory) ? inventory : []) {
    if (covered.has(pkg)) continue
    const owed = debt.get(pkg)
    if (!owed) {
      errors.push(`${pkg}: 已经在用（capabilityInventory 里有它）却既没有框架登记也没有参考实现对照登记`
        + ' —— 出表或登记进 referenceConformanceDebt 绑到期日')
      continue
    }
    checkDebtEntry(owed, today, errors)
  }

  const known = new Set([...frameworks.map((framework) => framework?.id), ...(Array.isArray(inventory) ? inventory : [])])
  for (const id of debt.keys()) {
    if (!known.has(id)) {
      errors.push(`referenceConformanceDebt 里的 ${id} 既不是登记框架也不是 capabilityInventory 里的包`
        + ' —— 债只能欠在真实存在的东西上（清掉的债要从这里删，棘轮只减不增）')
    }
  }
  return { errors, warnings }
}
