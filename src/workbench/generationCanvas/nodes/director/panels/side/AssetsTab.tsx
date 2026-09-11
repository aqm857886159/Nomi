/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../vendor/tablerIcons、../../../../../../ui/toast、../../../../../api/assetUploadApi（importWorkbenchLocalAssetFile / hostedAssetUrl）、
 *          ../../../../../../utils/cn、../../DirectorEditorContext、../../model/directorTypes、../../model/assetKinds（类型判定 / accept）、../../scene/creation/useCharacterPlacement 的 CHARACTER_MODEL_BY_GENDER、
 *          ../LinkedAssetsContext 的 useLinkedAssets、../imageFile 的 readFileAsDataUrl、../Popover
 * [OUTPUT]: 对外提供 AssetsTab
 * [POS]: director/panels/side 的资产库（清单 §3.2 S2/S3）：六个目录——连线引用（画布连进来的全景 / 泼溅 / 模型，只读）、用户上传（工程 assets，文件夹树 + 条目）、
 *        泼溅场景（根目录泼溅，仓库不内置示例）、预设模型 / 基础灯光 / 基础几何体（内置）。目录/文件共用移动菜单与拖放，搜索展开命中祖先。
 *        双击或「添加」入场景：模型 / 泼溅 = 新对象（源约定泼溅绕 X 180°）、全景 = 设为天空、场景 JSON = 导入为新图层。
 *        上传走资产桥落盘只存句柄；无桌面运行时（devlab / 网页）退回 data / blob URL 并明说是临时的。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { hostedAssetUrl, importWorkbenchLocalAssetFile } from '../../../../../api/assetUploadApi'
import { toast } from '../../../../../../ui/toast'
import { cn } from '../../../../../../utils/cn'
import {
  IconArrowsMove,
  IconBulb,
  IconChevronDown,
  IconChevronRight,
  IconCube,
  Icon3dCubeSphere,
  IconFileImport,
  IconFolderPlus,
  IconLink,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconUser,
} from '../../../../../../vendor/tablerIcons'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorAssetFolder, DirectorAssetItem, DirectorAssetKind, DirectorLightType, DirectorLinkedAsset, DirectorPrimitiveType } from '../../model/directorTypes'
import { DIRECTOR_PRIMITIVE_TYPES } from '../../model/directorTypes'
import { ASSET_UPLOAD_ACCEPT, assetKindOfFileName } from '../../model/assetKinds'
import { canMoveAssetFolder, matchingAssetFolders } from '../../model/assetFolders'
import { CHARACTER_MODEL_BY_GENDER, type PlacementGender } from '../../scene/creation/useCharacterPlacement'
import { readFileAsDataUrl } from '../imageFile'
import { useLinkedAssets } from '../LinkedAssetsContext'
import { Popover, PopoverItem } from '../Popover'

type AssetMove = { kind: 'item' | 'folder'; id: string }
const ASSET_DRAG_TYPE = 'application/x-nomi-director-asset'

type BuiltinItem =
  | { id: string; kind: 'character'; gender: PlacementGender }
  | { id: string; kind: 'light'; lightType: DirectorLightType }
  | { id: string; kind: 'primitive'; primitive: DirectorPrimitiveType; auxiliary?: boolean }

const BUILTIN_FOLDERS: Array<{ id: 'models' | 'lights' | 'primitives'; items: BuiltinItem[] }> = [
  { id: 'models', items: [{ id: 'model_xbot', kind: 'character', gender: 'female' }, { id: 'model_ybot', kind: 'character', gender: 'male' }] },
  { id: 'lights', items: [{ id: 'light_directional', kind: 'light', lightType: 'directional' }, { id: 'light_point', kind: 'light', lightType: 'point' }, { id: 'light_spot', kind: 'light', lightType: 'spot' }] },
  {
    id: 'primitives',
    items: [
      ...DIRECTOR_PRIMITIVE_TYPES.map((primitive) => ({ id: `primitive_${primitive}`, kind: 'primitive' as const, primitive })),
      { id: 'primitive_auxiliary_sphere', kind: 'primitive', primitive: 'sphere', auxiliary: true },
    ],
  },
]


