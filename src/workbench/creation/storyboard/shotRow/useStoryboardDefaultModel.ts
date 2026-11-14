import React from 'react'
import type { ModelOption } from '../../../../config/models'
import { findModelOptionByIdentifier } from '../../../../config/modelOptionResolvers'
import { resolveStoryboardImageDefault, resolveStoryboardVideoDefault } from '../../../generationCanvas/agent/availableModels'

type DefaultModelRef = { modelKey?: string; modelVendor?: string }

/**
 * 一镜不存模型时，落画布会用哪个模型——和落地同一个解析（`resolveStoryboard*Default`：设置里保存的默认优先，
 * 缺席走兜底阶梯），这里只读它的结果给「默认模型」那一行画图标、写说明，不另写一套规则。
 *
 * 一张分镜表几十行同时问：同一份目录（modelOptions 引用不变）同一种类只解析一次。
 */
const pending = new WeakMap<readonly ModelOption[], Map<'image' | 'video', Promise<DefaultModelRef>>>()

function resolveOnce(kind: 'image' | 'video', modelOptions: readonly ModelOption[]): Promise<DefaultModelRef> {
  let byKind = pending.get(modelOptions)
  if (!byKind) { byKind = new Map(); pending.set(modelOptions, byKind) }
  let promise = byKind.get(kind)
  if (!promise) {
    promise = (kind === 'image' ? resolveStoryboardImageDefault() : resolveStoryboardVideoDefault()).catch(() => ({}))
    byKind.set(kind, promise)
  }
  return promise
}

export function useStoryboardDefaultModel(
  kind: 'image' | 'video',
  modelOptions: readonly ModelOption[],
  orderedVendorKeys: readonly string[],
): ModelOption | null {
  const [ref, setRef] = React.useState<DefaultModelRef>({})
  React.useEffect(() => {
    let live = true
    void resolveOnce(kind, modelOptions).then((next) => { if (live) setRef(next) })
    return () => { live = false }
  }, [kind, modelOptions])
  return ref.modelKey ? findModelOptionByIdentifier(modelOptions, ref.modelKey, ref.modelVendor, orderedVendorKeys) : null
}
