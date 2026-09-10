import { afterEach, describe, expect, it, vi } from 'vitest';

const { resolveSource } = vi.hoisted(() => ({ resolveSource: vi.fn() }));
vi.mock('./extractVideoFrame', () => ({ resolveVideoLocalPath: resolveSource }));
vi.mock('../runtime', () => ({ writeAsset: vi.fn() }));
vi.mock('../export/ffmpegRunner', () => ({ resolveFfmpegPath: () => '/fixture/ffmpeg' }));
vi.mock('../export/mediaProbe', () => ({ resolveFfprobePath: () => '/fixture/ffprobe' }));
vi.mock('./depthVideoModelCache', () => ({ ensureVideoDepthModels: vi.fn(), pendingVideoDepthDownloadBytes: () => 0 }));
vi.mock('../protocol/localRuntimeAssets', () => ({ localModelUrl: vi.fn(), localRuntimeBundleUrl: vi.fn() }));

import { prepareVideoDepthJob } from './depthVideoJob';

const payload = (projectId: string) => ({ projectId, nodeId: 'depth-node', sourceUrl: 'fixture.mp4' });
afterEach(() => vi.clearAllMocks());

describe('depth preparation resource ownership', () => {
  it('rejects a second same-project prepare before either source resolves', async () => {
    const rejectSource: Array<(error: Error) => void> = [];
    resolveSource.mockImplementation(() => new Promise((_resolve, reject) => { rejectSource.push(reject); }));
    const first = prepareVideoDepthJob(payload('same-project'), vi.fn());
    const second = prepareVideoDepthJob(payload('same-project'), vi.fn());
    const settled = Promise.allSettled([first, second]);
    const callsWhilePreparing = resolveSource.mock.calls.length;
    rejectSource.forEach(reject => reject(new Error('source unavailable')));
    const results = await settled;
    expect(callsWhilePreparing).toBe(1);
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'already-running' } });
  });

  it('does not block independent projects during source preparation', async () => {
    const rejectSource: Array<(error: Error) => void> = [];
    resolveSource.mockImplementation(() => new Promise((_resolve, reject) => { rejectSource.push(reject); }));
    const settled = Promise.allSettled([
      prepareVideoDepthJob(payload('project-a'), vi.fn()),
      prepareVideoDepthJob(payload('project-b'), vi.fn()),
    ]);
    expect(resolveSource).toHaveBeenCalledTimes(2);
    rejectSource.forEach(reject => reject(new Error('source unavailable')));
    await settled;
  });

  it('releases preparation ownership after failure so the same project can retry', async () => {
    resolveSource.mockRejectedValue(new Error('source unavailable'));
    await expect(prepareVideoDepthJob(payload('retry-project'), vi.fn())).rejects.toMatchObject({ code: 'source-unavailable' });
    await expect(prepareVideoDepthJob(payload('retry-project'), vi.fn())).rejects.toMatchObject({ code: 'source-unavailable' });
    expect(resolveSource).toHaveBeenCalledTimes(2);
  });
});
