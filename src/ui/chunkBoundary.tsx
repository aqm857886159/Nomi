// 懒加载容错域（审计 A5 根治）。
// 此前全 app 只有 main.tsx 根上一层错误边界：任一懒加载 chunk 失败（构建竞态、
// asar 损坏、增量更新中途、磁盘错误）都把整个工作台拖进根错误页；含 3D 节点的
// 项目甚至从此打不开——可选功能的资源失败不该有这种爆炸半径。
// 本原语把每个 React.lazy 点位包进自己的容错域：
// - 加载失败只降级该区域，兄弟区域照常工作；
// - 工厂自动重试 2 次（指数退避，吃掉瞬时 IO/网络抖动）；
// - 「重试」按钮重建 lazy 实例——React 18 的 lazy 一旦 reject 会永久缓存失败，
//   仅靠 remount 无法恢复，必须换新实例重新 import。
import React from 'react'
import { cn } from '../utils/cn'

const AUTO_RETRIES = 2
const RETRY_BASE_DELAY_MS = 300

export function importWithRetry<T>(
  factory: () => Promise<T>,
  retries = AUTO_RETRIES,
  baseDelayMs = RETRY_BASE_DELAY_MS,
): Promise<T> {
  const attempt = (remaining: number, delayMs: number): Promise<T> =>
    factory().catch((error: unknown) => {
      if (remaining <= 0) throw error
      return new Promise((resolve) => setTimeout(resolve, delayMs)).then(() =>
        attempt(remaining - 1, delayMs * 2),
      )
    })
  return attempt(retries, baseDelayMs)
}

type BoundaryProps = {
  label: string
  children: React.ReactNode
}

class ChunkErrorBoundary extends React.Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      ;(window as unknown as { nomiDesktop?: { logRendererCrash?: (m: string) => void } }).nomiDesktop?.logRendererCrash?.(
        `[chunk:${this.props.label}] ${error.name}: ${error.message}\n${error.stack || ''}\n--- componentStack ---\n${info.componentStack || ''}`,
      )
    } catch {
      /* 日志旁路失败不影响降级 UI */
    }
    console.error(`[nomi] chunk boundary "${this.props.label}" caught:`, error)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div
        role='alert'
        data-chunk-boundary={this.props.label}
        className={cn(
          'flex h-full w-full min-h-24 flex-col items-center justify-center gap-2 p-4 text-center',
          'rounded-nomi border border-nomi-line-soft bg-nomi-ink-05/60',
        )}
      >
        <span className={cn('text-caption text-nomi-ink-80')}>{this.props.label}加载失败</span>
        <span className={cn('text-micro text-nomi-ink-40')}>其余功能不受影响；可重新加载重试</span>
        <button
          type='button'
          className={cn(
            'inline-flex h-6 items-center px-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper',
            'text-caption text-nomi-ink-80 cursor-pointer hover:bg-nomi-ink-05',
          )}
          // 重试 = 整页重载：工厂层 importWithRetry 已自动退避重试 2 次吃掉瞬时抖动，
          // 走到降级说明 chunk 持续不可用；React.lazy 一旦 reject 会永久缓存失败、
          // 在同一 JS 上下文里无法复活，只有 reload 拿到全新上下文才可能自愈。
          onClick={() => { try { window.location.reload() } catch { /* noop */ } }}
        >
          重新加载
        </button>
      </div>
    )
  }
}

/**
 * React.lazy 的容错替身：用法与 `React.lazy(factory)` 相同（外层 Suspense 照旧），
 * 但 chunk 失败只降级本区域、不冒泡到根错误边界拖死整个 app。
 *
 * **关键：lazy 实例必须模块级创建一次**（在返回的组件之外）。一个会立即 suspend
 * 的组件，若在其内部用 useState/useMemo 创建会 suspend 的 lazy，React 在首次渲染
 * suspend 时会丢弃这次渲染的 hook 状态，promise resolve 后重试又重新初始化、新建
 * lazy、新 pending promise → 永久 suspend，app 卡在 loading 打不开（2026-06-13
 * 真机走查实锤，单测抓不到这个 React 树行为）。模块级 lazy 不受组件重渲染影响。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ComponentType<any> 是 React 组件泛型约束的惯用形态
export function lazyWithChunkBoundary<T extends React.ComponentType<any>>(
  label: string,
  factory: () => Promise<{ default: T }>,
): (props: React.ComponentProps<T>) => JSX.Element {
  const Lazy = React.lazy(() => importWithRetry(factory))
  function ChunkGuarded(props: React.ComponentProps<T>): JSX.Element {
    return (
      <ChunkErrorBoundary label={label}>
        <Lazy {...props} />
      </ChunkErrorBoundary>
    )
  }
  ChunkGuarded.displayName = `ChunkBoundary(${label})`
  return ChunkGuarded
}
