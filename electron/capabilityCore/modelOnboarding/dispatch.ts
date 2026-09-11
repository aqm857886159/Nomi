// 接模型工具面的派发层：4 个工具 / 9 个动作 -> 既有会话服务与 catalog。
//
// 这一层的全部职责，是把「Nomi 的实现」挡在模型面之外：
//   · 乐观锁不去掉，只是**不再由模型提供**——本层在写之前自己读当前 revision（mutateLatest）。
//     真正的并发写者只有在 GUI 里操作的用户本人，而用户应该赢：撞上就再读一次重试，
//     第二次还撞 = 用户正在改，返回 stale_fingerprint 让模型去问人，而不是覆盖他。
//   · 幂等键由 (setupId, action, 入参摘要) 派生，重放返回同一结果（含同一 changeId）。
//   · 返回值一律是 envelope.ts 那一个信封，`unverified` 说清此刻哪些话没有证据。
import { deriveVendorKeyFromBaseUrl } from '../../catalog/catalogCommit'
import {
  deleteModelCatalogModels,
  deleteModelCatalogVendor,
  listModelCatalogModels,
  listModelCatalogVendors,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
} from '../../catalog/catalogStore'
import { discoverHttpCandidates } from '../../integrationCertification/httpModelDiscovery'
import type { IntegrationSessionService, IntegrationSessionProjection } from '../../integrationCertification/integrationSession'
import { IntegrationRequestError, type IntegrationCredentialStatus } from '../../shared/integrationContract'
import type { CapabilityOriginHost } from '../security'
import { ONBOARDING_VERB_BY_ACTION, ONBOARDING_VERBS, type VerbDeclaration } from './declarations'
import {
  freeRequests,
  noBlast,
  unverified,
  type BlastRadius,
  type OnboardingChange,
  type OnboardingNextAction,
  type OnboardingResult,
  type UnverifiedClaim,
} from './envelope'
import { ReplayCache, changeIdFor, deriveIdempotencyKey } from './idempotency'
import { fingerprintOf } from './fingerprint'

export type ModelOnboardingDeps = {
  sessions: IntegrationSessionService
  owner: CapabilityOriginHost
  /**
   * 打开本机安全页（MCP URL 模式 elicitation）。返回值里的 ticket 是一次性凭据页，
   * 由协议层拿去发 elicitation/create；这一层只负责把它挂到信封上，自己不读、不存、不转述。
   * 无头宿主拿不到窗口时 opened:false 且没有 ticket —— 降级到持久 handoff，不是报错。
   */
  openCredentialsUi?: (input: { sessionId: string; vendorName: string }) => Promise<{ opened: boolean; ticket?: unknown } | void>
  /** 免费自检探针：列出供应商自己的模型清单。默认用主进程那条既有发现路径，**不发任何会计费的请求**。 */
  probeModels?: typeof discoverHttpCandidates
  /** 不可逆删除的确认卡：交给可信 UI，**返回前什么都没删**。 */
  enqueueRemovalConfirmation?: (input: PendingRemoval) => void
}

export type PendingRemoval = {
  removalId: string
  vendorKey: string
  modelKeys?: string[]
  recordsToDelete: number
  requestedBy: CapabilityOriginHost
}

const replay = new ReplayCache<OnboardingResult>()
/** 已签发但还没被人点的删除确认。**删除只在 confirmRemovalFromTrustedUi 里发生。** */
const pendingRemovals = new Map<string, PendingRemoval>()

// ── 视图（list_models 与所有写动作的 state 同形状） ───────────────────────────────────────

export type ModelRow = {
  vendorKey: string
  modelKey: string
  kind: string
  label: string
  /** 在不在画布模型框里。 */
  visibleInPicker: boolean
  /** 不在的话，为什么不在（模型直接念给用户听）。 */
  visibilityReason: string
  /** 已试跑 / 未试跑 —— 09-11 拍板：自检失败不下架，出现即标「未试跑」。 */
  tried: boolean
  /** 未试跑到什么程度（地址通了？key 收了？）——角标要说得出这句话。 */
  selfCheck?: { at: string; reachedOrigin?: string; latencyMs?: number; accepted: boolean; status?: number; bodyExcerpt?: string }
}

