// 能力核 · MCP 工具契约目录（单一职责：把 Nomi 能力核暴露成哪些 MCP 工具、各自的 name/description/
// inputSchema(JSON Schema)/method(能力核方法)/build(args→params)）。从 mcpProtocol.ts 抽出（壳到 800/800，
// 交付前预批的 headroom 提取）——协议握手/派发/确认逻辑留在 mcpProtocol.ts，工具"长什么样"这份数据契约独立成文件。
// 消费方（mcpProtocol：tools/list 广播、按 name 派发、只读标注）从本模块 import；测试直接测这份契约。
//
import { listProductionPlaybookNames } from '../productionRun/productionPlaybooks'
import { MCP_CAPABILITY_RESOLVER, immutableSchemaSnapshot } from './mcpCapabilityProjection'
import { MCP_GENERATION_TOOL_CATALOG } from './mcpGenerationTools'
import { MCP_INTEGRATION_TOOL_CATALOG } from './mcpIntegrationTools'
import { MCP_PROJECT_SESSION_TOOL } from './mcpProjectSessionTool'

// 工具定义：name → { description, inputSchema(JSON Schema), method(能力核方法), build(args→params) }。
export const MCP_TOOL_CATALOG = [
  MCP_PROJECT_SESSION_TOOL,
  ...MCP_GENERATION_TOOL_CATALOG,
  ...MCP_INTEGRATION_TOOL_CATALOG,
  {
    name: 'nomi_list_projects',
    description: '列出本机 Nomi 的所有项目（id / 名称 / 更新时间）。',
    // 无参工具的官方推荐形态（tools spec 2026-07-28）：显式只收空对象，模型幻觉出的参数早拒。
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    method: 'project.list',
    build: () => ({}),
  },
  {
    name: 'nomi_create_project',
    description: '新建一个空白 Nomi 项目，返回项目 id。',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: '项目名（可选）' } } },
    method: 'project.create',
    build: (a: Record<string, unknown>) => (a.name ? { name: a.name } : {}),
  },
  {
    name: 'nomi_list_models',
    description:
      '列出 Nomi 已启用的生成模型（vendor / modelKey / 能力 kind / 名称），用于选型。每条带真话字段，不只列名：'
      + 'keyStatus=ok/missing/locked——**只有 keyStatus=ok 才真能用**；missing=没配 API Key（调用它只会浪费一趟往返报缺 key），'
      + 'locked=Key 在但当前宿主身份解不开（让用户去 Nomi 应用重存该 Key）；statusReason 给一句人话缺口。'
      + 'references 说这个模型带不带得动参考：{image,video,audio,multiImage,referenceModes}——带参考图/视频前先看它，'
      + 'referenceModes 指出用哪个模式（如 image_to_video）才发得出，multiImage=能否多张参考图。选型只挑 keyStatus=ok 的。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    method: 'models.list',
    build: () => ({}),
  },
  ...MCP_CAPABILITY_RESOLVER.list(),
  {
    name: 'nomi_start_playbook',
    description: '在本地 Nomi 项目中创建一个可审阅的制作草稿。只记录 brief 与 playbook，不批准预算、不调用付费模型。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '目标 Nomi 项目 id' },
        // 只列真跑得动的（从注册表 derive，见 productionPlaybooks.ts）。不写「例如 xxx」——那会
        // 暗示还有别的名字可传，实际传别的会被当场拒（原先是静默建一个永远推不动的坏 Run）。
        playbook: {
          type: 'string',
          enum: listProductionPlaybookNames(),
          description: `制作 playbook。当前只实现了：${listProductionPlaybookNames().join('、')}；传其它值会被拒绝。`,
        },
        playbookVersion: { type: 'string', description: '可选版本；默认 1.0.0' },
        brief: {
          type: 'object',
          properties: {
            goal: { type: 'string', description: '要完成什么' },
            audience: { type: 'string' },
            channel: { type: 'string' },
            tone: { type: 'string' },
            durationSeconds: { type: 'number', minimum: 1, maximum: 3600 },
            sellingPoints: { type: 'array', maxItems: 20, items: { type: 'string' } },
            referenceArtifactIds: { type: 'array', maxItems: 20, items: { type: 'string' } },
          },
          required: ['goal'],
          additionalProperties: false,
        },
        trustLevel: {
          type: 'string',
          enum: ['key_confirm', 'budget_only', 'confirm_all'],
          description: '可选信任档位：key_confirm 默认（方向/样片门都停）/ budget_only 只管钱（跳过创意与样片门）/ confirm_all 每镜确认。用户一上来就说「别问了直接出」时设 budget_only。',
        },
      },
      required: ['projectId', 'playbook', 'brief'],
      additionalProperties: false,
    },
    method: 'production.start',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId,
      playbook: a.playbook,
      playbookVersion: a.playbookVersion,
      brief: a.brief,
      ...(a.trustLevel ? { trustLevel: a.trustLevel } : {}),
    }),
  },
  {
    name: 'nomi_get_run',
    description: '读取一个持久化制作 Run 的安全状态投影：阶段、任务、待确认项、预算与最新产物。',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, runId: { type: 'string' } },
      required: ['projectId', 'runId'],
      additionalProperties: false,
    },
    method: 'production.get',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, runId: a.runId }),
  },
  {
    name: 'nomi_subscribe_run',
    description: '从 durable cursor 开始长轮询制作 Run 的重要事件；最多等待 25 秒，不返回轮询噪声。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        runId: { type: 'string' },
        afterCursor: { type: 'integer', minimum: 0, default: 0 },
        waitMs: { type: 'integer', minimum: 0, maximum: 25_000, default: 0 },
      },
      required: ['projectId', 'runId'],
      additionalProperties: false,
    },
    method: 'production.events',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId,
      runId: a.runId,
      afterCursor: a.afterCursor ?? 0,
      waitMs: a.waitMs ?? 0,
    }),
  },
  {
    name: 'nomi_get_artifact',
    description: '读取 Run 内一个产物的安全元数据、受控预览能力与 Nomi 深链；不返回绝对路径或供应商地址。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        runId: { type: 'string' },
        artifactId: { type: 'string' },
      },
      required: ['projectId', 'runId', 'artifactId'],
      additionalProperties: false,
    },
    method: 'production.artifact',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId,
      runId: a.runId,
      artifactId: a.artifactId,
    }),
  },
  {
    name: 'nomi_read_artifact',
    description: '读取一个版本化剧本、分镜或制作产物的完整安全内容、版本号、内容 hash、来源和 Nomi 深链；不返回绝对路径、密钥或供应商私有地址。',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' }, runId: { type: 'string' }, artifactId: { type: 'string' } },
      required: ['projectId', 'runId', 'artifactId'],
      additionalProperties: false,
    },
    method: 'production.artifact.read',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, runId: a.runId, artifactId: a.artifactId }),
  },
  {
    name: 'nomi_request_script_revision',
    description: '基于当前版本的剧本请求一次定点修订；只创建新的 candidate 版本，不会自动采用或触发付费生成。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' }, runId: { type: 'string' }, artifactId: { type: 'string' },
        expectedVersion: { type: 'integer', minimum: 1, description: '你刚读到的当前剧本版本；版本变化后请求会被拒绝。' },
        instruction: { type: 'string', minLength: 1, maxLength: 4_000, description: '只描述这次定点修改。' },
      },
      required: ['projectId', 'runId', 'artifactId', 'expectedVersion', 'instruction'],
      additionalProperties: false,
    },
    method: 'production.artifact.revise',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId, runId: a.runId, artifactId: a.artifactId,
      expectedVersion: a.expectedVersion, instruction: a.instruction, kind: 'script',
    }),
  },
  {
    name: 'nomi_request_storyboard_revision',
    description: '基于当前版本的分镜请求一次定点修订；只创建新的 candidate 版本，不会自动采用或触发付费生成。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' }, runId: { type: 'string' }, artifactId: { type: 'string' },
        expectedVersion: { type: 'integer', minimum: 1, description: '你刚读到的当前分镜版本；版本变化后请求会被拒绝。' },
        instruction: { type: 'string', minLength: 1, maxLength: 4_000, description: '只描述这次定点修改。' },
      },
      required: ['projectId', 'runId', 'artifactId', 'expectedVersion', 'instruction'],
      additionalProperties: false,
    },
    method: 'production.artifact.revise',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId, runId: a.runId, artifactId: a.artifactId,
      expectedVersion: a.expectedVersion, instruction: a.instruction, kind: 'storyboard',
    }),
  },
  {
    name: 'nomi_review_artifact',
    description: '审阅一个当前版本的剧本或分镜：approved 采用，changes_requested 保持候选并请求修改，rejected 否决；只能操作你读到的版本。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' }, runId: { type: 'string' }, artifactId: { type: 'string' },
        expectedVersion: { type: 'integer', minimum: 1, description: '你刚读到的 artifact 版本。' },
        decision: { type: 'string', enum: ['approved', 'changes_requested', 'rejected'] },
      },
      required: ['projectId', 'runId', 'artifactId', 'expectedVersion', 'decision'],
      additionalProperties: false,
    },
    method: 'production.artifact.review',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId, runId: a.runId, artifactId: a.artifactId,
      expectedVersion: a.expectedVersion, decision: a.decision,
    }),
  },
  {
    name: 'nomi_materialize_storyboard',
    description:
      '把已批准且仍对应当前剧本的分镜一次性落到目标 Nomi 项目画布，并登记同一批 Production jobs/预算合同。'
      + '只接受你刚读到的 artifact 版本；不会批准剧本/分镜、不会批准预算，也不会直接调用付费模型。'
      + '落地成功后返回画布节点 id、制作 Run 状态和可在 Nomi 打开的深链。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        runId: { type: 'string' },
        artifactId: { type: 'string', description: '已批准的 storyboard artifact id' },
        expectedVersion: { type: 'integer', minimum: 1, description: '你刚读取到的分镜版本；版本变化后拒绝，避免覆盖新稿。' },
      },
      required: ['projectId', 'runId', 'artifactId', 'expectedVersion'],
      additionalProperties: false,
    },
    method: 'production.storyboard.materialize',
    build: (a: Record<string, unknown>) => ({
      projectId: a.projectId, runId: a.runId, artifactId: a.artifactId, expectedVersion: a.expectedVersion,
    }),
  },
  {
    name: 'nomi_control_run',
    description:
      '控制制作 Run：pause 暂停（保住已花预算与已完成镜头）/ resume 从断点继续（不重做不重付）/ cancel 取消（未提交任务不计费）'
      + ' / set_trust 改信任档位（配 trustLevel）。用户说「停一下 / 继续 / 别做了」用前三个；说「别问了直接出」= set_trust 到 budget_only（跳过创意与样片门，只留预算门）。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        runId: { type: 'string' },
        action: { type: 'string', enum: ['pause', 'resume', 'cancel', 'set_trust'] },
        trustLevel: { type: 'string', enum: ['key_confirm', 'budget_only', 'confirm_all'], description: 'action=set_trust 时必填：key_confirm 五门全开 / budget_only 只管钱 / confirm_all 每镜确认' },
      },
      required: ['projectId', 'runId', 'action'],
      additionalProperties: false,
    },
    method: 'production.control',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, runId: a.runId, action: a.action, ...(a.trustLevel ? { trustLevel: a.trustLevel } : {}) }),
  },
  {
    name: 'nomi_decide_gate',
    description:
      '对制作 Run 的可逆创意门表态：approved 批准 / rejected 否决。方向门（gate-direction-*）可带 choiceKey 指定候选。'
      + '多镜批的定妆照检查点（gate-anchor-checkpoint-*）也在此表态——决定前先把定妆照给真人过目'
      + '（nomi_get_run 取该门 jobIds，对应 artifacts 用 nomi_get_artifact 逐张预览）；批准即在已批预算内开拍剩余镜头，不新增授权。'
      + 'Nomi 会在服务端再次向真人发起确认；预算、逐镜头付费、导出和发布必须回 Nomi 决定，不能用本工具跳过。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        runId: { type: 'string' },
        gateId: { type: 'string', description: '门 id，例如 gate-direction-v1' },
        decision: { type: 'string', enum: ['approved', 'rejected'] },
        choiceKey: { type: 'string', description: '方向门专用：用户选中的候选 key（来自 gate.waiting 的 directionCandidates）' },
      },
      required: ['projectId', 'runId', 'gateId', 'decision'],
      additionalProperties: false,
    },
    method: 'production.decide-gate',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, runId: a.runId, gateId: a.gateId, decision: a.decision, choiceKey: a.choiceKey }),
  },
  {
    name: 'nomi_intake_brief',
    description:
      '开拍前的**一次性方向收敛**：一屏最多问 3 题（基调 / 画幅 / 风格），每题带候选与「按你判断」。'
      + '**整局只该调一次**——拿到方向后按它写剧本、拟分镜、生成，不要再就方向反复问用户。'
      + '客户端不支持表单时会返回题面与候选，请你在对话里一次性问全（同样只问一次），或直接用默认继续。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        kind: { type: 'string', description: '片型（如 brand.promo / 短剧），决定候选措辞；不给用通用候选。' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
    method: 'brief.intake',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, ...(a.kind ? { kind: a.kind } : {}) }),
  },
  {
    name: 'nomi_import_asset',
    description:
      '把**本机文件**导入项目当素材，返回可直接引用的 nomi-local:// 地址。'
      + '用它把手绘帧 / 截图 / 用户给的参考图弄进来——导入后可在语义生成提案中引用返回的 url，'
      + '或当画布节点的参考源。只收图片与视频（png/jpg/webp/gif/bmp/tiff/heic/mp4/mov/webm/m4v），'
      + '单个 ≤64MB，须传**绝对路径**；系统/凭据目录（如 ~/.ssh、~/.nomi）的文件会被拒绝。',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: '本机文件的绝对路径，如 /Users/你/Desktop/参考.png' },
        title: { type: 'string', description: '可选：素材名（不带扩展名也行，会自动补）' },
      },
      required: ['projectId', 'path'],
      additionalProperties: false,
    },
    method: 'asset.import',
    build: (a: Record<string, unknown>) => ({ projectId: a.projectId, path: a.path, ...(a.title ? { title: a.title } : {}) }),
  },
] as const

export type McpToolDefinition = (typeof MCP_TOOL_CATALOG)[number]

const MCP_TOOL_SNAPSHOT = Object.freeze(MCP_TOOL_CATALOG.map((tool) => {
  const annotations = 'annotations' in tool && tool.annotations
    ? Object.freeze({ ...tool.annotations })
    : undefined
  return Object.freeze({
    ...tool,
    inputSchema: immutableSchemaSnapshot(tool.inputSchema),
    ...(annotations ? { annotations } : {}),
  })
})) as readonly McpToolDefinition[]

const MCP_TOOL_BY_NAME = new Map<string, McpToolDefinition>(
  MCP_TOOL_SNAPSHOT.map((tool) => [tool.name, tool]),
)

if (MCP_TOOL_BY_NAME.size !== MCP_TOOL_SNAPSHOT.length) {
  throw new Error('Duplicate MCP tool name in the explicit catalog')
}

/** tools/list and tools/call must share this exact post-filter resolver. */
export const MCP_TOOL_RESOLVER = Object.freeze({
  list: (): readonly McpToolDefinition[] => MCP_TOOL_SNAPSHOT,
  resolve: (name: string): McpToolDefinition | undefined => MCP_TOOL_BY_NAME.get(name),
})
