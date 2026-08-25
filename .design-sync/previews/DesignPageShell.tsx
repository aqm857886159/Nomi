// DesignPageShell —— 页面外壳：min-h-screen + bg-nomi-bg + Nomi 字体/字色。
// 它是**整页的最外层容器**，负责钉死「这一页的底色和排版基线」，别把它当卡片容器用。
// props 就是普通 div 的 props（className 可加，其余透传）。
//
// 预览注意：组件本身带 min-h-screen，卡里会顶到视口高——这是它真实的样子，不是塌陷。
import { DesignPageShell, DesignSearchInput, ActionCard, DesignEmptyState } from 'nomi'
import { IconPlus, IconFolderOpen } from '@tabler/icons-react'

/** 真实用法：项目库整页——外壳给底色，里面才是内容区。 */
export const LibraryPage = (): JSX.Element => (
  <DesignPageShell className="min-h-0">
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0, font: '400 22px var(--nomi-font-display)', color: 'var(--nomi-ink)' }}>我的项目</h1>
        <DesignSearchInput value="" onChange={() => {}} placeholder="搜索项目" className="w-[220px]" />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <ActionCard
          variant="primary"
          icon={<IconPlus size={18} stroke={1.8} />}
          title="新建空白项目"
          description="从一段文字或想法开始"
        />
        <ActionCard
          icon={<IconFolderOpen size={18} stroke={1.6} />}
          title="打开素材文件夹"
          description="把素材文件夹变成项目"
        />
      </div>
    </div>
  </DesignPageShell>
)

/** 空页：外壳 + 居中空态（新用户首屏）。 */
export const EmptyPage = (): JSX.Element => (
  <DesignPageShell className="min-h-0">
    <DesignEmptyState
      icon={<IconFolderOpen size={34} stroke={1.4} className="text-nomi-ink-30" />}
      title="还没有项目"
      description="从一句话开始，Nomi 会帮你拆成分镜、生成画面、拼成成片。"
    />
  </DesignPageShell>
)