export type ConnectionRow = {
  vendorKey: string
  name: string
  baseUrl?: string
  authType?: string
  /** 只报状态，**永远不返回 key 的任何形式**。词表 owner 是 integrationContract，不在这里复制一份。 */
  keyStatus: IntegrationCredentialStatus
  models: ModelRow[]
}

export type ModelSetupView = {
  connections: ConnectionRow[]
  setups: IntegrationSessionProjection[]
  /** 不透明指纹；nomi_remove_provider 的 ifUnchanged 原样抄它。 */
  fingerprint: string
}

/** 自检结果留在哪：与模型记录同寿的 meta 角落，读侧只读不写（O6：show_models 不许读它）。 */
type SelfCheckMeta = NonNullable<ModelRow['selfCheck']>
function selfCheckOf(meta: unknown): SelfCheckMeta | undefined {
  if (!meta || typeof meta !== 'object') return undefined
  const value = (meta as Record<string, unknown>).nomiSelfCheck
  return value && typeof value === 'object' ? (value as SelfCheckMeta) : undefined
}

export function buildView(deps: ModelOnboardingDeps, filter?: { vendorKey?: string; setupId?: string; kind?: string }): ModelSetupView {
  const vendors = listModelCatalogVendors().filter((vendor) => !filter?.vendorKey || vendor.key === filter.vendorKey)
  const models = listModelCatalogModels()
  const connections: ConnectionRow[] = vendors.map((vendor) => ({
    vendorKey: vendor.key,
    name: vendor.name,
    ...(vendor.baseUrlHint ? { baseUrl: vendor.baseUrlHint } : {}),
    ...(vendor.authType ? { authType: vendor.authType } : {}),
    keyStatus: vendor.hasApiKey ? (vendor.credentialVerificationPending ? 'needs_resave' : 'ready') : 'missing',
    models: models
      .filter((model) => model.vendorKey === vendor.key && (!filter?.kind || model.kind === filter.kind))
      .map((model) => {
        const check = selfCheckOf(model.meta)
        return {
          vendorKey: model.vendorKey,
          modelKey: model.modelKey,
          kind: model.kind,
          label: model.labelZh,
          visibleInPicker: model.enabled && vendor.enabled,
          visibilityReason: !vendor.enabled
            ? 'the whole connection is switched off'
            : model.enabled
              ? 'shown'
              : 'hidden from the picker by the user or by show_models with visible:false',
          // 「已试跑」只有用户在画布上真跑过一次才成立。自检**永远**点不亮它（门岗 O5 / O6）。
          tried: Boolean((model.meta as Record<string, unknown> | undefined)?.nomiFirstRunAt),
          ...(check ? { selfCheck: check } : {}),
        }
      }),
  }))
  const setups = deps.sessions.list(deps.owner).sessions.filter((setup) => !filter?.setupId || setup.id === filter.setupId)
  return { connections, setups, fingerprint: fingerprintOf({ connections, setups: setups.map((s) => [s.id, s.revision]) }) }
}

// ── 锁：宿主自己读，用户永远赢 ─────────────────────────────────────────────────────────
/**
 * 读当前 revision -> 写。撞上并发（GUI 里的用户刚改过）再读一次重试；第二次还撞就**不覆盖**，
 * 返回 stale_fingerprint 让模型去问人。模型面上因此一个版本号都没有（门岗 O3）。
 */
