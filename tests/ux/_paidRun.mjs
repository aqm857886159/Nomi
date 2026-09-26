// 付费走查的开关、护栏与收据，唯一一份（2026-09-26）。每条会真的调用供应商、真的扣费的脚本，开头只走这里。
//
// 为什么收成一处：以前每条付费脚本各写各的——有的只拒 CI、不要任何显式开关（agent-spend-real-image），
// 有的认 NOMI_CORE_A_LIVE，有的认 APIMART_E2E + NOMI_SPEND_OK。一次忘记的代价是真实账单，
// 防线得建在最早能拦住的那层（R17），而不是靠每个作者记得抄全。
//
// 三道闸 + 两张收据：
//   ① CI 里拒跑（CI 从来没有真钱，也不该有）；
//   ② 没有显式 NOMI_SPEND_OK=1 拒跑（与 tests/system/profiles.mjs 的付费档同一个开关）；
//   ③ 用户自己的 Nomi 开着拒跑——要拷他的真实资料目录，开着的 App 会让拷到的东西半新半旧；
//   收据一：原库指纹跑前记下，跑后比对，变了就红；
//   收据二：这一场真正发生的付费调用（媒体任务号 + 供应商回的 cost 字段；Agent 的 token 用量）。
//   只记事实、不折算金额——价目会变，而且这是公开仓库。
import fs from 'node:fs'
import path from 'node:path'

import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { realNomiIsRunning, realProfileFingerprint, removeRealCredentials, seedRealModels } from './_realProfile.mjs'

export const SPEND_OPT_IN_ENV = 'NOMI_SPEND_OK'

/** 纯判据（单测钉它）：返回拒跑理由，null = 放行。 */
export function paidRunRefusal(script, { env = process.env, nomiRunning = false } = {}) {
  if (env.CI) return `${script} 会真的调用供应商并扣费，不在 CI 里跑`
  if (env[SPEND_OPT_IN_ENV] !== '1') return `${script} 会花真钱：显式设 ${SPEND_OPT_IN_ENV}=1 才跑`
  if (nomiRunning) return `${script} 要拷用户的真实资料目录，而 Nomi 正开着——关掉 App 再跑（开着拷到的是半新半旧的一份）`
  return null
}

export function assertPaidRunAllowed(script, env = process.env) {
  const refusal = paidRunRefusal(script, { env, nomiRunning: !env.CI && env[SPEND_OPT_IN_ENV] === '1' && realNomiIsRunning() })
  if (refusal) throw new Error(refusal)
  const before = realProfileFingerprint()
  return {
    realProfileBefore: before,
    /** 跑后调用：原库的目录与钥匙必须一字不差；返回跑后指纹给报告用。 */
    assertRealProfileUntouched() {
      const after = realProfileFingerprint()
      const changed = Object.keys({ ...before, ...after }).filter((name) => before[name] !== after[name])
      if (changed.length) throw new Error(`付费走查跑完，用户真实资料目录里的 ${changed.join('、')} 变了——走查写穿了原库，或期间有人开了 Nomi`)
      return after
    },
  }
}

/**
 * 付费走查的起点：先过闸，再建隔离实例（createRuntimeWalk），再把**点名的真实模型**连同凭据装进去。
 * 返回的 `finish(error)` 在 App 关掉之后删凭据副本、写收据、比对原库指纹。
 */
