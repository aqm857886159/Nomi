import type { GenerationNodeKind } from '../model/generationCanvasTypes'

/**
 * 画布「加东西」的**意图表**——左缘竖排工具条与空白处右键/双击菜单的单一真相源。
 *
 * 2026-09-06 用户拍板「第三档」：左缘从 9 个平铺收成 **5 个常驻 + 一个「更多」**。
 * 收束的依据是 §1.5 的两条：
 *  - **常驻位有预算**（L1 ≤5 个功能簇）——9 个平铺里真正 ≥7/10 会用的只有生成四种 + 导入；
 *  - **分段要有名字**——原来两组之间只有一条 `w-px` 分隔线，真机上淡到看不见，
 *    「生成什么」和「摆一个空间/草图」两类心智之间没有边界。现在每段都带名字。
 *
 * 为什么把「导入」也放进同一张表：加号这一族回答的是**同一个问题**「往画布上加点什么」，
 * 用户不区分「新建一个待生成的节点」和「把本地文件放上来」——把导入排除在外，
 * 它就只能另找一个家（又一个平铺按钮或又一个入口），正是这次要消灭的东西。
 *
 * **规则：加号只列意图，派生节点不进菜单。** 角色/场景/关键帧/镜头/输出/素材是
 * agent、分镜流程或导入的**产物**，用户不会「先建一个空的关键帧」——它们的 quickAdd
 * 仍为 true（能被程序创建），但不出现在这张表里。`clip`（剪辑）是真手动意图，留在表内。
 */

export type CanvasAddIntentId = GenerationNodeKind | 'import-file'

/** 常驻 = 左缘直接看得见；更多 = 收进左缘底部那颗 ＋ 的二级菜单（§1.5.3 收纳是最后一招）。 */
export type CanvasAddPlacement = 'resident' | 'more'

export type CanvasAddIntent = Readonly<{
  id: CanvasAddIntentId
  /** 建节点的意图带 kind；「导入」不建生成节点（走本地文件导入路径），kind 为 null。 */
  kind: GenerationNodeKind | null
  placement: CanvasAddPlacement
}>

export type CanvasAddSectionId = 'generate' | 'import' | 'space'

export type CanvasAddSection = Readonly<{
  id: CanvasAddSectionId
  /** 完整菜单（空白处右键/双击）里这一段的名字。 */
  labelKey: string
  /**
   * 左缘「更多」菜单里这一段的名字。生成段的溢出在那里叫「更多」而不是「生成」——
   * 因为那颗 ＋ 打开的语境已经是「还有什么」，再写一次「生成」是把常驻段的名字搬过来，
   * 会让人以为常驻的四颗不在生成段里。
   */
  overflowLabelKey: string
  intents: readonly CanvasAddIntent[]
}>

/** 顺序即左缘顺序：常驻 图片/视频/声音/剪辑/导入，更多 文字 → 空间·草图四种。 */
export const CANVAS_ADD_SECTIONS = [
  {
    id: 'generate',
    labelKey: 'canvas.addSections.generate',
    overflowLabelKey: 'canvas.addSections.more',
    intents: [
      { id: 'image', kind: 'image', placement: 'resident' },
      { id: 'video', kind: 'video', placement: 'resident' },
      { id: 'audio', kind: 'audio', placement: 'resident' },
      { id: 'clip', kind: 'clip', placement: 'resident' },
      { id: 'text', kind: 'text', placement: 'more' },
    ],
  },
  {
    id: 'import',
    labelKey: 'canvas.addSections.import',
    overflowLabelKey: 'canvas.addSections.import',
    intents: [{ id: 'import-file', kind: null, placement: 'resident' }],
  },
  {
    id: 'space',
    labelKey: 'canvas.addSections.space',
    overflowLabelKey: 'canvas.addSections.space',
    intents: [
      { id: 'scene3d', kind: 'scene3d', placement: 'more' },
      { id: 'model3d', kind: 'model3d', placement: 'more' },
      { id: 'panorama', kind: 'panorama', placement: 'more' },
      { id: 'whiteboard', kind: 'whiteboard', placement: 'more' },
    ],
  },
] as const satisfies readonly CanvasAddSection[]

type AnyIntent = (typeof CANVAS_ADD_SECTIONS)[number]['intents'][number]

/**
 * 用户点得出来的节点种类。键类型钉成它的地方（`src/devlab/uiShellLab.tsx` 的空态清单）
 * 一旦这张表加/减一种而没跟上 = **编译错**，不靠人记（R28 防线建在最早能拦住的那层）。
 */
export type CanvasToolbarNodeKind = Extract<AnyIntent, { kind: GenerationNodeKind }>['kind']

/** 一段在某个渲染语境下的投影：名字 + 该语境要显示的意图。 */
export type CanvasAddSectionView = Readonly<{
  id: CanvasAddSectionId
  labelKey: string
  intents: readonly CanvasAddIntent[]
}>

/** 左缘常驻条：按表顺序摊平的 5 个意图。 */
export function canvasResidentAddIntents(): readonly CanvasAddIntent[] {
  return CANVAS_ADD_SECTIONS.flatMap((section) => section.intents.filter((intent) => intent.placement === 'resident'))
}

/** 左缘 ＋「更多」菜单：只有溢出意图的段，段名用 overflowLabelKey。 */
export function canvasMoreAddSections(): readonly CanvasAddSectionView[] {
  return CANVAS_ADD_SECTIONS.flatMap((section) => {
    const intents = section.intents.filter((intent) => intent.placement === 'more')
    return intents.length ? [{ id: section.id, labelKey: section.overflowLabelKey, intents }] : []
  })
}

/** 空白处右键/双击的完整菜单：三段全列，段名用 labelKey。 */
export function canvasFullAddSections(): readonly CanvasAddSectionView[] {
  return CANVAS_ADD_SECTIONS.map((section) => ({
    id: section.id,
    labelKey: section.labelKey,
    intents: section.intents,
  }))
}

/** 全部意图（常驻在前、更多在后），供需要一条平表的地方用。 */
export function canvasAddIntents(): readonly CanvasAddIntent[] {
  return [...canvasResidentAddIntents(), ...CANVAS_ADD_SECTIONS.flatMap((section) =>
    section.intents.filter((intent) => intent.placement === 'more'))]
}

/** 手动可新建的节点种类，按左缘顺序。 */
export function canvasToolbarNodeKinds(): GenerationNodeKind[] {
  return canvasAddIntents().flatMap((intent) => (intent.kind ? [intent.kind] : []))
}
