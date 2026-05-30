/**
 * 模型设置抽屉——抽屉打开后看到的内容。
 *
 * - 顶部：[+ 添加模型] 按钮（打开 Wizard Modal）
 * - 下方：按 kind 分组列出已配置的模型，每条显示：名字 · vendor · 参数数 · 状态
 * - 每条右侧 🗑 删除（不再有"编辑"——v0.8 暂不支持编辑已 onboarded 模型，重新跑 Wizard 即可）
 *
 * 用户视角权重：
 *  ⭐⭐⭐ 加新模型（动作）
 *  ⭐⭐ 看现有模型（确认配齐了）
 *  ⭐ 删（万一加错）
 *  ❌ 编辑参数 / 编辑 vendor（90% 用户不需要；专家走 catalog 文件）
 */
import React from 'react'
import { Stack, Group, Text, ActionIcon } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { DesignButton } from '../../design'
import { OnboardingWizard } from './OnboardingWizard'
import { getDesktopBridge } from '../../desktop/bridge'
import { notifyModelOptionsRefresh } from '../../config/useModelOptions'

type ModelRow = {
  modelKey: string
  vendorKey: string
  labelZh: string
  kind: 'text' | 'image' | 'video' | 'audio'
  fieldsCount: number
  vendorBaseUrl: string
}

const KIND_LABEL: Record<ModelRow['kind'], string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
}

const KIND_ORDER: ModelRow['kind'][] = ['text', 'image', 'video', 'audio']

export function OnboardingDrawer(): JSX.Element {
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [models, setModels] = React.useState<ModelRow[]>([])
  const [version, setVersion] = React.useState(0) // bump to refetch

  React.useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    try {
      const ms = bridge.modelCatalog.listModels() as Array<Record<string, unknown>>
      const vs = bridge.modelCatalog.listVendors() as Array<Record<string, unknown>>
      const vendorMap = new Map<string, string>()
      for (const v of vs) vendorMap.set(String(v.key), String(v.baseUrlHint || ''))
      const rows: ModelRow[] = ms.map((m) => {
        const onboarding = m.onboarding as { fields?: unknown[] } | undefined
        return {
          modelKey: String(m.modelKey),
          vendorKey: String(m.vendorKey),
          labelZh: String(m.labelZh || m.modelKey),
          kind: m.kind as ModelRow['kind'],
          fieldsCount: Array.isArray(onboarding?.fields) ? onboarding!.fields!.length : 0,
          vendorBaseUrl: vendorMap.get(String(m.vendorKey)) || '',
        }
      })
      setModels(rows)
    } catch {
      setModels([])
    }
  }, [version])

  const handleAdded = React.useCallback(() => {
    notifyModelOptionsRefresh('all')
    setVersion((v) => v + 1)
  }, [])

  const handleDelete = React.useCallback((row: ModelRow) => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const ok = window.confirm(`删除「${row.labelZh}」？此操作不可恢复。`)
    if (!ok) return
    try {
      bridge.modelCatalog.deleteModel(row.vendorKey, row.modelKey)
      notifyModelOptionsRefresh('all')
      setVersion((v) => v + 1)
    } catch (e) {
      window.alert(`删除失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  const byKind: Record<ModelRow['kind'], ModelRow[]> = { text: [], image: [], video: [], audio: [] }
  for (const m of models) byKind[m.kind].push(m)

  return (
    <Stack gap="md" p="md" h="100%">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={700} c="var(--nomi-ink)">模型设置</Text>
        <DesignButton
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => setWizardOpen(true)}
        >
          添加模型
        </DesignButton>
      </Group>

      {models.length === 0 ? (
        <Stack align="center" justify="center" h={200} gap="xs">
          <Text size="sm" c="var(--nomi-ink-60)">还没有模型</Text>
          <Text size="xs" c="var(--nomi-ink-40)">点上方"添加模型"接入第一个</Text>
        </Stack>
      ) : (
        <Stack gap="sm" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {KIND_ORDER.map((kind) => {
            const list = byKind[kind]
            if (list.length === 0) return null
            return (
              <Stack key={kind} gap={6}>
                <Text size="xs" fw={500} c="var(--nomi-ink-60)" tt="uppercase">
                  {KIND_LABEL[kind]}
                </Text>
                {list.map((row) => (
                  <Group
                    key={`${row.vendorKey}-${row.modelKey}`}
                    justify="space-between"
                    align="center"
                    wrap="nowrap"
                    gap="xs"
                    px="xs"
                    py={6}
                    style={{
                      borderRadius: 'var(--nomi-radius-sm)',
                      background: 'var(--nomi-paper)',
                    }}
                  >
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" c="var(--nomi-ink)" truncate>{row.labelZh}</Text>
                      <Text size="xs" c="var(--nomi-ink-60)" truncate>
                        {row.vendorKey} · {row.fieldsCount > 0 ? `${row.fieldsCount} 参数` : '无参数'}
                      </Text>
                    </Stack>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={() => handleDelete(row)}
                      aria-label={`删除 ${row.labelZh}`}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )
          })}
        </Stack>
      )}

      <OnboardingWizard
        opened={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCommitted={handleAdded}
      />
    </Stack>
  )
}