async function mutateLatest<T>(
  deps: ModelOnboardingDeps,
  setupId: string,
  write: (revision: number) => Promise<T> | T,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = deps.sessions.get(setupId, deps.owner)
    try {
      return await write(current.revision)
    } catch (error) {
      const code = error instanceof IntegrationRequestError ? error.code : ''
      const stale = code === 'integration_revision_stale' || code === 'integration_revision_ahead'
      if (!stale || attempt === 1) throw error
    }
  }
  throw new IntegrationRequestError(
    'integration_revision_stale',
    'Someone is changing these settings in Nomi right now. Tell the user you will wait, then read the state again with nomi_list_models.',
  )
}

// ── 信封 ────────────────────────────────────────────────────────────────────────────────

function envelope(input: {
  deps: ModelOnboardingDeps
  verb: VerbDeclaration
  idempotencyKey: string
  setupId?: string
  vendorKey?: string
  claims: UnverifiedClaim[]
  changes: OnboardingChange[]
  blastRadius?: BlastRadius
  nextAction: OnboardingNextAction
  filter?: { vendorKey?: string; setupId?: string }
}): OnboardingResult {
  return {
    ok: true,
    ...(input.setupId ? { setupId: input.setupId } : {}),
    ...(input.vendorKey ? { vendorKey: input.vendorKey } : {}),
    ...(input.verb.effect === 'reversible_local' ? { changeId: changeIdFor(input.idempotencyKey) } : {}),
    state: buildView(input.deps, input.filter),
    unverified: unverified(...input.claims),
    changes: input.changes,
    blastRadius: input.blastRadius ?? noBlast(),
    nextAction: input.nextAction,
  }
}

/** 一个还没在画布上真跑过的模型，永远带着这条。自检消不掉它。 */
const ALWAYS_UNVERIFIED: UnverifiedClaim[] = ['model_produces_output']

// ── 派发 ────────────────────────────────────────────────────────────────────────────────

export async function dispatchModelOnboarding(
  method: string,
  params: Record<string, unknown>,
  deps: ModelOnboardingDeps,
): Promise<OnboardingResult> {
  const action = String(params.action ?? '')
  const verb = ONBOARDING_VERB_BY_ACTION[action] ?? findVerbByMethod(method)
  if (!verb) throw new IntegrationRequestError('integration_required_fields_missing', `Unknown model setup step: ${method}`)
  const setupId = typeof params.setupId === 'string' ? params.setupId : undefined
  const key = deriveIdempotencyKey(setupId, verb.action ?? verb.tool, params)
  // 重放恒等：模型不确定上一跳成没成功时再调一次是**无害的**，且返回值一字不差。
  if (verb.effect !== 'read') return replay.replay(key, () => run(verb, params, deps, key))
  return run(verb, params, deps, key)
}

function findVerbByMethod(method: string): VerbDeclaration | undefined {
  return Object.values(ONBOARDING_VERB_BY_ACTION).find((verb) => verb.method === method)
    ?? ONBOARDING_METHOD_INDEX[method]
}

// 独立工具（无 action）的 method -> 声明索引。
const ONBOARDING_METHOD_INDEX: Record<string, VerbDeclaration> = Object.fromEntries(
  ONBOARDING_VERBS.map((verb) => [verb.method, verb]),
)

async function run(
  verb: VerbDeclaration,
  params: Record<string, unknown>,
  deps: ModelOnboardingDeps,
  key: string,
): Promise<OnboardingResult> {
  switch (verb.method) {
    case 'modelSetup.list':
      return {
        ok: true,
        state: buildView(deps, {
          ...(typeof params.vendorKey === 'string' ? { vendorKey: params.vendorKey } : {}),
          ...(typeof params.setupId === 'string' ? { setupId: params.setupId } : {}),
          ...(typeof params.kind === 'string' ? { kind: params.kind } : {}),
        }),
        unverified: unverified(...ALWAYS_UNVERIFIED),
        changes: [],
        blastRadius: noBlast(),
        nextAction: { kind: 'none', userSees: 'Nothing changed; this is what the settings look like right now.' },
      }
    case 'modelSetup.await':
      return awaitSetup(verb, params, deps, key)
    case 'modelSetup.connect_provider':
      return connectProvider(verb, params, deps, key)
    case 'modelSetup.choose_models':
      return chooseModels(verb, params, deps, key)
    case 'modelSetup.draft_adapter':
      return draftAdapter(verb, params, deps, key)
    case 'modelSetup.check_connection':
      return checkConnection(verb, params, deps, key)
    case 'modelSetup.show_models':
      return showModels(verb, params, deps, key)
    case 'modelSetup.cancel':
      return cancelSetup(verb, params, deps, key)
    case 'modelSetup.remove_provider':
      return removeProvider(verb, params, deps, key)
    default:
      throw new IntegrationRequestError('integration_required_fields_missing', `Unknown model setup step: ${verb.method}`)
  }
}

