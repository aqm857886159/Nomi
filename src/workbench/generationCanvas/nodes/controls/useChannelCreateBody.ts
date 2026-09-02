/**
 * 取「这个节点当前选中的模型，在它所接的那条渠道上，实际会发出去的请求体」。
 *
 * 为什么节点需要它：UI 的模式/槽由**模型档案**声明（供应商无关），真正发得出什么由**渠道 mapping**
 * 决定。两者此前只在「点生成那一刻」才对账，于是用户连好参考、切到「全能参考」、点生成才被拒
 * （docs/plan/2026-08-02-reference-unification-and-channel-honesty）。拿到 body 后节点就能提前说实话。
 *
 * 拿不到就返回 null——调用方一律按「不收窄」处理。**宁可少说，也绝不因为查不到就把用户的槽藏掉。**
 */
import React from 'react'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { selectTaskMapping, type Mapping } from '../../../../../electron/catalog/types'
import type { ModeChannelBody } from './channelModeReach'

/** 目录变更广播（OnboardingDrawer.refresh 发的同一个信号）——接入/停用模型后立刻重算承载力。 */
const CATALOG_CHANGED_EVENT = 'nomi-model-catalog-changed'

/**
 * 一次寻址：**先证明「这个桶我查得到」，再报「桶里有没有这个模式的线缆」**。
 *
 * 三态（`ModeChannelBody`）不是过度设计——它把两件长得一样、处置却相反的事分开：
 * - 查不出来（无 bridge / 老 preload / 未知 vendor / 自建中转）→ `undefined` → **fail-open 不收窄**；
 * - 桶查得到、里面就是没有这个模式的 mapping → `null` → 这家真发不出这个模式（判据 (a)）。
 * 合成一个 `null` 的话，「查不到」会被当成「发不出」，第一次遇到老 preload 就把用户全部模式藏光。
 */
function readModeChannelBody(
  vendorKey: string,
  modelKey: string,
  taskKind: string,
  modeId?: string,
): ModeChannelBody {
  if (!vendorKey || !taskKind) return undefined
  try {
    const list = getDesktopBridge()?.modelCatalog?.listMappings?.({ vendorKey })
    if (!Array.isArray(list)) return undefined // 查不到 → fail-open。
    // selectTaskMapping = 主进程选 mapping 的那把尺子本尊（精确 modelKey 优先、再回落无 modelKey 的通配，
    // 且 modeId 给定时不再借用别的模式的专属线缆），直接复用而不是在这儿重写一遍——重写就会有
    // 「UI 看 A、生成走 B」的第二种漂移。**modeId 必须一起传**：runtime.findTaskMapping 传了它，这里不传
    // 就会拿到一条生成路径根本不会用的 body，收窄依据与实际发送再次分家。
    const mapping = selectTaskMapping(list as Mapping[], vendorKey, taskKind as Mapping['taskKind'], modelKey, modeId)
    return mapping ? { body: mapping.create?.body ?? null } : null
  } catch {
    return undefined
  }
}

/**
 * 一组 (taskKind, modeId) 各自的 create body。模式栏收窄要**同时**看档案声明的每个模式（至多两个
 * taskKind：text_to_video / image_to_video），不能只看当前选中那个。
 *
 * `specs` 由调用方按稳定 key 提供；hook 只在 key 串或目录广播变化时重算（避免每渲染重查 IPC）。
 */
export function useChannelCreateBodies(
  vendorKey: string,
  modelKey: string,
  specs: ReadonlyArray<{ key: string; taskKind: string; modeId?: string }>,
): Record<string, ModeChannelBody> {
  // 依赖签名：把 specs 序列化成串，避免调用方每渲染新建数组导致 effect 每帧重跑。用 JSON 而非自造
  // 分隔符——modelKey/modeId 里出现分隔字符时，手拼的串会静默错位（那类 bug 只在个别模型上现形）。
  const signature = JSON.stringify(specs.map((s) => [s.key, s.taskKind, s.modeId ?? '']))
  const compute = React.useCallback((): Record<string, ModeChannelBody> => {
    const out: Record<string, ModeChannelBody> = {}
    for (const [key, taskKind, modeId] of JSON.parse(signature) as string[][]) {
      out[key] = readModeChannelBody(vendorKey, modelKey, taskKind, modeId || undefined)
    }
    return out
  }, [vendorKey, modelKey, signature])

  const [bodies, setBodies] = React.useState<Record<string, ModeChannelBody>>(compute)
  React.useEffect(() => {
    const recompute = () => setBodies(compute())
    recompute() // 模型/模式集变化即重算
    window.addEventListener(CATALOG_CHANGED_EVENT, recompute)
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, recompute)
  }, [compute])

  return bodies
}
