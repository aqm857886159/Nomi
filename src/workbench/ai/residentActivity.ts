import { declareStoreLifetime } from '../project/storeLifetime'
import { create } from 'zustand'
import type { V4DockStatus } from './v4/agentPanelV4DockStatus'

/**
 * 常驻 Agent 面板对**子树之外**的那个投影口。
 *
 * 为什么单独一个 store 而不是塞进 workbenchStore：两个消费者都不在面板那棵子树里——
 * 剪辑面右侧 32px 图标条住在面板系统里（Agent 收起时挂到了预览列的浮层上，两边够不着），
 * 顶栏最右的 Nomi 入口（外壳 ShellNomiEntry）更是住在面板子树外面。而 Agent 的运行状态每个 token 都在变，
 * 塞进 workbenchStore 会让整条剪辑面跟着重渲。这里只有几个标量，只有那两处订阅它。
 *
 * ## 两组字段，两个消费者，同一个 owner
 *
 * - `dotClassName` / `label`：剪辑面图标条那颗点（合同 §2.1 + §2.6）。存的是**已经算好的
 *   token 类名**，不是又一套「运行中 / 等确认 / 空闲」的状态词。
 * - `dockStatus` / `dockFaceStatus` / `dockPendingCount` / `dockUnreadCount`：顶栏 Nomi 入口（NomiEntryTopbar 板：脸 + 角标 / 胶囊 + 点）。
 *   两个状态都是**搬运** `V4DockStatus`，不是在这儿另立一份同义词表——词表的唯一 owner
 *   仍是 `v4/agentPanelV4DockStatus.ts`，派生的唯一处仍是 `useV4DockStatus` / `resolveDockStatus`（R14.1）：
 *   `dockStatus` 是合并状态（等你确认压过一切，悬停那句的中段用它）；`dockFaceStatus` 是不算待确认的那份（脸用它，
 *   在做 + 等你确认时脸照样转，B5）。入口一直在顶栏，面板开着也报（按下底色的脸照样显示状态）。
 *   `null` = 根本没挂载（没开项目）→ 入口不画。
 */
type ResidentActivityStore = {
  /** 状态点的 token 类名；空串 = 不画点。 */
  dotClassName: string
  /** 人话状态（「正在想…」/「等你确认」），给图标条的 title 与无障碍名用。 */
  label: string
  setResidentActivity: (dotClassName: string, label: string) => void

  /** 合并状态（悬停那句的中段）；`null` = 没挂载（没开项目）。 */
  dockStatus: V4DockStatus | null
  /** 脸的状态：不算待确认（`useV4DockStatus` 传 pendingCount 0）；`null` = 没挂载。 */
  dockFaceStatus: V4DockStatus | null
  /** 还在等用户裁决的介入条数（计入未读，并在 tooltip 里被点名）。 */
  dockPendingCount: number
  /** 收起期间攒下的未读条数：新回复 + 工具跑完 + 待你确认的那几条。 */
  dockUnreadCount: number
  setResidentDockBadge: (status: V4DockStatus | null, faceStatus: V4DockStatus | null, pendingCount: number, unreadCount: number) => void
}

export const useResidentActivityStore = create<ResidentActivityStore>((set) => ({
  dotClassName: '',
  label: '',
  setResidentActivity: (dotClassName, label) => set((state) => (
    state.dotClassName === dotClassName && state.label === label ? state : { dotClassName, label }
  )),

  dockStatus: null,
  dockFaceStatus: null,
  dockPendingCount: 0,
  dockUnreadCount: 0,
  // 同值短路和上面那条同一个理由：这个 setter 挂在面板的 effect 上，每个 token 都会跑一遍，
  // 无脑 set 会让顶栏入口跟着 Agent 的每一帧重渲。
  setResidentDockBadge: (dockStatus, dockFaceStatus, dockPendingCount, dockUnreadCount) => set((state) => (
    state.dockStatus === dockStatus
      && state.dockFaceStatus === dockFaceStatus
      && state.dockPendingCount === dockPendingCount
      && state.dockUnreadCount === dockUnreadCount
      ? state
      : { dockStatus, dockFaceStatus, dockPendingCount, dockUnreadCount }
  )),
}))

/**
 * C1 寿命声明：常驻 Agent 的活动指示（点、文案、坞状态、待办/未读数）全是**当前项目**
 * 那条 lane 的事实。切项目不清，新项目的坞上会挂着上一个项目的「3 条未读」。
 */
export const residentActivityStoreLifetime = declareStoreLifetime({
  store: 'useResidentActivityStore',
  fields: {
    dotClassName: 'project', label: 'project', dockStatus: 'project', dockFaceStatus: 'project',
    dockPendingCount: 'project', dockUnreadCount: 'project',
  },
  releaseProject: () => useResidentActivityStore.setState({
    dotClassName: '', label: '', dockStatus: null, dockFaceStatus: null, dockPendingCount: 0, dockUnreadCount: 0,
  }),
})