/** 等人/等机器：有界阻塞，超时不是失败。 */
async function awaitSetup(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const setupId = String(params.setupId)
  const timeoutMs = Math.min(300, Math.max(1, Number(params.timeoutSeconds ?? 60))) * 1000
  const deadline = Date.now() + timeoutMs
  const waiting = new Set(['needs_credential', 'discovering', 'certifying', 'committing'])
  let setup = deps.sessions.get(setupId, deps.owner)
  while (waiting.has(setup.stage) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    setup = deps.sessions.get(setupId, deps.owner)
  }
  const stillWaiting = waiting.has(setup.stage)
  return envelope({
    deps, verb, idempotencyKey: key, setupId,
    claims: [...ALWAYS_UNVERIFIED],
    changes: [],
    nextAction: stillWaiting
      ? { kind: setup.stage === 'needs_credential' ? 'waiting_for_user' : 'working', userSees: nextActionText(setup), waitWith: 'nomi_await_setup' }
      : { kind: 'none', userSees: nextActionText(setup) },
    filter: { setupId },
  })
}

function nextActionText(setup: IntegrationSessionProjection): string {
  switch (setup.stage) {
    case 'needs_credential': return `Nomi is asking the user for the ${setup.config.name} key on its own local page.`
    case 'discovering': return `Nomi is reading the list of models ${setup.config.name} offers.`
    case 'needs_selection': return `Nomi found models for ${setup.config.name}; choose which ones to onboard.`
    case 'needs_input': return `Nomi needs one more thing for ${setup.config.name}: ${setup.unresolvedFields.map((field) => field.key).join(', ') || 'see unresolvedFields'}.`
    case 'cancelled': return `The ${setup.config.name} setup was cancelled; anything already saved is untouched.`
    case 'failed': return `The ${setup.config.name} setup stopped: ${setup.blockingReason?.code || 'see the provider response'}.`
    default: return `The ${setup.config.name} setup is at step "${setup.stage}".`
  }
}