function KindIcon({ kind, className }: { kind: DirectorAssetKind | 'character' | 'light' | 'primitive'; className?: string }): JSX.Element {
  const props = { size: 14, stroke: 1.9, className: cn('shrink-0 text-nomi-ink-40', className) }
  switch (kind) {
    case 'character':
      return <IconUser {...props} />
    case 'light':
      return <IconBulb {...props} />
    case 'primitive':
      return <IconCube {...props} />
    case 'splat':
      return <IconSparkles {...props} />
    case 'panorama':
      return <IconPhoto {...props} />
    case 'scene':
      return <IconFileImport {...props} />
    default:
      return <Icon3dCubeSphere {...props} />
  }
}

function FolderHeader({ label, folded, onToggle, actions }: { label: string; folded: boolean; onToggle: () => void; actions?: React.ReactNode }): JSX.Element {
  return (
    <div className="group flex items-center gap-1 rounded-nomi-sm pr-1 hover:bg-workbench-hover">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-body-sm font-medium text-nomi-ink" onClick={onToggle}>
        {folded ? <IconChevronRight size={12} stroke={2} /> : <IconChevronDown size={12} stroke={2} />}
        <span className="truncate">{label}</span>
      </button>
      {actions}
    </div>
  )
}

function RowAction({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      className={cn('rounded-nomi-sm p-0.5 text-nomi-ink-40 opacity-0 hover:bg-workbench-hover group-hover:opacity-100', danger ? 'hover:text-nomi-danger' : 'hover:text-nomi-ink')}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {icon}
    </button>
  )
}

function InlineRename({ value, onCommit, onCancel }: { value: string; onCommit: (next: string) => void; onCancel: () => void }): JSX.Element {
  const [draft, setDraft] = React.useState(value)
  return (
    <input
      autoFocus
      className="min-w-0 flex-1 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-1 text-caption text-nomi-ink outline-none"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft)
        else if (event.key === 'Escape') onCancel()
      }}
    />
  )
}

