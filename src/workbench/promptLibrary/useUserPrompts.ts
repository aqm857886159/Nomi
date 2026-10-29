import React from 'react'
import type { UserPromptRestoreSnapshot } from '../../../electron/shared/contracts/promptLibrary'
import i18n from '../../i18n'
import {
  addUserPrompt as apiAdd,
  deleteUserPromptWithSnapshot as apiDelete,
  fetchUserPrompts,
  restoreUserPrompt as apiRestore,
  updateUserPrompt as apiUpdate,
  type LibraryPrompt,
  type PromptMediaType,
} from '../api/promptLibraryApi'
import { getUserPromptsSnapshot, hasLoadedUserPrompts, subscribeUserPrompts } from './userPromptList'

type LoadStatus = { loading: boolean; error: string | null }

/** 不在 React 里预热「我的库」（应用启动后后台载入，挂生成框时只读内存）。读口自己把整表发布进共享缓存，这里不另存一份。 */
export async function loadUserPromptItems(): Promise<LibraryPrompt[]> {
  return hasLoadedUserPrompts() ? getUserPromptsSnapshot() : fetchUserPrompts()
}

export type UserPromptDraft = { title?: string; prompt: string; promptType: PromptMediaType }

export type UseUserPrompts = LoadStatus & {
  /** 此刻的整表：共享缓存的快照，谁写的都是这一份（不经本 hook 的写入口写完也在这里）。 */
  items: LibraryPrompt[]
  reload: () => void
  add: (draft: UserPromptDraft) => Promise<void>
  update: (id: string, patch: Partial<UserPromptDraft>) => Promise<void>
  remove: (id: string) => Promise<UserPromptRestoreSnapshot | null>
  restore: (snapshot: UserPromptRestoreSnapshot) => Promise<void>
}

export type UseUserPromptsOptions = {
  /**
   * 打开时强制重读一次（缺省：缓存里有就不读盘）。只给抽屉用——兜住不经渲染层写口的写入；
   * 挂生成框、`/` 菜单这些随点随挂的路径不要开，它们的预算是 0 次读盘。
   */
  refreshOnOpen?: boolean
}

/**
 * 我的库(用户级)数据 + CRUD。列表是共享的唯一一份（promptLibrary/userPromptList.ts）的订阅，不是 hook 自己的 state：
 * 写口（含不经本 hook 的直调）写完发布，所有挂着的实例当场看到；本 hook 只管 loading / error 与读盘时机。
 */
export function useUserPrompts(opened: boolean, options: UseUserPromptsOptions = {}): UseUserPrompts {
  const refreshOnOpen = options.refreshOnOpen === true
  const items = React.useSyncExternalStore(subscribeUserPrompts, getUserPromptsSnapshot, getUserPromptsSnapshot)
  const [status, setStatus] = React.useState<LoadStatus>({ loading: false, error: null })

  const load = React.useCallback((force: boolean) => {
    if (!force && hasLoadedUserPrompts()) {
      // 已在内存里：不读盘。每次挂生成框都会走这里，没有要清的状态就不 setState（白提交一次）。
      setStatus((prev) => (prev.loading || prev.error ? { loading: false, error: null } : prev))
      return
    }
    setStatus((prev) => (prev.loading && !prev.error ? prev : { loading: true, error: null }))
    fetchUserPrompts().then(
      () => setStatus({ loading: false, error: null }),
      (error: unknown) => setStatus({
        loading: false,
        error: error instanceof Error ? error.message : i18n.t('runtime.promptLibrary.loadFailed'),
      }),
    )
  }, [])

  React.useEffect(() => {
    if (opened) load(refreshOnOpen)
  }, [opened, load, refreshOnOpen])

  const reload = React.useCallback(() => load(true), [load])
  // 写口只管 await：整表由 API 层发布进共享缓存，items 随订阅更新。
  const add = React.useCallback(async (draft: UserPromptDraft) => { await apiAdd(draft) }, [])
  const update = React.useCallback(async (id: string, patch: Partial<UserPromptDraft>) => { await apiUpdate(id, patch) }, [])
  const remove = React.useCallback(async (id: string) => (await apiDelete(id)).deleted, [])
  const restore = React.useCallback(async (snapshot: UserPromptRestoreSnapshot) => { await apiRestore(snapshot) }, [])

  return { items, loading: status.loading, error: status.error, reload, add, update, remove, restore }
}
