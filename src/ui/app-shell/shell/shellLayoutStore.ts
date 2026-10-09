// 外壳的两项用户偏好：左栏收没收起、每个抽屉被拖成多宽（10-08 外壳重设计）。
// 是这台机器的界面偏好，不是项目内容：存 localStorage，不进项目文件、不 bump persistRevision，切项目不还原。
// （旧的 workbenchStore.sidebarCollapsed / projectSidebarWidth 随常驻探索栏一起删了，同一件事只留这一份。）
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { declareStoreLifetime } from '../../../workbench/project/storeLifetime'

export type ShellDrawerItem = 'docs' | 'catalog' | 'assets' | 'flows' | 'skills' | 'prompts'

export const DRAWER_WIDTH_MIN = 240
export const DRAWER_WIDTH_MAX = 720

type ShellLayoutState = {
  railCollapsed: boolean
  /** 抽屉被用户拖过的宽度；没拖过 = 用默认宽（2026-08-08 飞书反馈「素材库宽度锁死不能拽」）。 */
  drawerWidth: Partial<Record<ShellDrawerItem, number>>
  setRailCollapsed: (collapsed: boolean) => void
  setDrawerWidth: (item: ShellDrawerItem, width: number) => void
}

export const useShellLayoutStore = create<ShellLayoutState>()(persist((set) => ({
  railCollapsed: false,
  drawerWidth: {},
  setRailCollapsed: (railCollapsed) => set({ railCollapsed }),
  setDrawerWidth: (item, width) => set((state) => ({
    drawerWidth: { ...state.drawerWidth, [item]: Math.max(DRAWER_WIDTH_MIN, Math.min(DRAWER_WIDTH_MAX, Math.round(width))) },
  })),
}), { name: 'nomi:shell-layout:v1', version: 1 }))

export const shellLayoutStoreLifetime = declareStoreLifetime({
  store: 'useShellLayoutStore',
  fields: { railCollapsed: 'window', drawerWidth: 'window' },
})
