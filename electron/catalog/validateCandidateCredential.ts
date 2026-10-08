import { BrowserWindow } from 'electron'
import { readCatalog, normalizeProviderKind, mutateCatalog } from './catalogStore'
import { decryptApiKeyRecord } from './secrets'
import type { Vendor } from './types'
import { authQueryParams } from '../ai/requestPipeline'
import { vendorAuthSpec } from './vendorAuthSpec'
import { buildAuthHeaders, fetchModelList, readExtraHeaders } from '../ai/onboarding/modelListProbe'
import { isJsonRecord } from '../jsonUtils'
import { desktopT } from '../i18n'
import { providerProxyUrl } from '../providerNetwork'
import { hasBuiltinCredentialJudgement } from './builtinVendorSeeds'
import { credentialProbePlan } from './credentialProbePolicy'
import { probeDirectKeyCredential, publishBuiltinCuratedVendor } from './directKeyCredential'

/**
 * 返回「是否仍待验证」；明确的鉴权拒绝直接抛，候选不发布。
 *
 * 判据按**种子声明**分派（credentialProbePolicy），不按 vendor 名、也不假设人人都有
 * `GET /v1/models`：apimart 对合法 key 恒 401、minimax 回 200 却连最小生成都跑不通，
 * 两个方向的反例都在我们自己的证据里（prior-art ④）。
 */
/**
 * 验证失败的那句话 —— 「原密钥和连接已保留」**只在真有原密钥时才说**（2026-09-17，W-17）。
 *
 * 为什么它曾经恒在：这半句被烤进了 `credential.invalid` / `credential.validationUnavailable`
 * 两条词条里，而抛异常的那一层压根不知道这个 vendor 之前有没有存过 key。于是**第一次**接入
 * 失败时用户读到的是「原密钥和连接已保留」——他没有原密钥，这半句对他是噪音，还暗示着
 * 「刚才那把是不是被存进去了」。
 *
 * 修在这里而不是在渲染层删字符串：判据（有没有原密钥）只有这一层拿得到，
 * 而渲染层能做的只有按子串猜——那正是本仓五张「错误码 → 人话」表当初要替掉的东西。
 */
function credentialFailure(messageKey: 'credential.invalid' | 'credential.validationUnavailable', vendorKey: string): Error {
  const kept = Boolean(readCatalog().apiKeysByVendor[vendorKey])
  return new Error(kept ? `${desktopT(messageKey)}${desktopT('credential.previousKept')}` : desktopT(messageKey))
}

export async function validateCandidateCredential(vendor: Vendor, apiKey: string): Promise<boolean> {
  const strategy = credentialProbePlan(vendor.key).kind
  // 内置家里没有便宜且可信的预检的那一类（最小真实请求 = 一次付费生成，不能替用户花钱）：
  // 存 key 即发布，首次生成时的鉴权失败走现有诚实报错。
  // 火山语音这类 authType:'none'（三头鉴权由 audioTaskRunner 手搓）也从这条路存得进去。
  //
  // 刻意**不**标 verificationPending：那个标记在本仓的语义是「这次没验成，之后还会再验」
  // （UI 文案逐字为「已保存 · 未验证 / 联网后会自动复验，下次调用前也会先检查一次」）。
  // 对这一类我们不会再验——没有可验的便宜端点。挂上它等于让 12 家常驻一句做不到的承诺，
  // 并把接入卡上的「N 个可使用」永久换成「未验证」。那还是名实不一，只是换了个方向。
  //
  // `authType: 'none'` 走同一条路，理由更硬：这家**根本不发鉴权**，所以没有「验证密钥」这件事
  // 可做。它以前落在下面那条 throw 里，用户读到的是「暂时无法验证密钥，请检查接口地址和网络
  // 后重试」——地址和网络都没问题，问题是我们拿一件不存在的事当失败报（名实不一）。同一份判据
  // 在可用性 owner 那边早就写对了：`modelAvailability.ts:93` 对 `authType === 'none'` 直接判可用、
  // 连钥匙都不探；`catalogModelAvailability.ts:32` 同样短路。这里是那条不变量漏掉的第三处。
  if (strategy === 'first-use' || vendor.authType === 'none') {
    if (!apiKey) throw credentialFailure('credential.validationUnavailable', vendor.key)
    return false
  }
  if (!apiKey || !vendor.baseUrlHint) {
    throw credentialFailure('credential.validationUnavailable', vendor.key)
  }
  // 种子声明了凭据探测端点的（apimart / higgsfield）：那份代码拥有的 credentialProbe 才是诚实的 key 判据。
  // 花不花钱、要不要先问，由 `credentialProbePolicy` 决定，`probeDirectKeyCredential` 执行。
  if (strategy === 'seed-probe') {
    const outcome = await probeDirectKeyCredential(vendor, apiKey)
    if (outcome === 'invalid-key') throw credentialFailure('credential.invalid', vendor.key)
    // `declined` = 用户在报价卡上说了「不发」。那不是失败：密钥照存（标未验证），
    // 判据留给首次真实调用的诚实报错——把它当失败就等于「不付这一下钱就别想接入」。
    return outcome !== 'verified'
  }
  const providerKind = normalizeProviderKind(vendor.providerKind)
  const authType = vendor.authType || (providerKind === 'anthropic' ? 'x-api-key' : 'bearer')
  const headers = buildAuthHeaders(
    providerKind,
    apiKey,
    readExtraHeaders(isJsonRecord(vendor.meta) ? vendor.meta.extraHeaders : undefined),
    { ...vendorAuthSpec(vendor), authType },
  )
  const result = await fetchModelList(providerKind, vendor.baseUrlHint, headers, AbortSignal.timeout(12_000), {
    query: authQueryParams({ ...vendorAuthSpec(vendor), authType }, apiKey),
    proxyUrl: providerProxyUrl(vendor),
  })
  if (!result.ok && result.failureKind === 'auth') throw credentialFailure('credential.invalid', vendor.key)
  return !result.ok
}

