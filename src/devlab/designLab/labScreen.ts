import type React from 'react'

/**
 * 设计实验室的**屏**与**状态**的共享类型。
 *
 * 实验室从 #516 起是单屏（agent-panel）；本次加入 storyboard 屏时把这两个类型提到这里，
 * 让两屏共用同一份形状——不是给每屏各写一套（那就是同一个契约两份定义）。
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
  /**
   * 截图取景范围。默认 `element`（只截这一格的舞台）。
   * `viewport` 用于**逃出舞台的形态**——走 BodyPortal + fixed 定位的浮层（槽浮层、素材选择器）
   * 根本不在舞台的 DOM 子树里，按元素截会截出"浮层没打开"的假证据。
   */
  capture?: 'element' | 'viewport'
  render: () => React.ReactElement
}>

export type LabScreen = Readonly<{
  id: string
  /** 屏名（实验室头部显示）。 */
  label: string
  states: readonly LabState[]
  /** 接触表里每一格 iframe 的取景尺寸。屏与屏差别很大（面板 340 宽、分镜表接近整页）。 */
  cell: { width: number; height: number }
}>
