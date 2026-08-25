// DesignDrawer —— 抽屉（Mantine Drawer 的 Nomi 封装：Nomi 字体/字色
// + zIndex 默认取自 NOMI_OVERLAY_Z_INDEX.dialog）。
// 用于从边缘滑入的**辅助面板**（素材来源、参数详情），内容比 Modal 长、且用户可能要边看边操作主界面。
//
// 预览：配了 cardMode:"single" + viewport 760x520。滑入动画渲染不出来（截图是终态），
// 这里展示的是**已经打开**的形态。
import { DesignDrawer, DesignButton, DesignSearchInput } from 'nomi'

/** 右侧滑入的素材面板（默认 position="right"）。 */
export const AssetPanel = (): JSX.Element => (
  <DesignDrawer opened onClose={() => {}} title="添加素材" size="sm">
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DesignSearchInput value="" onChange={() => {}} placeholder="搜索素材，或粘贴一个链接" className="w-full" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {['参考图 01', '参考图 02', '角色设定', '场景板'].map((label) => (
          <div
            key={label}
            style={{
              borderRadius: 'var(--nomi-radius-sm)',
              border: '1px solid var(--nomi-line)',
              overflow: 'hidden',
              background: 'var(--nomi-paper)',
            }}
          >
            <div style={{ height: 60, background: 'linear-gradient(135deg, var(--nomi-ink-10), var(--nomi-ink-05))' }} />
            <div style={{ padding: '5px 7px', font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-80)' }}>
              {label}
            </div>
          </div>
        ))}
      </div>
      <DesignButton variant="filled">导入所选到画布</DesignButton>
    </div>
  </DesignDrawer>
)

/** 左侧滑入：位置轴的另一端。 */
export const FromLeft = (): JSX.Element => (
  <DesignDrawer opened onClose={() => {}} title="项目大纲" position="left" size="sm">
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {['第 1 镜 · 海边远景', '第 2 镜 · 推近侧脸', '第 3 镜 · 礁石特写', '第 4 镜 · 逆光剪影'].map((s) => (
        <div
          key={s}
          style={{
            padding: '8px 10px',
            borderRadius: 'var(--nomi-radius-sm)',
            background: 'var(--nomi-ink-05)',
            font: '400 13px var(--nomi-font-sans)',
            color: 'var(--nomi-ink)',
          }}
        >
          {s}
        </div>
      ))}
    </div>
  </DesignDrawer>
)
