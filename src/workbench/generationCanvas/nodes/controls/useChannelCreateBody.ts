/**
 * 取「这个节点当前选中的模型，在它所接的那条渠道上，实际会发出去的请求体」。
 *
 * 为什么节点需要它：UI 的模式/槽由**模型档案**声明（供应商无关），真正发得出什么由**渠道 mapping**
 * 决定。两者此前只在「点生成那一刻」才对账，于是用户连好参考、切到「全能参考」、点生成才被拒
 * （docs/plan/2026-08-02-reference-unification-and-channel-honesty）。拿到 body 后节点就能提前说实话。
 *
 * 拿不到就返回 undefined——调用方一律按「不收窄」处理。**宁可少说，也绝不因为查不到就把用户的槽藏掉。**
 *
 * mapping 从哪来（2026-10-16 卡顿波可疑点 j）：以前每次挂生成框都经**同步 IPC** 问主进程，3 份参数控件
 * 各问一遍，主进程一忙点卡就跟着等。现在全表只住一处——`config/modelCatalogCache`：启动后异步载一次进内存、
 * 目录变更作废；这里只读内存，挂载这一刻 0 次 IO。同步那条通道已删。
 */
import React from 'react'
import { selectTaskMapping, type Mapping } from '../../../../../electron/catalog/types'
import { loadChannelMappings, peekChannelMappings, subscribeCatalogCache } from '../../../../config/modelCatalogCache'
import { wireReferencedParamKeys } from './archetypeMeta'
import type { ModeChannelBody } from './channelModeReach'

/** 按供应商取渠道 mapping 列表；undefined = 查不到（无 bridge / 老 preload / 还没载 / 读失败）。 */
export type VendorMappingsReader = (vendorKey: string) => readonly unknown[] | undefined

/** 没有证据：每一家都「查不到」→ 调用方 fail-open，不收窄。 */
const NO_EVIDENCE: VendorMappingsReader = () => undefined
const NO_MAPPINGS: readonly unknown[] = Object.freeze([])

/** 同一份全表只按供应商分一次组（与主进程 `filterByParams({ vendorKey })` 同一判据：vendorKey 相等）。 */
const readerByList = new WeakMap<readonly unknown[], VendorMappingsReader>()

/** 把渠道 mapping 全表变成「按供应商取」的读取器。全表是 undefined（查不到）→ 每家都查不到。 */
export function vendorMappingsReader(list: readonly unknown[] | undefined): VendorMappingsReader {
  if (!list) return NO_EVIDENCE
  const cached = readerByList.get(list)
  if (cached) return cached
  const byVendor = new Map<string, unknown[]>()
  for (const mapping of list) {
    const vendorKey = (mapping as { vendorKey?: unknown } | null)?.vendorKey
    if (typeof vendorKey !== 'string') continue
    const bucket = byVendor.get(vendorKey)
    if (bucket) bucket.push(mapping)
    else byVendor.set(vendorKey, [mapping])
  }
  const reader: VendorMappingsReader = (vendorKey) => byVendor.get(vendorKey) ?? NO_MAPPINGS
  readerByList.set(list, reader)
  return reader
}

/**
 * 订阅内存里的渠道 mapping 全表。还没载过（应用刚起、预热还没回来）就载一次，载好之前一律「查不到」→ 不收窄；
 * 载好后订阅通知重渲。读取器按全表身份记住：同一份全表 = 同一个读取器引用，下游 memo 不会白算。
 */
export function useVendorMappingsReader(): VendorMappingsReader {
  const snapshot = React.useSyncExternalStore(subscribeCatalogCache, peekChannelMappings, peekChannelMappings)
  React.useEffect(() => {
    if (!snapshot.loaded) void loadChannelMappings()
  }, [snapshot.loaded])
  return snapshot.loaded ? vendorMappingsReader(snapshot.list) : NO_EVIDENCE
}