async function connectProvider(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const existingVendorKey = typeof params.vendorKey === 'string' ? params.vendorKey : undefined
  // 改已存在的连接：同一个动作既建也改（upsert）。这同时答掉群里问了四次的「改不了 api url」。
  if (existingVendorKey) {
    const patch: Record<string, unknown> = { key: existingVendorKey }
    for (const field of ['name', 'authType', 'authHeader', 'authQueryParam', 'providerKind'] as const) {
      if (params[field] !== undefined) patch[field] = params[field]
    }
    if (typeof params.baseUrl === 'string') patch.baseUrlHint = params.baseUrl
    if (typeof params.proxyUrl === 'string' || typeof params.proxyEnabled === 'boolean') {
      // 打开代理前先确认真的配过一个——没配过就打开等于悄悄改了出站路由却什么都没生效。
      if (params.proxyEnabled === true && typeof params.proxyUrl !== 'string') {
        const configured = listModelCatalogVendors().find((vendor) => vendor.key === existingVendorKey)?.network?.proxyUrl
        if (!configured) {
          throw new IntegrationRequestError(
            'integration_required_fields_missing',
            `No secure proxy is configured for ${existingVendorKey}. Send proxyUrl in the same call, or ask the user to configure one in Nomi.`,
            { action: 'connect_provider', missing: 'proxyUrl', required: 'proxyUrl' },
          )
        }
      }
      patch.network = {
        ...(typeof params.proxyUrl === 'string' ? { proxyUrl: params.proxyUrl } : {}),
        ...(typeof params.proxyEnabled === 'boolean' ? { proxyEnabled: params.proxyEnabled } : {}),
      }
    }
    upsertModelCatalogVendor(patch)
    const needsKey = params.reissueKey === true
    return envelope({
      deps, verb, idempotencyKey: key, vendorKey: existingVendorKey,
      claims: [...ALWAYS_UNVERIFIED, 'endpoint_reachable', 'credential_accepted'],
      changes: [{ state: 'S11.1', summary: `Updated the ${existingVendorKey} connection.` }],
      nextAction: needsKey
        ? { kind: 'user_sees_key_page', userSees: `Nomi is asking the user for a new ${existingVendorKey} key on its own local page.`, waitWith: 'nomi_await_setup' }
        : { kind: 'none', userSees: `The ${existingVendorKey} connection was updated. Nothing has been tried against it yet.` },
      filter: { vendorKey: existingVendorKey },
    })
  }
  // 新建（或接着同一个 baseUrl 的未完成接入做）。
  let credentialEntry: unknown
  const begun = deps.sessions.begin(
    {
      kind: params.kind as 'http-api-provider' | 'comfyui-workflow',
      name: String(params.name),
      ...(typeof params.setupId === 'string' ? { sessionId: params.setupId } : {}),
      ...(typeof params.baseUrl === 'string' ? { baseUrl: params.baseUrl } : {}),
      ...(typeof params.docs === 'string' ? { docs: params.docs } : {}),
      ...(typeof params.providerKind === 'string' ? { providerKind: params.providerKind } : {}),
      ...(typeof params.authType === 'string' ? { authType: params.authType as never } : {}),
      ...(typeof params.authHeader === 'string' ? { authHeader: params.authHeader } : {}),
      ...(typeof params.authQueryParam === 'string' ? { authQueryParam: params.authQueryParam } : {}),
    },
    deps.owner,
  )
  const needsKey = begun.credentialStatus !== 'ready'
  if (needsKey) {
    // 「让用户填 key」不是动词，是这一跳的后果：本机安全页由宿主自己打开（MCP URL 模式 elicitation）。
    await mutateLatest(deps, begun.id, (revision) => deps.sessions.openCredentials(begun.id, revision, deps.owner))
    try {
      credentialEntry = (await deps.openCredentialsUi?.({ sessionId: begun.id, vendorName: begun.config.name }))?.ticket
    } catch {
      // 窗口可能在持久 handoff 与渲染层请求之间消失；handoff 已入队，下次打开 Nomi 会重放。
    }
  }
  const ticketUrl = (credentialEntry as { url?: unknown } | undefined)?.url
  const result = envelope({
    deps, verb, idempotencyKey: key, setupId: begun.id,
    claims: [...ALWAYS_UNVERIFIED, 'endpoint_reachable', 'credential_accepted', 'model_id_exists'],
    changes: [{ state: 'S11.1', summary: `Started a connection for ${begun.config.name}.` }],
    nextAction: needsKey
      ? {
          kind: 'user_sees_key_page',
          userSees: `Nomi is asking the user for the ${begun.config.name} key on its own local page. Nothing is set up until they finish.`,
          waitWith: 'nomi_await_setup',
          ...(typeof ticketUrl === 'string' ? { url: ticketUrl } : {}),
        }
      : { kind: 'working', userSees: `Nomi already has a key for ${begun.config.name} and is reading its list of models.`, waitWith: 'nomi_await_setup' },
    filter: { setupId: begun.id },
  })
  // 一次性票据只给协议层看，发完 elicitation/create 就被剥掉（mcpCredentialElicitation.withoutTicket）。
  // 它永远不会进到模型上下文里——模型只看得到 nextAction.url。
  return credentialEntry ? Object.assign(result, { credentialEntry, config: begun.config }) : result
}