export async function openPaidWalk(script, name, models) {
  const guard = assertPaidRunAllowed(script)
  const walk = await createRuntimeWalk(name)
  const removeCredentialCopy = () => removeRealCredentials({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir })
  let seeded
  try { seeded = seedRealModels({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, models }) }
  catch (error) { removeCredentialCopy(); await walk.fixture.close(); throw error }
  walk.report.seededModels = seeded.map((row) => `${row.vendorKey}/${row.modelKey}`)
  walk.report.realProfileBefore = guard.realProfileBefore
  console.log(`[paid] 隔离副本装了：${walk.report.seededModels.join(' · ')}`)
  const label = (vendorKey, modelKey) => seeded.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey)?.labelZh
  /**
   * 花第一分钱之前，在被测 App 里把花钱面收窄到被授权的那几个模型，再让 App 自己说它们「能用」。
   *
   * 为什么非在 App 起来之后做：App 首启会把内置目录补进隔离副本（同一家 APIMart 下几十个生成模型），
   * 它们和被授权的那一个共用同一把 key——不停掉，Agent 在 list_models 里点到哪个贵的、全自动档就直接花了。
   * 停用走的是设置页同一条 IPC（`modelCatalog.upsertModel`），等于用户在设置里把别的生成模型关掉。
   * 可用性问的是主进程的唯一答案（含钥匙解不解得开）：Windows 上漏拷 Local State，这里就会红，一分钱没花。
   */
  async function lockToAuthorizedModels(win) {
    const authorized = new Set(seeded.map((row) => `${row.vendorKey}/${row.modelKey}`))
    const disabled = await win.evaluate((allowed) => {
      const off = []
      for (const row of window.nomiDesktop.modelCatalog.listModels({})) {
        if (row.kind === 'text' || !row.enabled || allowed.includes(`${row.vendorKey}/${row.modelKey}`)) continue
        window.nomiDesktop.modelCatalog.upsertModel({ vendorKey: row.vendorKey, modelKey: row.modelKey, enabled: false })
        off.push(`${row.vendorKey}/${row.modelKey}`)
      }
      return off
    }, [...authorized])
    const rows = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels({}))
    const stillOn = rows.filter((row) => row.kind !== 'text' && row.enabled && !authorized.has(`${row.vendorKey}/${row.modelKey}`))
      .map((row) => `${row.vendorKey}/${row.modelKey}`)
    if (stillOn.length) throw new Error(`付费前置不成立：这些未授权的生成模型停不掉（一分钱没花）：${stillOn.join('、')}`)
    const unusable = seeded.map((want) => {
      const row = rows.find((candidate) => candidate.vendorKey === want.vendorKey && candidate.modelKey === want.modelKey)
      return row?.availability?.usable ? null : `${want.vendorKey}/${want.modelKey}：${JSON.stringify(row?.availability ?? '目录里没有')}`
    }).filter(Boolean)
    if (unusable.length) throw new Error(`付费前置不成立，被测 App 说这些模型不能用（一分钱没花）：\n  ${unusable.join('\n  ')}`)
    walk.report.disabledUnauthorizedModels = disabled.length
  }
  async function finish(error) {
    await walk.finish(error, {
      unscriptedFixture: true,
      collect: async () => {
        // App 已经关了：凭据副本（目录里的 key 密文 + 钥匙）当场删掉，项目与截图留作证据。
        const credentialCopyRemoved = removeCredentialCopy()
        const after = guard.assertRealProfileUntouched()
        return { spend: spendReceipt(walk.report.projectRoot), realProfileAfter: after, credentialCopyRemoved }
      },
    })
  }
  return { walk, label, lockToAuthorizedModels, finish }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** 项目里所有制作 Run（`.nomi/runs/<runId>/run.json`，Agent 发起的付费都记在这里），按创建先后。 */
export function readProductionRuns(projectRoot) {
  const dir = path.join(projectRoot, '.nomi', 'runs')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).map((id) => readJson(path.join(dir, id, 'run.json'))?.run).filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

/**
 * 这一场真正发生的付费调用，全部从项目落盘读（App 关了之后也读得到）。媒体：画布节点上的每次提交 +
 * 制作 Run 里每个拿到供应商任务号的 job，按供应商任务号去重（同一笔可能两处都记）；
 * 文本：Agent 转录里每条回复的 usage。
 */
