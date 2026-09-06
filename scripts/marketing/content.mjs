export const locales = ['zh-CN', 'en']

export const shared = Object.freeze({
  siteUrl: 'https://nomiaqm.com',
  repositoryUrl: 'https://github.com/aqm857886159/Nomi',
  releaseUrl: 'https://github.com/aqm857886159/Nomi/releases/latest',
  businessUrl: 'https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml',
  discussionUrl: 'https://github.com/aqm857886159/Nomi/discussions',
  licenseName: 'AGPL-3.0-only',
  licenseUrl: 'https://www.gnu.org/licenses/agpl-3.0.html',
  wechatId: 'TZ857886159',
  groupQr: '/assets/group-wechat-2026-09-01.jpg',
  authorQr: '/assets/qingyang-wechat.jpg',
  quickstartUrl: '/quickstart',
  handbookUrl: '/handbook',
  mcpGuideUrl: 'https://github.com/aqm857886159/Nomi/blob/main/docs/guide/capability-core-cli-mcp.md',
})

const zhCN = {
  path: '/',
  htmlLang: 'zh-CN',
  ogLocale: 'zh_CN',
  meta: {
    title: 'Nomi — 把 AI 视频的成本打下来',
    description: '开源、本地优先的 AI 视频工作台。使用你已有的模型、会员、API 或本地 ComfyUI，从脚本、分镜、生成到剪辑，减少平台溢价、重复订阅、无效生成和重复劳动。',
    imageAlt: 'Nomi 开源、本地优先的低成本 AI 视频工作台',
  },
  nav: {
    ariaLabel: '主导航',
    why: '为什么省',
    workflow: '怎么做片',
    open: '开源',
    manual: '用户手册',
    community: '社群与项目',
    download: '下载 Nomi',
    menu: '菜单',
    locale: 'EN',
    localeLabel: '切换到英文',
  },
  hero: {
    titleLead: '把 AI 视频的成本，',
    titleEmphasis: '打下来。',
    lede: '模型、会员、API、ComfyUI，都用你自己的。Nomi 把脚本、分镜、生成、剪辑和 AI 助手放进一个开源工作台，不再为平台套餐、重复工具和低效试错多付一遍。',
    download: '下载 Nomi',
    github: '去 GitHub 参与改进 ↗',
    contribution: '项目还在快速迭代。遇到问题欢迎提 Issue，想一起改进可以提交 PR。',
    macNotice: 'macOS 安装包暂未签名或公证，首次打开可能被系统拦截。',
    macInstallHelp: '查看安全打开方法',
    truth: '生成仍会消耗你所选服务的额度；Nomi 减少平台溢价、重复订阅、无效生成和重复劳动。',
    ribbon: ['平台溢价', '重复订阅', '无效抽卡', '重复劳动'],
    imageAlt: 'Nomi 将角色参考、生成画布和视频时间线放在同一个项目中',
  },
  cost: {
    eyebrow: 'WHY IT COSTS LESS',
    title: '贵，不只贵在模型。',
    description: '真正烧钱的是同一种能力买两遍、没有参考地反复抽卡、在十个工具间搬运，以及每条片都从零重做。',
    tabsLabel: '成本维度',
    items: [
      {
        id: 'generation',
        label: '生成成本',
        index: '01 / GENERATION',
        title: '已有的能力，不用再买一遍。',
        description: '即梦高级会员、你熟悉的云端 API、本机 ComfyUI，都可以继续使用。哪个模型更合适，就把这一镜交给哪个模型。',
        proof: '结果：不再为了换工作台，重新购买同一类生成能力。',
        image: '/assets/screen-canvas-2026-08-17.png',
        imageAlt: 'Nomi 生成画布和模型接入工作流',
      },
      {
        id: 'trial',
        label: '试错成本',
        index: '02 / ITERATION',
        title: '少抽几次，就是少烧一次钱。',
        description: '角色、场景、道具、构图和风格作为视觉锚点留在项目里。后面的镜头继承同一组证据，而不是每次重新赌提示词。',
        proof: '结果：减少身份漂移、空间漂移和没有参考的无效生成。',
        image: '/assets/screen-3d-2026-08-17.png',
        imageAlt: 'Nomi 3D 导演台中的人物与镜头参考',
      },
      {
        id: 'labor',
        label: '人力成本',
        index: '03 / LABOR',
        title: '让 AI 助手做重复工作。',
        description: 'Codex、Claude Code、Cursor 通过 MCP 与 Skills 建项目、拆分镜、连参考、调用模型并推进初稿，你只在方向、预算和采用节点做决定。',
        proof: '结果：把时间留给判断与创作，而不是机械操作和素材搬运。',
        image: '/assets/screen-agentic-2026-08-17.png',
        imageAlt: 'Nomi 自动化与权限设置中的 AI 助手接入入口',
      },
      {
        id: 'lockin',
        label: '迁移成本',
        index: '04 / OWNERSHIP',
        title: '换模型，不用换家。',
        description: '项目、素材、提示词和密钥保存在自己的电脑上。供应商价格或效果变化时，替换生成能力，不需要抛弃整个项目。',
        proof: '结果：工作流留在手里，平台变化不再等于从零开始。',
        image: '/assets/screen-timeline-2026-08-17.png',
        imageAlt: '保存在本地的 Nomi 项目与时间线',
      },
    ],
  },
  stack: {
    eyebrow: 'BRING YOUR OWN STACK',
    titleLead: '不是再买一个模型。',
    titleEmphasis: '是把你已有的能力接起来。',
    description: 'Nomi 不和即梦、ComfyUI 或模型 API 竞争。它负责把这些生成能力组织成一条能编辑、能恢复、能交付的视频工作流。',
    rows: [
      { label: '生成引擎', items: ['即梦会员', '任意 API', '本地 ComfyUI'], result: '图片、视频、文本与声音' },
      { label: '生产工作台', items: ['Nomi 画布', '视觉锚点', '真实时间线'], result: '一版可以继续修改的初稿' },
      { label: 'AI 助手', items: ['Codex', 'Claude Code', 'Cursor'], result: '通过 MCP + Skills 真正开工' },
    ],
  },
  workflow: {
    eyebrow: 'ONE PROJECT · ONE CONTEXT',
    title: '从一句话，到一条能改的片。',
    tabsLabel: 'Nomi 工作流',
    steps: [
      {
        id: 'story',
        number: '01',
        label: '写与拆',
        image: '/assets/screen-script-2026-08-17.png',
        imageAlt: 'Nomi 故事与分镜工作区',
        caption: '故事、角色和镜头规划留在同一个项目里，后面的每一步都知道前面发生了什么。',
      },
      {
        id: 'anchor',
        number: '02',
        label: '锁参考',
        image: '/assets/screen-3d-2026-08-17.png',
        imageAlt: 'Nomi 3D 导演台与视觉参考',
        caption: '先锁定人物、场景、道具、机位和风格，再让后续镜头继承同一组视觉证据。',
      },
      {
        id: 'generate',
        number: '03',
        label: '跑生成',
        image: '/assets/screen-canvas-2026-08-17.png',
        imageAlt: 'Nomi 生成画布',
        caption: '把提示词、参考、生成结果和下一镜头放在同一张画布上，按任务选择不同模型。',
      },
      {
        id: 'edit',
        number: '04',
        label: '剪与交付',
        image: '/assets/screen-timeline-2026-08-17.png',
        imageAlt: 'Nomi 视频时间线',
        caption: '把满意结果放进真实时间线继续剪辑、预览和导出 MP4，而不是停在一堆散落素材。',
      },
    ],
  },
  agent: {
    eyebrow: 'MCP + SKILLS',
    titleLead: '让 AI 助手动手，',
    titleEmphasis: '不是只给建议。',
    description: 'Codex、Claude Code、Cursor 可以在 Nomi 里建立项目、拆分镜、连接参考、调用你配置的模型并推进初稿。',
    bullets: ['生成前看清模型和支出后果', '预算、采用和导出仍由你批准', '任务中断后可以恢复，不重复下单'],
    imageAlt: 'Nomi 自动化与权限设置中的 Claude Code、Codex 和 Cursor 接入入口',
  },
  openSource: {
    eyebrow: 'OPEN SOURCE IS THE BUSINESS MODEL',
    title: '源码在手里，成本才真的由你决定。',
    github: '查看 GitHub',
    license: '查看许可证',
    facts: [
      { label: '工作台', value: 'AGPL-3.0 开源' },
      { label: '项目与素材', value: '保存在本机' },
      { label: '模型与密钥', value: '由你选择和持有' },
      { label: '定制与部署', value: '按 AGPL 合规交付' },
    ],
  },
  start: {
    eyebrow: 'START WITH WHAT YOU HAVE',
    title: '三步，先跑出第一条片。',
    steps: [
      { number: '01', title: '下载桌面版', description: 'Windows 和 macOS 都有安装包，不需要 Docker 或数据库。' },
      { number: '02', title: '接入已有能力', description: '使用自己的 API、即梦高级会员或本地 ComfyUI，不必重新购买一套。' },
      { number: '03', title: '做一条 3–6 镜短片', description: '先跑通故事、分镜、参考、生成、时间线和 MP4 导出的完整闭环。' },
    ],
    quickstart: '打开新手指南',
    handbook: '一页上手',
    mcpGuide: 'MCP 指南',
  },
  community: {
    eyebrow: 'BUILD IN PUBLIC',
    title: '你遇到的摩擦，直接进入下一轮迭代。',
    description: '先让更多真实创作者用起来，再根据真实项目修产品。用户群负责反馈与交流；项目合作单独沟通，不混在一起。',
    group: {
      eyebrow: 'USER COMMUNITY',
      title: '加入 Nomi 用户群，一起把成本继续打下来。',
      description: '交流工作流、反馈问题、获取版本动态。群码失效时可以直接添加作者微信。',
      discussion: 'GitHub Discussions',
      qrAlt: 'Nomi 用户群微信二维码',
      qrCaption: '扫码加入 Nomi 用户群',
    },
    project: {
      eyebrow: 'FOR REAL PROJECTS',
      title: '有真实项目，直接聊清楚怎么落地。',
      description: '内部 AI 视频工作台、系统与模型集成、垂直流程、AGPL 合规部署和持续迭代。',
      wechat: '添加作者微信',
      submit: '提交项目需求',
    },
  },
  closing: {
    eyebrow: 'NOMI / OPEN-SOURCE AI VIDEO WORKBENCH',
    title: '把 AI 视频的成本，打下来。',
    description: '用你自己的模型和工作流，完成一条属于你、留在你电脑里、还能继续修改的片。',
    download: '下载 Nomi',
    community: '加入用户群',
  },
  footer: {
    product: 'Nomi · 本地优先 AI 视频工作台',
    truth: '开源不等于所有推理离线 · 外部模型仍按其服务规则收费',
    locale: 'English',
  },
  download: {
    title: '选择适合这台电脑的版本',
    description: '能识别系统时会直接下载；无法可靠判断 Mac 芯片时，请选择对应安装包。',
    windows: 'Windows x64',
    windowsHint: 'Windows 10 / 11 · .exe 安装包',
    macArm: 'Mac Apple 芯片',
    macArmHint: 'macOS 12+ · M1 / M2 / M3 / M4 · .dmg 安装包',
    macIntel: 'Mac Intel 芯片',
    macIntelHint: 'macOS 12+ · Intel 处理器 · .dmg 安装包',
    macGuideTitle: 'macOS 第一次打开',
    macGuideSummary: '当前 macOS 安装包未使用 Apple Developer ID 签名，也未经过 Apple 公证。请只使用本页或 Nomi GitHub 官方仓库的下载链接。',
    macSteps: [
      '下载对应的 DMG，把 Nomi 拖到“应用程序”。',
      '在 Finder 的“应用程序”中右键 Nomi，选择“打开”，再确认“打开”。',
      '如果仍被拦截，打开“系统设置” → “隐私与安全”，找到 Nomi 后点击“仍要打开”。',
    ],
    macDamaged: '仅当 macOS 提示 Nomi“已损坏”时：先确认安装包来自上述官方链接，再打开“终端”运行：',
    macCommand: 'xattr -dr com.apple.quarantine "/Applications/Nomi.app"',
    macSafety: '不需要、也不要全局关闭 Gatekeeper。',
  },
  a11y: {
    skip: '跳到主要内容',
    filmTitle: 'Nomi 真实工作流',
    close: '关闭',
    authorTitle: '添加作者微信',
    authorCopy: '微信号：TZ857886159。请简单说明项目、当前流程和最想降低的成本。',
    currentLocale: '当前语言：简体中文',
  },
}

