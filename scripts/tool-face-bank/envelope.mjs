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

const VENDOR = 'probe-vendor'

/** 按题库 case 的 state 铺初始世界。近似，但每一格都对得上该状态下用户会说的那些话。 */
export function worldFor(state) {
  const model = (key, kind, extra = {}) => ({ modelKey: key, kind, visible: false, lastSelfCheck: null, ...extra })
  switch (state) {
    case 'S11.0': // 还没有任何已保存的连接，但手上有一个半途的接入
      return { connections: [], setups: [{ id: 'setup_probe_0001', vendorKey: 'halfway-vendor', name: 'Halfway Vendor', waitingOn: 'user_pastes_key', step: 'connect_provider' }] }
    case 'S11.1': // 已经接好过一家，现在要接**新的一家**（或改现有这家的地址）
      return { connections: [{ vendorKey: VENDOR, name: 'Probe Vendor', baseUrl: 'https://probe.example.com/v1', authStyle: 'header', hasStoredKey: true, models: [model('probe-model-a', 'text', { visible: true })] }], setups: [] }
    case 'S11.2': // 连接建好了，key 还没落地
      return { connections: [{ vendorKey: VENDOR, name: 'Probe Vendor', baseUrl: 'https://probe.example.com/v1', authStyle: 'header', hasStoredKey: false, models: [] }], setups: [{ id: 'setup_probe_0001', vendorKey: VENDOR, waitingOn: 'user_pastes_key', step: 'connect_provider' }] }
    case 'S11.3': // key 有了，候选模型已探到，等着挑
      return { connections: [{ vendorKey: VENDOR, name: 'Probe Vendor', baseUrl: 'https://probe.example.com/v1', hasStoredKey: true, models: [], candidates: [model('probe-text-1', 'text'), model('probe-image-1', 'image'), model('probe-video-1', 'video')] }], setups: [{ id: 'setup_probe_0001', vendorKey: VENDOR, waitingOn: null, step: 'choose_models' }] }
    case 'S11.4': // 供应商没有 model-list 端点，等模型写请求配方
      return { connections: [{ vendorKey: VENDOR, name: 'Probe Vendor', baseUrl: 'https://probe.example.com/v1', hasStoredKey: true, models: [] }], setups: [{ id: 'setup_probe_0001', vendorKey: VENDOR, waitingOn: null, step: 'draft_adapter', compileRequest: { contractSchema: '{"sources":[],"models":[]}' } }] }
    case 'S11.5': // 模型已挑好，自检刚失败（401），还没有出现在画布模型框里
      return { connections: [{ vendorKey: VENDOR, name: 'Probe Vendor', baseUrl: 'https://probe.example.com/v1', hasStoredKey: true, models: [model('probe-text-1', 'text', { lastSelfCheck: { ok: false, code: 401, excerpt: '{"error":"invalid_api_key"}' } }), model('probe-image-1', 'image')] }], setups: [{ id: 'setup_probe_0001', vendorKey: VENDOR, waitingOn: null, step: 'check_connection' }] }
    case 'S11.6': // 都接好了，画布模型框里一堆，用户想收拾
    default:
      return { connections: [{ vendorKey: VENDOR, name: 'Probe Vendor', baseUrl: 'https://probe.example.com/v1', hasStoredKey: true, models: [model('probe-text-1', 'text', { visible: true }), model('probe-image-1', 'image', { visible: true }), model('probe-video-1', 'video', { visible: false, notInPickerBecause: 'hidden by the user' })] }], setups: [] }
  }
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