export function AssetsTab(): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const library = useDirectorStore((state) => state.project.assets)
  const linked = useLinkedAssets()
  const [query, setQuery] = React.useState('')
  const [folded, setFolded] = React.useState<Set<string>>(new Set())
  const [renaming, setRenaming] = React.useState<{ kind: 'item' | 'folder'; id: string } | null>(null)
  const [moving, setMoving] = React.useState<AssetMove | null>(null)
  const [uploadTarget, setUploadTarget] = React.useState<string | null>(null)
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null)

  const toggleFold = (id: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const labelOfBuiltin = (item: BuiltinItem): string => {
    if (item.kind === 'character') return t(item.gender === 'female' ? 'director.creation.female' : 'director.creation.male')
    if (item.kind === 'light') return t(`director.lightType.${item.lightType}`)
    return item.auxiliary ? t('director.assets.auxiliarySphere') : t(`director.primitive.${item.primitive}`)
  }

  const addBuiltin = (item: BuiltinItem) => {
    const state = store.getState()
    const scene = state.activeScene()
    if (item.kind === 'character') {
      const index = scene.objects.filter((object) => object.type === 'character').length + 1
      const spec = CHARACTER_MODEL_BY_GENDER[item.gender]
      state.addObject({
        name: t('director.creation.characterName', { index }),
        type: 'character',
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        color: item.gender === 'female' ? '#fb7185' : '#38bdf8',
        visible: true,
        locked: false,
        posePreset: 'tpose',
        modelPath: spec.modelPath,
        modelScale: 1,
        isSystemModel: true,
        rig: spec.rig,
      })
      return
    }
    if (item.kind === 'light') {
      const count = scene.lights.filter((light) => light.type === item.lightType).length + 1
      state.addLight(item.lightType, t(`director.creation.lightName.${item.lightType}`, { index: count }))
      return
    }
    const count = scene.objects.filter((object) => object.type === item.primitive).length + 1
    state.addObject({
      name: item.auxiliary ? t('director.assets.auxiliaryName', { index: count }) : `${t(`director.primitive.${item.primitive}`)} ${count}`,
      type: item.primitive,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
      isAuxiliary: item.auxiliary,
    })
    state.setTransformMode('translate')
  }

  // 模型 / 泼溅 = 新对象；全景 = 设为天空；场景 JSON = 导入为新图层
  const addFileAsset = async (asset: { name: string; kind: DirectorAssetKind; url: string }) => {
    const state = store.getState()
    const scene = state.activeScene()
    if (asset.kind === 'panorama') {
      state.saveState()
      state.patchPanoramaConfig({ url: asset.url })
      return
    }
    if (asset.kind === 'scene') {
      try {
        const raw: unknown = await fetch(asset.url).then((response) => response.json())
        const sceneId = store.getState().importScene(raw, asset.name)
        if (!sceneId) throw new Error('invalid scene')
        toast(t('director.assets.sceneImported', { name: asset.name }), 'success')
      } catch {
        toast(t('director.assets.sceneImportFailed'), 'error')
      }
      return
    }
    const type = asset.kind === 'splat' ? 'splat' : 'model'
    const index = scene.objects.filter((object) => object.type === type).length + 1
    state.addObject({
      name: asset.name || t(type === 'splat' ? 'director.assets.splatName' : 'director.assets.modelName', { index }),
      type,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: type === 'splat' ? 180 : 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      locked: false,
      modelPath: asset.url,
      modelScale: 1,
      isSystemModel: false,
      rig: type === 'model' ? 'mixamo' : undefined,
    })
    state.setTransformMode('translate')
  }

  const uploadFiles = async (files: File[], folderId: string | null) => {
    for (const file of files) {
      const kind = assetKindOfFileName(file.name, file.type)
      if (!kind) {
        toast(t('director.assets.unsupported', { name: file.name }), 'warning')
        continue
      }
      let url: string
      let temporary = false
      try {
        const asset = await importWorkbenchLocalAssetFile(file, file.name)
        url = hostedAssetUrl(asset)
        if (!url) throw new Error('asset missing url')
      } catch {
        // 无桌面运行时 / 落盘失败：小文件（图片 / JSON）转 data URL 还能随工程存；大文件只能 blob URL，明说是临时的
        temporary = true
        // 模型 loader 通过扩展名分 FBX/GLTF；blob 地址保留文件名，fragment 不参与字节读取。
        url = kind === 'panorama' || kind === 'scene' ? await readFileAsDataUrl(file).catch(() => '') : `${URL.createObjectURL(file)}#${encodeURIComponent(file.name)}`
      }
      if (!url) {
        toast(t('director.assets.uploadFailed', { name: file.name }), 'error')
        continue
      }
      store.getState().addAssetItem({ name: file.name.replace(/\.[^.]+$/, ''), kind, url, folderId, sizeBytes: file.size })
      toast(t(temporary ? 'director.assets.uploadedTemporary' : 'director.assets.uploaded', { name: file.name }), temporary ? 'info' : 'success')
    }
  }

  const q = query.trim().toLowerCase()
  const matches = (name: string) => !q || name.toLowerCase().includes(q)
  const userItems = library.items.filter((item) => item.kind !== 'splat' || item.folderId !== null)
  const splatItems = library.items.filter((item) => item.kind === 'splat' && item.folderId === null)
  const visibleFolders = matchingAssetFolders(library.folders, userItems, q)
  const childFolders = (parentId: string | null) => library.folders.filter((folder) => folder.parentId === parentId && visibleFolders.has(folder.id))
  const itemsIn = (folderId: string | null) => userItems.filter((item) => item.folderId === folderId && matches(item.name))

  const moveAsset = (source: AssetMove, parentId: string | null) => {
    if (source.kind === 'folder') store.getState().moveAssetFolder(source.id, parentId)
    else store.getState().moveAssetItem(source.id, parentId)
    setMoving(null)
    if (parentId) setFolded((current) => { const next = new Set(current); next.delete(parentId); return next })
  }
  const dragProps = (source: AssetMove) => ({
    draggable: !renaming,
    onDragStart: (event: React.DragEvent) => {
      event.stopPropagation()
      event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(source))
      event.dataTransfer.effectAllowed = 'move'
    },
  })
  const dropProps = (parentId: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
    },
    onDrop: (event: React.DragEvent) => {
      const raw = event.dataTransfer.getData(ASSET_DRAG_TYPE)
      if (!raw) return
      event.preventDefault()
      event.stopPropagation()
      try {
        const source: unknown = JSON.parse(raw)
        if (!source || typeof source !== 'object' || !('kind' in source) || !('id' in source) || typeof source.id !== 'string') return
        if (source.kind === 'folder' || source.kind === 'item') moveAsset({ kind: source.kind, id: source.id }, parentId)
      } catch { /* External malformed drags do not mutate the library. */ }
    },
  })
  const renderMoveMenu = (source: AssetMove) => (
    <Popover
      open={moving?.kind === source.kind && moving.id === source.id}
      onClose={() => setMoving(null)}
      panelClassName="w-[180px] p-1"
      trigger={<RowAction icon={<IconArrowsMove size={13} stroke={2} />} label={t('director.assets.moveTo')} onClick={() => setMoving((current) => current?.kind === source.kind && current.id === source.id ? null : source)} />}
    >
      <PopoverItem onClick={() => moveAsset(source, null)}>{t('director.assets.root')}</PopoverItem>
      {library.folders.filter((folder) => source.kind === 'item' || canMoveAssetFolder(library.folders, source.id, folder.id)).map((folder) => (
        <PopoverItem key={folder.id} onClick={() => moveAsset(source, folder.id)}>{folder.name}</PopoverItem>
      ))}
    </Popover>
  )

  const renderItem = (item: DirectorAssetItem) => (
    <div key={item.id} {...dragProps({ kind: 'item', id: item.id })} className="group flex items-center gap-1.5 rounded-nomi-sm py-1 pl-6 pr-1 text-caption text-nomi-ink-80 hover:bg-workbench-hover" onDoubleClick={() => void addFileAsset(item)} title={t('director.assets.doubleClickHint')}>
      <KindIcon kind={item.kind} />
      {renaming?.kind === 'item' && renaming.id === item.id ? (
        <InlineRename value={item.name} onCommit={(next) => { store.getState().renameAssetItem(item.id, next); setRenaming(null) }} onCancel={() => setRenaming(null)} />
      ) : (
        <span className="truncate">{item.name}</span>
      )}
      <span className="ml-auto flex items-center" onDoubleClick={(event) => event.stopPropagation()}>
        <RowAction icon={<IconPencil size={13} stroke={2} />} label={t('director.assets.rename')} onClick={() => setRenaming({ kind: 'item', id: item.id })} />
        {renderMoveMenu({ kind: 'item', id: item.id })}
        <RowAction icon={<IconTrash size={13} stroke={2} />} label={t('director.assets.delete')} danger onClick={() => store.getState().removeAssetItem(item.id)} />
        <RowAction icon={<IconPlus size={13} stroke={2} />} label={item.kind === 'panorama' ? t('director.assets.setPanorama') : item.kind === 'scene' ? t('director.assets.importScene') : t('director.assets.addToScene')} onClick={() => void addFileAsset(item)} />
      </span>
    </div>
  )

  const renderFolder = (folder: DirectorAssetFolder, depth: number): JSX.Element => {
    const isFolded = !q && folded.has(folder.id)
    return (
      <div key={folder.id} {...dragProps({ kind: 'folder', id: folder.id })} {...dropProps(folder.id)} style={{ paddingLeft: depth * 12 }}>
        <FolderHeader
          label={folder.name}
          folded={isFolded}
          onToggle={() => toggleFold(folder.id)}
          actions={
            renaming?.kind === 'folder' && renaming.id === folder.id ? (
              <InlineRename value={folder.name} onCommit={(next) => { store.getState().renameAssetFolder(folder.id, next); setRenaming(null) }} onCancel={() => setRenaming(null)} />
            ) : (
              <>
                <RowAction icon={<IconUpload size={13} stroke={2} />} label={t('director.assets.upload')} onClick={() => { setUploadTarget(folder.id); uploadInputRef.current?.click() }} />
                <RowAction icon={<IconFolderPlus size={13} stroke={2} />} label={t('director.assets.newFolder')} onClick={() => store.getState().addAssetFolder(t('director.assets.newFolderName'), folder.id)} />
                <RowAction icon={<IconPencil size={13} stroke={2} />} label={t('director.assets.rename')} onClick={() => setRenaming({ kind: 'folder', id: folder.id })} />
                {renderMoveMenu({ kind: 'folder', id: folder.id })}
                <RowAction icon={<IconTrash size={13} stroke={2} />} label={t('director.assets.delete')} danger onClick={() => store.getState().deleteAssetFolder(folder.id)} />
              </>
            )
          }
        />
        {!isFolded ? (
          <>
            {childFolders(folder.id).map((child) => renderFolder(child, depth + 1))}
            {itemsIn(folder.id).map(renderItem)}
          </>
        ) : null}
      </div>
    )
  }

  const renderLinked = (asset: DirectorLinkedAsset) => (
    <div key={asset.id} className="group flex items-center gap-1.5 rounded-nomi-sm py-1 pl-6 pr-1 text-caption text-nomi-ink-80 hover:bg-workbench-hover" onDoubleClick={() => void addFileAsset(asset)} title={t('director.assets.doubleClickHint')}>
      <KindIcon kind={asset.kind} />
      <span className="truncate">{asset.name}</span>
      <span className="ml-auto flex items-center" onDoubleClick={(event) => event.stopPropagation()}>
        <RowAction icon={<IconPlus size={13} stroke={2} />} label={asset.kind === 'panorama' ? t('director.assets.setPanorama') : t('director.assets.addToScene')} onClick={() => void addFileAsset(asset)} />
      </span>
    </div>
  )

  const linkedVisible = linked.filter((asset) => matches(asset.name))
  const splatVisible = splatItems.filter((item) => matches(item.name))
  const uploadsVisible = !q || userItems.some((item) => matches(item.name)) || library.folders.some((folder) => matches(folder.name))

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="director-assets">
      <div className="mx-2 mt-2 flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-bg px-2 py-1 text-caption text-nomi-ink-40">
          <IconSearch size={14} stroke={2} />
          <input className="w-full bg-transparent text-caption text-nomi-ink outline-none" placeholder={t('director.assets.search')} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setQuery(''); (event.target as HTMLInputElement).blur() } }} />
        </div>
        <button type="button" className="rounded-nomi-sm border border-nomi-line p-1 text-nomi-ink-80 hover:bg-workbench-hover" title={t('director.assets.uploadHint')} aria-label={t('director.assets.upload')} onClick={() => { setUploadTarget(null); uploadInputRef.current?.click() }}>
          <IconUpload size={14} stroke={2} />
        </button>
        <button type="button" className="rounded-nomi-sm border border-nomi-line p-1 text-nomi-ink-80 hover:bg-workbench-hover" title={t('director.assets.newFolder')} aria-label={t('director.assets.newFolder')} onClick={() => store.getState().addAssetFolder(t('director.assets.newFolderName'), null)}>
          <IconFolderPlus size={14} stroke={2} />
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          accept={ASSET_UPLOAD_ACCEPT}
          className="hidden"
          aria-label={t('director.assets.upload')}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (files.length) void uploadFiles(files, uploadTarget)
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-1">
        <div className="mb-1">
          <FolderHeader label={t('director.assets.folder.linked')} folded={!q && folded.has('linked')} onToggle={() => toggleFold('linked')} actions={<IconLink size={12} stroke={2} className="text-nomi-ink-40" />} />
          {q || !folded.has('linked') ? (linkedVisible.length ? linkedVisible.map(renderLinked) : <div className="py-1 pl-6 text-micro text-nomi-ink-40">{t('director.assets.linkedEmpty')}</div>) : null}
        </div>
        {uploadsVisible ? (
          <div className="mb-1" {...dropProps(null)}>
            <FolderHeader label={t('director.assets.folder.uploads')} folded={!q && folded.has('uploads')} onToggle={() => toggleFold('uploads')} />
            {q || !folded.has('uploads') ? (
              <>
                {childFolders(null).map((folder) => renderFolder(folder, 0))}
                {itemsIn(null).map(renderItem)}
                {library.folders.length === 0 && userItems.length === 0 ? <div className="py-1 pl-6 text-micro text-nomi-ink-40">{t('director.assets.uploadsEmpty')}</div> : null}
              </>
            ) : null}
          </div>
        ) : null}
        {!q || splatVisible.length ? (
          <div className="mb-1">
            <FolderHeader label={t('director.assets.folder.splats')} folded={!q && folded.has('splats')} onToggle={() => toggleFold('splats')} />
            {q || !folded.has('splats') ? splatVisible.map(renderItem) : null}
          </div>
        ) : null}
        {BUILTIN_FOLDERS.map((folder) => {
          const items = folder.items.filter((item) => matches(labelOfBuiltin(item)))
          if (q && items.length === 0) return null
          const isFolded = !q && folded.has(folder.id)
          return (
            <div key={folder.id} className="mb-1">
              <FolderHeader label={t(`director.assets.folder.${folder.id}`)} folded={isFolded} onToggle={() => toggleFold(folder.id)} />
              {!isFolded
                ? items.map((item) => (
                    <div key={item.id} className="group flex items-center gap-1.5 rounded-nomi-sm py-1 pl-6 pr-1 text-caption text-nomi-ink-80 hover:bg-workbench-hover" onDoubleClick={() => addBuiltin(item)} title={t('director.assets.doubleClickHint')}>
                      <KindIcon kind={item.kind} />
                      <span className="truncate">{labelOfBuiltin(item)}</span>
                      <span className="ml-auto flex items-center" onDoubleClick={(event) => event.stopPropagation()}>
                        <RowAction icon={<IconPlus size={13} stroke={2} />} label={t('director.assets.addToScene')} onClick={() => addBuiltin(item)} />
                      </span>
                    </div>
                  ))
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
