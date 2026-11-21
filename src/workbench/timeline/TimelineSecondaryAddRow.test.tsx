import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReactTestRenderer } from '../ai/v4/testReactRenderer'
import { useWorkbenchStore } from '../workbenchStore'
import { TimelineSecondaryAddRow } from './TimelineSecondaryAddRow'

const fixtures = vi.hoisted(() => ({
  copyFiles: vi.fn(),
  readAudioDuration: vi.fn(async () => 1),
}))

vi.mock('../assets/AssetPickerPopover', () => ({ default: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../assets/useAssetPool', () => ({ useAssetPool: () => ({ assets: [], loading: false, refresh: () => undefined }) }))
vi.mock('../project/useOpenProjectId', () => ({ useOpenProjectId: () => 'project-a' }))
vi.mock('../project/projectCanvasReadSurface', () => {
  const project = { binding: { projectId: 'project-a' }, signal: new AbortController().signal, assertCurrent: () => undefined }
  return { withProjectAction: (run: (issued: typeof project) => unknown) => run(project), isProjectExecutionContextCurrent: () => true }
})
vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: () => ({
  clipboard: { getPathForFile: () => '/tmp/tone.wav' },
  assets: { copyFiles: fixtures.copyFiles },
}) }))
vi.mock('../../media/audioDurationProbe', () => ({ readAudioDurationSeconds: fixtures.readAudioDuration }))

type Host = { type: string; props: Record<string, unknown> }

function musicClips() {
  return useWorkbenchStore.getState().timeline.tracks.flatMap((track) => track.type === 'audio' ? track.clips : [])
}

describe('timeline music upload', () => {
  const initialTimeline = useWorkbenchStore.getState().timeline
  afterEach(() => {
    useWorkbenchStore.getState().setTimeline(initialTimeline)
    fixtures.copyFiles.mockReset()
  })

  it.each([
    { existing: false, startFrame: 0 },
    { existing: true, startFrame: 150 },
  ])('puts a selected local audio file in the library and on the music track at $startFrame', async ({ existing, startFrame }) => {
    const oldClip = { id: 'older-music', type: 'audio' as const, sourceNodeId: 'older', label: 'older.wav', startFrame: 0, endFrame: 30, frameCount: 30, offsetStartFrame: 0, offsetEndFrame: 0 }
    useWorkbenchStore.getState().setTimeline({ ...initialTimeline, playheadFrame: 150, tracks: initialTimeline.tracks.map((track) => ({ ...track, clips: track.type === 'audio' && existing ? [oldClip] : [] })) })
    fixtures.copyFiles.mockResolvedValue({
      created: [{ id: 'asset-a', name: 'tone.wav', projectId: 'project-a', createdAt: '', updatedAt: '', data: {
        mediaType: 'audio', relativePath: 'assets/imported/tone.wav', url: 'nomi-local://asset/project-a/assets/imported/tone.wav',
      } }],
      rejected: [], failedCount: 0,
    })
    const hosts: Host[] = []
    const renderer = createReactTestRenderer<Host>({ createInstance: (type, props) => {
      const host = { type, props }
      hosts.push(host)
      return host
    } })
    renderer.render(<TimelineSecondaryAddRow showAudio showText={false} />)
    const music = hosts.find((host) => host.type === 'button' && String(host.props['aria-label']).includes('配乐'))
    expect(music).toBeTruthy()
    ;(music!.props.onClick as () => void)()
    renderer.render(<TimelineSecondaryAddRow showAudio showText={false} />)
    const input = hosts.find((host) => host.type === 'input' && host.props.type === 'file')
    expect(input).toBeTruthy()
    ;(input!.props.onChange as (event: unknown) => void)({ currentTarget: { files: [{ name: 'tone.wav', type: 'audio/wav', size: 44 }], value: '/tmp/tone.wav' } })
    await vi.waitFor(() => expect(musicClips()).toHaveLength(existing ? 2 : 1))
    expect(fixtures.copyFiles).toHaveBeenCalledWith({ projectId: 'project-a', paths: ['/tmp/tone.wav'] })
    expect(musicClips().find((clip) => clip.label === 'tone.wav')).toMatchObject({ type: 'audio', startFrame })
    renderer.close()
  })

  it('shows the existing inline failure and leaves the track unchanged when import creates no asset', async () => {
    useWorkbenchStore.getState().setTimeline({ ...initialTimeline, tracks: initialTimeline.tracks.map((track) => ({ ...track, clips: [] })) })
    fixtures.copyFiles.mockResolvedValue({ created: [], rejected: [], failedCount: 1 })
    const hosts: Host[] = []
    const renderer = createReactTestRenderer<Host>({ createInstance: (type, props) => {
      const host = { type, props }
      hosts.push(host)
      return host
    } })
    const row = <TimelineSecondaryAddRow showAudio showText={false} />
    renderer.render(row)
    ;(hosts.find((host) => host.type === 'button' && String(host.props['aria-label']).includes('配乐'))!.props.onClick as () => void)()
    renderer.render(row)
    ;(hosts.find((host) => host.type === 'input' && host.props.type === 'file')!.props.onChange as (event: unknown) => void)({ currentTarget: { files: [{ name: 'tone.wav', type: 'audio/wav', size: 44 }], value: '' } })
    await vi.waitFor(() => {
      renderer.render(row)
      expect(hosts.some((host) => host.type === 'p' && host.props['data-timeline-audio-feedback'] !== undefined)).toBe(true)
    })
    expect(musicClips()).toHaveLength(0)
    renderer.close()
  })
})
