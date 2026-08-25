// NomiAILabel —— 「Nomi AI」署名标（图形标 + 字标 + 后缀）。
// 用在 AI 产出物的署名处：AI 生成的消息、自动写的分镜稿、AI 建议卡片。
// suffix 默认 'AI'，可以换成别的角色词（如「导演」「剪辑」），字标部分仍是品牌不变量。
// 组合取自真实调用点：AI 消息气泡的头部署名。
import { NomiAILabel } from 'nomi'

/** 尺寸轴：markSize / wordSize 分别控制两半。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
    <NomiAILabel markSize={18} wordSize={12} />
    <NomiAILabel markSize={22} wordSize={14} />
    <NomiAILabel markSize={30} wordSize={19} />
  </div>
)

/** suffix 轴：换成具体角色词，标清楚「是哪个 AI 在说话」。 */
export const RoleSuffixes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
    <NomiAILabel suffix="AI" />
    <NomiAILabel suffix="导演" />
    <NomiAILabel suffix="剪辑" />
  </div>
)

/** 真实用法：AI 消息气泡的头部署名 + 正文。 */
export const InMessageBubble = (): JSX.Element => (
  <div
    style={{
      width: 400,
      padding: 14,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <NomiAILabel markSize={20} wordSize={13} />
    <p style={{ margin: '10px 0 0', font: '400 13px var(--nomi-font-sans)', color: 'var(--nomi-ink-80)', lineHeight: 1.65 }}>
      我把「海边黄昏」拆成了 6 个镜头。第 3 镜原本是硬切，我改成缓推——你说要停在侧脸剪影，
      推进去收尾会更稳。要现在生成，还是先看看分镜稿？
    </p>
  </div>
)
