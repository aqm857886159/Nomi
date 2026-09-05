import { create } from 'zustand'

/**
 * Nomi 收起后，右侧 32px 图标条上那颗状态点读的就是这里（合同 §2.1 + §2.6）。
 *
 * 为什么单独一个 store 而不是塞进 workbenchStore：图标条住在剪辑面的面板系统里，
 * 常驻 Agent 收起时**根本不在那棵子树里**（它挂到预览列的浮层上去了），两边够不着；
 * 而 Agent 的运行状态每个 token 都在变，塞进 workbenchStore 会让整条剪辑面跟着重渲。
 * 这里只有两个标量，只有图标条订阅它。
 *
 * 存的是**已经算好的那格 token 类名**，不是又一套「运行中 / 等确认 / 空闲」的状态词——
 * 这三态的唯一 owner 是 ProjectAgentResidentShell（它同时决定面板头那颗点的颜色）。
 * 再在这里立一份同义词表，就是「同一语义两份定义」（R14.1）。
 */
type ResidentActivityStore = {
  /** 状态点的 token 类名；空串 = 不画点。 */
  dotClassName: string
  /** 人话状态（「正在想…」/「等你确认」），给图标条的 title 与无障碍名用。 */
  label: string
  setResidentActivity: (dotClassName: string, label: string) => void
}

export const useResidentActivityStore = create<ResidentActivityStore>((set) => ({
  dotClassName: '',
  label: '',
  setResidentActivity: (dotClassName, label) => set((state) => (
    state.dotClassName === dotClassName && state.label === label ? state : { dotClassName, label }
  )),
}))
