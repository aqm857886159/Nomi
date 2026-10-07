// 设计实验室 · 导演视图（3D-BOX）屏的轻量常量与类型——labScreens 与状态注册表只 import 这里，
// 不碰导演台的模块图（重的那份在 director3dboxLabKit.tsx，只经 director3dboxLazyStage 动态加载）。

/** 取景框 = 真机走查窗口的内容区（ACCEPTANCE_VIEWPORT 1280×933），实验室格子与真机截图同尺寸才能并排比。 */
export const DIRECTOR_3DBOX_CELL_WIDTH = 1280
export const DIRECTOR_3DBOX_CELL_HEIGHT = 933

/**
 * 工程夹具：空工程，或 courtyard-standoff 计划经现役编译器编出的庭院对峙；
 * courtyard-after = 同一份计划经现役补丁应用器把第 2 镜改成特写之后（画布「正在改：镜头 N」⑤ Agent 改完那一刻）。
 */
export type Director3dBoxFixture = 'empty' | 'courtyard' | 'courtyard-after'
/** 格子要替用户点的真按钮：不点 / 点第 2 张镜头卡 / 点完再切「精修」。 */
export type LabDrive = 'none' | 'shot-2' | 'shot-2-refine'

/**
 * 精修「选中才出」样张格要替用户点的真按钮，按顺序执行（每一步都是界面上真实存在的控件，不往 store 塞状态）：
 *   · click：点一个选择器命中的控件（等它出现）；
 *   · clickWith：按住 Ctrl / Shift 点（镜头条加选）；
 *   · clickText：在选择器命中的一组控件里点文字等于 text 的那一个（大纲行、菜单项）；
 *   · pointer：在文字等于 text 的那个元素正中按下再松开指针（时间轴片段是按下就选中、不认 click）；
 *   · press：按一个键（Esc：先关浮层、再清选中）。
 */
export type LabStep =
  | { click: string }
  | { clickWith: { selector: string; modifier: 'ctrl' | 'shift' } }
  | { pointer: { selector: string; text: string } }
  | { clickText: { selector: string; text: string } }
  | { press: 'Escape' }

