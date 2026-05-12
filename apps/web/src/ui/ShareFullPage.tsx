import React from 'react'
import { Box, Button as MantineButton, Center, Container, Group, Loader, ScrollArea, Stack, Text, Title, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconCopy, IconCopyPlus, IconFileText, IconRefresh } from '@tabler/icons-react'
import type { Edge, Node } from '@xyflow/react'
import { cloneProject, getPublicProjectFlows, listPublicProjects, type FlowDto, type ProjectDto } from '../api/server'
import { buildStudioUrl } from '../utils/appRoutes'
import { navigateBackOr } from '../utils/spaNavigate'
import { DesignBadge, DesignButton, DesignModal, DesignSelect, IconActionButton, PanelCard } from '../design'
import { useUIStore } from './uiStore'
import { toast } from './toast'
import { GenerationCanvas, useGenerationCanvasStore } from '../workbench/generationCanvasV2'
import { importLegacyFlowGraph } from '../workbench/generationCanvasV2/model/importLegacyFlowGraph'

const SHARE_GROUP_PADDING = 24
const SHARE_GROUP_MIN_WIDTH = 240
const SHARE_GROUP_MIN_HEIGHT = 160

type ReadonlyNodeData = Record<string, unknown>
type ReadonlyCanvasNode = Node<ReadonlyNodeData> & {
  width?: number
  height?: number
  parentId?: string
  selected?: boolean
  dragging?: boolean
  positionAbsolute?: unknown
}
type ReadonlyCanvasEdge = Edge<Record<string, unknown>> & {
  selected?: boolean
}
type ReadonlyCanvasGraph = {
  nodes: ReadonlyCanvasNode[]
  edges: ReadonlyCanvasEdge[]
}
type PromptEntry = {
  id: string
  label: string
  items: Array<{ label: string; value: string }>
}
type ShareViewport = { x: number; y: number; zoom: number }

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isReadonlyCanvasNode(value: unknown): value is ReadonlyCanvasNode {
  const record = readRecord(value)
  return typeof record.id === 'string'
}

function isReadonlyCanvasEdge(value: unknown): value is ReadonlyCanvasEdge {
  const record = readRecord(value)
  return typeof record.id === 'string' && typeof record.source === 'string' && typeof record.target === 'string'
}

function readReadonlyNodes(value: unknown): ReadonlyCanvasNode[] {
  return Array.isArray(value) ? value.filter(isReadonlyCanvasNode) : []
}

function readReadonlyEdges(value: unknown): ReadonlyCanvasEdge[] {
  return Array.isArray(value) ? value.filter(isReadonlyCanvasEdge) : []
}

function shareErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function readShareViewport(value: unknown): ShareViewport | null {
  const record = readRecord(value)
  const zoom = toFiniteNumber(record.zoom)
  if (zoom === null) return null
  return {
    x: toFiniteNumber(record.x) ?? 0,
    y: toFiniteNumber(record.y) ?? 0,
    zoom,
  }
}

function getReadonlyNodeSize(node: ReadonlyCanvasNode): { w: number; h: number } {
  const style = readRecord(node.style)
  const data = readRecord(node.data)
  const width = toFiniteNumber(node.width)
    ?? toFiniteNumber(style.width)
    ?? toFiniteNumber(data.nodeWidth)
  const height = toFiniteNumber(node.height)
    ?? toFiniteNumber(style.height)
    ?? toFiniteNumber(data.nodeHeight)
  const fallback = node.type === 'groupNode'
    ? { w: SHARE_GROUP_MIN_WIDTH, h: SHARE_GROUP_MIN_HEIGHT }
    : node.type === 'ioNode'
      ? { w: 88, h: 40 }
      : { w: 120, h: 210 }
  return {
    w: Math.max(24, width ?? fallback.w),
    h: Math.max(24, height ?? fallback.h),
  }
}

