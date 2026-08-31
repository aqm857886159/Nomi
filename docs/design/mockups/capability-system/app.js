/* global document, history, location */

const icon = (name, className = '') =>
  `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`

const capabilityItems = [
  {
    id: 'brief',
    name: '创作 Brief 访谈',
    description: '把一句模糊目标收敛成平台、受众、规格和不可违背事实。',
    stage: 'create',
    kind: 'workflow',
    kindLabel: 'Workflow',
    status: 'enabled',
    statusLabel: '项目已用',
    score: '9.2',
    duration: '约 2 分钟',
    image: './media/original-frame.jpg',
    preview: '00:18',
    summary: '只追问会明显改变成片的缺口，生成可供脚本、分镜和模型编译共用的 CreativeBrief。',
    input: '一句目标、产品事实',
    output: 'CreativeBrief',
    requirements: ['当前文稿写入', '无需外部 Connector'],
    source: 'Nomi 内置 · v1.0.0',
    evaluation: 'J1 · 18/20 通过',
  },
  {
    id: 'research',
    name: '研究与证据收集',
    description: '把网页结论连同日期、引用片段和来源状态写入项目。',
    stage: 'research',
    kind: 'skill',
    kindLabel: 'Skill',
    status: 'enabled',
    statusLabel: '项目已用',
    score: '8.9',
    duration: '3–8 分钟',
    image: './media/reference-frame.jpg',
    preview: '00:24',
    summary: '研究结果不再只留在聊天里。每个关键结论都能回到原始页面，并把网页提示注入隔离为不可信内容。',
    input: '研究问题、时间范围',
    output: 'ResearchEvidence[]',
    requirements: ['浏览器只读', '当前页/选区读取'],
    source: '参考 pi-web-access · Nomi 改造',
    evaluation: 'J2 · 16/20 通过',
  },
  {
    id: 'breakdown',
    name: '参考视频拆解',
    description: '按时间码拆出镜头、节奏、声音和可借鉴的创作规则。',
    stage: 'research',
    kind: 'skill',
    kindLabel: 'Skill',
    status: 'available',
    statusLabel: '可直接使用',
    score: '9.0',
    duration: '约 4 分钟',
    image: './media/libtv-breakdown-reference.jpg',
    preview: '00:31',
    summary: '把参考片变成可编辑的 ShotBreakdown，区分事实、判断和不确定项，不把原内容照抄成新方案。',
    input: '视频或页面视频',
    output: 'ShotBreakdown',
    requirements: ['视频读取', 'MediaDigest'],
    source: 'Nomi 精选 · v1.2.0',
    evaluation: 'J3 · 17/20 通过',
  },
  {
    id: 'prompt',
    name: '视频 Prompt 编译',
    description: '把镜头意图编译成当前视频模型支持的提示和参数。',
    stage: 'create',
    kind: 'prompt',
    kindLabel: 'Prompt',
    status: 'update',
    statusLabel: '有更新',
    score: '8.7',
    duration: '约 20 秒',
    image: './media/libtv-reshoot-reference.jpg',
    preview: '00:14',
    summary: '保留同一镜头意图，按模型能力确定性编译参数；不会因为模板升级静默改变旧项目。',
    input: '镜头规格、模型档案',
    output: 'Provider prompt + params',
    requirements: ['视频模型档案', '项目版本锁'],
    source: 'PromptRecipe · v2.1.0',
    evaluation: 'J5 · 26/30 通过',
  },
  {
    id: 'sound',
    name: '声音设计',
    description: '为音乐、环境、动作和转场建立可定位的声音 cue。',
    stage: 'create',
    kind: 'skill',
    kindLabel: 'Skill',
    status: 'available',
    statusLabel: '需连接音效源',
    score: '8.4',
    duration: '约 3 分钟',
    image: './media/original-frame.jpg',
    preview: '00:22',
    summary: '输出落到时间码和镜头，不只是一段声音建议；商业项目会默认排除 NC 素材。',
    input: '时间轴、风格方向',
    output: 'SoundCue[]',
    requirements: ['时间轴只读', 'Freesound 可选'],
    source: 'Nomi 精选 · v1.0.0',
    evaluation: 'J6 · 待跑基线',
  },
  {
    id: 'rights',
    name: '权利与署名检查',
    description: '导出前只找来源、许可和署名异常，不让用户重查全部素材。',
    stage: 'finish',
    kind: 'workflow',
    kindLabel: 'Workflow',
    status: 'enabled',
    statusLabel: '项目已用',
    score: '9.4',
    duration: '约 15 秒',
    image: './media/reference-frame.jpg',
    preview: '00:16',
    summary: '持续检查素材证据和项目用途，导出时只阻断真正异常，并能生成所需署名。',
    input: '项目素材与使用关系',
    output: 'RightsCheckReport',
    requirements: ['素材证据只读', '导出前检查'],
    source: 'Nomi 内置 · v1.0.0',
    evaluation: 'J9 · 19/20 通过',
  },
]

