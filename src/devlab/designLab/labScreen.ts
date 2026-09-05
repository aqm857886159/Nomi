import type React from 'react'

/**
 * 设计实验室的**屏**与**状态**的共享类型。
 *
 * 实验室从 #516 起是单屏（agent-panel）；加第二屏（vendor-order）时把这两个类型提到这里，
 * 让各屏共用同一份形状——不是给每屏各写一套（那就是同一个契约两份定义）。
 */

export type LabCoverage =
  /** 现役界面能真实走到这个形态（数据 → 渲染整条通）。 */
  | 'shell'
  /** 组件已实现，但没有数据路径能让它出现在真机界面里——欠账。 */
  | 'component-only'
  /** 设计文档要求、现役一行代码都没有——缺口。 */
  | 'missing'
  /** 设计上已被后续裁决取消，基线用来钉死「它确实不在」。 */
  | 'retired'

export type LabState = Readonly<{
  id: string
  /** 人话名字，出现在选择器和接触表格子上。 */
  name: string
  /** 来源文档 + 章节。改设计先改文档，再改这里。 */
  source: string
  coverage: LabCoverage
  /** 这一格在接触表里占几列（宽件占 2 列）。 */
  span?: 1 | 2
  render: () => JSX.Element
}>

export type LabScreen = Readonly<{
  id: string
  /** 屏名（实验室头部显示）。 */
  label: string
  states: readonly LabState[]
  /** 接触表里每一格 iframe 的取景尺寸。屏与屏差别很大（面板 340 宽、下拉浮层要留出展开高度）。 */
  cell: { width: number; height: number }
  /**
   * 这一屏的**视觉基线还没拍板**。
   *
   * 为什么要有这个档位而不是「先把基线录了再说」：基线的语义是「用户看过并认可的那一张」，
   * 录一张没人拍过板的图钉住，等于把「待定」伪装成「已定」——以后任何人改动它都会被一张
   * 从没被认可过的图拦下来。所以待拍板的屏**必须一张基线都没有**，`check:design-lab` 两头都查：
   * 待拍板的屏有基线 = 红（该把 pendingApproval 摘掉了），已拍板的屏缺基线 = 红。
   */
  pendingApproval?: boolean
}>
