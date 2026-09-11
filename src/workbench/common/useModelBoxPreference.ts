// 模型框偏好的渲染层单例存储（与 `useVendorPreference.ts` 同构：一份内存值 + 订阅者集合）。
//
// 为什么是模块级单例而不是 React context：模型框在画布节点、分镜条、批量条、Agent 面板各有一处，
// 它们不共祖先。context 要么挂到 App 根（一个只有四个字段的偏好不配拿一层 provider），
// 要么每处各自读一次 IPC（四次读 = 四种加载态，且改一次顺序只有点过的那处会更新）。
import * as React from 'react'
import { getModelBoxPreference, setModelBoxPreference } from '../api/modelBoxPreferenceApi'
import {
  DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS,
  type ModelBoxPreferenceSettings,
} from '../../../electron/shared/contracts/modelBoxPreference'

let preference: ModelBoxPreferenceSettings = DEFAULT_MODEL_BOX_PREFERENCE_SETTINGS
let loaded = false
let promise: Promise<void> | null = null
const listeners = new Set<() => void>()
function notify(): void { for (const listener of listeners) listener() }

export function loadModelBoxPreference(): Promise<void> {
  // 已经有值了就不再回盘取：偏好只会被本进程自己改（写完就 notify），
  // 而重复取数会把设计实验室种进来的那份冲掉（见 seedModelBoxPreferenceForLab）。
  if (loaded) return Promise.resolve()
  if (promise) return promise
  promise = getModelBoxPreference()
    .then((value) => { preference = value; loaded = true; notify() })
    .catch(() => { loaded = true; notify() })
    .finally(() => { promise = null })
  return promise
}

export function useModelBoxPreference(): ModelBoxPreferenceSettings {
  React.useEffect(() => { void loadModelBoxPreference() }, [])
  return React.useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    () => preference,
    () => preference,
  )
}

export function modelBoxPreferenceLoaded(): boolean { return loaded }

/**
 * 设计实验室/测试专用种子：与 `seedModelCatalogForTests` 同一手法——只替掉**最外面那一次取数**，
 * 从这里往下（排序、隐藏、chip 高亮、自动选家）全部仍是现役代码。
 *
 * 为什么需要它：实验室跑在浏览器里、没有桌面桥，读偏好会静默落回默认值（没排过、没藏过、没记过），
 * 于是「已隐藏 · 2」这一组永远渲不出来——拍板过的形态在基线里根本不存在。
 */
export function seedModelBoxPreferenceForLab(value: ModelBoxPreferenceSettings): void {
  preference = value
  loaded = true
  notify()
}

/** 读当前值（非 React 路径用，如 chip 点击回调里要基于最新值做增量写）。 */
export function getModelBoxPreferenceSnapshot(): ModelBoxPreferenceSettings { return preference }

async function commit(next: ModelBoxPreferenceSettings): Promise<void> {
  const value = await setModelBoxPreference(next)
  preference = value
  loaded = true
  notify()
}

export async function saveModelBoxOrder(modelOrder: readonly string[]): Promise<void> {
  await commit({ ...preference, modelOrder: [...modelOrder] })
}

export async function setModelHidden(canonicalId: string, hidden: boolean): Promise<void> {
  const id = canonicalId.trim()
  if (!id) return
  const current = new Set(preference.hiddenModelIds)
  if (hidden) current.add(id)
  else current.delete(id)
  await commit({ ...preference, hiddenModelIds: [...current] })
}

/**
 * 记住「这个模型我走哪家」。
 *
 * 只该由**用户显式点供应商**的路径调用（行尾 chip、供应商下拉）——自动选家不写。
 * 不需要「清除记忆」按钮：点另一家就是覆盖，天然可逆（方案 §6 删除清单）。
 */
export async function rememberVendorForModel(canonicalId: string, vendorKey: string | null | undefined): Promise<void> {
  const id = canonicalId.trim()
  const vendor = (vendorKey || '').trim()
  if (!id || !vendor) return
  if (preference.preferredVendorByModel[id] === vendor) return
  await commit({ ...preference, preferredVendorByModel: { ...preference.preferredVendorByModel, [id]: vendor } })
}
