// NomiSkeleton —— 内容骨架屏（pending 规范 #3）。列表/面板数据 async 加载期的占位，
// 替代「空白色块 / return null / 空态文字」——用户看到的是「内容马上就来」，不是「这里没东西」。
// token-only pulse 块；motion-reduce 下不闪。自带 role="status" + aria-busy。
//
// lines>1 时**末行自动短一截**（w-3/5），更像真实文本块——这是它比手写占位条好的地方。
// className 覆盖的是每条的高度/宽度（如 'h-3'、'h-24'）。
import { NomiSkeleton } from 'nomi'

/** lines 轴：单条 vs 多条（注意末行更短）。 */
export const Lines = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: 360 }}>
    <NomiSkeleton />
    <NomiSkeleton lines={3} />
    <NomiSkeleton lines={5} />
  </div>
)

/** 真实用法：项目卡列表加载中——缩略图块 + 两行文字。 */
export const CardListLoading = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 380 }}>
    {[0, 1].map((i) => (
      <div
        key={i}
        style={{
          display: 'flex',
          gap: 12,
          padding: 12,
          borderRadius: 'var(--nomi-radius-lg)',
          border: '1px solid var(--nomi-line)',
          background: 'var(--nomi-paper)',
        }}
      >
        <div style={{ width: 72, flexShrink: 0 }}>
          <NomiSkeleton className="h-12" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <NomiSkeleton lines={2} />
        </div>
      </div>
    ))}
  </div>
)

/** 高度覆盖：用 className 换成缩略图尺寸的大块。 */
export const CustomHeights = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 340 }}>
    <NomiSkeleton className="h-3" />
    <NomiSkeleton className="h-8" />
    <NomiSkeleton className="h-20" />
  </div>
)
