// NomiWordmark —— 文字标志「No·m·i」的**唯一真相源**（P1）。
// 品牌不变量：中间的 m 永远是 accent 色 + Fraunces（display）字体。
// No/i 的颜色由 className/父级控制（品牌处 text-nomi-ink，消息标签处可以灰）。
// 任何要显示「Nomi」字标的地方都用它，别再手写 `No<span>m</span>i`。
//
// 文字来自 i18n（brand.wordStart / wordAccent / wordEnd），组件自己取，不用传。
import { NomiWordmark } from 'nomi'

/** 字号轴：缺省继承父级 font-size；显式给 fontSize 则钉死。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap' }}>
    <NomiWordmark fontSize={14} className="text-nomi-ink" />
    <NomiWordmark fontSize={17} className="text-nomi-ink" />
    <NomiWordmark fontSize={24} className="text-nomi-ink" />
    <NomiWordmark fontSize={40} className="text-nomi-ink" />
  </div>
)

/** 颜色：No/i 跟随 className，m 的 accent 是不变量——两种底色下都验证一遍。 */
export const OnLightAndInk = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
    <div style={{ padding: '14px 20px', borderRadius: 'var(--nomi-radius)', background: 'var(--nomi-paper)', border: '1px solid var(--nomi-line)' }}>
      <NomiWordmark fontSize={28} className="text-nomi-ink" />
    </div>
    <div style={{ padding: '14px 20px', borderRadius: 'var(--nomi-radius)', background: 'var(--nomi-ink)' }}>
      <NomiWordmark fontSize={28} className="text-nomi-paper" />
    </div>
    <div style={{ padding: '14px 20px', borderRadius: 'var(--nomi-radius)', background: 'var(--nomi-ink-05)' }}>
      <NomiWordmark fontSize={28} className="text-nomi-ink-40" />
    </div>
  </div>
)

/** 继承父级字号：放进标题里不给 fontSize，跟着排版走。 */
export const InheritsFontSize = (): JSX.Element => (
  <div style={{ maxWidth: 420 }}>
    <h1 style={{ margin: 0, font: '400 32px var(--nomi-font-display)', color: 'var(--nomi-ink)' }}>
      欢迎回到 <NomiWordmark />
    </h1>
    <p style={{ margin: '8px 0 0', font: '400 13px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)' }}>
      继续上次的项目，或者从一句话开始新的。
    </p>
  </div>
)
