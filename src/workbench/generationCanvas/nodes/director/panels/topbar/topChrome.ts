/**
 * [INPUT]: 无依赖（纯常量）
 * [OUTPUT]: 对外提供 DIRECTOR_TOP_CHROME_PX：悬浮顶栏在视口坐标里占掉的竖直高度
 * [POS]: director/panels/topbar 的布局契约单一真相。顶栏是 absolute 浮层，不占布局流，
 *        所以「谁该让开它」必须由一个常量说了算：画中画的默认位置与拖动下限、右栏的顶部留白都从这里 derive。
 *        2026-09-09 真机走查抓到过反例 —— 顶栏压住了画中画头部和右栏页签，因为两边各自沿用了自己的 14px 边距。
 *        数值 = 顶部外边距 12 + 簇高 40（p-1 + 32px 控件）+ 呼吸 4。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const DIRECTOR_TOP_CHROME_PX = 56