function normalizeReadonlyGroupLayout(rawNodes: ReadonlyCanvasNode[]): ReadonlyCanvasNode[] {
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return []
  let nodes = rawNodes.map((node) => ({ ...node }))
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false
    const byId = new Map(nodes.map((node) => [String(node.id || ''), node]))
    const groupIds = nodes
      .filter((node) => node.type === 'groupNode' && node.id)
      .map((node) => String(node.id))
    if (!groupIds.length) break

    // 先修正内层 group，再修正外层 group，避免嵌套场景反复抖动
    const depthOf = (groupId: string): number => {
      let depth = 0
      let current = byId.get(groupId)
      while (current) {
        const pid = typeof current.parentId === 'string' ? current.parentId.trim() : ''
        if (!pid) break
        const parent = byId.get(pid)
        if (!parent || parent.type !== 'groupNode') break
        depth += 1
        current = parent
      }
      return depth
    }

    const sortedGroupIds = groupIds.sort((a, b) => depthOf(b) - depthOf(a))
    for (const groupId of sortedGroupIds) {
      const group = byId.get(groupId)
      if (!group) continue
      const children = nodes.filter((node) => String(node.parentId || '').trim() === groupId)
      if (!children.length) continue

      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const child of children) {
        const px = toFiniteNumber(child.position?.x) ?? 0
        const py = toFiniteNumber(child.position?.y) ?? 0
        const { w, h } = getReadonlyNodeSize(child)
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px + w)
        maxY = Math.max(maxY, py + h)
      }
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue

      const offsetX = minX < SHARE_GROUP_PADDING ? SHARE_GROUP_PADDING - minX : 0
      const offsetY = minY < SHARE_GROUP_PADDING ? SHARE_GROUP_PADDING - minY : 0
      const nextChildren = offsetX > 0 || offsetY > 0
        ? children.map((child) => ({
          ...child,
          position: {
            x: (toFiniteNumber(child.position?.x) ?? 0) + offsetX,
            y: (toFiniteNumber(child.position?.y) ?? 0) + offsetY,
          },
        }))
        : children

      if (nextChildren !== children) {
        const nextById = new Map(nextChildren.map((n) => [String(n.id), n]))
        nodes = nodes.map((node) => nextById.get(String(node.id || '')) || node)
        changed = true
      }

      const nextMinX = minX + offsetX
      const nextMinY = minY + offsetY
      const nextMaxX = maxX + offsetX
      const nextMaxY = maxY + offsetY
      const desiredWidth = Math.max(
        SHARE_GROUP_MIN_WIDTH,
        Math.ceil(nextMaxX + SHARE_GROUP_PADDING),
      )
      const desiredHeight = Math.max(
        SHARE_GROUP_MIN_HEIGHT,
        Math.ceil(nextMaxY + SHARE_GROUP_PADDING),
      )
      const groupStyle = readRecord(group.style)
      const groupData = readRecord(group.data)
      const currentWidth = toFiniteNumber(group.width)
        ?? toFiniteNumber(groupStyle.width)
        ?? toFiniteNumber(groupData.nodeWidth)
        ?? SHARE_GROUP_MIN_WIDTH
      const currentHeight = toFiniteNumber(group.height)
        ?? toFiniteNumber(groupStyle.height)
        ?? toFiniteNumber(groupData.nodeHeight)
        ?? SHARE_GROUP_MIN_HEIGHT

      if (desiredWidth > currentWidth + 0.1 || desiredHeight > currentHeight + 0.1) {
        const nextGroup = {
          ...group,
          width: desiredWidth,
          height: desiredHeight,
          style: {
            ...groupStyle,
            width: desiredWidth,
            height: desiredHeight,
          },
          data: {
            ...groupData,
            nodeWidth: desiredWidth,
            nodeHeight: desiredHeight,
          },
        }
        nodes = nodes.map((node) => (String(node.id || '') === groupId ? nextGroup : node))
        changed = true
      }
    }
    if (!changed) break
  }
  return nodes
}

function sanitizeReadonlyGraph(payload: ReadonlyCanvasGraph): ReadonlyCanvasGraph {
  const normalizedNodes = normalizeReadonlyGroupLayout(payload.nodes || [])
  const nodes = normalizedNodes.map((node) => {
    const { selected: _selected, dragging: _dragging, positionAbsolute: _positionAbsolute, ...rest } = node
    return {
      ...rest,
      selected: false,
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
    }
  })
  const edges = (payload.edges || []).map((edge) => {
    const { selected: _selected, ...rest } = edge
    return {
      ...rest,
      selected: false,
      selectable: false,
      focusable: false,
    }
  })
  return { nodes, edges }
}

function parseShareLocation(): { projectId: string | null; flowId: string | null } {
  if (typeof window === 'undefined') return { projectId: null, flowId: null }
  const parts = (window.location.pathname || '').split('/').filter(Boolean)
  const idx = parts.indexOf('share')
  const projectId = idx >= 0 ? (parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : null) : null
  const flowId = idx >= 0 ? (parts[idx + 2] ? decodeURIComponent(parts[idx + 2]) : null) : null
  return { projectId, flowId }
}

