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
