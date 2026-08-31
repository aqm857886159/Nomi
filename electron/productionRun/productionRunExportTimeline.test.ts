import { describe, expect, it } from 'vitest'

import { buildProductionExportTimeline } from './productionRunExportTimeline'

describe('production export timeline projection', () => {
  it('carries the durable arrangement and adopted local video artifacts into export state', () => {
    const timeline = buildProductionExportTimeline({
      projectId: 'project-1',
      arrangement: {
        timelineContract: {
          fps: 30,
          durationFrames: 918,
          clips: [
            { shotId: 'shot-1', startFrame: 0, endFrame: 153 },
            { shotId: 'shot-2', startFrame: 153, endFrame: 306 },
          ],
          subtitles: [
            { startFrame: 0, endFrame: 153, text: '第一镜' },
            { startFrame: 153, endFrame: 306, text: '第二镜' },
          ],
          transitions: [
            { fromShotId: 'shot-1', toShotId: 'shot-2', type: 'dissolve', durationFrames: 12 },
          ],
        },
      },
      jobs: [
        { jobId: 'job-1', nodeId: 'shot-1', metadata: {} },
        { jobId: 'job-2', nodeId: 'shot-2', metadata: {} },
      ],
      artifacts: [
        { jobId: 'job-1', kind: 'video', status: 'adopted', projectRelativePath: 'assets/shot-1.mp4' },
        { jobId: 'job-2', kind: 'video', status: 'adopted', projectRelativePath: 'assets/shot-2.mp4' },
      ],
    })

    expect(timeline.tracks.find((track) => track.type === 'video')?.clips).toHaveLength(2)
    expect(timeline.tracks.find((track) => track.type === 'video')?.clips.map((clip) => clip.url)).toEqual([
      'nomi-local://asset/project-1/assets/shot-1.mp4',
      'nomi-local://asset/project-1/assets/shot-2.mp4',
    ])
    expect(timeline.textClips.map((clip) => clip.text)).toEqual(['第一镜', '第二镜'])
    expect(timeline.transitions).toEqual([
      { fromClipId: 'production-clip-shot-1', toClipId: 'production-clip-shot-2', type: 'dissolve', durationFrames: 12 },
    ])
  })
})
