import type React from 'react'

/**
 * 设计实验室的**屏**与**状态**的共享类型。
 *
 * 实验室从 #516 起是单屏（agent-panel）；加第二、第三屏（editing / storyboard）时把这两个类型提到这里，
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
  /**
   * 这一格**镜像的真实调用点**：`src/….tsx:123` 形式的一条或多条，或 `'none'`。
   *
   * 为什么必填（2026-09-07 用户抓到的系统性缺陷）：陈列格一直宣称「屏幕上那格就是现役 React
   * 组件渲染的，不是手画样张」。这话只对了一半——**组件是真的，props 是夹具作者编的**。
   * 于是一格可以「技术上是真组件」却完全不像真实使用，而它顶着「这是真组件」的名义，
   * 比手画样张更容易误导（`pf-06` 的比例分段：真身画按宽高比的描边矩形，夹具画了个大空框配文字）。
   *
   * 填 `'none'` 是**合法且必要**的一档：设计系统提供了能力、生产尚无调用点（零采纳件）。
   * 那种格子证明的是「这件东西长什么样」，不是「现役界面就长这样」——必须标出来，
   * 别让人把它当现役形态。写成 `'none'` 而不是省略，是为了让「想过这件事」和「忘了写」分开。
   *
   * `scripts/check-design-lab.mjs` 第五项验：三块 primitive 陈列屏上**缺字段红**；
   * 任何屏只要填了，file:line 就必须真的存在、行号不越界（陈旧的指路牌比没有指路牌更糟）。
   *
   * 为什么类型上是可选、门岗上对陈列屏必填：另外 9 屏画的是**某个功能界面**的形态
   * （Agent 面板、分镜表、剪辑浮层……），它们镜像的是一整块界面而不是某个组件的调用点，
   * 「这一格对应哪一行代码」对它们不成立。做出「这是现役组件的真实用法」这个承诺的
   * 只有 primitive 陈列三屏，所以约束就钉在它们身上——把字段硬填满 180 格只会逼出一堆
   * 编造的行号，那正是本字段要消灭的东西。
   */
  mirrors?: string | readonly string[]
  coverage: LabCoverage
  /** 这一格在接触表里占几列（宽件占 2 列）。 */
  span?: 1 | 2
  /**
   * 这一格钉死的明暗档。默认浅色（见 designLab.tsx 顶部：实验室永远显式钉死，
   * 否则「天黑自动暗」会让同一份代码上午绿、晚上红）。
   * 暗色**必须**由这里给：暗色 token 只定义在 `:root[data-mantine-color-scheme="dark"]` 上，
   * 组件自己加个 class 翻不动它——那会渲出一块「暗色状态却是浅色」的假证据。
   */
  scheme?: 'light' | 'dark'
  /**
   * 截图取景范围。默认 `element`（只截这一格的舞台）。
   * `viewport` 用于**逃出舞台的形态**——走 BodyPortal + fixed 定位的浮层
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
  /** 接触表里每一格 iframe 的取景尺寸。屏与屏差别很大（面板 340 宽、剪辑浮层 420 宽、分镜表接近整页）。 */
  cell: { width: number; height: number }
}>