async function chooseModels(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const setupId = String(params.setupId)
  const chosen = (params.models as Array<{ modelKey: string; kind: string }>) || []
  await mutateLatest(deps, setupId, (revision) => deps.sessions.propose(setupId, revision, deps.owner, {
    candidates: chosen,
    selections: chosen.map((model) => ({ modelKey: model.modelKey })),
  }))
  return envelope({
    deps, verb, idempotencyKey: key, setupId,
    claims: [...ALWAYS_UNVERIFIED, 'model_id_exists'],
    changes: [{ state: 'S11.3', summary: `Chose ${chosen.length} model(s) to onboard.` }],
    nextAction: { kind: 'none', userSees: `${chosen.length} model(s) are now listed under this connection, marked "not yet tried". They are not selectable on the canvas until you show them.` },
    filter: { setupId },
  })
}

async function draftAdapter(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const setupId = String(params.setupId)
  const current = deps.sessions.get(setupId, deps.owner)
  const proposal = typeof params.workflow === 'string'
    ? { workflow: params.workflow }
    : {
        candidates: current.candidates,
        selections: current.selections,
        adapterDraft: params.adapterDraft,
      }
  await mutateLatest(deps, setupId, (revision) => deps.sessions.propose(setupId, revision, deps.owner, proposal))
  const after = deps.sessions.get(setupId, deps.owner)
  const compiled = !after.compileRequest
  return envelope({
    deps, verb, idempotencyKey: key, setupId,
    claims: compiled ? [...ALWAYS_UNVERIFIED] : [...ALWAYS_UNVERIFIED, 'adapter_compiles'],
    changes: [{ state: 'S11.4', summary: compiled ? 'The request recipe compiled.' : 'The request recipe was not accepted yet.' }],
    nextAction: { kind: 'none', userSees: compiled ? 'Nomi accepted the request recipe.' : `Nomi could not compile the recipe: ${after.unresolvedFields.map((field) => field.key).join(', ')}.` },
    filter: { setupId },
  })
}

/**
 * 免费自检（09-11 拍板：这条路上一个花钱的动作都没有）。
 *
 * 它证明的是**地址通、key 被收下、模型 id 在对方的清单里**，仅此而已。
 * 仓库自己记着两个反例：apimart 对合法 key 恒回 401、minimax 回 200 却跑不通——所以自检
 * 既会假阴也会假阳。因此：**通过不下结论、失败不下架**，unverified 里那条 model_produces_output
 * 无论如何都留着（门岗 O5）。
 */