const assets = [
  {
    id: 'camp',
    name: '山间营地全景.jpg',
    image: './media/original-frame.jpg',
    kind: 'photo',
    kindLabel: '图片',
    rights: 'ok',
    rightsLabel: '可商用',
    source: 'Pexels',
    license: 'Pexels License',
    author: 'Maksim Goncharenok',
    imported: '今天 10:42',
    role: '场景参考',
    usage: ['镜头 1 · 建立环境', '镜头 4 · 收束品牌'],
    note: '保留摄影师与原始落地页快照。',
  },
  {
    id: 'product',
    name: '云雀产品参考.png',
    image: './media/reference-frame.jpg',
    kind: 'photo',
    kindLabel: '图片',
    rights: 'ok',
    rightsLabel: '自有素材',
    source: '本地上传',
    license: '品牌自有',
    author: '产品团队',
    imported: '昨天 18:20',
    role: '产品身份',
    usage: ['产品身份卡', '镜头 2 · 一键萃取'],
    note: '文件哈希已锁定，替换会产生新版本。',
  },
  {
    id: 'hands',
    name: '按下萃取键.mp4',
    image: './media/libtv-reshoot-reference.jpg',
    kind: 'video',
    kindLabel: '视频',
    rights: 'ok',
    rightsLabel: '可商用',
    source: 'Pexels',
    license: 'Pexels License',
    author: 'Cottonbro Studio',
    imported: '今天 11:03',
    role: '动作参考',
    usage: ['镜头 2 · 手部动作'],
    note: '仅作动作参考，不进入最终时间轴。',
  },
  {
    id: 'steam',
    name: '咖啡蒸汽特写.mp4',
    image: './media/libtv-breakdown-reference.jpg',
    kind: 'video',
    kindLabel: '视频',
    rights: 'ok',
    rightsLabel: 'CC0',
    source: 'Openverse',
    license: 'CC0 1.0',
    author: 'FoodiesFeed',
    imported: '今天 11:08',
    role: 'B-roll',
    usage: ['镜头 3 · 液体与蒸汽'],
    note: '已复核原始来源页面。',
  },
  {
    id: 'fire',
    name: '篝火环境声.wav',
    image: null,
    kind: 'audio',
    kindLabel: '音效',
    rights: 'risk',
    riskType: 'attribution',
    rightsLabel: '需要署名',
    source: 'Freesound',
    license: 'CC BY 4.0',
    author: 'klankbeeld',
    imported: '今天 11:16',
    role: '环境声',
    usage: ['时间轴 · 00:00–00:18'],
    note: '署名尚未加入导出清单。',
  },
  {
    id: 'table',
    name: '露营桌面参考.jpg',
    image: './media/original-frame.jpg',
    kind: 'photo',
    kindLabel: '图片',
    rights: 'risk',
    riskType: 'unknown',
    rightsLabel: '许可待确认',
    source: '浏览器导入',
    license: '页面未声明',
    author: '未知',
    imported: '今天 10:56',
    role: '构图参考',
    usage: ['镜头 2 · 构图参考'],
    note: '可以改为仅参考，不能进入最终成片。',
  },
  {
    id: 'pour',
    name: '浓缩液流动_生成_v3.mp4',
    image: './media/libtv-reshoot-reference.jpg',
    kind: 'video',
    kindLabel: '视频',
    rights: 'ok',
    rightsLabel: 'AI 生成',
    source: 'Nomi 生成',
    license: '项目生成制品',
    author: 'Seedance 2.5',
    imported: '今天 11:41',
    role: '成片镜头',
    usage: ['镜头 3 · 已上时间轴'],
    note: '生成合同与模型版本已保留。',
  },
  {
    id: 'music',
    name: '清晨木吉他_剪辑版.wav',
    image: null,
    kind: 'audio',
    kindLabel: '音乐',
    rights: 'ok',
    rightsLabel: '已授权',
    source: '本地上传',
    license: '客户项目授权',
    author: 'North Studio',
    imported: '昨天 19:05',
    role: '配乐',
    usage: ['时间轴 · 00:00–00:30'],
    note: '授权文件保存在项目附件。',
  },
]

