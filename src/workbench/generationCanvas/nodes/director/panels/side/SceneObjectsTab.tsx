/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../utils/cn、../../../../../vendor/tablerIcons、../../../../../design 的 promptDialog / confirmDialog、
 *          ../../DirectorEditorContext、../../model/directorTypes、../Popover
 * [OUTPUT]: 对外提供 SceneObjectsTab：图层列表（新建/复制/重命名/删除/显隐/激活）+ 实体树（角色/物体/组/机位/灯：显隐、锁定、删除、
 *           重命名、跨图层复制移动）+ 多选（Ctrl/Shift 点选）+ 多选浮条 + 搜索
 * [POS]: director/panels/side 的大纲（清单 §3.1 S1）：只发 store 意图；选择态与 3D 拾取共用 store.selection。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { confirmDialog } from '../../../../../../design'
import { cn } from '../../../../../../utils/cn'
import {
  IconBulb, IconChevronDown, IconChevronRight, IconCube, IconDotsVertical, IconEye, IconEyeOff, IconLock, IconLockOpen,
  IconPlus, IconSearch, IconTrash, IconUser, IconVideo, IconLayersSubtract,
} from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject, DirectorScene } from '../../model/directorTypes'
import { Popover, PopoverItem } from '../Popover'

type RowKind = 'object' | 'camera' | 'light'
type FlatRow = { id: string; kind: RowKind; name: string; depth: number; type?: DirectorObject['type']; visible: boolean; locked: boolean; hasChildren: boolean; isAuxiliary?: boolean }

function flattenScene(scene: DirectorScene, folded: Set<string>, query: string): FlatRow[] {
  const rows: FlatRow[] = []
  const byParent = new Map<string | undefined, DirectorObject[]>()
  for (const object of scene.objects) {
    const key = object.parentId && scene.objects.some((item) => item.id === object.parentId) ? object.parentId : undefined
    const list = byParent.get(key) ?? []
    list.push(object)
    byParent.set(key, list)
  }
  const q = query.trim().toLowerCase()
  const matches = (name: string) => !q || name.toLowerCase().includes(q)
  const hasMatch = (object: DirectorObject): boolean => matches(object.name) || (byParent.get(object.id) ?? []).some(hasMatch)
  const walk = (parentId: string | undefined, depth: number) => {
    for (const object of byParent.get(parentId) ?? []) {
      const children = byParent.get(object.id) ?? []
      if (hasMatch(object)) {
        rows.push({ id: object.id, kind: 'object', name: object.name, depth, type: object.type, visible: object.visible, locked: object.locked, hasChildren: children.length > 0, isAuxiliary: object.isAuxiliary })
      }
      if (q || !folded.has(object.id)) walk(object.id, depth + 1)
    }
  }
  walk(undefined, 0)
  for (const camera of scene.cameras) if (matches(camera.name)) rows.push({ id: camera.id, kind: 'camera', name: camera.name, depth: 0, visible: true, locked: false, hasChildren: false })
  for (const light of scene.lights) if (matches(light.name)) rows.push({ id: light.id, kind: 'light', name: light.name, depth: 0, visible: light.visible, locked: light.locked, hasChildren: false })
  return rows
}

function RowIcon({ row }: { row: FlatRow }): JSX.Element {
  if (row.kind === 'camera') return <IconVideo size={14} stroke={1.9} className="text-nomi-ink-40" />
  if (row.kind === 'light') return <IconBulb size={14} stroke={1.9} className="text-nomi-ink-40" />
  if (row.type === 'character') return <IconUser size={14} stroke={1.9} className="text-nomi-ink-40" />
  if (row.type === 'group') return <IconLayersSubtract size={14} stroke={1.9} className="text-nomi-ink-40" />
  return <IconCube size={14} stroke={1.9} className="text-nomi-ink-40" />
}

