import { describe, expect, it } from 'vitest'
import { summarizeToolCall } from './toolCallSummary'

describe('summarizeToolCall export tools', () => {
  it('uses human-readable labels in the existing confirmation UI', () => {
    expect(summarizeToolCall('export_timeline', {
      resolution: '720p',
      quality: 'high',
      outputName: 'first-cut',
    })).toBe('导出时间线（720p · 高质量）：first-cut')
    expect(summarizeToolCall('export_timeline', {})).toBe('导出时间线（1080p · 标准质量）')
    expect(summarizeToolCall('inspect_export_job', { jobId: 'job-1' })).toBe('查看导出进度')
    expect(summarizeToolCall('verify_render', { jobId: 'job-1' })).toBe('验证导出结果')
    expect(summarizeToolCall('cancel_export_job', { jobId: 'job-1' })).toBe('取消导出任务')
  })
})