const state = {
  view: 'library',
  capabilityId: 'brief',
  stage: 'all',
  kind: 'all',
  capabilityStatus: null,
  capabilityQuery: '',
  assetId: 'fire',
  rightsFilter: 'all',
  assetQuery: '',
}

function switchView(next) {
  if (!document.querySelector(`[data-view="${next}"]`)) return
  state.view = next
  document
    .querySelectorAll('[data-view]')
    .forEach((view) => view.classList.toggle('is-active', view.dataset.view === next))
  document
    .querySelectorAll('[data-view-target]')
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.viewTarget === next)))
  history.replaceState(null, '', `#${next}`)
}

function visibleCapabilities() {
  const query = state.capabilityQuery.trim().toLowerCase()
  return capabilityItems.filter((item) => {
    if (state.stage !== 'all' && item.stage !== state.stage) return false
    if (state.kind !== 'all' && item.kind !== state.kind) return false
    if (state.capabilityStatus && item.status !== state.capabilityStatus) return false
    return !query || `${item.name} ${item.description} ${item.kindLabel}`.toLowerCase().includes(query)
  })
}

function renderCapabilities() {
  const list = visibleCapabilities()
  document.querySelector('#catalog-count').textContent = `${list.length} 项`
  document.querySelector('#capability-grid').innerHTML = list.length
    ? list
        .map(
          (item) => `
    <button class="capability-card ${item.id === state.capabilityId ? 'is-selected' : ''}" type="button" data-capability-id="${item.id}">
      <span class="capability-cover"><img src="${item.image}" alt="" /><span class="cover-overlay"><span>${icon('play')}预览</span><b>${item.preview}</b></span></span>
      <span class="capability-copy">
        <span class="capability-title-row"><h3>${item.name}</h3><span class="meta-badge ${item.status === 'enabled' ? 'ok' : item.status === 'update' ? 'warn' : ''}">${item.kindLabel}</span></span>
        <p>${item.description}</p>
        <span class="card-meta"><span>${icon('clock')}${item.duration}</span><span class="score">${icon('check')} ${item.score}</span></span>
      </span>
    </button>`,
        )
        .join('')
    : `<div class="document-empty">${icon('search')}<span>没有匹配的能力</span></div>`

  document.querySelectorAll('[data-capability-id]').forEach((button) => {
    const select = () => {
      state.capabilityId = button.dataset.capabilityId
      renderCapabilities()
      renderCapabilityDetail()
    }
    button.addEventListener('click', select)
    button.addEventListener('mouseenter', () => {
      state.capabilityId = button.dataset.capabilityId
      document
        .querySelectorAll('[data-capability-id]')
        .forEach((card) => card.classList.toggle('is-selected', card === button))
      renderCapabilityDetail()
    })
  })
}