export function candidateCredentialSnapshot(vendorKey: string): string {
  const state = readCatalog()
  return JSON.stringify({ vendor: state.vendors.find((vendor) => vendor.key === vendorKey), key: state.apiKeysByVendor[vendorKey] })
}


const pendingProbes = new Map<string, { snapshot: string; promise: Promise<void> }>()

/** One zero-cost probe before a pending credential is used. Never promotes model certification. */
export async function revalidatePendingCredential(vendorKey: string): Promise<void> {
  const state = readCatalog()
  const credential = state.apiKeysByVendor[vendorKey]
  if (!credential?.verificationPending) return
  // 存量装机可能还留着本次改动之前写下的 pending 记录。对 `first-use` 这一类没有零成本预检
  // 可跑（唯一判据就是这次真实调用本身），在这里挡住等于把「没法便宜地预检」翻译成「不许用」。
  // 鉴权真错时，上游 401 会经现有诚实报错路径回到用户面前。
  const plan = credentialProbePlan(vendorKey)
  if (plan.kind === 'first-use') return
  // 会花钱的探测**只由用户显式点「保存验证」发起**（T-MO-10，2026-09-22）。首用前的这一下
  // 是我们自己挑的时机，不该在这里横插一张付费确认卡；判据本来就有——紧接着的那次真实调用。
  if (plan.cost === 'paid') return
  const vendor = state.vendors.find(item => item.key === vendorKey)
  if (!vendor) throw credentialFailure('credential.validationUnavailable', vendorKey)
  const snapshot = candidateCredentialSnapshot(vendorKey)
  const inflight = pendingProbes.get(vendorKey)
  if (inflight?.snapshot === snapshot) return inflight.promise
  const promise = (async () => {
    const pending = await validateCandidateCredential(vendor, decryptApiKeyRecord(credential))
    if (snapshot !== candidateCredentialSnapshot(vendorKey)) throw new Error(desktopT('credential.changed'))
    if (pending) throw new Error(desktopT('credential.revalidationUnavailable'))
    mutateCatalog((_tx, current) => { delete current.apiKeysByVendor[vendorKey].verificationPending })
    // pending→verified 的转正：探测型凭据存进来时是 enabled:false（诚实门要求未验证先不发布），
    // 复检通过后凭据与 vendor 一起发布——只清 pending 不发布，用户会卡在
    // 「验证过了但模型还是不出现」的半截状态。
    if (hasBuiltinCredentialJudgement(vendorKey)) {
      mutateCatalog((_tx, current) => { const record = current.apiKeysByVendor[vendorKey]; if (record) record.enabled = true })
      publishBuiltinCuratedVendor(vendorKey)
    }
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('nomi:model-catalog:changed')
  })()
  pendingProbes.set(vendorKey, { snapshot, promise })
  try { await promise } finally {
    if (pendingProbes.get(vendorKey)?.promise === promise) pendingProbes.delete(vendorKey)
  }
}
