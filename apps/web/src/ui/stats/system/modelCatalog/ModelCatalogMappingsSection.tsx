import React from 'react'
import { Divider, Group, Loader, Stack, Table, Text } from '@mantine/core'
import { IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react'
import {
  DesignButton,
  DesignModal,
  DesignSelect,
  DesignSwitch,
  DesignTextInput,
  DesignTextarea,
  IconActionButton,
} from '../../../../design'
import type { ModelCatalogMappingDto, ModelCatalogMappingTestResultDto, ModelCatalogModelDto, ProfileKind } from './deps'
import { testModelCatalogMapping, toast } from './deps'
import { EnabledBadge } from './ModelCatalogBadges'
import { ModelCatalogTableFooter } from './ModelCatalogTableFooter'
import { TASK_KIND_OPTIONS } from './modelCatalog.constants'
import { formatTaskKind, paginateItems, prettyJson } from './modelCatalog.utils'

type MappingTestState = {
  mapping: ModelCatalogMappingDto
  modelKey: string
  prompt: string
  stage: 'create' | 'result'
  execute: boolean
  taskId: string
  extrasText: string
  upstreamResponseText: string
  submitting: boolean
  result: ModelCatalogMappingTestResultDto | null
}

function safeParseJsonObject(text: string, fieldName: string): Record<string, unknown> | undefined {
  const raw = text.trim()
  if (!raw) return undefined
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

function safeParseJsonValue(text: string): unknown | undefined {
  const raw = text.trim()
  if (!raw) return undefined
  return JSON.parse(raw) as unknown
}

export function ModelCatalogMappingsSection({
  loading,
  mappings,
  models,
  vendorSelectData,
  onCreateMapping,
  onEditMapping,
  onDeleteMapping,
}: {
  loading: boolean
  mappings: ModelCatalogMappingDto[]
  models: ModelCatalogModelDto[]
  vendorSelectData: Array<{ value: string; label: string }>
  onCreateMapping: () => void
  onEditMapping: (mapping: ModelCatalogMappingDto) => void
  onDeleteMapping: (mapping: ModelCatalogMappingDto) => void
}): JSX.Element {
  const [vendorFilterInput, setVendorFilterInput] = React.useState<string>('all')
  const [taskKindFilterInput, setTaskKindFilterInput] = React.useState<ProfileKind | 'all'>('all')
  const [enabledOnlyInput, setEnabledOnlyInput] = React.useState(false)

  const [vendorFilter, setVendorFilter] = React.useState<string>('all')
  const [taskKindFilter, setTaskKindFilter] = React.useState<ProfileKind | 'all'>('all')
  const [enabledOnly, setEnabledOnly] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [testState, setTestState] = React.useState<MappingTestState | null>(null)

  const filteredMappings = React.useMemo(() => {
    let items = [...mappings]
    if (vendorFilter !== 'all') items = items.filter((mapping) => mapping.vendorKey === vendorFilter)
    if (taskKindFilter !== 'all') items = items.filter((mapping) => mapping.taskKind === taskKindFilter)
    if (enabledOnly) items = items.filter((mapping) => !!mapping.enabled)
    return items
  }, [enabledOnly, mappings, taskKindFilter, vendorFilter])

  const pagedMappings = React.useMemo(
    () => paginateItems(filteredMappings, page, pageSize),
    [filteredMappings, page, pageSize],
  )

  React.useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(filteredMappings.length / pageSize))
    if (page > totalPages) setPage(totalPages)
  }, [filteredMappings.length, page, pageSize])

  const submitSearch = React.useCallback(() => {
    setVendorFilter(vendorFilterInput)
    setTaskKindFilter(taskKindFilterInput)
    setEnabledOnly(enabledOnlyInput)
    setPage(1)
  }, [enabledOnlyInput, taskKindFilterInput, vendorFilterInput])

  const resetSearch = React.useCallback(() => {
    setVendorFilterInput('all')
    setTaskKindFilterInput('all')
    setEnabledOnlyInput(false)
    setVendorFilter('all')
    setTaskKindFilter('all')
    setEnabledOnly(false)
    setPage(1)
  }, [])

  const openTestModal = React.useCallback((mapping: ModelCatalogMappingDto) => {
    const firstModel = models.find((model) => model.vendorKey === mapping.vendorKey)
    setTestState({
      mapping,
      modelKey: firstModel?.modelKey ?? '',
      prompt: 'test prompt',
      stage: 'create',
      execute: false,
      taskId: '',
      extrasText: '{}',
      upstreamResponseText: '',
      submitting: false,
      result: null,
    })
  }, [models])

  const modelOptionsForTest = React.useMemo(() => {
    if (!testState) return []
    return models
      .filter((model) => model.vendorKey === testState.mapping.vendorKey)
      .map((model) => ({
        value: model.modelKey,
        label: `${model.labelZh}（${model.modelKey}）`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  }, [models, testState])

  const runMappingTest = React.useCallback(async () => {
    if (!testState || testState.submitting) return
    setTestState((current) => current ? { ...current, submitting: true, result: null } : current)
    try {
      const extras = safeParseJsonObject(testState.extrasText, 'extras')
      const upstreamResponse = safeParseJsonValue(testState.upstreamResponseText)
      const result = await testModelCatalogMapping(testState.mapping.id, {
        modelKey: testState.modelKey,
        prompt: testState.prompt,
        stage: testState.stage,
        execute: testState.execute,
        taskId: testState.taskId.trim() || undefined,
        ...(extras ? { extras } : {}),
        ...(typeof upstreamResponse === 'undefined' ? {} : { upstreamResponse }),
      })
      setTestState((current) => current ? { ...current, submitting: false, result } : current)
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试映射失败'
      toast(message, 'error')
      setTestState((current) => current ? { ...current, submitting: false } : current)
    }
  }, [testState])

  return (
    <>
      <Divider className="stats-model-catalog-divider" label="字段映射（Transform）" labelPosition="left" />
      <Group className="stats-model-catalog-mapping-search" gap="sm" wrap="wrap" align="flex-end">
        <DesignSelect
          className="stats-model-catalog-mapping-search-taskkind"
          label="任务类型"
          value={taskKindFilterInput}
          onChange={(value) => setTaskKindFilterInput(((value as ProfileKind | 'all' | null) || 'all'))}
          data={[{ value: 'all', label: '全部任务类型' }, ...TASK_KIND_OPTIONS]}
          w={240}
        />
        <DesignSelect
          className="stats-model-catalog-mapping-search-vendor"
          label="厂商"
          value={vendorFilterInput}
          onChange={(value) => setVendorFilterInput(value || 'all')}
          data={vendorSelectData}
          searchable
          w={220}
        />
        <DesignSwitch
          className="stats-model-catalog-mapping-search-enabled"
          checked={enabledOnlyInput}
          onChange={(event) => setEnabledOnlyInput(event.currentTarget.checked)}
          label="仅看启用映射"
          mb={4}
        />
        <Group className="stats-model-catalog-mapping-search-actions" gap={8} mb={4}>
          <DesignButton className="stats-model-catalog-mapping-search-submit" size="xs" onClick={submitSearch}>
            查询
          </DesignButton>
          <DesignButton className="stats-model-catalog-mapping-search-reset" size="xs" variant="subtle" onClick={resetSearch}>
            重置
          </DesignButton>
          <DesignButton className="stats-model-catalog-mapping-create" size="xs" variant="light" leftSection={<IconPlus className="stats-model-catalog-mapping-create-icon" size={14} />} onClick={onCreateMapping}>
            新增映射
          </DesignButton>
        </Group>
      </Group>

      <div className="stats-model-catalog-mappings-table-wrap" style={{ overflowX: 'auto' }}>
        <Table className="stats-model-catalog-mappings-table" striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead className="stats-model-catalog-mappings-table-head">
            <Table.Tr className="stats-model-catalog-mappings-table-head-row">
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 120 }}>厂商</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 170 }}>任务类型</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 180 }}>名称</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 90 }}>状态</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell">Request</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell">Response</Table.Th>
              <Table.Th className="stats-model-catalog-mappings-table-head-cell" style={{ width: 110 }}>操作</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody className="stats-model-catalog-mappings-table-body">
            {loading && !mappings.length ? (
              <Table.Tr className="stats-model-catalog-mappings-table-row-loading">
                <Table.Td className="stats-model-catalog-mappings-table-cell" colSpan={7}>
                  <Group className="stats-model-catalog-loading" gap="xs" align="center">
                    <Loader className="stats-model-catalog-loading-icon" size="sm" />
                    <Text className="stats-model-catalog-loading-text" size="sm" c="dimmed">加载中…</Text>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ) : !pagedMappings.length ? (
              <Table.Tr className="stats-model-catalog-mappings-table-row-empty">
                <Table.Td className="stats-model-catalog-mappings-table-cell" colSpan={7}>
                  <Text className="stats-model-catalog-empty" size="sm" c="dimmed">暂无映射</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pagedMappings.map((mapping) => (
                <Table.Tr className="stats-model-catalog-mappings-table-row" key={mapping.id}>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-vendor" size="sm" fw={600}>{mapping.vendorKey}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-taskkind" size="sm" c="dimmed">{formatTaskKind(mapping.taskKind)}</Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-name" size="sm">
                      {mapping.name}
                      {((mapping.requestMapping as { version?: unknown } | null | undefined)?.version === 'v2' || (mapping.responseMapping as { version?: unknown } | null | undefined)?.version === 'v2') ? ' · V2' : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <EnabledBadge enabled={!!mapping.enabled} />
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-request" size="xs" c="dimmed" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mapping.requestMapping ? prettyJson(mapping.requestMapping).replace(/\s+/g, ' ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Text className="stats-model-catalog-mapping-response" size="xs" c="dimmed" style={{ maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mapping.responseMapping ? prettyJson(mapping.responseMapping).replace(/\s+/g, ' ') : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td className="stats-model-catalog-mappings-table-cell">
                    <Group className="stats-model-catalog-mapping-row-actions" gap={6} justify="flex-end" wrap="nowrap">
                      <IconActionButton className="stats-model-catalog-mapping-test" size="sm" variant="light" aria-label={`test-mapping-${mapping.id}`} onClick={() => openTestModal(mapping)} icon={<IconPlayerPlay className="stats-model-catalog-mapping-test-icon" size={14} />} />
                      <DesignButton className="stats-model-catalog-mapping-edit" size="xs" variant="light" onClick={() => onEditMapping(mapping)}>编辑</DesignButton>
                      <IconActionButton className="stats-model-catalog-mapping-delete" size="sm" variant="light" color="red" aria-label="delete-mapping" onClick={() => void onDeleteMapping(mapping)} icon={<IconTrash className="stats-model-catalog-mapping-delete-icon" size={14} />} />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </div>

      <ModelCatalogTableFooter
        total={filteredMappings.length}
        page={page}
        pageSize={pageSize}
        onChangePage={setPage}
        onChangePageSize={(next) => {
          setPageSize(next)
          setPage(1)
        }}
      />
      <DesignModal
        className="stats-model-catalog-mapping-test-modal"
        opened={!!testState}
        onClose={() => setTestState(null)}
        title="测试字段映射"
        size="xl"
      >
        {testState && (
          <Stack className="stats-model-catalog-mapping-test-body" gap="sm">
            <Group className="stats-model-catalog-mapping-test-summary" gap="xs" wrap="wrap">
              <Text className="stats-model-catalog-mapping-test-summary-vendor" size="xs" fw={700}>{testState.mapping.vendorKey}</Text>
              <Text className="stats-model-catalog-mapping-test-summary-kind" size="xs" c="dimmed">{formatTaskKind(testState.mapping.taskKind)}</Text>
              <Text className="stats-model-catalog-mapping-test-summary-name" size="xs" c="dimmed">{testState.mapping.name}</Text>
            </Group>
            <Group className="stats-model-catalog-mapping-test-form" gap="xs" align="flex-end" wrap="wrap">
              <DesignSelect
                className="stats-model-catalog-mapping-test-model"
                label="模型"
                data={modelOptionsForTest}
                value={testState.modelKey}
                onChange={(value) => setTestState((current) => current ? { ...current, modelKey: value || '' } : current)}
                searchable
                size="xs"
                style={{ flex: '2 1 260px' }}
              />
              <DesignSelect
                className="stats-model-catalog-mapping-test-stage"
                label="阶段"
                data={[
                  { value: 'create', label: 'create' },
                  { value: 'result', label: 'result/query' },
                ]}
                value={testState.stage}
                onChange={(value) => setTestState((current) => current ? { ...current, stage: value === 'result' ? 'result' : 'create' } : current)}
                size="xs"
                style={{ flex: '1 1 140px' }}
              />
              <DesignSwitch
                className="stats-model-catalog-mapping-test-execute"
                checked={testState.execute}
                onChange={(event) => setTestState((current) => current ? { ...current, execute: event.currentTarget.checked } : current)}
                label="真实发送"
                mb={4}
              />
              <DesignButton
                className="stats-model-catalog-mapping-test-run"
                size="xs"
                loading={testState.submitting}
                leftSection={<IconPlayerPlay className="stats-model-catalog-mapping-test-run-icon" size={14} />}
                onClick={() => void runMappingTest()}
              >
                测试
              </DesignButton>
            </Group>
            <DesignTextInput
              className="stats-model-catalog-mapping-test-task-id"
              label="taskId / provider query id"
              value={testState.taskId}
              onChange={(event) => setTestState((current) => current ? { ...current, taskId: event.currentTarget.value } : current)}
              size="xs"
              placeholder="result 阶段需要时填写"
            />
            <DesignTextarea
              className="stats-model-catalog-mapping-test-prompt"
              label="测试 prompt"
              value={testState.prompt}
              onChange={(event) => setTestState((current) => current ? { ...current, prompt: event.currentTarget.value } : current)}
              minRows={2}
              autosize
            />
            <DesignTextarea
              className="stats-model-catalog-mapping-test-extras"
              label="extras JSON"
              value={testState.extrasText}
              onChange={(event) => setTestState((current) => current ? { ...current, extrasText: event.currentTarget.value } : current)}
              minRows={3}
              autosize
            />
            <DesignTextarea
              className="stats-model-catalog-mapping-test-upstream-response"
              label="上游响应 JSON（可选，用于只验证 response mapping）"
              value={testState.upstreamResponseText}
              onChange={(event) => setTestState((current) => current ? { ...current, upstreamResponseText: event.currentTarget.value } : current)}
              minRows={3}
              autosize
            />
            {testState.result && (
              <Stack className="stats-model-catalog-mapping-test-result" gap="xs">
                <Text className="stats-model-catalog-mapping-test-result-status" size="xs" fw={700}>
                  {testState.result.ok ? '测试通过' : '测试完成但有诊断'}
                </Text>
                {testState.result.diagnostics.length > 0 && (
                  <Text className="stats-model-catalog-mapping-test-result-diagnostics" size="xs" c="dimmed">
                    {testState.result.diagnostics.join(' / ')}
                  </Text>
                )}
                <DesignTextarea
                  className="stats-model-catalog-mapping-test-result-json"
                  value={JSON.stringify(testState.result, null, 2)}
                  readOnly
                  autosize
                  minRows={10}
                />
              </Stack>
            )}
          </Stack>
        )}
      </DesignModal>
    </>
  )
}