function buildShareUrl(projectId?: string | null, flowId?: string | null): string {
  if (typeof window === 'undefined') {
    const base = projectId ? `/share/${encodeURIComponent(projectId)}` : '/share'
    return flowId ? `${base}/${encodeURIComponent(flowId)}` : base
  }
  try {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.pathname = projectId
      ? flowId
        ? `/share/${encodeURIComponent(projectId)}/${encodeURIComponent(flowId)}`
        : `/share/${encodeURIComponent(projectId)}`
      : '/share'
    return url.toString()
  } catch {
    const base = projectId ? `/share/${encodeURIComponent(projectId)}` : '/share'
    return flowId ? `${base}/${encodeURIComponent(flowId)}` : base
  }
}

export default function ShareFullPage(): JSX.Element {
  const { projectId, flowId } = React.useMemo(() => parseShareLocation(), [])
  const setViewOnly = useUIStore((s) => s.setViewOnly)
  const setCurrentProject = useUIStore((s) => s.setCurrentProject)
  const setCurrentFlow = useUIStore((s) => s.setCurrentFlow)
  const restoreGenerationCanvas = useGenerationCanvasStore((s) => s.restoreSnapshot)

  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [publicProjects, setPublicProjects] = React.useState<ProjectDto[]>([])
  const [project, setProject] = React.useState<ProjectDto | null>(null)
  const [flows, setFlows] = React.useState<FlowDto[]>([])
  const [selectedFlowId, setSelectedFlowId] = React.useState<string | null>(flowId)
  const [promptModalOpen, setPromptModalOpen] = React.useState(false)
  const [cloning, setCloning] = React.useState(false)

  React.useEffect(() => {
    setViewOnly(true)
    return () => {
      setViewOnly(false)
    }
  }, [setViewOnly])

  const reload = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setRefreshing(true)
    try {
      if (!projectId) {
        const projects = await listPublicProjects()
        setPublicProjects(projects || [])
        return
      }

      const [projects, projectFlows] = await Promise.all([
        listPublicProjects().catch(() => []),
        getPublicProjectFlows(projectId),
      ])
      const p = (projects || []).find((it) => it.id === projectId) || null
      setProject(p)
      setFlows(projectFlows || [])
    } catch (err: unknown) {
      console.error(err)
      toast(shareErrorMessage(err, '加载分享项目失败'), 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [projectId])

  React.useEffect(() => {
    void reload()
  }, [reload])

  React.useEffect(() => {
    if (!projectId) return
    if (!flows.length) return
    const exists = selectedFlowId && flows.some((f) => f.id === selectedFlowId)
    if (exists) return
    setSelectedFlowId(flows[0]!.id)
  }, [flows, projectId, selectedFlowId])

  React.useEffect(() => {
    if (!projectId) return
    if (!selectedFlowId) return
    const f = flows.find((it) => it.id === selectedFlowId)
    if (!f) return
    const data = readRecord(f.data)
    const nodes = readReadonlyNodes(data.nodes)
    const edges = readReadonlyEdges(data.edges)
    const viewport = readShareViewport(data.viewport)
    restoreGenerationCanvas(importLegacyFlowGraph(sanitizeReadonlyGraph({ nodes, edges })))
    useUIStore.getState().setRestoreViewport(viewport)
    setCurrentProject({ id: projectId, name: project?.name || 'Shared Project' })
    setCurrentFlow({ id: f.id, name: f.name, source: 'server' })
  }, [flows, project?.name, projectId, restoreGenerationCanvas, selectedFlowId, setCurrentFlow, setCurrentProject])

  const handleCopyLink = React.useCallback(async () => {
    const url = buildShareUrl(projectId, selectedFlowId)
    try {
      await navigator.clipboard.writeText(url)
      toast('已复制分享链接', 'success')
    } catch (err) {
      console.error(err)
      toast('复制失败，请手动复制地址栏链接', 'error')
    }
  }, [projectId, selectedFlowId])

  const handleCloneProject = React.useCallback(async () => {
    if (!projectId) return
    if (cloning) return
    setCloning(true)
    try {
      const baseName = project?.name ? `克隆 - ${project.name}` : '克隆项目'
      const cloned = await cloneProject(projectId, baseName)
      toast('已复制到我的项目', 'success')
      if (cloned?.id) {
        window.location.href = buildStudioUrl(cloned.id)
      }
    } catch (err: unknown) {
      console.error(err)
      toast(shareErrorMessage(err, '复制项目失败'), 'error')
    } finally {
      setCloning(false)
    }
  }, [cloning, project?.name, projectId])

  if (!projectId) {
    return (
      <Container className="tc-share" size="md" py={40}>
        <Stack className="tc-share__stack" gap="md">
          <Group className="tc-share__header" justify="space-between">
            <Title className="tc-share__title" order={3}>Nomi 分享</Title>
            <DesignButton className="tc-share__action" variant="subtle" onClick={() => navigateBackOr('/')}>
              返回
            </DesignButton>
          </Group>
          <Text className="tc-share__desc" size="sm" c="dimmed">
            这是只读分享页：只能观看创作过程，不能编辑画布，也不能发送消息。
          </Text>
          <Group className="tc-share__section-header" justify="space-between" align="center">
            <Title className="tc-share__section-title" order={5}>公开项目</Title>
            <IconActionButton className="tc-share__icon-button" variant="light" onClick={() => reload()} loading={refreshing || loading} aria-label="刷新分享项目列表" icon={<IconRefresh className="tc-share__icon" size={16} />} />
          </Group>
          {loading ? (
            <Center className="tc-share__center" py="lg">
              <Group className="tc-share__loading" gap="xs">
                <Loader className="tc-share__loader" size="sm" />
                <Text className="tc-share__loading-text" size="sm" c="dimmed">加载中…</Text>
              </Group>
            </Center>
          ) : publicProjects.length === 0 ? (
            <Text className="tc-share__empty" size="sm" c="dimmed">暂无公开项目</Text>
          ) : (
            <Stack className="tc-share__list" gap={8}>
              {publicProjects.map((p) => (
                <MantineButton
                  className="tc-design-button tc-share__list-item"
                  key={p.id}
                  variant="light"
                  component="a"
                  href={buildShareUrl(p.id, null)}
                  styles={{ inner: { justifyContent: 'space-between' } }}
                >
                  <span className="tc-share__list-name">{p.name}</span>
                  <DesignBadge className="tc-share__list-badge" variant="outline" color="green">公开</DesignBadge>
                </MantineButton>
              ))}
            </Stack>
          )}
        </Stack>
      </Container>
    )
  }

  const flowOptions = flows.map((f) => ({ value: f.id, label: f.name || f.id }))
  const selectedFlow = selectedFlowId ? flows.find((f) => f.id === selectedFlowId) : null
  const promptEntries = React.useMemo(() => {
    if (!selectedFlow) return []
    const data = readRecord(selectedFlow.data)
    const nodes = readReadonlyNodes(data.nodes)
    return nodes
      .map((node): PromptEntry | null => {
        const nodeData = readRecord(node.data)
        const label = (nodeData.label || nodeData.name || node.id || '未命名节点') as string
        const items: { label: string; value: string }[] = []
        const prompt = typeof nodeData.prompt === 'string' ? nodeData.prompt.trim() : ''
        if (prompt) items.push({ label: '提示词', value: prompt })
        const systemPrompt = typeof nodeData.systemPrompt === 'string' ? nodeData.systemPrompt.trim() : ''
        if (systemPrompt) items.push({ label: '系统提示词', value: systemPrompt })
        const storyboard = typeof nodeData.storyboard === 'string' ? nodeData.storyboard.trim() : ''
        if (storyboard && storyboard !== prompt) items.push({ label: '分镜脚本', value: storyboard })
        if (!items.length) return null
        return { id: String(node?.id || label), label, items }
      })
      .filter((entry): entry is PromptEntry => entry !== null)
  }, [selectedFlow])

  return (
    <Box className="tapcanvas-viewonly tc-share" style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      <Box
        className="tc-share__topbar"
        style={{
          flex: '0 0 auto',
          padding: 12,
          borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
          background: 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Group className="tc-share__topbar-row" justify="space-between" align="center" gap="sm">
          <Group className="tc-share__topbar-left" gap="sm" align="center">
            <Tooltip className="tc-share__tooltip" label="返回主页" withArrow>
              <IconActionButton className="tc-share__icon-button" variant="subtle" onClick={() => navigateBackOr('/')} aria-label="返回" icon={<IconArrowLeft className="tc-share__icon" size={18} />} />
            </Tooltip>
            <Stack className="tc-share__topbar-title" gap={0}>
              <Group className="tc-share__topbar-title-row" gap={8} align="center">
                <Title className="tc-share__title" order={5}>Nomi 分享</Title>
                <DesignBadge className="tc-share__badge" color="gray">只读</DesignBadge>
                {project?.ownerName && (
                  <DesignBadge className="tc-share__badge" variant="outline" color="blue">{project.ownerName}</DesignBadge>
                )}
              </Group>
              <Text className="tc-share__desc" size="xs" c="dimmed">
                只能观看创作过程，不能编辑画布，也不能发送消息。
              </Text>
            </Stack>
          </Group>

          <Group className="tc-share__topbar-actions" gap="xs" align="center">
            <DesignSelect
              className="tc-share__select"
              size="xs"
              value={selectedFlowId}
              onChange={(v) => setSelectedFlowId(v)}
              data={flowOptions}
              placeholder="选择工作流"
              w={220}
              disabled={loading || !flowOptions.length}
            />
            <Tooltip className="tc-share__tooltip" label="复制到我的项目" withArrow>
              <DesignButton
                className="tc-share__action"
                size="xs"
                variant="light"
                leftSection={<IconCopyPlus size={14} />}
                onClick={handleCloneProject}
                loading={cloning}
                disabled={!projectId}
              >
                复制项目
              </DesignButton>
            </Tooltip>
            <Tooltip className="tc-share__tooltip" label="查看提示词" withArrow>
              <IconActionButton
                className="tc-share__icon-button"
                variant="light"
                onClick={() => setPromptModalOpen(true)}
                aria-label="查看分享提示词"
                disabled={!selectedFlow}
                icon={<IconFileText className="tc-share__icon" size={16} />}
              />
            </Tooltip>
            <Tooltip className="tc-share__tooltip" label="复制分享链接" withArrow>
              <IconActionButton className="tc-share__icon-button" variant="light" onClick={handleCopyLink} aria-label="复制链接" icon={<IconCopy className="tc-share__icon" size={16} />} />
            </Tooltip>
            <Tooltip className="tc-share__tooltip" label="刷新" withArrow>
              <IconActionButton className="tc-share__icon-button" variant="light" onClick={() => reload({ silent: true })} loading={refreshing} aria-label="刷新当前分享项目" icon={<IconRefresh className="tc-share__icon" size={16} />} />
            </Tooltip>
          </Group>
        </Group>
      </Box>

      <Box className="tc-share__content" style={{ flex: 1, minHeight: 0 }}>
        {loading && !selectedFlow ? (
          <Center className="tc-share__center" style={{ height: '100%' }}>
            <Group className="tc-share__loading" gap="xs">
              <Loader className="tc-share__loader" size="sm" />
              <Text className="tc-share__loading-text" size="sm" c="dimmed">加载中…</Text>
            </Group>
          </Center>
        ) : flows.length === 0 ? (
          <Center className="tc-share__center" style={{ height: '100%' }}>
            <Text className="tc-share__empty" size="sm" c="dimmed">该项目暂无公开工作流</Text>
          </Center>
        ) : (
          <GenerationCanvas readOnly />
        )}
      </Box>
      <DesignModal
        className="tc-share__modal"
        opened={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title="提示词"
        size="lg"
        centered
      >
        <ScrollArea className="tc-share__scroll" h={480} type="auto">
          <Stack className="tc-share__modal-stack" gap="md">
            {promptEntries.length === 0 ? (
              <Text className="tc-share__empty" size="sm" c="dimmed">当前工作流暂无可展示的提示词。</Text>
            ) : (
              promptEntries.map((entry) => (
                <PanelCard className="tc-share__prompt-card" key={entry.id}>
                  <Group className="tc-share__prompt-header" justify="space-between" mb="xs" gap="xs">
                    <Text className="tc-share__prompt-title" size="sm" fw={600}>{entry.label}</Text>
                    <DesignBadge className="tc-share__badge" size="xs" color="gray">
                      {entry.items.length} 条
                    </DesignBadge>
                  </Group>
                  <Stack className="tc-share__prompt-list" gap="xs">
                    {entry.items.map((item) => (
                      <div className="tc-share__prompt-item" key={`${entry.id}-${item.label}`}>
                        <Text className="tc-share__prompt-label" size="xs" c="dimmed">{item.label}</Text>
                        <Text className="tc-share__prompt-value" size="sm" style={{ whiteSpace: 'pre-wrap' }}>{item.value}</Text>
                      </div>
                    ))}
                  </Stack>
                </PanelCard>
              ))
            )}
          </Stack>
        </ScrollArea>
      </DesignModal>
    </Box>
  )
}
