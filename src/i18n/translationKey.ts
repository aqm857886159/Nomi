// 翻译键的**类型**真相源（键值本身住 `locales/`，这里只导出「什么算一个合法键」）。
//
// 为什么要它：视图模型常把「显示哪一条文案」存成常量再交给渲染处 `t()`。
// 存**相对片段**（`labelKey: 'composer.append'`，渲染处拼 `t(`generationCommon.${labelKey}`)`）
// 会同时坏掉两件事：
//   ① 编译器管不着——片段是普通 string，键写错/词条被删都要等运行时渲染出原始 key 才发现；
//   ② 死键门岗瞎掉——`check-i18n-dead-keys` 会把源码里出现的模板 head 当动态前缀，
//      而 `generationCommon.` 这个 head 覆盖**整个命名空间**，于是该命名空间下再多死键也报不出来
//      （2026-09-05 实证：cutover 删组件后 44 条 `generationCommon.assistant.*` 零告警）。
//
// 故常量一律存**整键字面量**并 `satisfies` 本类型：编译器直接拦住坏键（R28 防线建在最早那层），
// 死键门岗也重新看得见——整键字面量就是它认的「精确引用」，删词条即当场报死键。
import type { ParseKeys } from 'i18next'

/**
 * 词典里全部可解析的翻译键。用法：`{ labelKey: 'ns.a.b' } as const satisfies { labelKey: TranslationKey }`。
 *
 * 用 ParseKeys 的**默认命名空间参数**，不要写死 `ParseKeys<'translation'>`：后者依赖
 * `i18next.d.ts` 的模块增强已被当前 tsconfig 收进来，而 tsconfig.app / test-types 两套工程并非
 * 都收（写死那版在 `pnpm run typecheck` 与 `check:test-types` 下报 TS2344）。
 */
export type TranslationKey = ParseKeys