function renderCapabilityDetail() {
  const item = capabilityItems.find((candidate) => candidate.id === state.capabilityId) || capabilityItems[0]
  const enabled = item.status === 'enabled'
  document.querySelector('#capability-detail').innerHTML = `
    <div class="detail-media"><img src="${item.image}" alt="${item.name} 效果预览" /><div class="media-control"><button type="button" title="播放预览" aria-label="播放预览">${icon('play')}</button><span class="media-progress"><i></i></span><b>${item.preview}</b></div></div>
    <div class="detail-kicker"><span>${item.kindLabel}</span><span>·</span><span>${item.statusLabel}</span></div>
    <h2 class="detail-title">${item.name}</h2>
    <p class="detail-summary">${item.summary}</p>
    <div class="detail-tabs"><button class="is-active" type="button">概览</button><button type="button">效果</button><button type="button">版本</button></div>
    <div class="detail-section"><span>输入与结果</span><div class="io-grid"><div><b>你提供</b><small>${item.input}</small></div><div><b>写入项目</b><small>${item.output}</small></div></div></div>
    <div class="detail-section"><span>运行前检查</span><div class="requirement-list">${item.requirements.map((requirement) => `<div>${icon('check')}<b>${requirement}</b><small>可用</small></div>`).join('')}</div></div>
    <div class="detail-section"><span>来源与评测</span><div class="evidence-list"><div class="evidence-row"><span>来源版本</span><b>${item.source}</b></div><div class="evidence-row"><span>最近评测</span><b>${item.evaluation}</b></div><div class="evidence-row"><span>项目锁定</span><b>${enabled ? '当前项目已固定此版本' : '使用后固定版本与内容哈希'}</b></div></div></div>
    <div class="detail-actions"><button class="primary-button" id="use-capability" type="button">${enabled ? `${icon('check')} 已用于当前项目` : `${icon('arrow')} 用于当前任务`}</button><button class="icon-button" type="button" title="更多操作" aria-label="更多操作">${icon('dots')}</button></div>`
  document.querySelector('#use-capability').addEventListener('click', () => {
    item.status = 'enabled'
    item.statusLabel = '项目已用'
    renderCapabilities()
    renderCapabilityDetail()
  })
}

function visibleAssets() {
  const query = state.assetQuery.trim().toLowerCase()
  return assets.filter((asset) => {
    if (state.rightsFilter !== 'all' && asset.rights !== state.rightsFilter) return false
    return !query || `${asset.name} ${asset.author} ${asset.role}`.toLowerCase().includes(query)
  })
}

function renderAssets() {
  const list = visibleAssets()
  const risks = assets.filter((asset) => asset.rights === 'risk').length
  document.querySelector('#asset-count').textContent = `${list.length} 项`
  document.querySelector('#asset-list-label').textContent =
    state.rightsFilter === 'risk' ? '待处理素材' : state.rightsFilter === 'ok' ? '可用素材' : '全部素材'
  document.querySelector('#risk-tab-count').textContent = String(risks)
  document.querySelector('#risk-side-count').textContent = String(risks)
  document.querySelector('#asset-grid').innerHTML = list.length
    ? list
        .map(
          (asset) => `
    <button class="asset-card ${asset.id === state.assetId ? 'is-selected' : ''}" type="button" data-asset-id="${asset.id}">
      <span class="asset-thumb">${asset.image ? `<img src="${asset.image}" alt="" />` : `<span class="audio-thumb"><i class="waveform"></i></span>`}<span class="asset-kind">${icon(asset.kind === 'audio' ? 'music' : asset.kind === 'video' ? 'play' : 'photo')}</span><span class="rights-chip ${asset.rights === 'risk' ? 'risk' : ''}">${icon(asset.rights === 'risk' ? 'alert' : 'check')}${asset.rightsLabel}</span></span>
      <span class="asset-copy"><h3>${asset.name}</h3><p>${asset.role} · ${asset.source}</p></span>
    </button>`,
        )
        .join('')
    : `<div class="document-empty">${icon('check')}<span>没有待处理素材</span></div>`
  document.querySelectorAll('[data-asset-id]').forEach((button) =>
    button.addEventListener('click', () => {
      state.assetId = button.dataset.assetId
      renderAssets()
      renderAssetDetail()
    }),
  )
  renderExportCheck(risks)
}

