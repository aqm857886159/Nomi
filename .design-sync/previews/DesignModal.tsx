// DesignModal —— 模态对话框（Mantine Modal 的 Nomi 封装：Nomi 字体/字色 + radius 默认 sm
// + zIndex 默认取自 NOMI_OVERLAY_Z_INDEX.dialog，保证叠放层级全仓一致）。
//
// 注意分工：**破坏性操作的确认卡不要手搓 DesignModal**——用 confirmDialog/alertDialog/promptDialog
// （设计系统 §3.5，宿主是 ConfirmDialogHost）。DesignModal 用于承载真正的内容型弹层。
//
// 预览：卡配了 cardMode:"single" + viewport 760x520，展开态才留在卡里而不逃出去。
// opened 直接给 true——静态卡渲染的就是打开态（关闭态没什么可看的）。
import { DesignModal, DesignButton, DesignTextInput } from 'nomi'

/** 内容型弹层：项目设置。 */
export const ProjectSettings = (): JSX.Element => (
  <DesignModal opened onClose={() => {}} title="项目设置" centered size="sm">
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <DesignTextInput label="项目名称" defaultValue="海边黄昏" />
      <DesignTextInput label="输出目录" defaultValue="文稿 / Nomi Projects / 海边黄昏" readOnly />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <DesignButton variant="subtle">取消</DesignButton>
        <DesignButton variant="filled">保存</DesignButton>
      </div>
    </div>
  </DesignModal>
)

/** 无标题 + 大尺寸：承载预览类内容。 */
export const LargeContent = (): JSX.Element => (
  <DesignModal opened onClose={() => {}} title="这一批要生成什么" centered size="md">
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {['第 1 镜 · 海边远景', '第 2 镜 · 推近侧脸', '第 3 镜 · 礁石特写'].map((s) => (
        <div
          key={s}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '8px 10px',
            borderRadius: 'var(--nomi-radius-sm)',
            border: '1px solid var(--nomi-line)',
            font: '400 13px var(--nomi-font-sans)',
            color: 'var(--nomi-ink)',
          }}
        >
          <span>{s}</span>
          <span style={{ fontFamily: 'var(--nomi-font-mono)', color: 'var(--nomi-ink-60)' }}>¥0.28</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span style={{ font: '400 12px var(--nomi-font-sans)', color: 'var(--nomi-ink-60)' }}>合计 ¥0.84</span>
        <DesignButton variant="filled">开始生成</DesignButton>
      </div>
    </div>
  </DesignModal>
)
