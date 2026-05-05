import { expect, type Locator, type Page, type Route } from '@playwright/test'

type MockTaskMode = 'success' | 'failed' | 'http-error'

const FIXTURE_NOW = '2026-05-05T08:00:00.000Z'
const CANONICAL_ORIGIN = process.env.NOMI_E2E_BASE_URL || process.env.NOMI_E2E_CANONICAL_ORIGIN || 'http://localhost:5173'

export function appUrl(path: string): string {
  return new URL(path, CANONICAL_ORIGIN).toString()
}

function jsonResponse(value: unknown, status = 200): { status: number; contentType: string; body: string } {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(value),
  }
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
  await route.fulfill(jsonResponse(value, status))
}

function ssePayload(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function fulfillAgentsChat(route: Route, response: { id: string; vendor: string; text: string }): Promise<void> {
  const body = route.request().postDataJSON() as { stream?: boolean } | null
  if (body?.stream === true) {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        ssePayload('content', { delta: response.text }),
        ssePayload('result', { response }),
        ssePayload('done', { reason: 'finished' }),
      ].join(''),
    })
    return
  }
  await fulfillJson(route, response)
}

function modelCatalogModels() {
  return [
    {
      modelKey: 'fixture-image-model',
      vendorKey: 'fixture-vendor',
      modelAlias: 'fixture-image',
      labelZh: 'Fixture Image',
      kind: 'image',
      enabled: true,
      meta: {
        imageOptions: {
          supportsReferenceImages: true,
          aspectRatioOptions: ['16:9', '9:16', '1:1'],
          imageSizeOptions: ['1024x1024', '1280x720'],
          defaultAspectRatio: '16:9',
          defaultImageSize: '1024x1024',
        },
      },
      pricing: { cost: 1, enabled: true, specCosts: [] },
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
    {
      modelKey: 'fixture-video-model',
      vendorKey: 'fixture-vendor',
      modelAlias: 'fixture-video',
      labelZh: 'Fixture Video',
      kind: 'video',
      enabled: true,
      meta: {
        videoOptions: {
          durationOptions: [5, 8],
          sizeOptions: ['16:9', '9:16'],
          resolutionOptions: ['720p', '1080p'],
          defaultDurationSeconds: 5,
          defaultSize: '16:9',
          defaultResolution: '720p',
        },
      },
      pricing: { cost: 10, enabled: true, specCosts: [] },
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
    {
      modelKey: 'fixture-text-model',
      vendorKey: 'fixture-vendor',
      modelAlias: 'fixture-text',
      labelZh: 'Fixture Text',
      kind: 'text',
      enabled: true,
      meta: {},
      pricing: { cost: 0, enabled: true, specCosts: [] },
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    },
  ]
}

export async function mockNomiApi(page: Page, options: { taskMode?: MockTaskMode } = {}): Promise<void> {
  const taskMode = options.taskMode || 'success'

  await page.route('**/api/model-catalog/vendors**', async (route) => {
    await fulfillJson(route, [
      {
        key: 'fixture-vendor',
        name: 'Fixture Vendor',
        enabled: true,
        hasApiKey: true,
        baseUrlHint: 'https://fixture.invalid',
        authType: 'x-api-key',
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ])
  })

  await page.route('**/api/model-catalog/models**', async (route) => {
    const url = new URL(route.request().url())
    const kind = url.searchParams.get('kind')
    const models = modelCatalogModels().filter((model) => !kind || model.kind === kind)
    await fulfillJson(route, models)
  })

  await page.route('**/api/model-catalog/health**', async (route) => {
    await fulfillJson(route, {
      ok: true,
      counts: {
        vendors: 1,
        enabledVendors: 1,
        models: 3,
        enabledModels: 3,
        mappings: 2,
        enabledMappings: 2,
        enabledApiKeys: 1,
      },
      byKind: [
        { kind: 'text', enabledModels: 1, executableModels: 1 },
        { kind: 'image', enabledModels: 1, executableModels: 1 },
        { kind: 'video', enabledModels: 1, executableModels: 1 },
      ],
      issues: [],
    })
  })

  await page.route('**/api/model-catalog/mappings**', async (route) => {
    await fulfillJson(route, [
      {
        id: 'fixture-image-mapping',
        vendorKey: 'fixture-vendor',
        taskKind: 'text_to_image',
        name: 'Fixture image mapping',
        enabled: true,
        requestMapping: {},
        responseMapping: {},
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
      {
        id: 'fixture-video-mapping',
        vendorKey: 'fixture-vendor',
        taskKind: 'text_to_video',
        name: 'Fixture video mapping',
        enabled: true,
        requestMapping: {},
        responseMapping: {},
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
      },
    ])
  })

  await page.route(/\/api\/projects\/public(?:\?.*)?$/, async (route) => {
    await fulfillJson(route, [])
  })

  await page.route(/\/api\/projects\/[^/]+\/flows(?:\?.*)?$/, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await fulfillJson(route, [])
      return
    }
    await fulfillJson(route, {
      id: 'server-flow-fixture',
      projectId: 'server-project-fixture',
      name: 'Nomi Studio',
      data: {},
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
    })
  })

  await page.route(/\/api\/projects(?:\?.*)?$/, async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await fulfillJson(route, [])
      return
    }
    await fulfillJson(route, {
      id: 'server-project-fixture',
      name: 'Nomi E2E Project',
      createdAt: FIXTURE_NOW,
      updatedAt: FIXTURE_NOW,
      isPublic: false,
    })
  })

  await page.route(/\/api\/tasks(?:\?.*)?$/, async (route) => {
    if (taskMode === 'http-error') {
      await fulfillJson(route, { message: 'fixture upstream unavailable' }, 503)
      return
    }
    const body = route.request().postDataJSON() as { request?: { kind?: string } } | null
    const kind = body?.request?.kind === 'text_to_video' || body?.request?.kind === 'image_to_video'
      ? 'text_to_video'
      : 'text_to_image'
    if (taskMode === 'failed') {
      await fulfillJson(route, {
        id: 'fixture-failed-task',
        kind,
        status: 'failed',
        assets: [],
        raw: { message: 'fixture model rejected prompt' },
      })
      return
    }
    await fulfillJson(route, {
      id: kind === 'text_to_video' ? 'fixture-video-task' : 'fixture-image-task',
      kind,
      status: 'succeeded',
      assets: [
        kind === 'text_to_video'
          ? { type: 'video', url: 'https://cdn.test/nomi-fixture-video.mp4', thumbnailUrl: 'https://cdn.test/nomi-fixture-video.jpg' }
          : { type: 'image', url: 'https://cdn.test/nomi-fixture-image.png' },
      ],
      raw: { fixture: true },
    })
  })

  await page.route(/\/api\/tasks\/result(?:\?.*)?$/, async (route) => {
    await fulfillJson(route, {
      vendor: 'fixture-vendor',
      result: {
        id: 'fixture-polled-task',
        kind: 'text_to_image',
        status: 'succeeded',
        assets: [{ type: 'image', url: 'https://cdn.test/nomi-fixture-image.png' }],
        raw: { fixture: true },
      },
    })
  })
}