export function spendReceipt(projectRoot) {
  if (!projectRoot) return { media: [], text: null }
  const nodes = readJson(path.join(projectRoot, '.nomi', 'project.json'))?.payload?.generationCanvas?.nodes ?? []
  const runs = readProductionRuns(projectRoot)
  const media = new Map()
  for (const node of nodes) {
    for (const run of node.runs ?? []) {
      const taskId = run.taskId ?? (run.resultId && run.resultId === node.result?.id ? node.result?.taskId : undefined)
      media.set(taskId ?? `${node.id}:${run.id}`, {
        source: 'canvas', nodeId: node.id, kind: node.kind, vendor: node.meta?.modelVendor ?? null, model: node.meta?.modelKey ?? null,
        taskId: taskId ?? null, status: run.status, providerCost: node.result?.taskId === taskId ? node.result?.provenance?.cost ?? null : null,
      })
    }
  }
  for (const run of runs) {
    for (const job of run.jobs ?? []) {
      if (!job.providerTaskId) continue
      const node = nodes.find((candidate) => candidate.id === job.nodeId)
      media.set(job.providerTaskId, {
        ...media.get(job.providerTaskId),
        source: 'production-run', runId: run.runId, jobId: job.jobId, nodeId: job.nodeId ?? null, vendor: job.provider, model: job.model,
        taskId: job.providerTaskId, status: job.status, providerCost: node?.result?.provenance?.cost ?? null,
      })
    }
  }
  // 制作 Run 落到节点上的那一次，节点自己的运行记录里没有供应商任务号（记的是 job）——它和 Run 里那条是同一笔。
  const runNodes = new Set([...media.values()].filter((entry) => entry.source === 'production-run').map((entry) => entry.nodeId))
  for (const [key, entry] of media) if (entry.source === 'canvas' && !entry.taskId && runNodes.has(entry.nodeId)) media.delete(key)
  const text = { replies: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: {} }
  for (const session of readLaneTranscripts(projectRoot)) {
    for (const message of laneMessages(session)) {
      if (message.role !== 'assistant' || !message.usage) continue
      text.replies += 1
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) text[key] += Number(message.usage[key]) || 0
      const model = `${message.provider ?? '?'}/${message.model ?? '?'}`
      text.models[model] = (text.models[model] ?? 0) + 1
    }
  }
  return { media: [...media.values()], text }
}

// ── 付费确认框的观察（画布与分镜表两条付费走查共用）──────────────────────────────

/** 确认框的稳定锚点（SpendConfirmDialog.tsx；按文案找是易碎选择器）。 */
export const SPEND_DIALOG = '[data-spend-confirm-dialog]'

/**
 * 「价格行」回来了没有。2026-09-26 起确认框不再印价格（官方额度上线前隐藏价格维度）；旧框里那一行是
 * 「预计金额 / Estimated amount」+「N 点 / 目录未标价」。任何货币符号或「点 / credits」计数出现在框里都算。
 * 按语义判，不按已删的 i18n 键判——键删了，字符串换个地方回来照样要红。
 */
export const PRICE_LINE = /预计金额|Estimated amount|目录未标价|[¥$]\s*\d|\d+(?:\.\d+)?\s*(?:点|credits?)\b/i

/**
 * 在真实 DOM 上挂一个观察者：确认框**出现过几次**，以及一个活体探针（某个元素的某个属性）走过哪些值。
 * 确认框可能一闪而过，事后查 locator 会漏；活体那一栏证明观察者真的在看——它一个值都没记到，「0 次弹框」不作数。
 */
export async function watchSpendDialogs(win, { selector, attribute }) {
  const slot = `__paidSpendWatch${Date.now()}`
  await win.evaluate(({ dialog, selector: probe, attribute: attr, slot: key }) => {
    const log = { dialogs: 0, liveness: [] }
    let open = false
    const sample = () => {
      const now = Boolean(document.querySelector(dialog))
      if (now && !open) log.dialogs += 1
      open = now
      const value = document.querySelector(probe)?.getAttribute(attr)
      if (value && log.liveness.at(-1) !== value) log.liveness.push(value)
    }
    window[key] = log
    sample()
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true, attributes: true })
  }, { dialog: SPEND_DIALOG, selector, attribute, slot })
  return { read: () => win.evaluate((key) => window[key], slot) }
}