/**
 * 一次寻址：**先证明「这个桶我查得到」，再报「桶里有没有这个模式的线缆」**。
 *
 * 三态（`ModeChannelBody`）不是过度设计——它把两件长得一样、处置却相反的事分开：
 * - 查不出来（无 bridge / 老 preload / 未知 vendor / 自建中转 / 还没载好）→ `undefined` → **fail-open 不收窄**；
 * - 桶查得到、里面就是没有这个模式的 mapping → `null` → 这家真发不出这个模式（判据 (a)）。
 * 合成一个 `null` 的话，「查不到」会被当成「发不出」，第一次遇到老 preload 就把用户全部模式藏光。
 */
export function readModeChannelBody(
  vendorKey: string,
  modelKey: string,
  taskKind: string,
  modeId: string | undefined,
  readMappings: VendorMappingsReader,
): ModeChannelBody {
  if (!vendorKey || !taskKind) return undefined
  try {
    const list = readMappings(vendorKey)
    if (!list) return undefined // 查不到 → fail-open。
    // **这家一条 mapping 都没有 → 同样是「没证据」，不是「不支持」。**
    // 自建中转（用户自己接的模型）常常一条 mapping 都不配：它的能力由 meta.adapter.publicationModes
    // 声明、走通用 transport 发送。把「空桶」读成判据 (a) 会把这些模型除文生外的模式**全部藏光**——
    // 正好砍到最该保护的那批用户。CI 的 group-reference-direction 走查（ux-local 供应商、mappings: []）
    // 就是这么红的：「改图」模式被静默摘掉。空列表 = 无证据 = fail-open。
    if (list.length === 0) return undefined
    // selectTaskMapping = 主进程选 mapping 的那把尺子本尊（精确 modelKey 优先、再回落无 modelKey 的通配，
    // 且 modeId 给定时不再借用别的模式的专属线缆），直接复用而不是在这儿重写一遍——重写就会有
    // 「UI 看 A、生成走 B」的第二种漂移。**modeId 必须一起传**：runtime.findTaskMapping 传了它，这里不传
    // 就会拿到一条生成路径根本不会用的 body，收窄依据与实际发送再次分家。
    const mapping = selectTaskMapping(list as Mapping[], vendorKey, taskKind as Mapping['taskKind'], modelKey, modeId)
    if (!mapping) return null
    // wireParamKeys 在这里算而不是留给调用方：只有这儿拿得到**整条 create op**。渲染层若只收到 body，
    // 进程型渠道（即梦走 create.process.args，根本没有 body）会被误判成「什么参数都发不出」。
    return { body: mapping.create?.body ?? null, wireParamKeys: wireReferencedParamKeys(mapping.create) }
  } catch {
    return undefined
  }
}

/**
 * 一组 (taskKind, modeId) 各自的 create body。模式栏收窄要**同时**看档案声明的每个模式（至多两个
 * taskKind：text_to_video / image_to_video），不能只看当前选中那个。
 *
 * `specs` 由调用方按稳定 key 提供；只在 key 串、模型或 mapping 全表变化时重算（纯内存，不碰 IPC）。
 */
export function useChannelCreateBodies(
  vendorKey: string,
  modelKey: string,
  specs: ReadonlyArray<{ key: string; taskKind: string; modeId?: string }>,
  readMappings: VendorMappingsReader,
): Record<string, ModeChannelBody> {
  // 依赖签名：把 specs 序列化成串，避免调用方每渲染新建数组导致每帧重算。用 JSON 而非自造
  // 分隔符——modelKey/modeId 里出现分隔字符时，手拼的串会静默错位（那类 bug 只在个别模型上现形）。
  const signature = JSON.stringify(specs.map((s) => [s.key, s.taskKind, s.modeId ?? '']))
  return React.useMemo(() => {
    const out: Record<string, ModeChannelBody> = {}
    for (const [key, taskKind, modeId] of JSON.parse(signature) as string[][]) {
      out[key] = readModeChannelBody(vendorKey, modelKey, taskKind, modeId || undefined, readMappings)
    }
    return out
  }, [vendorKey, modelKey, signature, readMappings])
}
