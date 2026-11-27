// 协调确认记录（2026-10-21，V-gates 复验 B1 / B4）：合同类数据（性能预算政策、拍板清单）不能由 PR 自己批准。
// 批准身份只能来自 base（main）上已有的内容，或协调在本机留下的确认记录——一个本机 JSONL 文件，路径取环境变量 NOMI_COORD_APPROVALS，不写死、不进仓库。
// 每条记录：{ pr, kind: 'board' | 'perf-policy' | 'eslint-suppressions', name, sha256, at, note }；sha256 是 PR head 上被批准内容的哈希，
// 批准之后内容又改了，哈希就对不上，重新判红。记录用 scripts/coord-approve.mjs 写（只给协调用）。
// CI 读不到本机文件：同一批检测只打「待协调确认」警告；merge-preflight（协调本机）没有匹配记录就红。
import crypto from 'node:crypto'
import fs from 'node:fs'

export const APPROVAL_ENV = 'NOMI_COORD_APPROVALS'
export const APPROVAL_KINDS = Object.freeze(['board', 'perf-policy', 'eslint-suppressions', 'generated-allowlist'])

/** 键排序的规范化 JSON：同一份内容永远同一个哈希。 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const sha256Of = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')

// ── 合同文件的批准范围：默认全拦（2026-10-22 用户拍板方案 A，V-gates 第 2 轮 R2-B1 / R2-B2 后）──────────────────────
// 旧做法是「默认放行」：由 PR 自报的认领集合 + 一份我们列出来的要保护的字段 / 元素决定，没列到的就漏（删除、板级字段、没被认领的新元素），补不完。
// 现在反过来：合同文件（板文件、场景文件）按 base 与 head 的**整份规范化内容**对比；先剥掉白名单里允许 PR 自改的字段，
// 剩下的任何差异（新增、删除、板级字段、以后新加的任何字段）都要协调确认，哈希绑定整份规范化后的内容。
// 要确认的集合由真实 diff 构造，不看 PR 认领了什么（认领只用来关联实现验收）。

/** 板的白名单：元素的实现进度字段，实现线推进时合理会改。其余（含板级字段 decor / functionCensus / 设计来源 / stage、元素的用户原话）全算合同。 */
export const BOARD_PROGRESS_FIELDS = Object.freeze(['status', 'assertion', 'owner'])

/**
 * 板级 stage 只放行一种前进（协调 2026-10-22 定）：base 是「已拍板」阶段、head 是 built——和元素的 status 一样属于实现进度，不用确认。
 * 「已拍板」阶段 = approved，以及仓库现行词表里的 explored（check-board-parity 的 BOARD_STAGES 只有 explored / built，explored 的板都带 approvedOn，即已拍板、待实现）。
 * 其余任何 stage 变化都要确认，尤其是改成 approved（代表用户拍板，只能来自确认记录）、built 退回前面。
 */
export const STAGES_BEFORE_BUILT = Object.freeze(['approved', 'explored'])
export const stageProgressAllowed = (baseStage, headStage) => headStage === 'built' && STAGES_BEFORE_BUILT.includes(baseStage)

/** 剥掉白名单字段、规范化（元素按 id 排序）后的板内容。 */
export function normalizeBoard(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest ?? null
  const out = { ...manifest }
  if (Array.isArray(manifest.elements)) {
    out.elements = manifest.elements
      .map((element) => {
        if (!element || typeof element !== 'object') return element
        const copy = { ...element }
        for (const key of BOARD_PROGRESS_FIELDS) delete copy[key]
        return copy
      })
      .sort((a, b) => String(a?.id).localeCompare(String(b?.id)))
  }
  return out
}

const withoutElements = (board) => Object.fromEntries(Object.entries(board ?? {}).filter(([key]) => key !== 'elements'))
const sameContent = (a, b) => canonicalJson(a) === canonicalJson(b)

/**
 * 一张板在 PR 里的合同差异（整份对比）。baseManifest / headManifest 任一为 null/undefined = 那一边没有这张板。
 * 返回 { needsApproval, added, removed, changed, boardLevel, isNewBoard, isRemovedBoard, fingerprint }：
 *   added / removed / changed = 新增 / 删除 / 合同变了的元素 id；boardLevel = 除 elements 外的板级字段变了；
 *   fingerprint = 整份规范化后的 head 内容的哈希（删板时是「删除」标记的哈希），批准记录的 sha256 就是它；内容再变一个字，哈希就对不上。
 */
