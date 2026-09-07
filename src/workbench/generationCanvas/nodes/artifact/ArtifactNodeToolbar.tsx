// agent-artifact 节点的选中浮条动作。复用系统 NodeFloatingToolbar 的容器与按钮原子（不新造样式）：
//   · 下载：文件已落盘（meta.artifact.url 带真实扩展名）→ bridge.assets.download 按 url 补全文件名。
//   · 复制：text/markdown/html 取文本进剪贴板（可复制的内容才给"复制"）。
//   · 固化为参考图：SVG 栅格化成 PNG → asset 节点（可被下游连线当参考）——「下游消费」的 UI 出口。
// 只读预览节点不进编辑态；动作只在选中浮条（L2），不压内容。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCopy, IconDownload, IconPhoto } from '@tabler/icons-react'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { toast } from '../../../../ui/toast'
import { canArtifactBecomeReference, type AgentArtifactMeta } from '../../model/artifactMeta'
import { FloatingToolbarShell, TOOLBAR_ICON as I, ToolbarButton } from '../NodeFloatingToolbar'
import { rasterizeArtifactToReferenceAsset } from './rasterizeArtifactToReferenceAsset'

type Props = {
  title: string
  artifact: AgentArtifactMeta
  /** 复制文本的来源（text/markdown/html 才传；取文件文本进剪贴板）。 */
  onCopyText?: () => Promise<void>
  canCopyText: boolean
}

export default function ArtifactNodeToolbar({ title, artifact, onCopyText, canCopyText }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const [downloading, setDownloading] = React.useState(false)
  const [copying, setCopying] = React.useState(false)
  const [rasterizing, setRasterizing] = React.useState(false)

  const download = React.useCallback(() => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    setDownloading(true)
    const base = (title || '').trim() || t('runtime.nodeRegistry.agent-artifact.downloadName')
    void bridge.assets
      .download({ url: artifact.url, suggestedName: base })
      .then((result) => {
        if (result.ok) toast(t('generationCommon.resultDownload.saved'), 'success')
        else if (!result.canceled) toast(t('generationCommon.resultDownload.failed'), 'error')
      })
      .catch(() => toast(t('generationCommon.resultDownload.failed'), 'error'))
      .finally(() => setDownloading(false))
  }, [artifact.url, title, t])

  const copy = React.useCallback(() => {
    if (!onCopyText) return
    setCopying(true)
    void onCopyText()
      .then(() => toast(t('runtime.nodeRegistry.agent-artifact.copied'), 'success'))
      .catch(() => toast(t('runtime.nodeRegistry.agent-artifact.copyFailed'), 'error'))
      .finally(() => setCopying(false))
  }, [onCopyText, t])

  const rasterizeReference = React.useCallback(() => {
    setRasterizing(true)
    void rasterizeArtifactToReferenceAsset(artifact)
      .then((result) => {
        if (result.ok) toast(t('runtime.nodeRegistry.agent-artifact.referenceCreated'), 'success')
        else toast(t('runtime.nodeRegistry.agent-artifact.referenceFailed'), 'error')
      })
      .catch(() => toast(t('runtime.nodeRegistry.agent-artifact.referenceFailed'), 'error'))
      .finally(() => setRasterizing(false))
  }, [artifact, t])

  return (
    <FloatingToolbarShell ariaLabel={t('runtime.nodeRegistry.agent-artifact.actions')}>
      {canArtifactBecomeReference(artifact.fileType) ? (
        <ToolbarButton
          icon={<IconPhoto size={I.size} stroke={I.stroke} />}
          label={t('runtime.nodeRegistry.agent-artifact.referenceAction')}
          disabled={rasterizing}
          onClick={rasterizeReference}
        />
      ) : null}
      {canCopyText ? (
        <ToolbarButton
          icon={<IconCopy size={I.size} stroke={I.stroke} />}
          label={t('runtime.nodeRegistry.agent-artifact.copy')}
          disabled={copying || !onCopyText}
          onClick={copy}
        />
      ) : null}
      <ToolbarButton
        icon={<IconDownload size={I.size} stroke={I.stroke} />}
        label={t('generationCommon.resultDownload.download')}
        disabled={downloading}
        onClick={download}
      />
    </FloatingToolbarShell>
  )
}