async function checkConnection(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const setupId = typeof params.setupId === 'string' ? params.setupId : undefined
  const vendorKey = typeof params.vendorKey === 'string'
    ? params.vendorKey
    : setupId
      ? deriveVendorKeyFromBaseUrl(String(deps.sessions.get(setupId, deps.owner).config.baseUrl || ''))
      : ''
  const wanted = Array.isArray(params.modelKeys) ? (params.modelKeys as string[]) : undefined
  const view = buildView(deps, { vendorKey })
  const connection = view.connections.find((row) => row.vendorKey === vendorKey)
  const targets = (connection?.models ?? []).filter((model) => !wanted || wanted.includes(model.modelKey))
  const probe = deps.probeModels ?? discoverHttpCandidates
  const origin = connection?.baseUrl ? safeOrigin(connection.baseUrl) : vendorKey

  const attempted = targets.map((model) => ({ modelKey: model.modelKey, probe: 'provider_model_list' as const }))
  const skipped: Array<{ modelKey: string; reason: string }> = []
  let accepted: string[] = []
  let rejected: Array<{ modelKey: string; status?: number; bodyExcerpt?: string }> = []
  let latencyMs = 0
  let failure: { status?: number; bodyExcerpt?: string } | undefined
  const startedAt = Date.now()
  try {
    if (!setupId) throw new Error('no_setup_for_probe')
    const session = deps.sessions.get(setupId, deps.owner)
    const listed = await probe({ session: session as never, certification: (deps.sessions as unknown as { certification: never }).certification, credentialResolver: undefined })
    latencyMs = Date.now() - startedAt
    const ids = new Set(listed.map((candidate) => candidate.modelKey))
    accepted = targets.filter((model) => ids.has(model.modelKey)).map((model) => model.modelKey)
    rejected = targets.filter((model) => !ids.has(model.modelKey)).map((model) => ({ modelKey: model.modelKey }))
  } catch (error) {
    latencyMs = Date.now() - startedAt
    failure = { bodyExcerpt: (error instanceof Error ? error.message : String(error)).slice(0, 512) }
    rejected = targets.map((model) => ({ modelKey: model.modelKey, ...failure }))
    if (!setupId) skipped.push(...targets.map((model) => ({ modelKey: model.modelKey, reason: 'no_models_endpoint' })))
  }

  // 自检结果写在模型记录旁边，**不影响可见性**（门岗 O6：show_models 的路径不读它）。
  const at = new Date().toISOString()
  for (const model of targets) {
    const ok = accepted.includes(model.modelKey)
    upsertModelCatalogModel({
      vendorKey, modelKey: model.modelKey,
      meta: { nomiSelfCheck: { at, reachedOrigin: origin, latencyMs, accepted: ok, ...(ok ? {} : failure ?? {}) } },
    })
  }

  const claims: UnverifiedClaim[] = [...ALWAYS_UNVERIFIED]
  if (!accepted.length) claims.push('endpoint_reachable', 'credential_accepted', 'model_id_exists')
  const result = envelope({
    deps, verb, idempotencyKey: key, vendorKey, ...(setupId ? { setupId } : {}),
    claims,
    changes: [{ state: 'S11.5', summary: `Self-checked ${targets.length} model(s): ${accepted.length} found in the provider's own list.` }],
    blastRadius: { modelsAppearing: 0, modelsDisappearing: 0, recordsDeleted: 0, outboundRequests: freeRequests(origin, targets.length ? 1 : 0) },
    nextAction: {
      kind: 'none',
      userSees: accepted.length
        ? `The address answered and the key was accepted; ${accepted.length} model id(s) are in ${vendorKey}'s own list. Nothing has been generated yet — the first real run is the user's own.`
        : `${vendorKey} did not confirm these model ids. The models stay where they are, labelled "not yet tried".`,
    },
    filter: { vendorKey },
  })
  // 重活五段式：想做什么 / 够到了吗 / 收下了吗 / 没做什么 / 证明了什么（顶层 unverified）。
  return Object.assign(result, {
    selfCheck: { attempted, reached: { origin, latencyMs }, accepted, rejected, skipped },
  })
}

function safeOrigin(url: string): string {
  try { return new URL(url).origin } catch { return url }
}

async function showModels(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const visible = params.visible === true
  const vendorKey = String(params.vendorKey)
  const modelKeys = (params.modelKeys as string[]) || []
  // O6：这条路径**只读入参**，不读 selfCheck / adapter.state / activeRevision。
  // 守的是「自检失败不下架」这个拍板，不是代码整洁。
  for (const modelKey of modelKeys) upsertModelCatalogModel({ vendorKey, modelKey, enabled: visible })
  return envelope({
    deps, verb, idempotencyKey: key, vendorKey,
    claims: [...ALWAYS_UNVERIFIED],
    changes: [{ state: 'S11.6', summary: `${visible ? 'Showed' : 'Hid'} ${modelKeys.length} model(s) in the canvas picker.` }],
    blastRadius: {
      modelsAppearing: visible ? modelKeys.length : 0,
      modelsDisappearing: visible ? 0 : modelKeys.length,
      recordsDeleted: 0,
      outboundRequests: [],
    },
    nextAction: {
      kind: 'none',
      userSees: visible
        ? `${modelKeys.length} model(s) are now in the canvas model picker, each with a "not yet tried" badge until the user runs one.`
        : `${modelKeys.length} model(s) no longer appear in the canvas model picker. Nothing was deleted.`,
    },
    filter: { vendorKey },
  })
}