export function boardApprovalSubject(name, baseManifest, headManifest) {
  let base = normalizeBoard(baseManifest ?? null)
  const head = normalizeBoard(headManifest ?? null)
  // 唯一放行的 stage 前进（已拍板 → built）按实现进度处理：比较时把 base 的 stage 对齐到 head
  if (base && head && stageProgressAllowed(base.stage, head.stage)) base = { ...base, stage: head.stage }
  const baseElements = new Map((base?.elements ?? []).map((element) => [element?.id, element]))
  const headElements = new Map((head?.elements ?? []).map((element) => [element?.id, element]))
  const added = [...headElements.keys()].filter((id) => !baseElements.has(id))
  const removed = [...baseElements.keys()].filter((id) => !headElements.has(id))
  const changed = [...headElements.keys()].filter((id) => baseElements.has(id) && !sameContent(baseElements.get(id), headElements.get(id)))
  const baseLevel = withoutElements(base)
  const headLevel = withoutElements(head)
  const boardLevel = !sameContent(baseLevel, headLevel)
  const needsApproval = !sameContent(base, head)
  return {
    needsApproval,
    added,
    removed,
    changed,
    boardLevel,
    isNewBoard: !base && !!head,
    isRemovedBoard: !!base && !head,
    // 兼容旧字段：所有有差异的元素 id（新增 + 删除 + 改动）
    changedIds: [...added, ...removed, ...changed],
    fingerprint: sha256Of({ board: name, content: head, removed: !head }),
  }
}

/** 人话描述一张板的差异（确认提示用）。 */
export function describeBoardDiff(subject) {
  const parts = []
  if (subject.isNewBoard) parts.push('是 PR 新增的板')
  else if (subject.isRemovedBoard) parts.push('被 PR 整张删掉')
  else {
    if (subject.added.length) parts.push(`新增了元素（${subject.added.join('、')}）`)
    if (subject.changed.length) parts.push(`改了合同的元素（${subject.changed.join('、')}）`)
    if (subject.removed.length) parts.push(`删了元素（${subject.removed.join('、')}）`)
    if (subject.boardLevel) parts.push('改了板级字段（decor / functionCensus / 设计来源 / stage 等）')
  }
  return parts.join('；')
}

// ── ESLint 批量抑制（eslint-suppressions.json）的冻结数上涨：2026-10-22 协调定，同 board / perf ─────────────────────
// 冻结数只许减少；涨了（新开规则 / 扩大覆盖面把存量冻进来）要协调确认。「涨」按**文件 × 规则**算：任何一个文件里任何一条规则的冻结数
// 比 base 多就要确认——按规则总数算会让「这里修一处、那里新冻一处」总数不变混进来（V-gates-g1 窄核）。改名 / 搬家也要确认，接受。
// 确认绑定的是**上涨的那部分 diff**：每个 (文件, 规则) 冻结数比 base 多的条目。之后再多冻一处，哈希就对不上；只减少不影响。
export const SUPPRESSIONS_FILE = 'eslint-suppressions.json'
export const GENERATED_ALLOWLIST_PATH = 'docs/engineering/generated-allowlist.json'

export function allowlistApprovalSubject(baseAllowlist, headAllowlist) {
  const baseGlobs = new Set(Array.isArray(baseAllowlist) ? baseAllowlist.map((entry) => String(entry?.glob ?? '').trim()).filter(Boolean) : [])
  const addedGlobs = [...new Set((Array.isArray(headAllowlist) ? headAllowlist : [])
    .map((entry) => String(entry?.glob ?? '').trim())
    .filter((glob) => glob && !baseGlobs.has(glob)))].sort()
  return {
    needsApproval: addedGlobs.length > 0,
    addedGlobs,
    fingerprint: sha256Of({ subject: GENERATED_ALLOWLIST_PATH, added: addedGlobs }),
  }
}