export async function resetBrowserState(page: Page): Promise<void> {
  await page.goto(appUrl('/studio'))
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
}

export async function openFreshStudioProject(page: Page): Promise<void> {
  await page.goto(appUrl('/studio'))
  const newProject = page.getByRole('button', { name: /新建项目/ })
  if (await newProject.isVisible().catch(() => false)) {
    await newProject.click()
  }
  await expect(page.getByLabel(/Nomi 工作台/)).toBeVisible()
  await page.locator('.generation-canvas-v2[data-ready="true"]').waitFor()
  await expect(page.locator('.generation-canvas-v2-node[data-kind="text"]')).toHaveCount(1)
  await expect(page.locator('.generation-canvas-v2-node[data-kind="image"]')).toHaveCount(1)
}

export async function switchStep(page: Page, label: '创作' | '生成' | '预览'): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
}

export async function mockWorkbenchAgent(page: Page): Promise<void> {
  await page.route('**/workbench/agents/chat**', async (route) => {
    const request = route.request()
    const body = request.postDataJSON() as { prompt?: string; displayPrompt?: string } | null
    const prompt = String(body?.prompt || '')
    const displayPrompt = String(body?.displayPrompt || '')
    const wantsChat = prompt.includes('当前模式：问答')
    const wantsRefine = prompt.includes('当前模式：润色')
    const wantsCreationAction = prompt.includes('documentTools 协议')
    const text = wantsCreationAction
      ? JSON.stringify({ type: 'append_to_end', content: `AI 追加正文：${displayPrompt}` })
      : wantsChat
        ? `这是问答回复：${displayPrompt}`
        : `<generation_canvas_plan>${JSON.stringify({
          action: 'create_generation_canvas_nodes',
          summary: wantsRefine ? 'refine selected prompt' : 'create a small storyboard chain',
          nodes: [
            {
              clientId: 'n1',
              kind: wantsRefine ? 'image' : 'text',
              title: wantsRefine ? '润色后的提示词' : '脚本文本',
              prompt: wantsRefine ? '电影感黄昏水彩镜头，人物轮廓清晰' : '第一幕：雨夜街道，角色走入霓虹灯下。',
              position: { x: 180, y: 260 },
            },
            ...(wantsRefine
              ? []
              : [{
                  clientId: 'n2',
                  kind: 'image',
                  title: '关键画面',
                  prompt: '雨夜街道，霓虹反光，电影感构图。',
                  position: { x: 520, y: 260 },
                }]),
          ],
          edges: wantsRefine ? [] : [{ sourceClientId: 'n1', targetClientId: 'n2' }],
        })}</generation_canvas_plan>`

    await fulfillAgentsChat(route, { id: 'e2e-agent-response', vendor: 'agents', text })
  })
}

