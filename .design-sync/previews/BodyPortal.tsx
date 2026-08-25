// BodyPortal —— 把子树 createPortal 到 document.body。
// 用途：需要**逃出父级 overflow/transform/stacking context** 的浮层（画布上的浮动工具条、
// 拖拽跟随层）。画布节点常带 transform，子元素的 position:fixed 会以它为参照系而错位——
// 这个组件就是解决那类错位的。
// SSR / 无 document 时自动退化成直接渲染 children（不会崩）。
//
// 预览说明：它**渲染在 body 上、不在卡片的 root 里**，所以卡上看到的浮层是「飞出去」的那层。
// 这里给 portal 内容加绝对定位，钉在卡片左上角附近，让它可见。
import { BodyPortal } from 'nomi'

/** portal 出去的浮动工具条：内容挂在 body，视觉上叠在最上层。 */
export const FloatingToolbar = (): JSX.Element => (
  <>
    <div
      style={{
        width: 320,
        height: 120,
        borderRadius: 'var(--nomi-radius-lg)',
        border: '1px dashed var(--nomi-line)',
        background: 'var(--nomi-paper)',
        display: 'grid',
        placeItems: 'center',
        font: '400 12px var(--nomi-font-sans)',
        color: 'var(--nomi-ink-60)',
        textAlign: 'center',
        padding: 12,
      }}
    >
      这个虚线框是「父容器」。
      <br />
      下面那条工具条已经被 portal 到 body 上了。
    </div>
    <BodyPortal>
      <div
        style={{
          position: 'absolute',
          top: 152,
          left: 24,
          display: 'inline-flex',
          gap: 8,
          alignItems: 'center',
          padding: '6px 10px',
          borderRadius: 'var(--nomi-radius-sm)',
          background: 'var(--nomi-ink)',
          color: 'var(--nomi-paper)',
          font: '500 12px var(--nomi-font-sans)',
          boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
        }}
      >
        已 portal 到 body · 不受父级 overflow 裁剪
      </div>
    </BodyPortal>
  </>
)
