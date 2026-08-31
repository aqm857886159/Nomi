export const locales = ['zh-CN', 'en']

export const shared = Object.freeze({
  siteUrl: 'https://nomiaqm.com',
  repositoryUrl: 'https://github.com/aqm857886159/Nomi',
  releaseUrl: 'https://github.com/aqm857886159/Nomi/releases/latest',
  businessUrl: 'https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml',
  discussionUrl: 'https://github.com/aqm857886159/Nomi/discussions',
  wechatId: 'TZ857886159',
  groupQr: '/assets/group-wechat-2026-08-25.png',
  authorQr: '/assets/qingyang-wechat.jpg',
  licenseName: 'AGPL-3.0-only',
  licenseUrl: 'https://www.gnu.org/licenses/agpl-3.0.html',
})

const zhCN = {
  path: '/',
  htmlLang: 'zh-CN',
  ogLocale: 'zh_CN',
  meta: {
    title: 'Nomi — 把镜头讲清楚，不让模型猜',
    description: '本地优先、开源的 AI 视频导演工作台。连接故事、分镜、视觉锚点、生成画布和时间线，也可通过 MCP 与 Skills 从一句话推进到可编辑初稿。',
    imageAlt: 'Nomi 本地优先 AI 视频导演工作台',
  },
  nav: {
    ariaLabel: '主导航',
    product: '产品',
    teams: '团队服务',
    community: '社群',
    docs: '文档',
    docsHref: '/quickstart.html',
    download: '下载',
    localeLabel: '切换到英文',
  },
  hero: {
    eyebrow: 'LOCAL-FIRST · OPEN SOURCE · AI VIDEO WORKBENCH',
    titleLead: '把镜头讲清楚，',
    titleEmphasis: '不让模型猜。',
    lede: '故事、分镜、视觉锚点、生成画布与时间线，保持在同一个上下文里。',
    download: '下载 Nomi',
    watch: '看 60 秒宣传片',
    monitorLabel: 'NOMI / DIRECTOR MONITOR',
    monitorTimecode: 'REC · 00:00:14:22',
    monitorCaption: '同一个画布里看见整条序列，而不是重开另一个提示词。',
    videoLabel: 'Nomi 生成画布工作流静音预览',
    sequenceLabel: 'LOCAL-FIRST AI VIDEO WORKBENCH',
  },
  proofs: [
    {
      id: 'context',
      number: '01',
      chapter: 'CONTEXT CONNECTED',
      title: '上下文持续连接',
      description: '故事、角色、分镜和生成证据不再散落在不同工具里；每一步都知道前面发生过什么。',
      image: '/assets/screen-script.png',
      imageAlt: 'Nomi 故事和分镜工作区',
      tags: ['STORY', 'STORYBOARD', 'MEMORY'],
    },
    {
      id: 'world',
      number: '02',
      chapter: 'LOCK THE WORLD FIRST',
      title: '先锁定世界',
      description: '先固定人物、场景、道具、构图和风格，让后续镜头继承同一组视觉锚点，减少身份与空间漂移。',
      image: '/assets/screen-3d.png',
      imageAlt: 'Nomi 3D 导演台中的人物与镜头调度',
      tags: ['CHARACTER', 'LOCATION', 'CAMERA'],
    },
    {
      id: 'canvas',
      number: '03',
      chapter: 'DIRECT ON CANVAS',
      title: '在画布上导演',
      description: '在全局序列中摆素材、写提示词、调用生成，把参考、结果和下一镜头放在同一张导演桌上。',
      image: '/assets/screen-canvas.png',
      imageAlt: 'Nomi 生成画布中的连续镜头和视觉参考',
      tags: ['PROMPTS', 'MEDIA', 'GENERATE'],
    },
    {
      id: 'agentic',
      number: '04',
      chapter: 'ONE SENTENCE TO A FIRST CUT',
      title: '一句话，推进到可编辑初稿',
      description: '让 Claude Code 等 AI 助手通过 Nomi MCP 调用 Skills：建立项目、生成分镜、连接参考并推进初稿；最终画面和成片仍由你决定。',
      image: '/assets/screen-agentic.jpg',
      imageAlt: 'Nomi 一键接入 Claude Code、Codex 和 Cursor 的真实界面',
      tags: ['CLAUDE CODE', 'NOMI MCP', 'SKILLS'],
    },
  ],
  paths: {
    titleLead: '开放给创作者，',
    titleEmphasis: '也能为团队落地。',
    description: '同一个产品，两条诚实路径：直接下载开源版；或者让我们把它接进你的真实业务。',
    open: {
      kicker: '01 / OPEN SOURCE',
      title: '面向创作者',
      description: '本地优先、AGPL-3.0 开源。项目与素材在你的电脑上，工作流由你掌控。',
      actions: ['下载桌面版', '查看源代码', '阅读使用文档'],
      download: '下载 Nomi',
    },
    teams: {
      kicker: '02 / FOR TEAMS',
      title: '把 Nomi 变成你的产品与交付能力',
      description: '适合内部 AI 视频工作台、客户项目、垂直行业流程与贴牌产品；从首次验证到上线后的持续迭代，围绕真实交付来构建。GitHub Issue 只提交非保密摘要。',
      services: [
        { id: 'custom', title: '定制开发', code: 'CUSTOM' },
        { id: 'integration', title: '系统与模型集成', code: 'INTEGRATE' },
        { id: 'whiteLabel', title: '贴牌交付与商业授权', code: 'WHITE-LABEL' },
        { id: 'iteration', title: '持续优化、维护与迭代', code: 'ONGOING' },
      ],
      discuss: '沟通项目',
      wechat: '微信沟通',
      wechatLabel: '作者微信',
    },
  },
  community: {
    titleLead: '一起用，',
    titleEmphasis: '也一起把它做好。',
    description: '看真实工作流、反馈问题、获取版本动态，也让你的摩擦直接进入下一轮产品迭代。',
    contactLabel: '作者微信',
    cards: [
      {
        id: 'group',
        kicker: '01 / USER COMMUNITY',
        title: '加入 Nomi 用户群',
        description: '进入 nomi 画布群，看别人怎么用、直接反馈问题，并第一时间收到版本动态。',
        primary: { label: '查看群二维码', code: 'WECHAT GROUP', target: 'groupQr' },
        secondary: { label: '参与 GitHub 讨论', code: 'DISCUSS', target: 'discussionUrl' },
      },
      {
        id: 'author',
        kicker: '02 / DIRECT CONTACT',
        title: '群码失效，直接加作者',
        description: '添加作者微信拉群；定制开发、系统集成、贴牌与持续迭代也可以直接沟通。',
        primary: { label: '查看个人微信二维码', code: 'WECHAT', target: 'authorQr' },
        secondary: { label: '提交商务咨询', code: 'BUSINESS', target: 'businessUrl' },
      },
    ],
  },
  closing: {
    kicker: '06 / BRING YOUR SHOT INTO FOCUS',
    titleLead: '你负责看见镜头。',
    titleEmphasis: 'Nomi 负责让模型看懂。',
    download: '下载',
    github: 'GitHub',
    mascotAlt: 'Nomi 折纸吉祥物',
  },
  footer: {
    historical: '历史版本保留发布时的原始许可证',
    privacy: '无需网站账户 · Nomi 不把项目素材上传到自己的服务器',
    locale: 'English',
  },
  a11y: {
    filmTitle: 'Nomi 中文宣传片',
    closeFilm: '关闭宣传片',
    currentLocale: '当前语言：简体中文',
  },
}

