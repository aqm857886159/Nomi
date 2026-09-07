import { create } from 'zustand'
import type { V4DockStatus } from './v4/agentPanelV4DockStatus'

/**
 * 常驻 Agent 面板对**子树之外**的那个投影口。
 *
 * 为什么单独一个 store 而不是塞进 workbenchStore：两个消费者都不在面板那棵子树里——
 * 剪辑面右侧 32px 图标条住在面板系统里（Agent 收起时挂到了预览列的浮层上，两边够不着），
 * 顶栏那格收起角标更是住在整个工作区外面。而 Agent 的运行状态每个 token 都在变，
 * 塞进 workbenchStore 会让整条剪辑面跟着重渲。这里只有几个标量，只有那两处订阅它。
 *
 * ## 两组字段，两个消费者，同一个 owner
 *
 * - `dotClassName` / `label`：剪辑面图标条那颗点（合同 §2.1 + §2.6）。存的是**已经算好的
 *   token 类名**，不是又一套「运行中 / 等确认 / 空闲」的状态词。
 * - `dockStatus` / `dockPendingCount` / `dockUnreadCount`：顶栏收起角标（09-01 定稿 §11.2）。
 *   `dockStatus` 是**搬运** `V4DockStatus`，不是在这儿另立一份同义词表——词表的唯一 owner
 *   仍是 `v4/agentPanelV4DockStatus.ts`，派生的唯一处仍是 `resolveDockStatus`（R14.1）。
 *   `null` = 面板没收起、或者根本没挂载（没开项目）→ 顶栏那格不出角标。
 */
type ResidentActivityStore = {
  /** 状态点的 token 类名；空串 = 不画点。 */
  dotClassName: string
  /** 人话状态（「正在想…」/「等你确认」），给图标条的 title 与无障碍名用。 */
  label: string
  setResidentActivity: (dotClassName: string, label: string) => void

  /** 收起角标该报哪一档；`null` = 不出角标（面板没收起 / 没挂载）。 */
  dockStatus: V4DockStatus | null
  /** 还在等用户裁决的介入条数（计入未读，并在 tooltip 里被点名）。 */
  dockPendingCount: number
  /** 收起期间攒下的未读条数：新回复 + 工具跑完 + 待你确认的那几条。 */
  dockUnreadCount: number
  setResidentDockBadge: (status: V4DockStatus | null, pendingCount: number, unreadCount: number) => void
}

export const useResidentActivityStore = create<ResidentActivityStore>((set) => ({
  dotClassName: '',
  label: '',
  setResidentActivity: (dotClassName, label) => set((state) => (
    state.dotClassName === dotClassName && state.label === label ? state : { dotClassName, label }
  )),

  dockStatus: null,
  dockPendingCount: 0,
  dockUnreadCount: 0,
  // 同值短路和上面那条同一个理由：这个 setter 挂在面板的 effect 上，每个 token 都会跑一遍，
  // 无脑 set 会让顶栏跟着 Agent 的每一帧重渲。
  setResidentDockBadge: (dockStatus, dockPendingCount, dockUnreadCount) => set((state) => (
    state.dockStatus === dockStatus
      && state.dockPendingCount === dockPendingCount
      && state.dockUnreadCount === dockUnreadCount
      ? state
      : { dockStatus, dockPendingCount, dockUnreadCount }
  )),
}))
