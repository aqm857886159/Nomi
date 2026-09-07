// 技能库面板的数据 hook：列出技能（内置+用户合并）、当前可用模态、删除/导入/导出。
// 列表是同步 IPC（invokeSync）；可用模态是异步（读 catalog health）。catalog 变了（接入新模型）
// 监听 nomi-model-catalog-changed 重算可用模态，让「缺 provider」标记实时刷新。
import React from 'react'
import {
  deleteWorkbenchSkill,
  exportWorkbenchSkill,
  getAvailableSkillProviders,
  importWorkbenchSkill,
  listWorkbenchSkills,
  type SkillListItemDto,
  type SkillProviderKind,
} from '../api/skillApi'
import { notifySkillLibraryChanged, onSkillLibraryChanged } from './skillLibraryChanged'

export type UseWorkbenchSkills = {
  items: SkillListItemDto[]
  available: ReadonlySet<SkillProviderKind>
  reload: () => void
  remove: (dirName: string) => { ok: boolean; error?: string }
  importPackage: (payload: unknown) => { ok: boolean; skillName?: string; error?: string }
  exportPackage: (dirName: string) => unknown
}

export function useWorkbenchSkills(opened: boolean): UseWorkbenchSkills {
  const [items, setItems] = React.useState<SkillListItemDto[]>([])
  const [available, setAvailable] = React.useState<ReadonlySet<SkillProviderKind>>(new Set())

  const reload = React.useCallback(() => {
    try {
      setItems(listWorkbenchSkills())
    } catch {
      setItems([])
    }
    getAvailableSkillProviders()
      .then(setAvailable)
      .catch(() => setAvailable(new Set()))
  }, [])

  React.useEffect(() => {
    if (!opened) return
    reload()
    const onCatalogChanged = (): void => {
      getAvailableSkillProviders()
        .then(setAvailable)
        .catch(() => setAvailable(new Set()))
    }
    window.addEventListener('nomi-model-catalog-changed', onCatalogChanged)
    // 别的面板（或本面板的另一个实例）写了技能盘就重读——列表只有一个真相源在盘上。
    const offSkills = onSkillLibraryChanged(reload)
    return () => {
      window.removeEventListener('nomi-model-catalog-changed', onCatalogChanged)
      offSkills()
    }
  }, [opened, reload])

  const remove = React.useCallback(
    (dirName: string) => {
      const res = deleteWorkbenchSkill(dirName)
      if (res.ok) notifySkillLibraryChanged()
      return { ok: res.ok, error: res.error }
    },
    [],
  )

  const importPackage = React.useCallback(
    (payload: unknown) => {
      const res = importWorkbenchSkill(payload)
      // 派信号而不是只 reload 自己：Agent 面板的 `/` 技能菜单是同一份盘的另一个读者，
      // 它读不到这次写入就等于「导进来了却用不上」（本轮走查抓到的那一幕）。
      if (res.ok) notifySkillLibraryChanged()
      return { ok: res.ok, skillName: res.skillName, error: res.error }
    },
    [],
  )

  const exportPackage = React.useCallback((dirName: string) => exportWorkbenchSkill(dirName), [])

  return { items, available, reload, remove, importPackage, exportPackage }
}