const english = {
  path: '/en/',
  htmlLang: 'en',
  ogLocale: 'en_US',
  meta: {
    title: 'Nomi — Direct the shot. Not just the prompt.',
    description: 'An open-source, local-first AI video workbench that connects story, visual anchors, generation, and timeline—and lets AI assistants advance an editable first cut over MCP.',
    imageAlt: 'Nomi local-first AI video workbench',
  },
  nav: {
    ariaLabel: 'Primary navigation',
    product: 'Product',
    teams: 'For Teams',
    community: 'Community',
    docs: 'Docs',
    docsHref: 'https://github.com/aqm857886159/Nomi#quick-start',
    download: 'Download',
    localeLabel: 'Switch to Chinese',
  },
  hero: {
    eyebrow: 'LOCAL-FIRST · OPEN SOURCE · AI VIDEO WORKBENCH',
    titleLead: 'Direct the shot.',
    titleEmphasis: 'Not just the prompt.',
    lede: 'Keep the story, storyboard, visual anchors, generation canvas, and timeline in one connected context.',
    download: 'Download Nomi',
    watch: 'Watch the 60s film',
    monitorLabel: 'NOMI / DIRECTOR MONITOR',
    monitorTimecode: 'REC · 00:00:14:22',
    monitorCaption: 'See the whole sequence on one canvas instead of restarting from another prompt.',
    videoLabel: 'Silent preview of the Nomi generation canvas workflow',
    sequenceLabel: 'LOCAL-FIRST AI VIDEO WORKBENCH',
  },
  proofs: [
    {
      id: 'context',
      number: '01',
      chapter: 'CONTEXT CONNECTED',
      title: 'Connected context',
      description: 'Story, characters, storyboard, and generation evidence stay together. Every step knows what came before.',
      image: '/assets/screen-script.png',
      imageAlt: 'Nomi story and storyboard workspace',
      tags: ['STORY', 'STORYBOARD', 'MEMORY'],
    },
    {
      id: 'world',
      number: '02',
      chapter: 'LOCK THE WORLD FIRST',
      title: 'Lock the world first',
      description: 'Fix characters, locations, props, composition, and style first, so later shots inherit the same visual anchors.',
      image: '/assets/screen-3d.png',
      imageAlt: 'Character and camera staging in the Nomi 3D director stage',
      tags: ['CHARACTER', 'LOCATION', 'CAMERA'],
    },
    {
      id: 'canvas',
      number: '03',
      chapter: 'DIRECT ON CANVAS',
      title: 'Direct on canvas',
      description: 'Place media, draft prompts, and call generation tools while the full sequence remains in view.',
      image: '/assets/screen-canvas.png',
      imageAlt: 'Connected shots and visual references on the Nomi generation canvas',
      tags: ['PROMPTS', 'MEDIA', 'GENERATE'],
    },
    {
      id: 'agentic',
      number: '04',
      chapter: 'ONE SENTENCE TO A FIRST CUT',
      title: 'One sentence to an editable first cut',
      description: 'Let Claude Code or another AI assistant call Nomi over MCP and use Skills to build the project, storyboard the shot, connect references, and advance a first cut. You keep final control.',
      image: '/assets/screen-agentic.jpg',
      imageAlt: 'Real Nomi interface for connecting Claude Code, Codex, and Cursor',
      tags: ['CLAUDE CODE', 'NOMI MCP', 'SKILLS'],
    },
  ],
  paths: {
    titleLead: 'Open for creators.',
    titleEmphasis: 'Ready to fit a team.',
    description: 'One product, two honest paths: download the open-source workbench, or bring us into a real delivery.',
    open: {
      kicker: '01 / OPEN SOURCE',
      title: 'Open source for creators',
      description: 'Local-first and AGPL-3.0. Your projects and media stay on your computer; the workflow stays under your control.',
      actions: ['Download the desktop app', 'View the source', 'Read the docs'],
      download: 'Download Nomi',
    },
    teams: {
      kicker: '02 / FOR TEAMS',
      title: 'Make Nomi fit your product and delivery',
      description: 'For internal AI video workbenches, client projects, vertical workflows, and white-label products—from first validation through ongoing iteration. The public issue should contain only a non-confidential summary.',
      services: [
        { id: 'custom', title: 'Custom builds', code: 'CUSTOM' },
        { id: 'integration', title: 'System and model integrations', code: 'INTEGRATE' },
        { id: 'whiteLabel', title: 'White-label and commercial license', code: 'WHITE-LABEL' },
        { id: 'iteration', title: 'Ongoing optimization and iteration', code: 'ONGOING' },
      ],
      discuss: 'Discuss a project',
      wechat: 'WeChat contact',
      wechatLabel: 'Maintainer WeChat',
    },
  },
  community: {
    titleLead: 'Build with Nomi.',
    titleEmphasis: 'Help shape what comes next.',
    description: 'See real workflows, discuss friction, follow releases, and bring useful feedback directly into the next iteration.',
    contactLabel: 'Maintainer WeChat',
    cards: [
      {
        id: 'group',
        kicker: '01 / COMMUNITY',
        title: 'Join the Nomi community',
        description: 'Use GitHub Discussions for an open, international conversation. WeChat users can also open the Chinese group QR.',
        primary: { label: 'Open GitHub Discussions', code: 'DISCUSS', target: 'discussionUrl' },
        secondary: { label: 'Open the WeChat group QR', code: 'WECHAT GROUP', target: 'groupQr' },
      },
      {
        id: 'author',
        kicker: '02 / FOR TEAMS',
        title: 'Bring a real project',
        description: 'Discuss a custom build, integration, white-label delivery, commercial license, or ongoing iteration using non-confidential information.',
        primary: { label: 'Discuss a project', code: 'BUSINESS', target: 'businessUrl' },
        secondary: { label: 'Open the maintainer WeChat QR', code: 'WECHAT', target: 'authorQr' },
      },
    ],
  },
  closing: {
    kicker: '06 / BRING YOUR SHOT INTO FOCUS',
    titleLead: 'You see the shot.',
    titleEmphasis: 'Nomi helps the model see it.',
    download: 'Download',
    github: 'GitHub',
    mascotAlt: 'Nomi origami mascot',
  },
  footer: {
    historical: 'Historical releases keep the license they were published under',
    privacy: 'No website account · Nomi does not upload project media to its own servers',
    locale: '简体中文',
  },
  a11y: {
    filmTitle: 'Nomi English launch film',
    closeFilm: 'Close launch film',
    currentLocale: 'Current language: English',
  },
}

export const contentByLocale = Object.freeze({ 'zh-CN': zhCN, en: english })

function compareParity(left, right, path = '') {
  const location = path || 'root'
  if (typeof left === 'string' || typeof right === 'string') {
    if (typeof left !== 'string' || typeof right !== 'string' || !left.trim() || !right.trim()) {
      throw new Error(`Locale parity error at ${location}`)
    }
    return
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      throw new Error(`Locale parity error at ${location}`)
    }
    left.forEach((item, index) => compareParity(item, right[index], `${path}[${index}]`))
    return
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    if (left !== right) throw new Error(`Locale parity error at ${location}`)
    return
  }
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (leftKeys.join('\0') !== rightKeys.join('\0')) throw new Error(`Locale parity error at ${location}`)
  for (const key of leftKeys) compareParity(left[key], right[key], path ? `${path}.${key}` : key)
}

export function assertLocaleParity() {
  compareParity(zhCN, english)
  const proofIds = zhCN.proofs.map(({ id }) => id)
  const requiredProofIds = ['context', 'world', 'canvas', 'agentic']
  if (proofIds.join('\0') !== requiredProofIds.join('\0')) throw new Error('Locale parity error at proofs')
}