function renderAssetDetail() {
  const asset = assets.find((candidate) => candidate.id === state.assetId) || visibleAssets()[0] || assets[0]
  state.assetId = asset.id
  const action =
    asset.rights === 'risk'
      ? asset.riskType === 'attribution'
        ? `<button class="resolve" id="resolve-rights" type="button">${icon('check')} 生成并加入署名</button>`
        : `<button class="reference" id="reference-only" type="button">${icon('tag')} 改为仅作参考</button>`
      : ''
  document.querySelector('#asset-detail').innerHTML = `
    <div class="asset-preview">${asset.image ? `<img src="${asset.image}" alt="${asset.name} 预览" />` : `<span class="audio-thumb"><i class="waveform"></i></span>`}</div>
    <div class="detail-kicker"><span>${asset.kindLabel}</span><span>·</span><span class="status-badge ${asset.rights === 'risk' ? 'warn' : 'ok'}">${asset.rightsLabel}</span></div>
    <h2>${asset.name}</h2><p>${asset.note}</p>
    <div class="detail-section"><span>来源证据</span><div class="evidence-list"><div class="evidence-row"><span>来源</span><b>${asset.source}</b></div><div class="evidence-row"><span>许可证</span><b>${asset.license}</b></div><div class="evidence-row"><span>作者</span><b>${asset.author}</b></div><div class="evidence-row"><span>原始页面</span><a href="#assets">查看证据快照 ${icon('external')}</a></div><div class="evidence-row"><span>导入时间</span><b>${asset.imported}</b></div></div></div>
    <div class="detail-section"><span>项目关系</span><div class="usage-list">${asset.usage.map((usage) => `<div class="usage-row">${icon(asset.kind === 'audio' ? 'music' : 'photo')}<span><b>${usage}</b><small>${asset.role}</small></span><span>已关联</span></div>`).join('')}</div></div>
    <div class="rights-action">${action}<button class="reference" type="button">${icon('history')} 查看版本与哈希</button></div>`
  const resolve = document.querySelector('#resolve-rights')
  if (resolve) resolve.addEventListener('click', () => resolveAsset(asset, '署名已加入', '署名已写入导出清单。'))
  const reference = document.querySelector('#reference-only')
  if (reference) reference.addEventListener('click', () => resolveAsset(asset, '仅作参考', '该素材不会进入最终成片。'))
}

function resolveAsset(asset, label, note) {
  asset.rights = 'ok'
  asset.rightsLabel = label
  asset.note = note
  renderAssets()
  renderAssetDetail()
}

function renderExportCheck(risks) {
  const root = document.querySelector('#export-check')
  root.classList.toggle('is-ready', risks === 0)
  root.querySelector('.status-icon').innerHTML = icon(risks ? 'alert' : 'check')
  document.querySelector('#export-title').textContent = risks ? `导出前有 ${risks} 项待处理` : '素材权利检查已通过'
  root.querySelector('small').textContent = risks
    ? `只处理异常，其他 ${assets.length - risks} 项无需重复检查`
    : `${assets.length} 项素材均有可追溯状态`
  document.querySelector('#export-button').disabled = risks > 0
}

document
  .querySelectorAll('[data-view-target]')
  .forEach((button) => button.addEventListener('click', () => switchView(button.dataset.viewTarget)))
