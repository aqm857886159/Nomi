// 渠道 body 三态的边界锁。
//
// 这三态直接决定「模式栏收窄」的行为，而收窄错了**没有任何报错**——只是用户少了一个模式，
// 谁也不会注意到。所以「什么算证据」必须逐条钉死，尤其是两种长得一样、处置却相反的情况：
//   · 查不到 / 无证据 → undefined → fail-open，绝不收窄
//   · 桶里确实没有这个模式的线缆 → null → 判据 (a)，这家发不出这个模式
//
// 本文件的存在是有账的：`list.length === 0`（自建中转一条 mapping 都不配）曾被错误地读成
// 第二种，导致 CI 的 group-reference-direction 走查红——「改图」模式被静默摘掉。当时这个
// 函数没有任何单测，所以那个 bug 一路溜到了 CI。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const listMappings = vi.fn()
// bridge 本身可换：既要测「listMappings 返回什么」，也要测「压根没有 bridge / 没有这个方法」。
let bridge: unknown = { modelCatalog: { listMappings } }
vi.mock('../../../../desktop/bridge', () => ({ getDesktopBridge: () => bridge }))

const { readModeChannelBody } = await import('./useChannelCreateBody')

const T2I = {
  id: 'm-t2i', vendorKey: 'v', taskKind: 'text_to_image', modelKey: 'nano-banana', modeId: 't2i',
  enabled: true, create: { body: { prompt: '{{request.prompt}}' } },
}
const EDIT = {
  id: 'm-edit', vendorKey: 'v', taskKind: 'image_edit', modelKey: 'nano-banana', modeId: 'edit',
  enabled: true, create: { body: { image_urls: '{{request.params.image_urls}}' } },
}

beforeEach(() => {
  listMappings.mockReset()
  bridge = { modelCatalog: { listMappings } }
})

describe('readModeChannelBody — 什么算「这家发不出这个模式」的证据', () => {
  it('桶里有这个模式的线缆 → 返回 body + 这条 op 引用的 canonical 键', () => {
    listMappings.mockReturnValue([T2I, EDIT])
    // wireParamKeys 在这里算（唯一拿得到整条 create op 的地方）：渲染层只收到 body 的话，
    // 进程型渠道（无 body、参数在 CLI args）会被误判成什么都发不出。见变体轴收窄。
    expect(readModeChannelBody('v', 'nano-banana', 'image_edit', 'edit')).toEqual({
      body: EDIT.create.body,
      wireParamKeys: ['image_urls'],
    })
  })

  it('这家有 mapping，但没有这个模式的 → null（判据 (a)：真发不出）', () => {
    listMappings.mockReturnValue([T2I])
    expect(readModeChannelBody('v', 'nano-banana', 'image_edit', 'edit')).toBeNull()
  })

  // ⚠️ 回归锁（CI 抓到过）：自建中转常常一条 mapping 都不配，能力由 meta.adapter.publicationModes
  // 声明、走通用 transport 发送。把「空列表」读成「不支持」会把这些模型除文生外的模式全部藏光。
  // 空列表 = 无证据 = fail-open，不是判据 (a)。
  it('这家一条 mapping 都没有（自建中转）→ undefined，绝不收窄', () => {
    listMappings.mockReturnValue([])
    expect(readModeChannelBody('v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
  })

  it('查不到（老 preload / 无 bridge / 返回非数组）→ undefined，fail-open', () => {
    listMappings.mockReturnValue(undefined)
    expect(readModeChannelBody('v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
    listMappings.mockReturnValue(null)
    expect(readModeChannelBody('v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
  })

  it('vendor / taskKind 缺失 → undefined，不去猜', () => {
    listMappings.mockReturnValue([T2I, EDIT])
    expect(readModeChannelBody('', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
    expect(readModeChannelBody('v', 'nano-banana', '', 'edit')).toBeUndefined()
  })

  it('老 preload 没有 listMappings 这个方法 → undefined，不因为查不到就藏用户的模式', () => {
    // 生产里这是真实存在的一档：桌面端升级前的 preload 不导出 listMappings，可选链求值成 undefined。
    bridge = { modelCatalog: {} }
    expect(readModeChannelBody('v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
    bridge = null // 整个 bridge 都没有（网页/测试环境）
    expect(readModeChannelBody('v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
  })
})
