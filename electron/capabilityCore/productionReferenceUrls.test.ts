import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { localizeProductionReferenceUrls, resolveProductionReferenceUrls, reworkReferenceUrls } from './productionReferenceUrls';
import { AnonymousAssetConsentRequiredError, localizeAssetsForVendor, type LocalAsset } from '../catalog/assetLocalization';
import { spendReferenceKey } from '../shared/contracts/pendingSpendConfirm';
import { matchNomiErrorCode, tagNomiError } from '../shared/nomiErrorCodes';
import { desktopT } from '../desktopStrings';
const reference = { assetId: 'asset', contentHash: 'hash', version: 1, kind: 'image' as const, role: 'first_frame' as const };
function fixture() {
  const assets = { list: () => [{ id: 'asset', data: {url:'nomi-local://asset/p/ref.png',contentType:'image/png'} }], identity: () => ({contentHash:'hash',version:1}), import: vi.fn() };
  return { assets, localize: vi.fn(async () => ['https://cdn.example/ref.png']) };
}
it('localizes pinned project assets through the existing transport before sealing', async () => {
  const deps = fixture();
  expect(await resolveProductionReferenceUrls({projectId:'p',providerId:'apimart',references:[reference],assertCurrent(){}},deps)).toEqual({[spendReferenceKey(reference)]:'https://cdn.example/ref.png'});
  expect(deps.localize).toHaveBeenCalledWith('apimart',['nomi-local://asset/p/ref.png']);
});
it('rejects changed content before upload and after asynchronous upload', async () => {
  const deps = fixture();
  deps.assets.identity = () => ({contentHash:'changed',version:1});
  await expect(resolveProductionReferenceUrls({projectId:'p',providerId:'apimart',references:[reference],assertCurrent(){}},deps)).rejects.toThrow('identity_changed');
  expect(deps.localize).not.toHaveBeenCalled();
  deps.assets.identity = () => ({contentHash:'hash',version:1});
  deps.localize.mockImplementation(async () => { deps.assets.identity = () => ({contentHash:'changed',version:1}); return ['https://cdn.example/ref.png']; });
  await expect(resolveProductionReferenceUrls({projectId:'p',providerId:'apimart',references:[reference],assertCurrent(){}},deps)).rejects.toThrow('identity_changed');
});
it('rejects a retired project after upload', async () => {
  let current = true;
  const deps = fixture(); deps.localize.mockImplementation(async () => { current = false; return ['https://cdn.example/ref.png']; });
  await expect(resolveProductionReferenceUrls({projectId:'p',providerId:'apimart',references:[reference],assertCurrent(){if(!current)throw new Error('stale_project')}},deps)).rejects.toThrow('stale_project');
});

