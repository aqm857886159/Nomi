// NomiLogoMark —— 品牌图形标（28×28 viewBox 的圆角方块 + 白色「N」字形）。
// 底色走 --nomi-logo-ground token，笔画恒为白色。size 缩放整个 svg。
// 组合取自真实调用点：窗口标题栏、加载态（被 NomiLoadingMark 包起来转）、AI 消息头像。
import { NomiLogoMark } from 'nomi'

/** size 轴：从 16px 的行内图标到 64px 的空态大图。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
    <NomiLogoMark size={16} />
    <NomiLogoMark size={24} />
    <NomiLogoMark size={32} />
    <NomiLogoMark size={48} />
    <NomiLogoMark size={64} />
  </div>
)

/** 真实用法：作为消息头像跟一行文字并排。 */
export const AsAvatar = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      gap: 10,
      alignItems: 'flex-start',
      width: 380,
      padding: 12,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <NomiLogoMark size={28} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ font: '600 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>已经拆好 6 个镜头</div>
      <div style={{ marginTop: 4, font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)', lineHeight: 1.6 }}>
        第 3 镜的运镜我改成了缓推，和你说的「停在侧脸剪影」更接。要现在生成吗？
      </div>
    </div>
  </div>
)

/** 在深底上：logo-ground 自带底色，所以深浅底都立得住。 */
export const OnDarkSurface = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
    <div style={{ padding: 16, borderRadius: 'var(--nomi-radius)', background: 'var(--nomi-paper)', border: '1px solid var(--nomi-line)' }}>
      <NomiLogoMark size={40} />
    </div>
    <div style={{ padding: 16, borderRadius: 'var(--nomi-radius)', background: 'var(--nomi-ink)' }}>
      <NomiLogoMark size={40} />
    </div>
  </div>
)
