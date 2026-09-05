import React from 'react'
import { IconBrush, IconMusic, IconPhoto, IconMessage, IconFileText, IconVideo } from '../vendor/tablerIcons'
import { NodeEmptyState } from '../workbench/generationCanvas/nodes/render/NodeEmptyState'
import { UpdaterDialog } from '../ui/app-shell/UpdaterDialog'
import type { Updater } from '../ui/app-shell/useUpdater'
import type { UpdaterPhase } from '../ui/app-shell/useUpdater'

export type UiShellLabState = Readonly<{ id: string; name: string; render: () => JSX.Element }>

const updater = (phase: UpdaterPhase, overrides: Partial<Updater> = {}): Updater => ({
  phase,
  appInfo: { version: '0.21.0', platform: 'darwin', arch: 'arm64', canAutoInstall: true, canCheckUpdates: true },
  latestVersion: '0.22.0',
  notes: '## 这次更新\n\n- 生成任务可以继续在后台运行\n- 画布节点空态更清晰',
  percent: 48,
  errorMessage: '更新服务器暂时不可用',
  supported: true,
  canAutoInstall: true,
  canCheckUpdates: true,
  check: () => undefined,
  download: () => undefined,
  install: () => undefined,
  openDownload: () => undefined,
  reset: () => undefined,
  ...overrides,
})

function LabFrame({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="grid min-h-[24rem] w-[34rem] place-items-center bg-nomi-bg p-8 text-nomi-ink">{children}</div>
}

function UpdateState({ phase, running = false }: { phase: UpdaterPhase; running?: boolean }): JSX.Element {
  return <LabFrame><UpdaterDialog updater={updater(phase)} hasRunningTask={running} /></LabFrame>
}

const nodeStates = [
  { id: 'node-empty-image', name: '图片节点空态', icon: <IconPhoto size={20} stroke={1.6} />, title: '图片节点', description: '放入图片，作为参考或生成结果。', action: '上传图片' },
  { id: 'node-empty-character', name: '角色节点空态', icon: <IconPhoto size={20} stroke={1.6} />, title: '角色节点', description: '放入角色参考图，保持人物形象一致。', action: '上传角色图' },
  { id: 'node-empty-scene', name: '场景节点空态', icon: <IconPhoto size={20} stroke={1.6} />, title: '场景节点', description: '放入场景参考图，固定空间与氛围。', action: '上传场景图' },
  { id: 'node-empty-prop', name: '道具节点空态', icon: <IconPhoto size={20} stroke={1.6} />, title: '道具节点', description: '放入道具参考图，让关键物件保持一致。', action: '上传道具图' },
  { id: 'node-empty-panorama', name: '全景节点空态', icon: <IconPhoto size={20} stroke={1.6} />, title: '全景节点', description: '放入全景图，作为环境参考。', action: '上传全景图' },
  { id: 'node-empty-video', name: '视频节点空态', icon: <IconVideo size={20} stroke={1.6} />, title: '视频节点', description: '连接首帧或提示词，生成一段视频。', action: '添加首帧' },
  { id: 'node-empty-audio', name: '音频节点空态', icon: <IconMusic size={20} stroke={1.6} />, title: '音频节点', description: '放入声音，为作品添加配乐或旁白。', action: '上传音频' },
  { id: 'node-empty-text', name: '文本节点空态', icon: <IconFileText size={20} stroke={1.6} />, title: '文本节点', description: '写下脚本、对白或制作备注。', action: '开始输入' },
  { id: 'node-empty-prompt', name: '提示词节点空态', icon: <IconMessage size={20} stroke={1.6} />, title: '提示词节点', description: '写下你想让模型完成的画面。', action: '开始输入' },
  { id: 'node-empty-whiteboard', name: '画板节点空态', icon: <IconBrush size={20} stroke={1.6} />, title: '画板节点', description: '画下构图、动作或参考关系。', action: '打开画板' },
].map((item) => ({
  ...item,
  render: () => <LabFrame><div className="h-64 w-[26rem] rounded-nomi border border-nomi-line bg-nomi-paper"><NodeEmptyState icon={item.icon} title={item.title} description={item.description} action={<span className="rounded-nomi-sm bg-nomi-ink px-3 py-1.5 text-caption font-medium text-nomi-paper">{item.action}</span>} /></div></LabFrame>,
}))

export const UI_SHELL_STATES: readonly UiShellLabState[] = [
  { id: 'updater-available', name: '版本弹窗 · 有更新', render: () => <UpdateState phase="available" /> },
  { id: 'updater-downloading', name: '版本弹窗 · 下载中', render: () => <UpdateState phase="downloading" /> },
  { id: 'updater-error', name: '版本弹窗 · 失败', render: () => <UpdateState phase="error" /> },
  { id: 'updater-running-badge', name: '版本弹窗 · 任务运行中角标', render: () => <UpdateState phase="available" running /> },
  ...nodeStates,
]

export function findUiShellState(id: string | null): UiShellLabState | null {
  return UI_SHELL_STATES.find((state) => state.id === id) ?? null
}
