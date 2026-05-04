import React, { useEffect } from 'react'
import { Group } from '@mantine/core'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { defaultsFor } from '../inspector/forms'
import { DesignButton, DesignModal, DesignNumberInput, DesignSelect, DesignTextInput, DesignTextarea } from '../design'

type ParamFormValue = string | number | boolean | null | undefined
type ParamForm = Record<string, ParamFormValue>
type FormSetter = (k: string, v: ParamFormValue) => void
type NodeDataWithKind = ParamForm & { kind?: string }

function readString(form: ParamForm, key: string, fallback = ''): string {
  const value = form[key]
  return typeof value === 'string' ? value : fallback
}

function readNumber(form: ParamForm, key: string, fallback: number): number {
  const value = form[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function renderVideoStoryboardSection(form: ParamForm, setField: FormSetter) {
  return (
    <>
      <DesignTextarea className="param-modal-field" label="分镜/脚本" autosize minRows={4} value={readString(form, 'storyboard')} onChange={(e)=>setField('storyboard', e.currentTarget.value)} />
      <Group className="param-modal-row" grow mt={8}>
        <DesignNumberInput className="param-modal-field" label="Duration(s)" min={1} max={600} value={readNumber(form, 'duration', 30)} onChange={(v)=>setField('duration', Number(v)||30)} />
        <DesignNumberInput className="param-modal-field" label="FPS" min={1} max={60} value={readNumber(form, 'fps', 24)} onChange={(v)=>setField('fps', Number(v)||24)} />
      </Group>
    </>
  )
}

function renderStoryboardImageSection(form: ParamForm, setField: FormSetter) {
  return (
    <>
      <Group className="param-modal-row" grow mt={2}>
        <DesignNumberInput
          className="param-modal-field"
          label="分镜数"
          min={4}
          max={16}
          value={readNumber(form, 'storyboardCount', 4)}
          onChange={(v) => setField('storyboardCount', Math.max(4, Math.min(16, Math.floor(Number(v) || 4))))}
        />
        <DesignSelect
          className="param-modal-field"
          label="镜头比例"
          data={[
            { value: '16:9', label: '16:9 横屏' },
            { value: '9:16', label: '9:16 竖屏' },
          ]}
          value={form.storyboardAspectRatio === '9:16' ? '9:16' : '16:9'}
          onChange={(v) => setField('storyboardAspectRatio', v === '9:16' ? '9:16' : '16:9')}
          withinPortal
        />
      </Group>
      <DesignSelect
        className="param-modal-field"
        mt={8}
        label="风格"
        data={[
          { value: 'realistic', label: '写实' },
          { value: 'comic', label: '美漫' },
          { value: 'sketch', label: '草图' },
          { value: 'strip', label: '条漫' },
        ]}
        value={readString(form, 'storyboardStyle', 'realistic')}
        onChange={(v) => setField('storyboardStyle', v || 'realistic')}
        withinPortal
      />
      <DesignTextarea
        className="param-modal-field"
        mt={8}
        label="分镜脚本（可选）"
        autosize
        minRows={6}
        value={readString(form, 'storyboardScript')}
        onChange={(e) => setField('storyboardScript', e.currentTarget.value)}
        placeholder="建议每行一个镜头提示词；若留空，将使用 Prompt 作为剧情主题。"
      />
    </>
  )
}

function renderPromptSection(form: ParamForm, setField: FormSetter) {
  return (
    <DesignTextarea
      className="param-modal-field"
      label="Prompt"
      autosize
      minRows={4}
      value={readString(form, 'prompt')}
      onChange={(e) => setField('prompt', e.currentTarget.value)}
      placeholder="填写或粘贴生成提示词（英文，可含动作/光影/对白/音效描述）"
    />
  )
}

function renderSubtitleAlignSection(form: ParamForm, setField: FormSetter) {
  return (
    <>
      <DesignTextInput className="param-modal-field" label="音频 URL" value={readString(form, 'audioUrl')} onChange={(e)=>setField('audioUrl', e.currentTarget.value)} />
      <DesignTextarea className="param-modal-field" mt={8} label="字幕文本" autosize minRows={4} value={readString(form, 'transcript')} onChange={(e)=>setField('transcript', e.currentTarget.value)} />
    </>
  )
}

export default function ParamModal(): JSX.Element {
  const nodeId = useUIStore(s => s.paramNodeId)
  const close = useUIStore(s => s.closeParam)
  const nodes = useRFStore(s => s.nodes)
  const edges = useRFStore(s => s.edges)
  const update = useRFStore(s => s.updateNodeData)
  const n = nodes.find(n => n.id === nodeId)
  const nodeData = n?.data as NodeDataWithKind | undefined
  const kind = typeof nodeData?.kind === 'string' ? nodeData.kind : undefined
  const [form, setForm] = React.useState<ParamForm>({})
  useEffect(()=>{
    if (n) {
      const base = defaultsFor(kind)
      setForm({ ...base, ...(nodeData || {}) })
    }
  },[n, nodeData, kind])

  const setField = (k: string, v: ParamFormValue) => setForm((f)=>({ ...f, [k]: v }))
  const save = () => { if (!n) return; update(n.id, form); close() }
  const isVideoStoryboardKind = kind === 'video'
  const isStoryboardImageKind = false
  const isPromptSupportedKind =
    kind === 'image' ||
    kind === 'video'
  const isSubtitleAlignKind = kind === 'subtitle'

  return (
    <DesignModal className="param-modal" opened={!!nodeId} onClose={close} title="参数" centered>
      {!n && <div className="param-modal-empty">节点不存在</div>}
      {n && (
        <div className="param-modal-body">
          {isVideoStoryboardKind && renderVideoStoryboardSection(form, setField)}
          {isStoryboardImageKind && renderStoryboardImageSection(form, setField)}
          {isPromptSupportedKind && renderPromptSection(form, setField)}
          {isSubtitleAlignKind && renderSubtitleAlignSection(form, setField)}
          <Group className="param-modal-footer" justify="flex-end" mt={12}>
            <Group className="param-modal-footer-actions" gap="xs">
              <DesignButton className="param-modal-cancel" variant="subtle" onClick={close}>取消</DesignButton>
              <DesignButton className="param-modal-save" onClick={save}>保存</DesignButton>
            </Group>
          </Group>
        </div>
      )}
    </DesignModal>
  )
}