document.querySelectorAll('[data-stage]').forEach((button) =>
  button.addEventListener('click', () => {
    state.stage = button.dataset.stage
    state.capabilityStatus = null
    document
      .querySelectorAll('[data-stage], [data-status]')
      .forEach((candidate) => candidate.classList.toggle('is-active', candidate === button))
    renderCapabilities()
  }),
)
document.querySelectorAll('[data-status]').forEach((button) =>
  button.addEventListener('click', () => {
    state.capabilityStatus = button.dataset.status
    state.stage = 'all'
    document
      .querySelectorAll('[data-stage], [data-status]')
      .forEach((candidate) => candidate.classList.toggle('is-active', candidate === button))
    renderCapabilities()
  }),
)
document.querySelectorAll('[data-kind]').forEach((button) =>
  button.addEventListener('click', () => {
    state.kind = button.dataset.kind
    document
      .querySelectorAll('[data-kind]')
      .forEach((candidate) => candidate.classList.toggle('is-active', candidate === button))
    renderCapabilities()
  }),
)
document.querySelector('#capability-search').addEventListener('input', (event) => {
  state.capabilityQuery = event.target.value
  renderCapabilities()
})

const answers = new Map()
document.querySelectorAll('.question-block').forEach((block) =>
  block.querySelectorAll('button').forEach((button) =>
    button.addEventListener('click', () => {
      block
        .querySelectorAll('button')
        .forEach((candidate) => candidate.classList.toggle('is-selected', candidate === button))
      answers.set(block.dataset.question, button.dataset.value)
      document.querySelector('#brief-continue').disabled = answers.size < 3
    }),
  ),
)
document.querySelector('#brief-continue').addEventListener('click', () => {
  document.querySelector('#elicitation-card').hidden = true
  document.querySelector('#brief-result').hidden = false
  document.querySelector('#brief-platform').textContent = answers.get('platform')
  document.querySelector('#brief-audience').textContent = answers.get('audience')
  const output = document.querySelector('#brief-output')
  output.classList.add('is-filled')
  output.innerHTML = `${icon('check')}<span><b>方向已确认：${answers.get('tone')}</b><br />前 3 秒展示户外使用结果，中段证明一键萃取，结尾回到产品与品牌名；不扩写未提供的性能参数。</span>`
  document.querySelector('#agent-scroll').scrollTop = document.querySelector('#agent-scroll').scrollHeight
})
document.querySelector('#preflight-toggle').addEventListener('click', () => {
  const panel = document.querySelector('#preflight')
  panel.classList.toggle('is-open')
  document.querySelector('#preflight-toggle').textContent = panel.classList.contains('is-open')
    ? '收起预检'
    : '查看预检'
})
document.querySelector('#connect-freesound').addEventListener('click', (event) => {
  document.querySelector('#connector-row').innerHTML =
    `${icon('check', 'ok')}<span><b>Freesound</b><small>仅搜索与试听，商业项目过滤 NC</small></span><small>已连接</small>`
  event.stopPropagation()
})

document.querySelectorAll('[data-right-filter]').forEach((button) =>
  button.addEventListener('click', () => {
    state.rightsFilter = button.dataset.rightFilter
    document
      .querySelectorAll('[data-right-filter]')
      .forEach((candidate) =>
        candidate.classList.toggle('is-active', candidate.dataset.rightFilter === state.rightsFilter),
      )
    const first = visibleAssets()[0]
    if (first && !visibleAssets().some((asset) => asset.id === state.assetId)) state.assetId = first.id
    renderAssets()
    renderAssetDetail()
  }),
)
document.querySelector('#asset-search').addEventListener('input', (event) => {
  state.assetQuery = event.target.value
  renderAssets()
})
document.querySelector('#show-risks').addEventListener('click', () => {
  state.rightsFilter = 'risk'
  document
    .querySelectorAll('[data-right-filter]')
    .forEach((candidate) => candidate.classList.toggle('is-active', candidate.dataset.rightFilter === 'risk'))
  const first = visibleAssets()[0]
  if (first) state.assetId = first.id
  renderAssets()
  renderAssetDetail()
})

const initialView = location.hash.replace('#', '')
switchView(['library', 'agent', 'assets'].includes(initialView) ? initialView : 'library')
renderCapabilities()
renderCapabilityDetail()
renderAssets()
renderAssetDetail()