export function SceneObjectsTab(): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const project = useDirectorStore((state) => state.project)
  const scene = useDirectorStore((state) => state.activeScene())
  const selection = useDirectorStore((state) => state.selection)
  const [query, setQuery] = React.useState('')
  const [folded, setFolded] = React.useState<Set<string>>(new Set())
  const [layerMenu, setLayerMenu] = React.useState<string | null>(null)
  const [rowMenu, setRowMenu] = React.useState<string | null>(null)
  const [renaming, setRenaming] = React.useState<{ kind: 'layer' | RowKind; id: string; draft: string } | null>(null)
  const lastClickedRef = React.useRef<string | null>(null)

  const rows = React.useMemo(() => flattenScene(scene, folded, query), [scene, folded, query])
  const selectedIds = React.useMemo(() => new Set([selection.objectId, selection.cameraId, selection.lightId, ...selection.multiObjectIds].filter((id): id is string => Boolean(id))), [selection])
  const multiCount = selection.multiObjectIds.length
  const selectedGroups = scene.objects.filter(object => object.type === 'group' && selection.multiObjectIds.includes(object.id))

  const selectRow = (row: FlatRow, event: React.MouseEvent) => {
    const state = store.getState()
    if (row.kind === 'object' && (event.metaKey || event.ctrlKey)) {
      const next = selection.multiObjectIds.includes(row.id) ? selection.multiObjectIds.filter((id) => id !== row.id) : [...selection.multiObjectIds, row.id]
      state.select({ objectId: next[next.length - 1] ?? null, multiObjectIds: next, cameraId: null, lightId: null })
      lastClickedRef.current = row.id
      return
    }
    if (row.kind === 'object' && event.shiftKey && lastClickedRef.current) {
      const objectRows = rows.filter((item) => item.kind === 'object')
      const a = objectRows.findIndex((item) => item.id === lastClickedRef.current)
      const b = objectRows.findIndex((item) => item.id === row.id)
      if (a !== -1 && b !== -1) {
        const range = objectRows.slice(Math.min(a, b), Math.max(a, b) + 1).map((item) => item.id)
        state.select({ objectId: row.id, multiObjectIds: range, cameraId: null, lightId: null })
        return
      }
    }
    lastClickedRef.current = row.id
    if (row.kind === 'object') state.select({ objectId: row.id, multiObjectIds: [row.id], cameraId: null, lightId: null, activeWaypointId: null, selectedWaypointIds: [] })
    else if (row.kind === 'camera') state.select({ cameraId: row.id, objectId: null, lightId: null, multiObjectIds: [], activeWaypointId: null, selectedWaypointIds: [] })
    else state.select({ lightId: row.id, objectId: null, cameraId: null, multiObjectIds: [], activeWaypointId: null, selectedWaypointIds: [] })
  }

  const commitRename = () => {
    if (!renaming) return
    const state = store.getState()
    const name = renaming.draft.trim()
    if (name) {
      if (renaming.kind === 'layer') state.renameSceneLayer(renaming.id, name)
      else if (renaming.kind === 'object') state.renameObject(renaming.id, name)
      else state.withHistory(() => {
        if (renaming.kind === 'camera') state.updateCamera(renaming.id, { name })
        else state.updateLight(renaming.id, { name })
      })
    }
    setRenaming(null)
  }

  const deleteRow = async (row: FlatRow) => {
    const state = store.getState()
    if (row.kind === 'object') {
      if (row.hasChildren) {
        const ok = await confirmDialog({ title: t('director.outliner.deleteTitle'), message: t('director.outliner.deleteGroupMessage', { name: row.name }), confirmLabel: t('common.delete'), danger: true })
        if (!ok) return
      }
      state.deleteObject(row.id)
    } else if (row.kind === 'camera') state.deleteCamera(row.id)
    else state.deleteLight(row.id)
  }

  const deleteLayer = async (layer: DirectorScene) => {
    const ok = await confirmDialog({ title: t('director.outliner.deleteLayerTitle'), message: t('director.outliner.deleteLayerMessage', { name: layer.name }), confirmLabel: t('common.delete'), danger: true })
    if (ok) store.getState().deleteSceneLayer(layer.id)
    setLayerMenu(null)
  }

  const otherLayers = project.scenes.filter((layer) => layer.id !== scene.id)
  const menuIds = (row: FlatRow) => row.kind === 'object' && selection.multiObjectIds.includes(row.id) ? selection.multiObjectIds : [row.id]
  const copyToNewLayer = (row: FlatRow) => {
    const state = store.getState(), ids = menuIds(row)
    state.withHistory(() => {
      const targetId = state.createSceneLayer(t('director.outliner.newLayerName', { index: project.scenes.length + 1 }))
      state.setActiveScene(scene.id)
      state.copyEntitiesToScene(ids, targetId, false)
      state.setActiveScene(targetId)
    })
    setRowMenu(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="director-outliner">
      <div className="mx-2 mt-2 flex items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2 py-1 text-caption text-nomi-ink-40">
        <IconSearch size={14} stroke={2} />
        <input
          className="w-full bg-transparent text-caption text-nomi-ink outline-none"
          placeholder={t('director.outliner.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('')
              ;(event.target as HTMLInputElement).blur()
            }
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        {project.scenes.map((layer) => {
          const active = layer.id === scene.id
          return (
            <div key={layer.id} className="mb-1">
              <div
                className={cn('group flex items-center gap-1 rounded-nomi-sm px-1.5 py-1 text-body-sm', active ? 'text-nomi-ink' : 'text-nomi-ink-60 hover:bg-workbench-hover')}
                onClick={() => store.getState().setActiveScene(layer.id)}
                onDoubleClick={() => setRenaming({ kind: 'layer', id: layer.id, draft: layer.name })}
              >
                <IconLayersSubtract size={14} stroke={1.9} className={active ? 'text-nomi-accent' : 'text-nomi-ink-40'} />
                {renaming?.kind === 'layer' && renaming.id === layer.id ? (
                  <input autoFocus onFocus={(event) => event.currentTarget.select()} className="w-full rounded-nomi-sm border border-nomi-line bg-nomi-bg px-1 text-caption text-nomi-ink" value={renaming.draft} onChange={(event) => setRenaming({ ...renaming, draft: event.target.value })} onBlur={commitRename} onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') setRenaming(null) }} onClick={(event) => event.stopPropagation()} />
                ) : (
                  <span className="truncate font-medium">{layer.name}</span>
                )}
                {!layer.visible ? <span className="text-micro text-nomi-ink-40">{t('director.outliner.hidden')}</span> : null}
                <div className="ml-auto flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
                  <button type="button" className="rounded-nomi-sm p-0.5 hover:bg-workbench-hover" title={layer.visible ? t('director.outliner.hideLayer') : t('director.outliner.showLayer')} onClick={(event) => { event.stopPropagation(); store.getState().toggleSceneVisible(layer.id) }}>
                    {layer.visible ? <IconEye size={13} stroke={2} /> : <IconEyeOff size={13} stroke={2} />}
                  </button>
                  <Popover
                    open={layerMenu === layer.id}
                    onClose={() => setLayerMenu(null)}
                    side="bottom"
                    align="end"
                    trigger={<button type="button" className="rounded-nomi-sm p-0.5 hover:bg-workbench-hover" title={t('director.outliner.layerMenu')} onClick={(event) => { event.stopPropagation(); setLayerMenu(layerMenu === layer.id ? null : layer.id) }}><IconDotsVertical size={13} stroke={2} /></button>}
                  >
                    <PopoverItem onClick={() => { store.getState().createSceneLayer(t('director.outliner.newLayerName', { index: project.scenes.length + 1 })); setLayerMenu(null) }}>{t('director.outliner.newLayer')}</PopoverItem>
                    <PopoverItem onClick={() => { store.getState().duplicateSceneLayer(layer.id, t('director.outliner.copySuffix')); setLayerMenu(null) }}>{t('director.outliner.duplicateLayer')}</PopoverItem>
                    <PopoverItem onClick={() => { setRenaming({ kind: 'layer', id: layer.id, draft: layer.name }); setLayerMenu(null) }}>{t('director.outliner.rename')}</PopoverItem>
                    <PopoverItem onClick={() => void deleteLayer(layer)} disabled={project.scenes.length <= 1} title={project.scenes.length <= 1 ? t('director.outliner.lastLayer') : undefined}>{t('director.outliner.deleteLayer')}</PopoverItem>
                  </Popover>
                </div>
              </div>
              {active ? (
                rows.length === 0 ? (
                  <div className="px-2 py-2 text-caption text-nomi-ink-40">{t('director.regions.placeholderObjects')}</div>
                ) : (
                  rows.map((row) => {
                    const selected = selectedIds.has(row.id)
                    return (
                      <div
                        key={row.id}
                        className={cn('group flex items-center gap-1 rounded-nomi-sm py-1 pr-1 text-caption', selected ? 'bg-nomi-accent-soft text-nomi-ink' : 'text-nomi-ink-80 hover:bg-workbench-hover', !row.visible ? 'line-through opacity-60' : '')}
                        style={{ paddingLeft: 8 + row.depth * 14 }}
                        onClick={(event) => selectRow(row, event)}
                        onDoubleClick={() => setRenaming({ kind: row.kind, id: row.id, draft: row.name })}
                        onContextMenu={(event) => { event.preventDefault(); setRowMenu(row.id) }}
                        data-testid="director-outliner-row"
                      >
                        {row.type === 'group' ? (
                          <button type="button" className="rounded-nomi-sm p-0.5 hover:bg-workbench-hover" onClick={(event) => { event.stopPropagation(); setFolded((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next }) }}>
                            {folded.has(row.id) ? <IconChevronRight size={12} stroke={2} /> : <IconChevronDown size={12} stroke={2} />}
                          </button>
                        ) : (
                          <span className="w-4" />
                        )}
                        <RowIcon row={row} />
                        {renaming && renaming.kind !== 'layer' && renaming.id === row.id ? (
                          <input autoFocus onFocus={(event) => event.currentTarget.select()} className="w-full rounded-nomi-sm border border-nomi-line bg-nomi-bg px-1 text-caption text-nomi-ink" value={renaming.draft} onChange={(event) => setRenaming({ ...renaming, draft: event.target.value })} onBlur={commitRename} onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') setRenaming(null) }} onClick={(event) => event.stopPropagation()} />
                        ) : (
                          <span className="truncate">{row.name}</span>
                        )}
                        {row.isAuxiliary ? <span className="rounded-nomi-sm bg-nomi-ink-05 px-1 text-micro text-nomi-ink-40">{t('director.outliner.auxiliary')}</span> : null}
                        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                          {row.kind !== 'camera' ? (
                            <>
                              <button type="button" className="rounded-nomi-sm p-0.5 hover:bg-workbench-hover" title={row.visible ? t('director.outliner.hide') : t('director.outliner.show')} onClick={(event) => { event.stopPropagation(); if (row.kind === 'object') store.getState().toggleObjectVisible(row.id); else store.getState().toggleLightVisible(row.id) }}>
                                {row.visible ? <IconEye size={13} stroke={2} /> : <IconEyeOff size={13} stroke={2} />}
                              </button>
                              <button type="button" className="rounded-nomi-sm p-0.5 hover:bg-workbench-hover" title={row.locked ? t('director.outliner.unlock') : t('director.outliner.lock')} onClick={(event) => { event.stopPropagation(); if (row.kind === 'object') store.getState().toggleObjectLock(row.id); else store.getState().toggleLightLock(row.id) }}>
                                {row.locked ? <IconLock size={13} stroke={2} /> : <IconLockOpen size={13} stroke={2} />}
                              </button>
                            </>
                          ) : null}
                          <button type="button" className="rounded-nomi-sm p-0.5 hover:bg-workbench-hover hover:text-workbench-danger" title={t('director.outliner.delete')} onClick={(event) => { event.stopPropagation(); void deleteRow(row) }}>
                            <IconTrash size={13} stroke={2} />
                          </button>
                          {(
                            <Popover
                              open={rowMenu === row.id}
                              onClose={() => setRowMenu(null)}
                              side="bottom"
                              align="end"
                              trigger={<button type="button" className="rounded-nomi-sm p-0.5 hover:bg-workbench-hover" title={t('director.outliner.crossLayer')} onClick={(event) => { event.stopPropagation(); setRowMenu(rowMenu === row.id ? null : row.id) }}><IconDotsVertical size={13} stroke={2} /></button>}
                            >
                              <PopoverItem onClick={() => { setRenaming({ kind: row.kind, id: row.id, draft: row.name }); setRowMenu(null) }}>{t('director.outliner.rename')}</PopoverItem>
                              {row.type === 'group' ? <PopoverItem onClick={() => { store.getState().ungroupObjects(row.id); setRowMenu(null) }}>{t('director.help.keys.ungroup')}</PopoverItem> : null}
                              <PopoverItem onClick={() => copyToNewLayer(row)}>{t('director.outliner.copyToNewLayer')}</PopoverItem>
                              {otherLayers.length > 0 ? <div className="px-2 py-1 text-micro text-nomi-ink-40">{t('director.outliner.copyToLayer')}</div> : null}
                              {otherLayers.map((layer) => (
                                <PopoverItem key={`copy-${layer.id}`} onClick={() => { store.getState().copyEntitiesToScene(menuIds(row), layer.id, false); setRowMenu(null) }}>{layer.name}</PopoverItem>
                              ))}
                              {otherLayers.length > 0 ? <div className="px-2 py-1 text-micro text-nomi-ink-40">{t('director.outliner.moveToLayer')}</div> : null}
                              {otherLayers.map((layer) => (
                                <PopoverItem key={`move-${layer.id}`} onClick={() => { store.getState().copyEntitiesToScene(menuIds(row), layer.id, true); setRowMenu(null) }}>{layer.name}</PopoverItem>
                              ))}
                            </Popover>
                          )}
                        </div>
                      </div>
                    )
                  })
                )
              ) : null}
            </div>
          )
        })}
        <button type="button" className="mt-1 inline-flex items-center gap-1 rounded-nomi-sm px-2 py-1 text-caption text-nomi-accent hover:bg-workbench-hover" onClick={() => store.getState().createSceneLayer(t('director.outliner.newLayerName', { index: project.scenes.length + 1 }))}>
          <IconPlus size={13} stroke={2} />
          {t('director.outliner.newLayer')}
        </button>
      </div>
      {multiCount > 1 ? (
        <div className="mx-2 mb-2 flex flex-wrap items-center gap-2 rounded-nomi-sm bg-nomi-ink-05 px-2 py-1.5 text-caption text-nomi-ink-80" data-testid="director-selection-bar">
          <span>{t('director.outliner.selectedCount', { count: multiCount })}</span>
          <div className="flex-1" />
          <button type="button" className="text-nomi-accent hover:underline" onClick={() => store.getState().groupObjects(selection.multiObjectIds, t('director.outliner.groupName'))}>{t('director.outliner.group')}</button>
          {selectedGroups.length > 0 ? <button type="button" className="text-nomi-accent hover:underline" onClick={() => store.getState().withHistory(() => { for (const group of selectedGroups) store.getState().ungroupObjects(group.id) })}>{t('director.help.keys.ungroup')}</button> : null}
          <button type="button" className="text-nomi-accent hover:underline" onClick={() => store.getState().bulkToggleObjectVisible(selection.multiObjectIds)}>{t('director.outliner.toggleVisible')}</button>
          <button type="button" className="text-nomi-accent hover:underline" onClick={() => store.getState().bulkToggleObjectLock(selection.multiObjectIds)}>{t('director.outliner.toggleLock')}</button>
          <button type="button" className="text-workbench-danger hover:underline" onClick={() => store.getState().withHistory(() => { for (const id of selection.multiObjectIds) store.getState().deleteObject(id) })}>{t('common.delete')}</button>
          <button type="button" className="text-nomi-ink-60 hover:underline" onClick={() => store.getState().clearSelection()}>{t('common.cancel')}</button>
        </div>
      ) : null}
    </div>
  )
}
