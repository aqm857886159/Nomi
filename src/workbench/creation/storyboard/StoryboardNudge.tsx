import React from 'react'
import { cn } from '../../../utils/cn'
import { useWorkbenchStore } from '../../workbenchStore'
import { extractWorkbenchDocumentText } from '../creationAiModes'
import StoryboardActionCard, { type StoryboardShotMode } from './StoryboardActionCard'

// 情景卡自动浮现（用户拍板 2026-07-15）：写好故事、还没拆过镜头、非生成中时，在助手顶部浮一张「拆成镜头」卡。
// 补上「拆镜头没有可点入口、全靠说对暗号」这个触发难的根因；点了才跑、可关，不加常驻按钮、贴合「对话驱动」。
// 自成组件（从 CreationAiPanel 抽出，防巨壳 R9）：故事正文/是否已拆/收起态都在这判，父层只给 onRun + busy。
const STORYBOARD_NUDGE_MIN_CHARS = 60 // 故事正文达到这么多字才认为「有故事可拆」，避免刚起个头就弹卡。

export default function StoryboardNudge({
  busy,
  onRun,
}: {
  /** 生成/规划进行中时不浮卡（避免和在途轮次抢注意）。 */
  busy?: boolean
  onRun: (shotMode: StoryboardShotMode) => void
}): JSX.Element | null {
  const workbenchDocument = useWorkbenchStore((state) => state.workbenchDocument)
  const storyboardPlan = useWorkbenchStore((state) => state.storyboardPlan)
  const [dismissed, setDismissed] = React.useState(false)
  const documentText = React.useMemo(() => extractWorkbenchDocumentText(workbenchDocument), [workbenchDocument])

  // storyboardPlan≠null（已拆过、随项目持久化）→ 天然不再显示；收起=会话级。
  const show = !busy && !storyboardPlan && !dismissed && documentText.trim().length >= STORYBOARD_NUDGE_MIN_CHARS
  if (!show) return null

  return (
    <div className={cn('pt-1.5')}>
      <StoryboardActionCard
        kind="storyboard"
        resolved={false}
        lead="写好故事了？一键把它拆成一个个镜头、铺到画布。"
        onRun={(shotMode) => {
          setDismissed(true)
          onRun(shotMode)
        }}
        onDismiss={() => setDismissed(true)}
      />
    </div>
  )
}