it('uses the real multipart upload path against a delayed loopback endpoint', async () => {
  const uploads: Array<{ fileName: string; bytes: number }> = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    await new Promise((resolve) => setTimeout(resolve, 25));
    uploads.push({ fileName: req.headers['content-disposition'] ?? 'multipart', bytes: Buffer.concat(chunks).length });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: 'https://loopback.invalid/reference.png' }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback server did not bind');
  const endpoint = `http://127.0.0.1:${address.port}/v1/uploads/images`;
  const localUrl = 'nomi-local://asset/p/ref.png';
  const local: LocalAsset = { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png', fileName: 'ref.png' };
  const postMultipart = async (url: string, headers: Record<string, string>, bytes: Buffer, fileName: string, contentType: string, _extra?: Record<string, string>, fileField = 'file') => {
    const form = new FormData();
    form.append(fileField, new Blob([new Uint8Array(bytes)], { type: contentType }), fileName);
    const response = await fetch(url, { method: 'POST', headers, body: form });
    return JSON.parse(await response.text()) as unknown;
  };
  try {
    const resolved = await resolveProductionReferenceUrls({
      projectId: 'p', providerId: 'apimart', references: [{ ...reference, assetId: 'asset' }], assertCurrent() {},
    }, {
      assets: {
        list: () => [{ id: 'asset', data: { url: localUrl, contentType: 'image/png' } }],
        identity: () => ({ contentHash: 'hash', version: 1 }),
      },
      localize: async (_providerId, urls) => {
        const result = await localizeAssetsForVendor(
          { referenceImages: urls },
          () => [{ vendorKey: 'apimart', ingestion: { strategy: 'upload-multipart', endpoint, urlPath: 'url', accepts: ['image'] }, uploadApiKey: '' }],
          () => local,
          vi.fn(),
          postMultipart,
        );
        return [((result.value as { referenceImages: string[] }).referenceImages[0])!];
      },
    });
    expect(resolved).toEqual({ [spendReferenceKey(reference)]: 'https://loopback.invalid/reference.png' });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.bytes).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

// 做片返工：沿用冻住的链接，还是重新换？只在「这条连接拒绝过」或「冻住的链接明确失效」时换，其余一字不变。
// 以前一律沿用（同一份合同不重传），于是冻住的是一条临时链接时，返工发的还是那条死链接，模型再拒一次、再扣一次。
describe('reworkReferenceUrls', () => {
  const frozen = { [spendReferenceKey(reference)]: 'https://tmp.example.com/old.png' };
  const resolved = { [spendReferenceKey(reference)]: 'https://cdn.example/fresh.png' };
  const setup = (verdict: 'alive' | 'dead' | 'unknown', refused = false) => {
    const probe = vi.fn(async () => verdict);
    const resolve = vi.fn(async () => resolved);
    const policyOf = vi.fn(() => ({ refused, probe }));
    const run = (overrides: Partial<{ frozen: Record<string, string> | undefined; references: typeof reference[] }> = {}) => reworkReferenceUrls(
      { projectId: 'p', providerId: 'apimart', references: [reference], frozen, assertCurrent() {}, ...overrides },
      { policyOf, resolve },
    );
    return { probe, resolve, policyOf, run };
  };

  it('冻住的链接活着 → 沿用，不重传', async () => {
    const t = setup('alive');
    expect(await t.run()).toBeUndefined();
    expect(t.resolve).not.toHaveBeenCalled();
    expect(t.probe).toHaveBeenCalledWith('https://tmp.example.com/old.png');
  });

  it('冻住的链接判断不了（超时 / 断网 / 5xx）→ 同样沿用，和今天逐字相同', async () => {
    const t = setup('unknown');
    expect(await t.run()).toBeUndefined();
    expect(t.resolve).not.toHaveBeenCalled();
  });

  it('冻住的链接明确失效 → 重新走唯一决定点换链接', async () => {
    const t = setup('dead');
    expect(await t.run()).toEqual(resolved);
    expect(t.resolve).toHaveBeenCalledWith({ projectId: 'p', providerId: 'apimart', references: [reference], assertCurrent: expect.any(Function) });
  });

  it('这条连接拒绝过 → 不试探，直接重新换（哪怕冻住的链接看着还活着）', async () => {
    const t = setup('alive', true);
    expect(await t.run()).toEqual(resolved);
    expect(t.probe).not.toHaveBeenCalled();
  });

  it('没有冻住的链接 / 没有参考 / 连接不在目录里 → 沿用（不试探、不重传）', async () => {
    const t = setup('dead', true);
    expect(await t.run({ frozen: undefined })).toBeUndefined();
    expect(await t.run({ references: [] })).toBeUndefined();
    const missing = await reworkReferenceUrls(
      { projectId: 'p', providerId: 'gone', references: [reference], frozen, assertCurrent() {} },
      { policyOf: () => null, resolve: t.resolve },
    );
    expect(missing).toBeUndefined();
    expect(t.resolve).not.toHaveBeenCalled();
  });

  it('多条冻住的链接：任何一条明确失效就整批重新换', async () => {
    const second = { ...reference, assetId: 'asset-2' };
    const both = { ...frozen, [spendReferenceKey(second)]: 'https://tmp.example.com/old-2.png' };
    const probe = vi.fn(async (url: string) => url.endsWith('old-2.png') ? 'dead' as const : 'alive' as const);
    const resolve = vi.fn(async () => resolved);
    const out = await reworkReferenceUrls(
      { projectId: 'p', providerId: 'apimart', references: [reference, second], frozen: both, assertCurrent() {} },
      { policyOf: () => ({ refused: false, probe }), resolve },
    );
    expect(out).toEqual(resolved);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

// ── NF-1107-0002 回归矩阵：productionReferenceUrls 不得用 hostingDisabled 覆写 413 / 通道故障摘要 ──
describe('localizeProductionReferenceUrls · 上传失败摘要保真矩阵（NF-1107-0002）', () => {
  const UPLOAD_FAILURE_PRESERVATION_MATRIX = [
    {
      label: 'HTTP 413 素材超限（asset-too-large）：保留逐通道摘要、文件名、体积与换行结构',
      thrown: new Error(tagNomiError(
        'asset-too-large',
        '文件太大，apimart的上传通道收不下。请重试、换小一点的文件，或去设置里允许第三方公共临时托管。\n还没请求这次选的服务商。 视频 clip.mp4（180.0MB）: apimart: HTTP 413 Payload Too Large',
      )),
      expectedCode: 'asset-too-large',
      mustContain: ['文件太大，apimart的上传通道收不下', 'clip.mp4（180.0MB）', 'HTTP 413', '\n'],
      mustNotBeBareHostingDisabled: true,
    },
    {
      label: '通道 503 不可用（asset-upload-failed）：保留真实通道故障原因，不误报未开启托管',
      thrown: new Error(tagNomiError(
        'asset-upload-failed',
        'Nomi 中转暂时不可用。请重试、换小一点的文件，或去设置里允许第三方公共临时托管。\n还没请求这次选的服务商。 图片 ref.png（4.0MB）: nomi-relay: HTTP 503',
      )),
      expectedCode: 'asset-upload-failed',
      mustContain: ['Nomi 中转暂时不可用', 'ref.png（4.0MB）', 'HTTP 503', '\n'],
      mustNotBeBareHostingDisabled: true,
    },
    {
      label: '正对照 · 确实未开启第三方托管（AnonymousAssetConsentRequiredError）：原样透传 hostingDisabled',
      thrown: new AnonymousAssetConsentRequiredError(),
      expectedCode: 'asset-upload-failed',
      mustContain: [desktopT('assetUpload.hostingDisabled')],
      mustNotBeBareHostingDisabled: false,
    },
  ] as const;

  it.each(UPLOAD_FAILURE_PRESERVATION_MATRIX)('$label', async ({ thrown, expectedCode, mustContain, mustNotBeBareHostingDisabled }) => {
    const vendor = { key: 'apimart' };
    let caught: Error | null = null;
    try {
      await localizeProductionReferenceUrls('apimart', ['nomi-local://asset/p/clip.mp4'], {
        readCatalog: () => ({ vendors: [vendor] }) as never,
        localizeForSend: vi.fn(async () => { throw thrown; }) as never,
        assetIngestionResolver: (() => () => []) as never,
        assetLocalizationOptions: (() => ({})) as never,
      });
    } catch (error) {
      caught = error as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(matchNomiErrorCode(caught!.message)).toBe(expectedCode);
    for (const piece of mustContain) expect(caught!.message).toContain(piece);
    if (mustNotBeBareHostingDisabled) {
      expect(caught!.message).not.toBe(tagNomiError(expectedCode, desktopT('assetUpload.hostingDisabled')));
    }
  });
});
