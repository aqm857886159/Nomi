// 「这把 key 该怎么验、验它要不要花钱」——**唯一那份判据**（T-MO-10，用户 2026-09-22 拍板）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 用户在接入页点「保存验证」，`probeDirectKeyCredential` 当场发一次真实
// `POST /chat/completions`（`max_tokens:1`）——**用户的钱**，而且这条路经 `appFetch`
// 直接出门、不碰 `runtime.ts`、没有 `grantId`，所以报价卡在结构上永远不可能为它出现
// （钱的闸 = 每次提交看报价确认，用户 2026-09-09 拍板；09-11 群反馈撞上）。
//
// 顺带说清一条边界：`VendorSeed.livenessProbe` 是**每周雷达的逐模型存活探针**，那一次按定义
// 就是真实生成、也该由那条每周任务付钱。凭据有效性是另一个问题，所以它有自己的声明位
// `VendorSeed.credentialProbe`。两件事合用一个声明位，就等于让后者继承前者的价格——
// 那正是这次这一族的形状。
//
// 拍板的修法是**免费探测**，两句话：
//   ① 能用免费端点就用（种子声明的零费用 `credentialProbe` / OpenAI 兼容的 `GET /models`）；
//   ② 没有免费端点的，**一个字节都不发**，照「首次使用」处理（D-1117-delete-verification，协调 2026-11-18：
//      保存 key 时只剩 401 / 403 拒收闸，不再为「验证」花钱，也就不再有付费确认卡）。
//
// ── 为什么是一份 ──
//
// 「会在用户未确认时发出可能计费的请求」这个概念曾散在四处（见根因合同
// docs/fixes/2026-09-22-credential-probe-paid-without-consent.root-cause.json 的门表）：
// 接入页保存验证、首用前复验、供应商健康探测、认证自检的凭据步。后三处随
// D-1117-delete-verification 整段删了，只剩保存 key 时的拒收闸。判据仍收在这里：
// 以后谁要再加一条探测路，先问这份策略「我这一下花不花钱」，不花钱才发。
//
// ── 缺省是 fail-closed ──
//
// 种子的 `credentialProbe` 不声明 `cost` 就判 `paid`（= 不发）。理由是一次真实教训：
// 把 Higgsfield 的 `POST /marketing-studio/image` 当余额探针，它只要 prompt 就真排任务，
// 当场烧掉 $0.439。「我以为它免费」必须写成「有出处地声明它免费」才算数。
import { builtinVendorSeed, type VendorSeed } from './builtinVendorSeeds'

export type CredentialProbePlan =
  /**
   * 种子声明、且有出处地证明过零费用的探测端点（apimart 的余额查询、higgsfield 的 estimate 报价）。
   * 声明了会花钱（或没声明 `cost`）的探测不在这一档——落 `first-use`，不发。
   */
  | { kind: 'seed-probe'; cost: 'free'; probe: NonNullable<VendorSeed['credentialProbe']> }
  /**
   * 免费：OpenAI 兼容的模型列表。对「用户自己填地址的兼容端点」这是成立的判据，且零费用。
   * 没有内置种子的行（自定义供应商 / 用户自建中转 / 认证晋升出来的候选）落在这一档。
   */
  | { kind: 'model-list'; cost: 'free' }
  /**
   * 没有便宜且可信的预检——最小真实请求 = 一次付费生成。存 key 即发布，首次调用的鉴权失败
   * 走现有诚实报错。不发请求，所以不花钱。
   */
  | { kind: 'first-use'; cost: 'free' }

/**
 * 这家的凭据该怎么验（**唯一分派点**）。
 *
 * 内置种子自己说了算；没有内置种子的行回落到 `model-list`——那对「用户自己填地址的兼容
 * 端点」确实成立，而且零费用。`keyValidation: 'first-use'` 的内置家（12 家）没有可跑的
 * 便宜预检，落 `first-use`。
 */
export function credentialProbePlan(vendorKey: string): CredentialProbePlan {
  const seed = builtinVendorSeed(vendorKey)
  if (!seed) return { kind: 'model-list', cost: 'free' }
  if (seed.credentialProbe) {
    // 缺省 = paid：没有出处的「我以为它免费」不算数（见文件头）。会花钱的不发，照首次使用处理。
    if ((seed.credentialProbe.cost ?? 'paid') !== 'free') return { kind: 'first-use', cost: 'free' }
    return { kind: 'seed-probe', cost: 'free', probe: seed.credentialProbe }
  }
  if (seed.keyValidation === 'model-list') return { kind: 'model-list', cost: 'free' }
  return { kind: 'first-use', cost: 'free' }
}