export async function sendGenerationAssistantMessage(page: Page, mode: 'Agent' | '问答' | '润色', message: string): Promise<void> {
  await switchStep(page, '生成')
  const launcher = page.getByRole('button', { name: 'Nomi 生成', exact: true })
  if (await launcher.isVisible().catch(() => false)) await launcher.click()
  const assistant = page.locator('.generation-canvas-v2-assistant[data-collapsed="false"]')
  await expect(assistant).toBeVisible()
  await assistant.getByLabel('AI 模式').selectOption(mode === 'Agent' ? 'agent' : mode === '问答' ? 'chat' : 'refine')
  await assistant.getByLabel('给生成助手发送消息').fill(message)
  await assistant.getByRole('button', { name: '生成 AI 发送', exact: true }).click()
}

export async function addGenerationNode(page: Page, label: '文本' | '图片' | '视频' | '角色' | '场景' | '关键帧' | '镜头' | '输出'): Promise<Locator> {
  await page.getByLabel(`添加${label}节点`).click()
  const kindByLabel: Record<typeof label, string> = {
    文本: 'text',
    图片: 'image',
    视频: 'video',
    角色: 'character',
    场景: 'scene',
    关键帧: 'keyframe',
    镜头: 'shot',
    输出: 'output',
  }
  const node = page.locator(`.generation-canvas-v2-node[data-kind="${kindByLabel[label]}"]`).last()
  await expect(node).toBeVisible()
  return node
}

export async function selectNode(node: Locator): Promise<void> {
  await node.click({ position: { x: 20, y: 20 }, force: true })
  await expect(node).toHaveAttribute('data-selected', 'true')
}

export async function fillSelectedNodePrompt(page: Page, text: string): Promise<void> {
  const input = page.locator('.generation-canvas-v2-node__prompt-input').last()
  await expect(input).toBeVisible()
  await input.fill(text)
}

export async function mockPublicShareProject(page: Page): Promise<void> {
  await page.route(/\/api\/projects\/public(?:\?.*)?$/, async (route) => {
    await fulfillJson(route, [
      { id: 'public-project', name: '公开项目', createdAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW, isPublic: true },
    ])
  })
  await page.route(/\/api\/projects\/public-project\/flows(?:\?.*)?$/, async (route) => {
    await fulfillJson(route, [
      {
        id: 'public-flow',
        name: '公开工作流',
        createdAt: FIXTURE_NOW,
        updatedAt: FIXTURE_NOW,
        data: {
          nodes: [
            {
              id: 'legacy-image',
              type: 'taskNode',
              position: { x: 120, y: 120 },
              data: {
                kind: 'image',
                label: '分享图像',
                prompt: '公开提示词',
                imageUrl: 'https://cdn.test/share.png',
              },
            },
          ],
          edges: [],
        },
      },
    ])
  })
}