const english = {
  path: '/en/',
  htmlLang: 'en',
  ogLocale: 'en_US',
  meta: {
    title: 'Nomi — Bring the cost of AI video down',
    description: 'Open-source, local-first AI video workbench. Bring your own models, APIs, or ComfyUI to script, storyboard, generate, edit, and export with less waste.',
    imageAlt: 'Nomi, an open-source local-first workbench for lower-cost AI video production',
  },
  nav: {
    ariaLabel: 'Primary navigation',
    why: 'Why it costs less',
    workflow: 'How it works',
    open: 'Open source',
    manual: 'User guide',
    community: 'Community & projects',
    download: 'Download Nomi',
    menu: 'Menu',
    locale: '中文',
    localeLabel: 'Switch to Chinese',
  },
  hero: {
    titleLead: 'Bring the cost of AI video',
    titleEmphasis: 'down.',
    lede: 'Use your own models, subscriptions, APIs, and ComfyUI. Nomi brings scripts, storyboards, generation, editing, and AI assistants into one open-source workbench, so you do not pay again for platform bundles, duplicate tools, and inefficient retries.',
    download: 'Download Nomi',
    github: 'Help improve it on GitHub ↗',
    contribution: 'Nomi is still evolving. Found a problem? Open an issue. Want to help shape it? Send a pull request.',
    macNotice: 'The macOS build is not yet signed or notarized, so macOS may block the first launch.',
    macInstallHelp: 'View safe opening steps',
    truth: 'Generation still uses the quota of your chosen service. Nomi reduces platform markup, duplicate subscriptions, wasted generations, and repetitive work.',
    ribbon: ['Platform markup', 'Duplicate tools', 'Wasted rerolls', 'Repetitive work'],
    imageAlt: 'Nomi keeps character references, the generation canvas, and video timeline in one project',
  },
  cost: {
    eyebrow: 'WHY IT COSTS LESS',
    title: 'The model is not the only expensive part.',
    description: 'Costs compound when you buy the same capability twice, reroll without references, move assets between ten tools, and rebuild every project from scratch.',
    tabsLabel: 'Cost dimensions',
    items: [
      {
        id: 'generation',
        label: 'Generation',
        index: '01 / GENERATION',
        title: 'Keep using what you already pay for.',
        description: 'Your Dreamina subscription, preferred cloud API, and local ComfyUI can all stay in the workflow. Send each shot to the model that fits it best.',
        proof: 'Result: switching workbenches does not mean buying the same generation capability again.',
        image: '/assets/screen-canvas-2026-08-17.png',
        imageAlt: 'Nomi generation canvas and model workflow',
      },
      {
        id: 'trial',
        label: 'Iteration',
        index: '02 / ITERATION',
        title: 'Every avoided reroll keeps money in your budget.',
        description: 'Characters, locations, props, composition, and style remain as visual anchors. Later shots inherit evidence instead of gambling on a fresh prompt.',
        proof: 'Result: fewer identity shifts, spatial jumps, and blind generations without references.',
        image: '/assets/screen-3d-2026-08-17.png',
        imageAlt: 'Character and camera references in the Nomi 3D director stage',
      },
      {
        id: 'labor',
        label: 'Labor',
        index: '03 / LABOR',
        title: 'Give repetitive production work to AI assistants.',
        description: 'Codex, Claude Code, and Cursor use MCP and Skills to create projects, break down shots, connect references, call models, and advance a first cut. You decide direction, budget, and what gets accepted.',
        proof: 'Result: spend time on judgment and creative direction, not mechanical setup and asset shuffling.',
        image: '/assets/screen-agentic-2026-08-17.png',
        imageAlt: 'AI assistant connection entry in Nomi automation and permission settings',
      },
      {
        id: 'lockin',
        label: 'Ownership',
        index: '04 / OWNERSHIP',
        title: 'Switch models without switching homes.',
        description: 'Projects, media, prompts, and keys stay on your computer. When a provider changes price or quality, replace the generation capability instead of abandoning the project.',
        proof: 'Result: you keep the workflow, so a platform change does not force a restart.',
        image: '/assets/screen-timeline-2026-08-17.png',
        imageAlt: 'A Nomi project and timeline stored on the local computer',
      },
    ],
  },
  stack: {
    eyebrow: 'BRING YOUR OWN STACK',
    titleLead: 'Do not buy another model.',
    titleEmphasis: 'Connect the capabilities you already have.',
    description: 'Nomi does not compete with Dreamina, ComfyUI, or model APIs. It organizes those capabilities into a video workflow you can edit, recover, and deliver.',
    rows: [
      { label: 'Generation', items: ['Dreamina', 'Any API', 'Local ComfyUI'], result: 'Image, video, text, and sound' },
      { label: 'Workbench', items: ['Nomi canvas', 'Visual anchors', 'Real timeline'], result: 'A first cut you can keep editing' },
      { label: 'AI assistants', items: ['Codex', 'Claude Code', 'Cursor'], result: 'Real work through MCP + Skills' },
    ],
  },
  workflow: {
    eyebrow: 'ONE PROJECT · ONE CONTEXT',
    title: 'From one sentence to a video you can still edit.',
    tabsLabel: 'Nomi workflow',
    steps: [
      {
        id: 'story',
        number: '01',
        label: 'Write & plan',
        image: '/assets/screen-script-2026-08-17.png',
        imageAlt: 'Nomi story and storyboard workspace',
        caption: 'Story, characters, and shot plans stay in one project, so every later step knows what came before.',
      },
      {
        id: 'anchor',
        number: '02',
        label: 'Lock references',
        image: '/assets/screen-3d-2026-08-17.png',
        imageAlt: 'Nomi 3D director stage and visual references',
        caption: 'Lock characters, locations, props, camera position, and style before later shots inherit the same evidence.',
      },
      {
        id: 'generate',
        number: '03',
        label: 'Run generation',
        image: '/assets/screen-canvas-2026-08-17.png',
        imageAlt: 'Nomi generation canvas',
        caption: 'Keep prompts, references, results, and the next shot on one canvas, then choose the right model for each task.',
      },
      {
        id: 'edit',
        number: '04',
        label: 'Edit & deliver',
        image: '/assets/screen-timeline-2026-08-17.png',
        imageAlt: 'Nomi video timeline',
        caption: 'Move accepted results into a real timeline for editing, preview, and MP4 export instead of stopping at scattered assets.',
      },
    ],
  },
  agent: {
    eyebrow: 'MCP + SKILLS',
    titleLead: 'Let AI assistants do the work,',
    titleEmphasis: 'not just suggest it.',
    description: 'Codex, Claude Code, and Cursor can create Nomi projects, break down shots, connect references, call your configured models, and advance an editable first cut.',
    bullets: ['See the model and spending consequence before generation', 'You still approve budgets, accepted results, and exports', 'Resume interrupted work without submitting the same order twice'],
    imageAlt: 'Claude Code, Codex, and Cursor connection entry in Nomi automation and permission settings',
  },
  openSource: {
    eyebrow: 'OPEN SOURCE IS THE BUSINESS MODEL',
    title: 'You control cost when you control the source.',
    github: 'View on GitHub',
    license: 'Read the license',
    facts: [
      { label: 'Workbench', value: 'AGPL-3.0 open source' },
      { label: 'Projects & media', value: 'Stored on your computer' },
      { label: 'Models & keys', value: 'Chosen and held by you' },
      { label: 'Custom & deployment', value: 'AGPL-compliant delivery' },
    ],
  },
  start: {
    eyebrow: 'START WITH WHAT YOU HAVE',
    title: 'Three steps to your first finished video.',
    steps: [
      { number: '01', title: 'Download the desktop app', description: 'Installers are available for Windows and macOS. No Docker or database required.' },
      { number: '02', title: 'Connect what you already use', description: 'Use your own APIs, Dreamina subscription, or local ComfyUI instead of buying another bundle.' },
      { number: '03', title: 'Make a 3–6 shot short', description: 'Complete the loop from story and references through generation, timeline editing, and MP4 export.' },
    ],
    quickstart: 'Quick start',
    handbook: 'Chinese handbook',
    mcpGuide: 'MCP guide',
  },
  community: {
    eyebrow: 'BUILD IN PUBLIC',
    title: 'Your friction goes straight into the next iteration.',
    description: 'Real creators use the product first, and real projects shape what gets fixed next. Community feedback and project work have separate paths.',
    group: {
      eyebrow: 'USER COMMUNITY',
      title: 'Join the Nomi community and keep pushing costs down.',
      description: 'Share workflows, report friction, and follow releases through GitHub Discussions. WeChat users can scan the group code directly.',
      discussion: 'GitHub Discussions',
      qrAlt: 'WeChat QR code for the Nomi user group',
      qrCaption: 'Scan to join the Nomi WeChat group',
    },
    project: {
      eyebrow: 'FOR REAL PROJECTS',
      title: 'Bring a real project and discuss how to ship it.',
      description: 'Internal AI video workbenches, model integrations, vertical workflows, AGPL-compliant deployment, and ongoing iteration.',
      wechat: 'Maintainer WeChat',
      submit: 'Submit project brief',
    },
  },
  closing: {
    eyebrow: 'NOMI / OPEN-SOURCE AI VIDEO WORKBENCH',
    title: 'Bring the cost of AI video down.',
    description: 'Use your own models and workflow to finish a video that stays on your computer and remains editable.',
    download: 'Download Nomi',
    community: 'Join the community',
  },
  footer: {
    product: 'Nomi · Local-first AI video workbench',
    truth: 'Open source does not mean every inference is offline · External models follow their own pricing and service terms',
    locale: '简体中文',
  },
  download: {
    title: 'Choose the version for this computer',
    description: 'Nomi downloads directly when the platform is known. If the Mac chip cannot be detected reliably, choose the matching installer.',
    windows: 'Windows x64',
    windowsHint: 'Windows 10 / 11 · .exe installer',
    macArm: 'Mac with Apple silicon',
    macArmHint: 'macOS 12+ · M1 / M2 / M3 / M4 · .dmg installer',
    macIntel: 'Mac with Intel',
    macIntelHint: 'macOS 12+ · Intel processor · .dmg installer',
    macGuideTitle: 'First launch on macOS',
    macGuideSummary: 'The current macOS build is not Apple Developer ID signed or notarized. Only use download links on this site or in the official Nomi GitHub repository.',
    macSteps: [
      'Download the matching DMG and drag Nomi to Applications.',
      'In Finder, right-click Nomi in Applications, choose Open, then confirm Open.',
      'If it is still blocked, open System Settings → Privacy & Security, find Nomi, and click Open Anyway.',
    ],
    macDamaged: 'Only if macOS says Nomi is “damaged”: confirm the installer came from an official link above, then open Terminal and run:',
    macCommand: 'xattr -dr com.apple.quarantine "/Applications/Nomi.app"',
    macSafety: 'You do not need to disable Gatekeeper globally, and should not do so.',
  },
  a11y: {
    skip: 'Skip to main content',
    filmTitle: 'The Nomi workflow',
    close: 'Close',
    authorTitle: 'Maintainer WeChat',
    authorCopy: 'WeChat ID: TZ857886159. Include a short description of the project, current workflow, and the cost you most want to reduce.',
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
  const costIds = zhCN.cost.items.map(({ id }) => id)
  const workflowIds = zhCN.workflow.steps.map(({ id }) => id)
  if (costIds.join('\0') !== ['generation', 'trial', 'labor', 'lockin'].join('\0')) {
    throw new Error('Locale parity error at cost.items')
  }
  if (workflowIds.join('\0') !== ['story', 'anchor', 'generate', 'edit'].join('\0')) {
    throw new Error('Locale parity error at workflow.steps')
  }
}