export function resolveEffectiveAllowlist({ files = [], baseAllowlist = undefined, headAllowlist = undefined, fallbackAllowlist = [], approvals = null } = {}) {
  const touched = files.some((file) => String(file?.path ?? '').replaceAll('\\', '/') === GENERATED_ALLOWLIST_PATH)
  const base = baseAllowlist ?? (touched ? [] : fallbackAllowlist)
  if (!touched && headAllowlist === undefined) return { allowlist: base, headAllowlist: undefined, unapprovedGlobs: [] }
  if (!Array.isArray(headAllowlist)) return { allowlist: base, headAllowlist, unapprovedGlobs: [] }
  const subject = allowlistApprovalSubject(base, headAllowlist)
  const approved = !subject.needsApproval || approvals?.lookup?.('generated-allowlist', GENERATED_ALLOWLIST_PATH, subject.fingerprint) === true
  return {
    allowlist: approved ? headAllowlist : base,
    headAllowlist,
    unapprovedGlobs: approved ? [] : subject.addedGlobs,
  }
}

/** 每条规则的冻结总数（eslint-suppressions.json 的形状：{ 文件: { 规则: { count } } }）。 */
export function suppressionTotals(suppressions) {
  const totals = {}
  for (const rules of Object.values(suppressions ?? {})) {
    for (const [rule, entry] of Object.entries(rules ?? {})) totals[rule] = (totals[rule] ?? 0) + (entry?.count ?? 0)
  }
  return totals
}

/** base → head 的冻结数上涨。返回 { needsApproval（任一文件 × 规则上涨）, grownRules（规则总数的变化，只用于描述）, grownEntries: [{ file, rule, base, head }], fingerprint }。 */
export function suppressionApprovalSubject(baseSuppressions, headSuppressions) {
  const baseTotals = suppressionTotals(baseSuppressions)
  const grownEntries = []
  for (const [file, rules] of Object.entries(headSuppressions ?? {})) {
    for (const [rule, entry] of Object.entries(rules ?? {})) {
      const base = baseSuppressions?.[file]?.[rule]?.count ?? 0
      if ((entry?.count ?? 0) > base) grownEntries.push({ file, rule, base, head: entry.count })
    }
  }
  grownEntries.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule))
  const headTotals = suppressionTotals(headSuppressions)
  const grownRules = [...new Set(grownEntries.map((entry) => entry.rule))].sort()
    .map((rule) => ({ rule, base: baseTotals[rule] ?? 0, head: headTotals[rule] ?? 0 }))
  return {
    needsApproval: grownEntries.length > 0,
    grownRules,
    grownEntries,
    fingerprint: sha256Of({ subject: SUPPRESSIONS_FILE, grown: grownEntries }),
  }
}

/** 人话描述冻结数上涨（确认提示用）。 */
export function describeSuppressionGrowth(subject) {
  const entries = subject.grownEntries.map(({ file, rule, base, head }) => `${file} ${rule} ${base}→${head}`)
  const files = new Set(subject.grownEntries.map((entry) => entry.file)).size
  return `冻结数涨了 ${entries.length} 处（文件 × 规则，涉及 ${files} 个文件）：${entries.slice(0, 4).join('、')}${entries.length > 4 ? ' …' : ''}`
}

// ── 确认记录文件 ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * 合并前扫描用：读本机确认记录，返回 approvals = { mode: 'local', lookup(kind, name, sha256) → boolean, unavailable?: 原因 }。
 * 环境变量没设 / 文件读不了 → unavailable（需要确认的项一律红，不当没有要求）。
 */
export function localApprovals({ pr, env = process.env, readFile = (file) => fs.readFileSync(file, 'utf8') } = {}) {
  const file = env[APPROVAL_ENV]
  if (!file) return { mode: 'local', pr, lookup: () => false, unavailable: `环境变量 ${APPROVAL_ENV} 没设置（协调确认记录文件的路径）` }
  let text
  try { text = readFile(file) } catch (error) { return { mode: 'local', pr, lookup: () => false, unavailable: `${APPROVAL_ENV} 指向的文件读不了：${String(error?.message ?? error).split('\n')[0]}` } }
  const records = text.split(/\r?\n/).filter((row) => row.trim()).flatMap((row) => { try { return [JSON.parse(row)] } catch { return [] } })
  return {
    mode: 'local',
    pr,
    lookup: (kind, name, sha256) => records.some((record) => record?.kind === kind && record?.name === name && record?.sha256 === sha256 && samePr(kind, record?.pr, pr)),
  }
}

