// NomiLoadingMark —— 品牌加载指示（转圈的 NomiLogoMark）。**全仓最常用的设计系统组件**（19 个文件）。
// pending 规范：任何 async 等待都用它，不用第三方 spinner——等待时间也是品牌时间。
// 自带 role="status" + aria-label（缺省取 i18n 的 common.loading），无障碍已经处理好。
// 尊重 prefers-reduced-motion（motion-reduce 下停转）。
//
// 注：截图是动画的某一帧，卡上看到的角度是随机的——这是预期的。
// 组合取自真实调用点：WorkbenchButton/DesignButton 的 loading 态（size=14）、面板级空转、整页加载。
import { NomiLoadingMark } from 'nomi'

/** size 轴：14 在按钮里，18 默认，32+ 用于面板/整页。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
    <NomiLoadingMark size={14} />
    <NomiLoadingMark size={18} />
    <NomiLoadingMark size={24} />
    <NomiLoadingMark size={32} />
    <NomiLoadingMark size={48} />
  </div>
)

/** 真实用法：按钮内的 14px（这是它出现频率最高的地方）。 */
export const InButton = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 12px',
        borderRadius: 'var(--nomi-radius-sm)',
        background: 'var(--nomi-ink)',
        color: 'var(--nomi-paper)',
        font: '500 13px var(--nomi-font-sans)',
      }}
    >
      <NomiLoadingMark size={14} label="正在生成" />
      正在生成
    </span>
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 12px',
        borderRadius: 'var(--nomi-radius-sm)',
        border: '1px solid var(--nomi-line)',
        background: 'var(--nomi-paper)',
        color: 'var(--nomi-ink)',
        font: '500 13px var(--nomi-font-sans)',
      }}
    >
      <NomiLoadingMark size={14} label="正在保存" />
      正在保存
    </span>
  </div>
)

/** 面板级空转：居中 + 一句说明（别只放一个转圈让人猜在等什么）。 */
export const PanelLoading = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      width: 320,
      height: 140,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <NomiLoadingMark size={28} label="正在读取项目" />
    <span style={{ font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)' }}>
      正在读取项目…
    </span>
  </div>
)
