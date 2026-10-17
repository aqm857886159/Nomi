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
//
// mapping 全表住在 config/modelCatalogCache（异步载一次进内存）；这里测的是「拿到全表 / 拿不到全表」之后的判据。
import { describe, it, expect, vi, beforeEach } from 'vitest'

// bridge 本身可换：「压根没有 bridge / 没有这个方法 / 读失败」都要落到「查不到」。
let bridge: unknown = null
vi.mock('../../../../desktop/bridge', () => ({ getDesktopBridge: () => bridge }))

const { readModeChannelBody, vendorMappingsReader } = await import('./useChannelCreateBody')
const { loadChannelMappings, notifyModelOptionsRefresh } = await import('../../../../config/modelCatalogCache')

/** 全表 → 读取器 → 判据：和生产同一条路。 */
const read = (list: readonly unknown[] | undefined, vendorKey: string, modelKey: string, taskKind: string, modeId?: string) =>
  readModeChannelBody(vendorKey, modelKey, taskKind, modeId, vendorMappingsReader(list))

const T2I = {
  id: 'm-t2i', vendorKey: 'v', taskKind: 'text_to_image', modelKey: 'nano-banana', modeId: 't2i',
  enabled: true, create: { body: { prompt: '{{request.prompt}}' } },
}
const EDIT = {
  id: 'm-edit', vendorKey: 'v', taskKind: 'image_edit', modelKey: 'nano-banana', modeId: 'edit',
  enabled: true, create: { body: { image_urls: '{{request.params.image_urls}}' } },
}

beforeEach(() => {
  bridge = null
  notifyModelOptionsRefresh('all')
})

describe('readModeChannelBody — 什么算「这家发不出这个模式」的证据', () => {
  it('桶里有这个模式的线缆 → 返回 body + 这条 op 引用的 canonical 键', () => {
    // wireParamKeys 在这里算（唯一拿得到整条 create op 的地方）：渲染层只收到 body 的话，
    // 进程型渠道（无 body、参数在 CLI args）会被误判成什么都发不出。见变体轴收窄。
    expect(read([T2I, EDIT], 'v', 'nano-banana', 'image_edit', 'edit')).toEqual({
      body: EDIT.create.body,
      wireParamKeys: ['image_urls'],
    })
  })

  it('这家有 mapping，但没有这个模式的 → null（判据 (a)：真发不出）', () => {
    expect(read([T2I], 'v', 'nano-banana', 'image_edit', 'edit')).toBeNull()
  })

  // ⚠️ 回归锁（CI 抓到过）：自建中转常常一条 mapping 都不配，能力由 meta.adapter.publicationModes
  // 声明、走通用 transport 发送。把「空列表」读成「不支持」会把这些模型除文生外的模式全部藏光。
  // 空列表 = 无证据 = fail-open，不是判据 (a)。
  it('这家一条 mapping 都没有（自建中转）→ undefined，绝不收窄', () => {
    expect(read([], 'v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
    // 别家有 mapping、这家一条都没有：同样是「没证据」。
    expect(read([{ ...T2I, vendorKey: 'other' }], 'v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
  })

  it('查不到（全表还没载 / 读不出来）→ undefined，fail-open', () => {
    expect(read(undefined, 'v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
  })

  it('vendor / taskKind 缺失 → undefined，不去猜', () => {
    expect(read([T2I, EDIT], '', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
    expect(read([T2I, EDIT], 'v', 'nano-banana', '', 'edit')).toBeUndefined()
  })

  it('老 preload 没有 listMappings / 没有 bridge / 读失败 → 全表载成「查不到」，不因为查不到就藏用户的模式', async () => {
    // 生产里这是真实存在的一档：桌面端升级前的 preload 不导出 listMappings，可选链求值成 undefined。
    bridge = { modelCatalog: {} }
    expect(read(await loadChannelMappings(), 'v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
    notifyModelOptionsRefresh('all')
    bridge = null // 整个 bridge 都没有（网页/测试环境）
    expect(read(await loadChannelMappings(), 'v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
    notifyModelOptionsRefresh('all')
    bridge = { modelCatalog: { listMappings: () => Promise.reject(new Error('main busy')) } }
    expect(read(await loadChannelMappings(), 'v', 'nano-banana', 'image_edit', 'edit')).toBeUndefined()
  })

  it('全表载一次就留在内存里：之后再问不碰桥（挂载路径 0 次 IO）', async () => {
    const listMappings = vi.fn(async () => [T2I, EDIT])
    bridge = { modelCatalog: { listMappings } }
    const list = await loadChannelMappings()
    await loadChannelMappings()
    expect(listMappings).toHaveBeenCalledTimes(1)
    expect(read(list, 'v', 'nano-banana', 'image_edit', 'edit')).toEqual({ body: EDIT.create.body, wireParamKeys: ['image_urls'] })
    // 目录变了 → 作废 → 下次用到再载。
    notifyModelOptionsRefresh('all')
    await loadChannelMappings()
    expect(listMappings).toHaveBeenCalledTimes(2)
  })
})
