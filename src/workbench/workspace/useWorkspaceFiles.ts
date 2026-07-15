import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import type { WorkspaceFileListResult } from '../../../electron/workspace/workspaceFileIndex'

export type WorkspaceFilesState = WorkspaceFileListResult & {
  loading: boolean
  error: string | null
}

// 项目文件一次列举上限。用户群反馈「一个项目 1000+ 张图只显示 500 张」——旧默认 500 静默截断。
// 提到 2000（listWorkspaceFiles 内部的硬上限），覆盖真实大项目；仍超上限时靠 truncated 显式提示，
// 不再静默丢（P2：「只显示 N 张」这类不再复发）。素材面板/画布消费方都已虚拟化，抬上限不增渲染负担。
const WORKSPACE_FILE_LIMIT = 2000

export function useWorkspaceFiles(projectId: string | null): WorkspaceFilesState & { refresh: () => void } {
  const [state, setState] = React.useState<WorkspaceFilesState>({ items: [], truncated: false, loading: false, error: null })
  const [version, setVersion] = React.useState(0)

  const refresh = React.useCallback(() => setVersion((value) => value + 1), [])

  React.useEffect(() => {
    let canceled = false
    const bridge = getDesktopBridge()
    if (!projectId || !bridge?.workspace?.listFiles) {
      setState({ items: [], truncated: false, loading: false, error: null })
      return () => {
        canceled = true
      }
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    bridge.workspace.listFiles({ projectId, limit: WORKSPACE_FILE_LIMIT })
      .then((result) => {
        if (!canceled) setState({ items: result.items, truncated: result.truncated, loading: false, error: null })
      })
      .catch(() => {
        if (!canceled) setState({ items: [], truncated: false, loading: false, error: '无法读取项目文件夹，请检查权限或重新打开文件夹' })
      })
    return () => {
      canceled = true
    }
  }, [projectId, version])

  return { ...state, refresh }
}