/**
 * 记录与 PR 对得上吗。board / perf：必须同一个 PR 号。
 * eslint-suppressions：确认绑的是上涨那部分 diff 的哈希，和 PR 号无关；协调常在开 PR 之前（推送前钩子拦下时）就确认，
 * 那时还没有号，记录的 pr 为空——所以两边任一边没号都算对上，两边都有号才要求相等。
 */
function samePr(kind, recordPr, pr) {
  if ((kind === 'eslint-suppressions' || kind === 'generated-allowlist') && (recordPr == null || pr == null)) return true
  return Number(recordPr) === Number(pr)
}

/**
 * 推送档用（lint:changed 与本机 check-pr-judgement --stage=push 共用）：
 * 同样读本机确认记录，仅把 mode 标为 'push'——记录取不到时只打警告放行（交给合并前扫描核），记录取得到但没签照旧判红。
 */
export function pushApprovals({ pr = null, env = process.env, readFile } = {}) {
  return { ...localApprovals({ pr, env, ...(readFile ? { readFile } : {}) }), mode: 'push' }
}

/**
 * ESLint 批量抑制冻结数上涨的唯一判据（lint:changed、check-pr-judgement、PR Body、merge-preflight 四处共用）：
 *   · mode === 'local'（merge-preflight 合并前扫描）：取不到内容 / 没签 / 记录不可用一律 ok=false 判红；
 *   · mode === 'push'（本机推送档）：签了哈希对上 → ok=true；记录取不到（unavailable）→ ⚠ 待协调确认（合并前扫描会核）并放行；记录取得到但没签 → ok=false 判红；
 *   · mode === 'ci' / null：⚠ 待协调确认（合并前扫描会核）并放行。
 */
export function checkSuppressionContracts({ strict = false, suppressions = undefined, baseSuppressions = undefined, approvals = null } = {}) {
  if (!strict || (suppressions === undefined && baseSuppressions === undefined)) return { ok: true, lines: [] }
  const resolve = (value) => (typeof value === 'function' ? value() : value)
  const head = resolve(suppressions)
  const base = resolve(baseSuppressions)
  if (!head || !base) {
    if (approvals?.mode === 'local') return { ok: false, lines: [`✖ ${SUPPRESSIONS_FILE}：取不到 PR head 或 base 上的内容，没法对比冻结数`] }
    return { ok: true, lines: [`⚠ ${SUPPRESSIONS_FILE}：取不到 PR head 或 base 上的内容，没法对比冻结数（待协调确认，合并前扫描会核）`] }
  }
  const subject = suppressionApprovalSubject(base, head)
  if (!subject.needsApproval) return { ok: true, lines: [] }
  if (approvals?.lookup?.('eslint-suppressions', SUPPRESSIONS_FILE, subject.fingerprint) === true) {
    return { ok: true, lines: [`✅ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}——协调已确认（哈希对上）`] }
  }
  const command = approvalCommand(approvals?.pr, 'eslint-suppressions')
  if (approvals?.mode === 'local') {
    return { ok: false, lines: [`✖ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}，没有协调确认记录${approvals?.unavailable ? `（${approvals.unavailable}）` : ''}。冻结数只许减少；确需冻进存量，协调看过 diff 后跑 ${command}`] }
  }
  if (approvals?.mode === 'push') {
    if (approvals?.unavailable) {
      return { ok: true, lines: [`⚠ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}——待协调确认（合并前扫描会核；确认命令 ${command}）`] }
    }
    return { ok: false, lines: [`✖ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}，没有协调确认记录。冻结数只许减少；确需冻进存量，协调看过 diff 后跑 ${command}`] }
  }
  return { ok: true, lines: [`⚠ ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}——待协调确认（合并前扫描会核；确认命令 ${command}）`] }
}

/** CI 用：读不到本机记录，只提示待确认。 */
export const ciApprovals = Object.freeze({ mode: 'ci', lookup: () => false })

export function approvalCommand(pr, kind, name) {
  if (kind === 'eslint-suppressions') return `node scripts/coord-approve.mjs${pr ? ` --pr ${pr}` : ''} --suppressions`
  if (kind === 'generated-allowlist') return `node scripts/coord-approve.mjs${pr ? ` --pr ${pr}` : ''} --allowlist`
  return `node scripts/coord-approve.mjs --pr ${pr ?? '<号>'} ${kind === 'board' ? '--board' : '--perf'} ${name}`
}
