import React from 'react'
import { Divider, Group, Image, Loader, Pagination, SimpleGrid, Stack, Table, Text, Tooltip } from '@mantine/core'
import { IconPencil, IconPlus, IconRefresh, IconSearch, IconTrash, IconUpload } from '@tabler/icons-react'
import { DesignButton, DesignModal, DesignSelect, DesignSwitch, DesignTextInput, DesignTextarea, IconActionButton, InlinePanel, PanelCard } from '../../design'
import type { AiCharacterLibraryActions, AiCharacterLibraryDerived, AiCharacterLibraryState } from './aiCharacterLibrary.types'
import { buildCharacterMeta, formatTime, pickPreviewUrl } from './aiCharacterLibrary.utils'

type Props = AiCharacterLibraryState & AiCharacterLibraryDerived & AiCharacterLibraryActions & {
  className?: string
  canEdit: boolean
  importFileInputRef: React.RefObject<HTMLInputElement | null>
}

export default function AiCharacterLibraryManagementView(props: Props): JSX.Element {
  const {
    className,
    canEdit,
    currentProjectOnly,
    onCurrentProjectOnlyChange,
    onReload,
    loading,
    search,
    onSearchChange,
    pageSize,
    onPageSizeChange,
    total,
    pageStart,
    pageEnd,
    syncState,
    importing,
    onImportFileLoad,
    onImportSubmit,
    importText,
    onImportTextChange,
    importFileInputRef,
    items,
    deletingId,
    onDelete,
    onEdit,
    saving,
    editor,
    onEditorChange,
    onEditorSubmit,
    totalPages,
    onPageChange,
    page,
    effectiveProjectId,
  } = props

  return (
    <PanelCard className={className}>
      <Stack className="ai-character-library-management-stack" gap="sm">
        <Group className="ai-character-library-management-header" justify="space-between" align="flex-start" wrap="wrap">
          <Stack className="ai-character-library-management-copy" gap={2}>
            <Text className="ai-character-library-management-title" fw={700}>AI 角色库管理</Text>
            <Text className="ai-character-library-management-subtitle" size="xs" c="dimmed">
              支持分页查询、单条 CRUD 和 JSON 批量导入。{syncState?.lastSyncedAt ? `最近同步：${formatTime(syncState.lastSyncedAt)}` : '当前为本地角色库。'}
            </Text>
          </Stack>
          <Group className="ai-character-library-management-actions" gap="xs" wrap="wrap">
            {effectiveProjectId ? (
              <DesignSwitch
                className="ai-character-library-management-project-switch"
                size="xs"
                checked={currentProjectOnly}
                onChange={(event) => {
                  onCurrentProjectOnlyChange(event.currentTarget.checked)
                  onPageChange(1)
                }}
                label="仅当前项目"
              />
            ) : null}
            <Tooltip className="ai-character-library-management-refresh-tooltip" label="刷新" withArrow>
              <IconActionButton className="ai-character-library-management-refresh" variant="subtle" onClick={onReload} loading={loading} aria-label="刷新角色库" icon={<IconRefresh className="ai-character-library-management-refresh-icon" size={16} />} />
            </Tooltip>
            <DesignButton
              className="ai-character-library-management-create"
              size="xs"
              leftSection={<IconPlus className="ai-character-library-management-create-icon" size={14} />}
              disabled={!canEdit}
              onClick={() => onEditorChange(buildEditorState())}
            >
              新建角色
            </DesignButton>
          </Group>
        </Group>

        <Group className="ai-character-library-management-toolbar" justify="space-between" align="center" wrap="wrap">
          <DesignTextInput
            className="ai-character-library-management-search"
            value={search}
            onChange={(event) => {
              onSearchChange(event.currentTarget.value)
              onPageChange(1)
            }}
            leftSection={<IconSearch className="ai-character-library-management-search-icon" size={14} />}
            placeholder="搜索：名称 / character_id / 标签 / 设定"
            w={320}
          />
          <Group className="ai-character-library-management-meta" gap="xs" wrap="wrap">
            <Text className="ai-character-library-management-summary" size="xs" c="dimmed">
              {total > 0 ? `第 ${pageStart}-${pageEnd} / 共 ${total} 条` : '共 0 条'}
            </Text>
            <DesignSelect
              className="ai-character-library-management-page-size"
              value={String(pageSize)}
              data={[
                { value: '10', label: '10 / 页' },
                { value: '20', label: '20 / 页' },
                { value: '50', label: '50 / 页' },
              ]}
              onChange={(value) => {
                const nextPageSize = Number.parseInt(String(value || pageSize), 10)
                if (!Number.isFinite(nextPageSize) || nextPageSize <= 0) return
                onPageSizeChange(nextPageSize)
                onPageChange(1)
              }}
              allowDeselect={false}
              w={100}
            />
          </Group>
        </Group>

        <InlinePanel className="ai-character-library-management-import">
          <Stack className="ai-character-library-management-import-stack" gap="xs">
            <Group className="ai-character-library-management-import-header" justify="space-between" align="center" wrap="wrap">
              <Text className="ai-character-library-management-import-title" fw={600}>JSON 批量导入</Text>
              <Group className="ai-character-library-management-import-actions" gap="xs" wrap="wrap">
                <DesignButton
                  className="ai-character-library-management-import-file"
                  size="xs"
                  variant="light"
                  disabled={!canEdit}
                  leftSection={<IconUpload className="ai-character-library-management-import-file-icon" size={14} />}
                  onClick={() => importFileInputRef.current?.click()}
                >
                  加载 JSON 文件
                </DesignButton>
                <DesignButton
                  className="ai-character-library-management-import-submit"
                  size="xs"
                  loading={importing}
                  disabled={!canEdit}
                  onClick={onImportSubmit}
                >
                  导入 JSON
                </DesignButton>
              </Group>
            </Group>
            <input
              className="ai-character-library-management-import-input"
              ref={importFileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={onImportFileLoad}
              hidden
            />
            <Text className="ai-character-library-management-import-hint" size="xs" c="dimmed">
              支持 <code className="ai-character-library-management-import-code">[{`{...}`}]</code> 或 <code className="ai-character-library-management-import-code">{'{ "characters": [...] }'}</code>。导入按 sourceCharacterUid / 角色关键信息做 upsert，不会静默丢弃。
            </Text>
            <DesignTextarea
              className="ai-character-library-management-import-textarea"
              value={importText}
              onChange={(event) => onImportTextChange(event.currentTarget.value)}
              minRows={6}
              autosize
              placeholder='[{"name":"角色A","character_id":"role_a","identity_hint":"主角","full_body_image_url":"https://..."}]'
            />
          </Stack>
        </InlinePanel>

        <Divider className="ai-character-library-management-divider" />

        {loading ? (
          <Group className="ai-character-library-management-loading" justify="center" py="xl">
            <Loader className="ai-character-library-management-loading-icon" size="sm" />
            <Text className="ai-character-library-management-loading-text" size="sm" c="dimmed">加载中…</Text>
          </Group>
        ) : items.length === 0 ? (
          <InlinePanel className="ai-character-library-management-empty" padding="default">
            <Text className="ai-character-library-management-empty-text" size="sm" c="dimmed">当前筛选下没有角色库记录。</Text>
          </InlinePanel>
        ) : (
          <Table.ScrollContainer className="ai-character-library-management-table-scroll" minWidth={960}>
            <Table className="ai-character-library-management-table" striped highlightOnHover withTableBorder>
              <Table.Thead className="ai-character-library-management-table-head">
                <Table.Tr className="ai-character-library-management-table-head-row">
                  <Table.Th className="ai-character-library-management-table-head-cell">预览</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">角色</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">标签</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">图片</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">更新时间</Table.Th>
                  <Table.Th className="ai-character-library-management-table-head-cell">操作</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody className="ai-character-library-management-table-body">
                {items.map((character) => {
                  const previewUrl = pickPreviewUrl(character)
                  const imageCount = [
                    character.full_body_image_url,
                    character.three_view_image_url,
                    character.expression_image_url,
                    character.closeup_image_url,
                  ].filter((value) => value && value.trim()).length
                  return (
                    <Table.Tr className="ai-character-library-management-table-row" key={character.id}>
                      <Table.Td className="ai-character-library-management-table-cell">
                        {previewUrl ? (
                          <Image className="ai-character-library-management-preview" src={previewUrl} alt={character.name || character.character_id || character.id} w={72} h={72} radius="sm" fit="cover" />
                        ) : (
                          <InlinePanel className="ai-character-library-management-preview ai-character-library-management-preview--empty" padding="compact">
                            <Text className="ai-character-library-management-preview-empty-text" size="xs" c="dimmed">无图</Text>
                          </InlinePanel>
                        )}
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Stack className="ai-character-library-management-role" gap={2}>
                          <Text className="ai-character-library-management-role-name" fw={600}>{character.name || '未命名角色'}</Text>
                          <Text className="ai-character-library-management-role-id" size="xs" c="dimmed">
                            {character.character_id || '无 character_id'}
                          </Text>
                          <Text className="ai-character-library-management-role-meta" size="xs" c="dimmed">
                            {buildCharacterMeta(character) || '无附加标签'}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Stack className="ai-character-library-management-tags" gap={2}>
                          <Text className="ai-character-library-management-tag-line" size="xs" c="dimmed">
                            世界观：{character.filter_worldview || '—'}
                          </Text>
                          <Text className="ai-character-library-management-tag-line" size="xs" c="dimmed">
                            主题：{character.filter_theme || '—'}
                          </Text>
                          <Text className="ai-character-library-management-tag-line" size="xs" c="dimmed">
                            场景：{character.filter_scene || '—'}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Text className="ai-character-library-management-image-count" size="sm">{imageCount} / 4</Text>
                        <Text className="ai-character-library-management-import-time" size="xs" c="dimmed">
                          导入：{formatTime(character.imported_at)}
                        </Text>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Text className="ai-character-library-management-updated-time" size="xs" c="dimmed">
                          {formatTime(character.updated_at)}
                        </Text>
                      </Table.Td>
                      <Table.Td className="ai-character-library-management-table-cell">
                        <Group className="ai-character-library-management-row-actions" gap="xs" wrap="nowrap">
                          <Tooltip className="ai-character-library-management-edit-tooltip" label="编辑" withArrow>
                            <IconActionButton
                              className="ai-character-library-management-edit"
                              variant="subtle"
                              color="blue"
                              disabled={!canEdit}
                              aria-label="编辑角色库记录"
                              onClick={() => onEdit(character)}
                              icon={<IconPencil className="ai-character-library-management-edit-icon" size={16} />}
                            />
                          </Tooltip>
                          <Tooltip className="ai-character-library-management-delete-tooltip" label="删除" withArrow>
                            <IconActionButton
                              className="ai-character-library-management-delete"
                              variant="subtle"
                              color="red"
                              disabled={!canEdit}
                              loading={deletingId === character.id}
                              aria-label="删除角色库记录"
                              onClick={() => onDelete(character)}
                              icon={<IconTrash className="ai-character-library-management-delete-icon" size={16} />}
                            />
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {total > pageSize ? (
          <Group className="ai-character-library-management-pagination" justify="flex-end">
            <Pagination
              className="ai-character-library-management-pagination-control"
              value={Math.min(page, totalPages)}
              onChange={onPageChange}
              total={totalPages}
              size="sm"
            />
          </Group>
        ) : null}
      </Stack>

      <DesignModal
        className="ai-character-library-management-editor-modal"
        opened={Boolean(editor)}
        onClose={() => onEditorChange(null)}
        title={editor?.id ? '编辑角色库记录' : '新建角色库记录'}
        size="lg"
      >
        {editor ? (
          <Stack className="ai-character-library-management-editor" gap="sm">
            <SimpleGrid className="ai-character-library-management-editor-grid" cols={{ base: 1, sm: 2 }} spacing="sm">
              <DesignTextInput className="ai-character-library-management-editor-name" label="名称" value={editor.name} onChange={(event) => onEditorChange({ ...editor, name: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-character-id" label="character_id" value={editor.character_id} onChange={(event) => onEditorChange({ ...editor, character_id: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-group-number" label="group_number" value={editor.group_number} onChange={(event) => onEditorChange({ ...editor, group_number: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-identity-hint" label="identity_hint" value={editor.identity_hint} onChange={(event) => onEditorChange({ ...editor, identity_hint: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-gender" label="gender" value={editor.gender} onChange={(event) => onEditorChange({ ...editor, gender: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-age-group" label="age_group" value={editor.age_group} onChange={(event) => onEditorChange({ ...editor, age_group: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-species" label="species" value={editor.species} onChange={(event) => onEditorChange({ ...editor, species: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-era" label="era" value={editor.era} onChange={(event) => onEditorChange({ ...editor, era: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-genre" label="genre" value={editor.genre} onChange={(event) => onEditorChange({ ...editor, genre: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-outfit" label="outfit" value={editor.outfit} onChange={(event) => onEditorChange({ ...editor, outfit: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-worldview" label="filter_worldview" value={editor.filter_worldview} onChange={(event) => onEditorChange({ ...editor, filter_worldview: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-theme" label="filter_theme" value={editor.filter_theme} onChange={(event) => onEditorChange({ ...editor, filter_theme: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-scene" label="filter_scene" value={editor.filter_scene} onChange={(event) => onEditorChange({ ...editor, filter_scene: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-full-body" label="full_body_image_url" value={editor.full_body_image_url} onChange={(event) => onEditorChange({ ...editor, full_body_image_url: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-three-view" label="three_view_image_url" value={editor.three_view_image_url} onChange={(event) => onEditorChange({ ...editor, three_view_image_url: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-expression" label="expression_image_url" value={editor.expression_image_url} onChange={(event) => onEditorChange({ ...editor, expression_image_url: event.currentTarget.value })} />
              <DesignTextInput className="ai-character-library-management-editor-closeup" label="closeup_image_url" value={editor.closeup_image_url} onChange={(event) => onEditorChange({ ...editor, closeup_image_url: event.currentTarget.value })} />
            </SimpleGrid>
            <DesignTextarea className="ai-character-library-management-editor-features" label="distinctive_features" minRows={3} autosize value={editor.distinctive_features} onChange={(event) => onEditorChange({ ...editor, distinctive_features: event.currentTarget.value })} />
            <Group className="ai-character-library-management-editor-actions" justify="flex-end">
              <DesignButton className="ai-character-library-management-editor-cancel" variant="light" onClick={() => onEditorChange(null)}>
                取消
              </DesignButton>
              <DesignButton className="ai-character-library-management-editor-submit" loading={saving} disabled={!canEdit} onClick={onEditorSubmit}>
                {editor.id ? '保存修改' : '创建角色'}
              </DesignButton>
            </Group>
          </Stack>
        ) : null}
      </DesignModal>
    </PanelCard>
  )
}