async function cancelSetup(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const setupId = String(params.setupId)
  await mutateLatest(deps, setupId, (revision) => deps.sessions.cancel(setupId, revision, deps.owner))
  return envelope({
    deps, verb, idempotencyKey: key, setupId,
    claims: [...ALWAYS_UNVERIFIED],
    changes: [{ state: 'S11.0', summary: 'Abandoned the in-progress setup.' }],
    nextAction: { kind: 'none', userSees: 'That setup is gone. Anything already saved — the connection and any key the user pasted — is untouched.' },
  })
}

/** 唯一的不可逆动作。**返回时什么都没删**：删除只在可信 UI 的确认里发生。 */
async function removeProvider(verb: VerbDeclaration, params: Record<string, unknown>, deps: ModelOnboardingDeps, key: string): Promise<OnboardingResult> {
  const vendorKey = String(params.vendorKey)
  const view = buildView(deps)
  if (String(params.ifUnchanged) !== view.fingerprint) {
    throw new IntegrationRequestError(
      'integration_revision_stale',
      'These settings changed since you last read them. Read them again with nomi_list_models and copy the new state.fingerprint verbatim.',
    )
  }
  const connection = view.connections.find((row) => row.vendorKey === vendorKey)
  if (!connection) {
    throw new IntegrationRequestError('integration_session_not_found', `There is no connection called ${vendorKey}. List them with nomi_list_models.`)
  }
  const modelKeys = Array.isArray(params.modelKeys) ? (params.modelKeys as string[]) : undefined
  const recordsToDelete = modelKeys ? modelKeys.length : connection.models.length + 1
  const removal: PendingRemoval = {
    removalId: `rm_${key.slice('idem_'.length, 'idem_'.length + 16)}`,
    vendorKey,
    ...(modelKeys ? { modelKeys } : {}),
    recordsToDelete,
    requestedBy: deps.owner,
  }
  pendingRemovals.set(removal.removalId, removal)
  deps.enqueueRemovalConfirmation?.(removal)
  return envelope({
    deps, verb, idempotencyKey: key, vendorKey,
    claims: [...ALWAYS_UNVERIFIED],
    changes: [{ state: 'S11.6', summary: `Asked the user to confirm deleting ${recordsToDelete} record(s).` }],
    blastRadius: { modelsAppearing: 0, modelsDisappearing: 0, recordsDeleted: recordsToDelete, outboundRequests: [] },
    nextAction: {
      kind: 'user_sees_confirm_card',
      userSees: modelKeys
        ? `Nomi is asking the user to confirm deleting ${modelKeys.length} model record(s) from ${vendorKey}. Nothing is deleted until they accept.`
        : `Nomi is asking the user to confirm deleting the whole ${vendorKey} connection, including its stored key. Nothing is deleted until they accept.`,
      waitWith: 'nomi_await_setup',
    },
    filter: { vendorKey },
  })
}

/** 可信 UI 路径：人点了确认，这里才真删。MCP 面永远到不了这个函数。 */
export function confirmRemovalFromTrustedUi(removalId: string): { deleted: number } {
  const removal = pendingRemovals.get(removalId)
  if (!removal) throw new Error('No pending removal with that id')
  pendingRemovals.delete(removalId)
  if (removal.modelKeys?.length) {
    deleteModelCatalogModels(removal.modelKeys.map((modelKey) => ({ vendorKey: removal.vendorKey, modelKey })))
    return { deleted: removal.modelKeys.length }
  }
  deleteModelCatalogVendor(removal.vendorKey)
  return { deleted: removal.recordsToDelete }
}

/** 测试用：清掉进程内的重放与待确认删除。 */
export function resetModelOnboardingRuntime(): void {
  pendingRemovals.clear()
}
