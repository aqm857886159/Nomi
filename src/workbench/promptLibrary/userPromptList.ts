/**
 * 「我的库」提示词列表在渲染层的唯一一份（2026-10-28）。
 *
 * 为什么单独一个模块：这份列表原来住在 `useUserPrompts` 的 hook 文件里（模块级 `cached`），写口却住在更下层的
 * `promptLibraryApi`——下层写完既没法也没义务通知上层。于是每多一个绕过 hook 的写入口（浏览器「提取提示词」、
 * 「保存选中文字」、画布选区存库、素材面迁移），就多一个「标签页写着已存入、抽屉里却没有，重载窗口才出现」的洞。
 *
 * 现在列表只有这一个持有者：读口和 4 个写口收到主进程回的整表，都经 `publishUserPrompts` 发到这里；
 * 所有 hook 实例用 `useSyncExternalStore` 订阅它。谁写的、写的时候有没有 hook 挂着，都不用管。
 *
 * 状态容器用仓库已有的 zustand（vanilla store，同 `directorStore`），发布 / 订阅不手写第二套；这里只写领域规则：
 * 按发起顺序发布（晚到的旧应答丢掉）、订阅者各自隔离（一个抛错不拦后面的、也不把成功的写变成失败）。
 * 不要在别处再存一份（hook 里不留 items 副本）；要看列表只读 `getUserPromptsSnapshot()`。
 * 本文件只对 API 做 `import type`，API 才能反过来 import 这里而不成环。
 */
import { createStore } from 'zustand/vanilla'
import { logRendererError } from '../../desktop/rendererLog'
import type { LibraryPrompt } from '../api/promptLibraryApi'
import { declareStoreLifetime } from '../project/storeLifetime'

/** 还没载入过时的快照：全局同一个常量，引用稳定（`useSyncExternalStore` 靠引用判断有没有变）。 */
const NOT_LOADED: LibraryPrompt[] = []
Object.freeze(NOT_LOADED)

/** items = null 表示还没载入过（读口或写口都没发布过）。 */
const userPromptListStore = createStore<{ items: LibraryPrompt[] | null }>(() => ({ items: null }))

/**
 * 寿命声明（C1）：用户级、跨项目的整表，跟随进程，**不随项目切换清空**——换项目不该让「我的库」消失再重读；
 * 真相源在主进程存储，这里是内存快照。
 */
export const userPromptListLifetime = declareStoreLifetime({
  store: 'userPromptListStore',
  fields: { items: 'process' },
})

/** 最近一次发起的号 / 已发布的最大号：号按发起顺序递增，见 `publishUserPrompts`。 */
let issued = 0
let published = 0

/** 此刻的整表。没载入过是同一个空数组；载入后在下一次发布之前引用不变。 */
export function getUserPromptsSnapshot(): LibraryPrompt[] {
  return userPromptListStore.getState().items ?? NOT_LOADED
}

/** 是否已经载入过（读口或写口发布过一次）。`load(false)` 靠它决定要不要读盘。 */
export function hasLoadedUserPrompts(): boolean {
  return userPromptListStore.getState().items !== null
}

/**
 * 订阅整表变化；返回退订函数。监听者不收参数，变了就自己读快照。
 * 监听者各自 try/catch：一个抛错既不能拦住后面的监听者，也不能把一次已经成功的写变成「写失败」
 * （用户会重试，库里就多一条重复的）。
 */
export function subscribeUserPrompts(listener: () => void): () => void {
  return userPromptListStore.subscribe(() => {
    try {
      listener()
    } catch (error) {
      logRendererError('user-prompt-listener-failed', error)
    }
  })
}

/** 发起一次读或写之前领号。号随请求走，应答回来时带着它去发布。 */
export function beginUserPromptRequest(): number {
  issued += 1
  return issued
}

/**
 * 发布主进程回的整表（唯一写口）。号比已经发布的更旧，说明这是个晚到的应答（读在途时写先落了地），
 * 它看到的是更早的盘，丢掉并返回 false——列表只往新走。
 */
export function publishUserPrompts(items: LibraryPrompt[], requestNo: number): boolean {
  if (requestNo < published) return false
  published = requestNo
  userPromptListStore.setState({ items })
  return true
}

/** 仅测试用：回到「没载入过」。订阅者留着（挂着的 hook 不该因为复位丢订阅），并通知它们重读快照。 */
export function resetUserPromptListForTests(): void {
  issued = 0
  published = 0
  userPromptListStore.setState({ items: null })
}
