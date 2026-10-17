import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  addUserPrompt as apiAdd,
  deleteUserPrompt as apiDelete,
  fetchUserPrompts,
  updateUserPrompt as apiUpdate,
  type LibraryPrompt,
  type PromptMediaType,
} from '../api/promptLibraryApi'

type State = { items: LibraryPrompt[]; loading: boolean; error: string | null }

// 模块级缓存:面板反复开关不重拉(我的库写操作后即刷新这份)。
let cached: LibraryPrompt[] | null = null

/** 不在 React 里预热「我的库」（应用启动后后台载入，挂生成框时只读内存）。 */
export async function loadUserPromptItems(): Promise<LibraryPrompt[]> {
  if (cached) return cached
  cached = await fetchUserPrompts()
  return cached
}

export type UserPromptDraft = { title?: string; prompt: string; promptType: PromptMediaType }

export type UseUserPrompts = State & {
  reload: () => void
  add: (draft: UserPromptDraft) => Promise<void>
  update: (id: string, patch: Partial<UserPromptDraft>) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** 我的库(用户级)数据 + CRUD;首次打开拉取,写操作后用返回的全量刷新缓存。 */
export function useUserPrompts(opened: boolean): UseUserPrompts {
  const { t } = useTranslation()
  const [state, setState] = React.useState<State>({ items: cached ?? [], loading: false, error: null })

  const apply = React.useCallback((items: LibraryPrompt[]) => {
    cached = items
    setState({ items, loading: false, error: null })
  }, [])

  const load = React.useCallback(
    (force: boolean) => {
      if (!force && cached) {
        // 已在内存里且屏上就是它：不再 setState（每次挂生成框都会走这里，白提交一次）。
        const items = cached
        setState((prev) => (prev.items === items && !prev.loading && !prev.error ? prev : { items, loading: false, error: null }))
        return
      }
      setState((prev) => ({ ...prev, loading: true, error: null }))
      fetchUserPrompts()
        .then(apply)
        .catch((error: unknown) =>
          setState({
            items: cached ?? [],
            loading: false,
            error: error instanceof Error ? error.message : t('runtime.promptLibrary.loadFailed'),
          }),
        )
    },
    [apply, t],
  )

  React.useEffect(() => {
    if (opened) load(false)
  }, [opened, load])

  const add = React.useCallback(async (draft: UserPromptDraft) => apply(await apiAdd(draft)), [apply])
  const update = React.useCallback(
    async (id: string, patch: Partial<UserPromptDraft>) => apply(await apiUpdate(id, patch)),
    [apply],
  )
  const remove = React.useCallback(async (id: string) => apply(await apiDelete(id)), [apply])

  return { ...state, reload: () => load(true), add, update, remove }
}
