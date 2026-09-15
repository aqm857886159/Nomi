// 探针回给模型的信封 —— MCP 探针 server 和 DeepSeek 直连臂**共用这一份**，
// 否则两臂看到的世界不一样，跑出来的数字不能互相比。
//
// 两条纪律：
//  ① 信封故意**不**代表成功：unverified 里一直留着 model_produces_output，
//     nextAction 说明还没完。会谎称「接好了」的探针会把分数刷高
//     （docs/lessons/assert-you-are-in-the-situation-you-claim）。
//  ② **每个 case 按它的 state 铺一个对得上的世界**。第一版所有 case 共用一个世界，
//     结果 nomi_list_models 一律报「已经有一个 setup 在等你贴 key」，模型很合理地
//     停下来让用户去贴——于是「读完再动手」被记成「没做对」。那是 harness 的 bug 被
//     洗成产品结论（docs/lessons/harness-catch-launders-bugs-into-verdicts）。

import fs from 'node:fs'
import path from 'node:path'

const VENDOR = 'probe-vendor'

// 初始世界的**唯一 owner** 是题库 JSON 的 `_worlds.byState`（P1：搬过去的同 commit 删掉
// 这里原来那个 switch）。零额度夹具 electron/capabilityCore/modelOnboardingLoopback.test.ts
// 读同一份，所以两臂看到的世界一样，数字才能互相比。
const BANK_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), '../../tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json')
const WORLDS = JSON.parse(fs.readFileSync(BANK_PATH, 'utf8'))._worlds.byState

/** 按题库 case 的 state 取初始世界。深拷贝：一个 case 改了世界不许漏到下一个 case。 */
export function worldFor(state) {
  return structuredClone(WORLDS[state] ?? WORLDS['S11.6'])
}

export function envelopeFor(name, args, seq = 1, world = worldFor('S11.6')) {
  const action = typeof args?.action === 'string' ? args.action : null
  const state = { fingerprint: 'fp_probe_abcdef123456', connections: world.connections, setups: world.setups }
  const base = {
    ok: true, setupId: world.setups[0]?.id ?? 'setup_probe_0001', vendorKey: args?.vendorKey ?? world.connections[0]?.vendorKey ?? VENDOR,
    changeId: `chg_probe_${seq}`,
    unverified: [{ claim: 'model_produces_output', why: 'no generation has been run' }],
    changes: [], blastRadius: { recordsDeleted: 0, modelsAppearing: 0, modelsDisappearing: 0, outboundRequests: [] },
    nextAction: { kind: 'none', userSees: 'Nothing is pending.', waitWith: null, url: null },
  }
  if (name === 'nomi_list_models') return { ...base, state }
  if (name === 'nomi_await_setup') return { ...base, state: { ...state, setups: state.setups.map((s) => ({ ...s, waitingOn: null })) } }
  if (name === 'nomi_model_setup' && action === 'connect_provider') {
    return { ...base, nextAction: { kind: 'user_sees_key_page', userSees: 'Nomi opened its own key page and is asking the user for the key.', waitWith: 'nomi_await_setup', url: null } }
  }
  if (name === 'nomi_model_setup' && action === 'check_connection') {
    return { ...base, blastRadius: { ...base.blastRadius, outboundRequests: [{ url: 'https://probe.example.com/v1/models', billable: false }] } }
  }
  if (name === 'nomi_remove_provider') {
    return { ...base, blastRadius: { ...base.blastRadius, recordsDeleted: 1 },
      nextAction: { kind: 'user_sees_confirm_card', userSees: 'The user is being shown a confirmation card; nothing is deleted yet.', waitWith: 'nomi_await_setup', url: null } }
  }
  return base
}
