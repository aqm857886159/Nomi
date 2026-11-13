export function productView(page, ctx) {
  const { t, state, esc } = ctx
  const img = (n) => '../../../../resources/onboarding-demo/shot-' + n + '.jpg'
  const button = (label, action, cls = 'btn', extra = '') =>
    `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`
  const go = (label, id, cls = 'btn') => button(label, 'go:' + id, cls)
  const tag = (label, tone = '') => `<span class="tag ${tone}">${label}</span>`
  const callout = (title, text = '', tone = '') =>
    `<div class="callout ${tone}"><strong>${title}</strong>${text ? `<p>${text}</p>` : ''}</div>`
  const field = (label, value) =>
    `<div class="field"><label>${label}</label><input class="input" value="${esc(value)}" readonly></div>`
  const costs = () =>
    `<p class="cost-line">${t('演示估价 0.12 Credits · 以实际账户与任务结算为准', 'Demo estimate: 0.12 Credits · actual account and task settlement apply')}</p>`
  const sourceMedia = (label, mask = false) =>
    `<div class="media"><img src="${img(8)}" alt="${t('Nomi 随包示例画面', 'Bundled Nomi example frame')}">${mask ? '<div class="mask" aria-label="Example selection"></div>' : ''}<span class="media-label">${label}</span></div>`
  const wave = () =>
    `<div class="wave" aria-label="${t('音频波形示意，不是实际音频', 'Illustrative waveform, not actual audio')}">${'<i></i>'.repeat(48)}</div>`
  const normalPrompt = t(
    '黄昏的屋顶上，小孩和修好的小机器人并肩看向夕阳。保持参考图的角色外观，暖金色光线，安静温柔的动画电影质感。',
    'On a rooftop at dusk, a child and a repaired little robot watch the sunset. Preserve the reference characters, warm golden light and a gentle animated-film feel.',
  )
  const prompt = state.prompt ?? normalPrompt
  const quoteUnavailable = state.prepared || state.resolution !== '1K' || state.model !== 'Nano Banana 2'

  function library() {
    return `<section class="library"><div class="row spread toolbar"><div class="row"><h3>${t('项目', 'Projects')}</h3><span class="muted">Skill</span><span class="muted">${t('提示词', 'Prompts')}</span></div>${go(t('＋ 新建项目', '＋ New project'), 'S07', 'btn small')}</div>
    <div class="recommend"><img src="${img(8)}" alt="${t('屋顶上的朋友 · 随包示例', 'Friends on the rooftop · bundled example')}"><div><span class="eyebrow">${t('从想法到第一份作品', 'FROM IDEA TO YOUR FIRST CREATION')}</span><h2>${t('图像、视频、声音，<br>一次连接开始创作。', 'Images, video and sound.<br>Start with one connection.')}</h2><p>${t('推荐 APIMart。Nomi 预置常用模型与对应参数，连接后就能在同一作品里继续做。', 'APIMart is recommended. Nomi prepares common models and settings so you can keep working in one project.')}</p><div class="row">${go(t('连接 APIMart →', 'Connect APIMart →'), 'S02', 'btn primary')}${go(t('先看示例', 'Explore example'), 'S07', 'link')}</div><div class="row" style="margin-top:10px">${button(t('价格与推荐依据', 'Pricing and recommendation'), 'why', 'link')}${go(t('使用已有连接', 'Use an existing connection'), 'S18', 'link')}</div><small>${t('通过推荐入口注册后的合资格充值可支持 Nomi 开发。', 'Eligible top-ups following referral registration can support Nomi development.')}</small></div></div>
    <div class="row spread"><h3>${t('从一个故事开始', 'Start with a story')}</h3><span class="muted small">${t('随包示例', 'Bundled examples')}</span></div><div class="project-grid">${[8, 4].map((n, i) => `<button class="project" data-action="go:S07"><img src="${img(n)}" alt=""><strong>${i ? t('修好一个小机器人', 'Fixing a little robot') : t('屋顶上的朋友', 'Friends on the rooftop')}</strong><small>${t('草稿 · 参考素材已准备', 'Draft · references prepared')}</small></button>`).join('')}</div></section>`
  }

  function canvas() {
    const isResult = page.id === 'S12'
    const isTask = page.id === 'S10' || page.id === 'S11'
    const connected = state.connected
    const h3 = page.id === 'S12' && state.variant === 'h3'
    const media = isTask
      ? task()
      : isResult
        ? sourceMedia(t('随包示例 · 结果位置示意', 'Bundled example · result placement'))
        : `<div class="media"><div class="empty"><b>▧</b>${state.prepared ? t('派生结果会出现在这里', 'The derived result will appear here') : t('你的第一张画面，会出现在这里', 'Your first image will appear here')}<p class="small">${t('参考图与提示词已经准备好', 'Your reference and prompt are ready')}</p></div></div>`
    return `<section class="canvas"><div class="row spread canvas-bar"><span class="muted">${t('生成画布 / 屋顶上的朋友', 'Generation canvas / Friends on the rooftop')}</span>${go(connected ? 'APIMart · 18.40 Credits' : t('连接模型', 'Connect models'), connected ? 'S17' : 'S02', 'btn small')}</div><div class="canvas-nodes"><aside class="source"><span class="small">${state.prepared ? t('来源素材', 'Source asset') : t('角色参考', 'Character reference')}</span>${state.prepared === 'S16' ? wave() : `<img src="${img(state.prepared ? 8 : 4)}" alt="${t('角色参考示例', 'Example character reference')}">`}<p>${t('原图在本机<br>后续操作沿用这份素材', 'Original saved locally<br>Reuse it for the next step')}</p></aside><div class="node"><div class="node-label">${state.prepared ? t('已准备 · ', 'Prepared · ') + esc(state.job) : h3 ? t('屋顶黄昏 · H3 视频', 'Rooftop at dusk · H3 video') : t('屋顶黄昏 · 分镜图', 'Rooftop at dusk · storyboard')}${tag(isResult ? t('结果示意', 'Demo result') : isTask ? t('状态示意', 'Demo state') : t('草稿', 'Draft'), isResult ? 'good' : '')}</div>${media}
    ${isResult ? resultInfo(h3) : isTask ? '' : `<div class="composer"><textarea id="prompt" ${state.prepared ? 'readonly' : ''} aria-label="${t('提示词', 'Prompt')}">${esc(state.prepared ? state.preparedPrompt : prompt)}</textarea><div class="controls">${state.prepared ? `<span class="tag">${esc(state.job)}</span><span class="tag">${state.prepared === 'S13' ? t('2K · 继承源时长', '2K · source duration') : state.prepared === 'S14' ? '1K · PNG · mask' : state.prepared === 'S15' ? '720p · adaptive · ' + state.preparedVariant : state.prepared === 'S16' ? 'Flow Music · ' + state.preparedVariant : '720p · 8s · first frame'}</span>` : `${go(state.model, 'S08', 'btn small')}<select id="resolution" aria-label="${t('清晰度', 'Resolution')}"><option>1K</option><option ${state.resolution === '2K' ? 'selected' : ''}>2K</option></select><span class="tag">16:9</span><span class="small">${t('1 张', '1 image')}</span>`}${button(connected ? t('生成 · 演示', 'Generate · demo') : t('连接后生成', 'Connect to generate'), connected ? 'submit' : 'go:S02', 'btn primary small')}</div>${quoteUnavailable ? `<p class="cost-line">${t('本规格报价暂缺。先查看价格再确认。', 'Quote unavailable for this setting. Review pricing first.')}</p>` : costs()}</div><div class="node-actions">${go(t('查看费用依据', 'Pricing details'), 'S09', 'link')}${button(t('提示词与素材会保留', 'Prompt and assets are preserved'), 'draft-note', 'link')}</div>`}
    </div></div></section>`
  }

  function task() {
    if (page.id === 'S10')
      return `<div class="media"><div class="task-box"><span class="eyebrow">APIMart · ${esc(state.job)}</span><h3>${state.variant === 'pending' ? t('任务已提交，正在排队', 'Submitted and queued') : t('正在生成这一个镜头', 'Generating this shot')}</h3>${state.variant === 'processing' ? '<progress max="100" value="64"></progress>' : ''}<p>${t('可以继续编辑其他内容，结果会回到这里。', 'You can edit other content. The result will return here.')}</p><p class="small">${t('进度为固定演示快照，不代表真实请求', 'Progress is a fixed demo snapshot, not a live request')}</p></div></div><div class="node-actions">${button(t('稍后再看', 'Check later'), 'observe-later', 'link')}${go(t('查看中断恢复设计', 'Inspect recovery design'), 'S11', 'link')}</div>`
    const type = state.variant
    const labels =
      type === 'unknown'
        ? [
            t('提交结果还不能确认', 'Submission outcome is uncertain'),
            t('先核对原请求。不要重复提交新的生成任务。', 'Reconcile the original request before creating another.'),
            t('核对原请求', 'Reconcile original request'),
          ]
        : type === 'download'
          ? [
              t('结果已生成，下载尚未完成', 'Generated; download incomplete'),
              t('保留原结果，继续下载这一份文件。', 'Keep the result and resume downloading this file.'),
              t('重新下载原结果', 'Download original result'),
            ]
          : [
              t('暂时无法取得最新进度', 'Latest progress is unavailable'),
              t('任务身份已保留，可以重新查询原任务。', 'The task identity is saved. Query the original task again.'),
              t('重新取回原任务', 'Retrieve original task'),
            ]
    return `<div class="media"><div class="task-box"><h3>${labels[0]}</h3><p>${labels[1]}</p><div class="row" style="justify-content:center;margin-top:20px">${button(labels[2], type === 'unknown' ? 'uncertain' : 'recover', 'btn primary')}</div></div></div><div class="result-info">${t('当前动作不会创建新的生成任务。真实结算状态以原任务记录为准。', 'This action does not create a new generation. Settlement follows the original task record.')}</div>`
  }

  function resultInfo(h3) {
    return `<div class="result-info"><div class="row spread"><strong>${t('已保存到项目 · 演示', 'Saved to project · demo')}</strong><span>${t('实际费用示意', 'Example actual cost')} · 0.12 Credits</span></div><p class="muted">${t('来源记录保留当前模型、规格、任务身份与费用。', 'Provenance keeps the model, settings, task identity and charge.')}</p></div>${state.variant === 'partial' ? callout(t('已取得 1 张，另 1 张未交付', '1 image received; 1 not delivered'), t('保留已成功的结果，先核对原任务与结算。', 'Keep the successful result and reconcile the original task.'), 'warn') : ''}<div class="node-actions">${h3 ? go(t('准备 2K 版本', 'Prepare a 2K version'), 'S13', 'btn primary small') : go(t('局部修改', 'Edit a region'), 'S14', 'btn primary small')}${h3 ? go(t('修改 / 续拍', 'Edit / extend'), 'S15', 'btn small') : button(t('用这张图做视频', 'Use as video first frame'), 'image-video', 'btn small')}${button(t('查看来源详情', 'View provenance'), 'provenance', 'link')}</div><p class="help">${t('继续操作先准备新草稿，原结果不变。', 'Next actions prepare a new draft and preserve this result.')}</p>`
  }

  function settings(inner, footer) {
    return `<div class="scrim"><section class="settings" aria-label="${t('模型设置设计', 'Model settings design')}"><aside class="settings-sidebar"><h3>${t('设置', 'Settings')}</h3>${[
      ['文件', 'Files'],
      ['模型', 'Models'],
      ['AI 策略', 'AI policy'],
      ['自动化', 'Automation'],
      ['通用', 'General'],
      ['关于', 'About'],
    ]
      .map((x, i) => `<div class="${i === 1 ? 'selected' : ''}">${t(...x)}</div>`)
      .join(
        '',
      )}</aside><div class="settings-main"><header class="settings-head">${t('模型 / APIMart', 'Models / APIMart')}${button('×', 'return', '', `aria-label="${t('关闭设置', 'Close settings')}"`)}</header><div class="settings-scroll">${inner}</div><footer class="settings-footer"><span>${t('原作品仍保留在背后', 'Your project stays behind this panel')}</span>${footer}</footer></div></section></div>`
  }

  function connect() {
    return settings(
      `<div class="row spread"><h2>${t('连接 APIMart', 'Connect APIMart')}</h2>${tag(t('推荐', 'Recommended'))}</div><p class="intro">${t('常用模型和参数已经准备好。带上你自己的 Key，就可以继续创作。', 'Common models and settings are prepared. Bring your own key to continue.')}</p><div class="step"><span class="step-num">1</span><div class="step-content"><h4>${t('去官方账户创建 Key', 'Create a key on APIMart')}</h4><p>${t('在浏览器中完成注册或登录，再进入 API Key。', 'Register or sign in in your browser, then open API Key.')}</p><div class="row">${go(t('注册并获取 Key ↗', 'Register and get a key ↗'), 'S03', 'btn small')}${go(t('已有账户，直接拿 Key', 'Already registered? Get a key'), 'S03', 'link')}</div></div></div><div class="step"><span class="step-num">2</span><div class="step-content"><label for="demo-key">${t('回到这里，粘贴一次', 'Return here and paste once')}</label><input id="demo-key" class="input" type="password" readonly value="${state.demoKey ? 'DEMO-ONLY' : ''}" placeholder="${t('原型不接收真实 Key', 'Prototype does not accept real keys')}"><div class="row" style="margin-top:8px">${button(t('填入演示 Key', 'Use demo key'), 'demo-key', 'link')}<small class="muted">${t('仅演示交互', 'Interaction demo only')}</small></div></div></div><div class="row">${button(t('先保存，稍后检查', 'Save and check later'), 'save-pending', 'link', state.demoKey ? '' : 'disabled')}${go(t('地址与高级连接', 'Endpoint and advanced setup'), 'S18', 'link')}${button(t('为什么推荐', 'Why recommended'), 'why', 'link')}</div>`,
      button(t('连接并检查 →', 'Connect and check →'), 'check', 'btn primary', state.demoKey ? '' : 'disabled'),
    )
  }

  function checks() {
    const partial = state.variant === 'partial'
    return settings(
      `<h2>${t('正在检查连接', 'Checking your connection')}</h2><p class="intro">${t('检查通过后，直接回到刚才的作品。', 'Return directly to your draft after the checks.')}</p><div class="check-list">${[
        [t('Key 身份', 'Key identity'), '✓', t('已通过', 'Passed')],
        [t('此 Key 可用额度', 'Key quota'), '✓', t('不限额', 'Unlimited')],
        [
          t('账户余额', 'Account funds'),
          partial ? '!' : '✓',
          partial ? t('暂时取不到', 'Unavailable') : t('已读取', 'Read'),
        ],
        [t('适配模型目录', 'Supported model catalog'), '◷', t('正在读取', 'Loading')],
      ]
        .map(
          (x) =>
            `<div class="check-row"><span>${x[1]}</span><span>${x[0]}</span><span class="status">${x[2]}</span></div>`,
        )
        .join(
          '',
        )}</div>${partial ? callout(t('余额暂时无法读取', 'Balance is temporarily unavailable'), t('连接检查与余额是不同状态。保留连接，稍后刷新。', 'Connection and balance are separate. Keep the connection and refresh later.'), 'warn') : callout(t('连接自检不等于模型试跑', 'A connection check is not a model trial'), t('真正生成将在你确认当前作品后进行。', 'A generation starts only when you confirm your draft.'))}`,
      button(t('检查中…', 'Checking…'), 'none', 'btn primary', 'disabled'),
    )
  }

  function connectionError() {
    const type = state.variant
    const text =
      type === 'saved'
        ? [
            t('Key 已保存，等待检查', 'Key saved; check pending'),
            t(
              '不需要重新去官网复制。网络恢复后，直接检查这份已保存的连接。',
              'No need to copy the key again. Check the saved connection when the network is available.',
            ),
            t('重新检查已保存的连接', 'Check saved connection'),
            'S04',
          ]
        : type === 'network'
          ? [
              t('模型接口暂时连不上', 'The model API is unreachable'),
              t(
                '网页能打开，不代表接口或素材下载可达。先检查地址与网络，原连接不变。',
                'Website access does not prove API or media access. Check the endpoint and network; keep the existing connection.',
              ),
              t('检查地址与网络', 'Check endpoint and network'),
              'S18',
            ]
          : type === 'models'
            ? [
                t('连接正常，当前任务没有匹配模型', 'Connected; no model matches this task'),
                t(
                  '这把 Key 可见的模型与 Nomi 已适配模式还没有交集。可以切换任务或使用其他连接。',
                  "This key has no model matching Nomi's supported modes for this task. Change the task or connection.",
                ),
                t('查看已有连接', 'View connections'),
                'S18',
              ]
            : [
                t('这把 Key 未通过检查', 'This key did not pass the check'),
                t(
                  '确认复制完整、仍然有效。已保存的旧连接不会被这次失败覆盖。',
                  'Check that it is complete and active. This failure does not replace an existing connection.',
                ),
                t('返回修改 Key', 'Edit the key'),
                'S02',
              ]
    return settings(
      `<h2>${text[0]}</h2><p class="intro">${text[1]}</p>${callout(t('提示词、素材和参数仍在', 'Prompt, assets and settings are preserved'), t('处理好后继续原操作。', 'Continue where you left off after resolving this.'), 'warn')}<div class="check-list"><div class="check-row">${t('账户资金', 'Account funds')}<span class="status">${t('未读取', 'Not read')}</span></div><div class="check-row">${t('生成任务', 'Generation task')}<span class="status">${t('尚未提交', 'Not submitted')}</span></div></div>${go(t('保留草稿，先返回', 'Return to the draft'), 'S07', 'link')}`,
      go(text[2], text[3], 'btn primary'),
    )
  }

  function balance(usage = false) {
    const pending = !usage && state.variant === 'pending',
      quota = !usage && state.variant === 'quota',
      stale = usage && state.variant === 'stale'
    const amount = usage || quota ? '18.40' : '0.00'
    return settings(
      `<div class="row spread"><h2>APIMart</h2>${tag(t('演示账户', 'Demo account'))}</div><span class="small muted">${t('账户余额', 'Account funds')}</span><div class="balance">${amount}<small>Credits</small></div><dl class="definition"><dt>${t('此 Key 可用额度', 'Key quota')}</dt><dd>${quota ? '0 Credits' : t('不限额', 'Unlimited')}</dd><dt>${t('更新时间', 'Updated')}</dt><dd>${stale ? t('上次记录 · 刷新失败', 'Last snapshot · refresh failed') : t('刚刚 · 演示', 'Just now · demo')}</dd></dl>
    ${usage ? (stale ? callout(t('保留上次记录', 'Last snapshot retained'), t('当前资金未知，重新刷新后再判断。', 'Current funds are unknown. Refresh before deciding.'), 'warn') : `<div class="row spread"><strong>${state.variant === 'account' ? t('账户近 7 天用量', 'Account usage · 7 days') : t('此 Key 近 7 天用量', 'Key usage · 7 days')}</strong>${button(t('刷新', 'Refresh'), 'refresh', 'link')}</div><div class="mini-chart" aria-label="${t('虚构用量示意', 'Fictional usage illustration')}">${[28, 40, 24, 60, 35, 48, 42].map((n) => `<span style="height:${n}px"></span>`).join('')}</div><div class="usage-row"><span>${t('图像与视频', 'Images and video')}</span><span>4.80 Credits</span></div><p class="help">${t('演示数据。统计可能包含其他工具的消费，不是这份作品的账单。', "Demo data. Usage may include other apps; this is not the project's bill.")}</p>`) : callout(quota ? t('账户有资金，Key 额度不足', 'Account funded; key quota too low') : pending ? t('先核对原订单', 'Check the original order first') : t('连接好了，账户余额不足', 'Connected; account funds are low'), quota ? t('请调整这把 Key 的限额，再充值不能解除这个限制。', "Adjust this key's quota. Another top-up does not remove the limit.") : pending ? t('关闭支付页不代表到账。确认浏览器账户与这把 Key 一致，再核对原付款记录。', 'Closing checkout does not confirm funds. Check the browser account and original payment.') : t('作品保留在原位置，充值后回来刷新余额。', 'Your draft stays in place. Return after topping up and refresh.'), 'warn')}
    <div class="row" style="margin-top:16px">${button(quota ? t('管理 Key ↗', 'Manage key ↗') : pending ? t('核对官方账单 ↗', 'Check official billing ↗') : t('前往官方充值 ↗', 'Top up on APIMart ↗'), 'official', 'btn small')}${go(t('管理连接', 'Manage connection'), 'S18', 'link')}</div><p class="help">${t('活动与支付方式以官网为准，未确认的专属优惠不展示。', 'Offers and payment methods follow the website. Unconfirmed exclusive offers are not shown.')}</p>`,
      usage
        ? go(t('回到作品', 'Return to project'), 'S07', 'btn primary')
        : button(t('刷新余额', 'Refresh balance'), 'refresh', 'btn primary'),
    )
  }

  function external() {
    return `<div class="external"><span class="eyebrow">${t('交接示意 · 这里属于系统浏览器', 'HANDOFF ILLUSTRATION · SYSTEM BROWSER')}</span><div class="address">apimart.ai → API Key</div><h2>${t('完成这三步，再回到 Nomi', 'Complete these steps, then return')}</h2><ol><li>${t('注册或登录你准备使用的账户', 'Register or sign in to the account you want to use')}</li><li>${t('进入 API Key，创建一把给 Nomi 用的 Key', 'Open API Key and create a key for Nomi')}</li><li>${t('复制 Key，切回 Nomi 粘贴', 'Copy the key, switch back to Nomi and paste')}</li></ol>${callout(t('作品与接入窗口仍在原位置', 'Your project and setup window stay in place'), t('这是交接示意，不是登录表单；原型不打开付款或收集凭据。', 'This is a handoff illustration, not a login form. The prototype does not open checkout or collect credentials.'))}<div class="row" style="margin-top:20px">${button(t('演示：已复制，返回 Nomi', 'Demo: copied, return to Nomi'), 'copied', 'btn primary')}${go(t('返回指引', 'Back to the guide'), 'S02', 'link')}</div></div>`
  }

  function picker() {
    return `<div class="scrim"><section class="popover"><div class="row spread"><h3>${t('选择图像模型', 'Choose an image model')}</h3>${go('×', 'S07', 'link')}</div><p class="small muted">${t('当前 Key 可见 · Nomi 已适配 · 首次生成仍需试跑', 'Visible to this key · supported in Nomi · first use still needs a trial')}</p>${[
      ['Nano Banana 2', t('角色参考与分镜起稿', 'Character references and storyboards')],
      ['GPT Image 2 · official', t('局部编辑与透明格式', 'Region editing and transparent formats')],
      ['Seedream', t('多参考图与画面变化', 'Multiple references and variations')],
    ]
      .map(
        (x, i) =>
          `<button class="model-row" data-action="model:${i}"><div><strong>${x[0]}</strong><p>${x[1]}</p></div>${tag(i === 0 ? t('当前', 'Current') : t('未试跑', 'Not tried'))}</button>`,
      )
      .join(
        '',
      )}<p class="help">${t('目录更新不会改变历史任务；不支持的规格不会出现在生成参数里。', 'Catalog updates do not alter past tasks. Unsupported settings stay out of the composer.')}</p>${go(t('管理全部连接与模型', 'Manage connections and models'), 'S18', 'link')}</section></div>`
  }

  function quote() {
    const unknown = state.variant === 'unknown' || quoteUnavailable
    const quoteModel = state.prepared ? state.job : state.model
    return `<div class="scrim"><section class="popover"><div class="row spread"><h3>${t('这次生成的费用', 'Cost of this generation')}</h3>${go('×', 'S07', 'link')}</div><p class="muted small">${esc(quoteModel)} · ${state.prepared ? t('派生规格 · 报价待取得', 'Derived settings · quote pending') : state.resolution + ' · 16:9 · ' + t('1 张', '1 image')}</p><dl class="definition"><dt>${t('参考估价 · 示例', 'Reference estimate · demo')}</dt><dd>${unknown ? t('暂未取得', 'Unavailable') : '0.12 Credits'}</dd><dt>${t('计费方式', 'Billing basis')}</dt><dd>${state.prepared ? t('按当前派生模式核对', 'Confirm for this derived mode') : t('按张 · 当前规格', 'Per image · current settings')}</dd><dt>${t('价格范围', 'Price scope')}</dt><dd>${t('公开分组参考', 'Public group reference')}</dd><dt>${t('更新时间', 'Updated')}</dt><dd>${unknown ? t('无有效报价', 'No valid quote') : t('演示快照', 'Demo snapshot')}</dd></dl>${callout(unknown ? t('先取得当前规格的价格', 'Get a quote for these settings first') : t('最终费用按任务结果显示', 'Final cost follows the task result'), unknown ? t('可以刷新、查看官方价格，或换一个已有报价的模式。', 'Refresh, check official pricing or choose a mode with a known quote.') : t('账户分组、素材与附加项可能影响结算。参考估价不是个人账户的保证价格。', 'Account group, references and extras may affect settlement. This estimate is not a guaranteed account price.'), unknown ? 'warn' : '')}<div class="row" style="margin-top:16px">${unknown ? button(t('重新获取报价', 'Refresh quote'), 'quote-refresh', 'btn primary') : go(t('回到原稿确认', 'Return to draft'), 'S07', 'btn primary')}${button(t('查看价格依据', 'View pricing source'), 'price-source', 'link')}</div></section></div>`
  }

  function edit(kind) {
    const isH3 = kind === 'S13',
      region = kind === 'S14',
      video = kind === 'S15',
      audio = kind === 'S16'
    const unavailable = (isH3 && state.variant === 'unavailable') || (video && state.variant === 'upload')
    const title = isH3
      ? t('准备 2K 版本', 'Prepare a 2K version')
      : region
        ? t('局部修改图片', 'Edit an image region')
        : video
          ? t('修改 / 续拍视频', 'Edit / extend video')
          : t('处理这段配乐', 'Work with this music')
    const source = isH3 ? 'H3 · 768P · 8s' : region ? 'GPT Image 2 · official' : video ? 'Seedance 2.5' : 'Flow Music'
    const media = audio
      ? wave()
      : sourceMedia(
          isH3
            ? t('原 H3 视频 · 示例封面', 'Source H3 video · example poster')
            : video
              ? t('原视频 · 示例封面', 'Source video · example poster')
              : t('原图保留', 'Source preserved'),
          region && state.variant === 'selected',
        )
    const importState = audio && ['importing', 'import-failed', 'imported'].includes(state.variant)
    const modes =
      audio && !importState
        ? [
            ['stems', '分离音轨', 'Separate stems'],
            ['extend', '延长', 'Extend'],
            ['replace', '替换片段', 'Replace section'],
          ]
        : video
          ? [
              ['edit', '修改视频', 'Edit video'],
              ['extend', '继续拍摄', 'Extend video'],
            ]
          : []
    let controls = ''
    if (isH3)
      controls = `<dl class="definition"><dt>${t('输出版本', 'Output version')}</dt><dd>2K</dd><dt>${t('源内容', 'Source content')}</dt><dd>${t('继承提示词、素材与时长', 'Inherit prompt, assets and duration')}</dd></dl>${callout(t('不需要重新上传或填写任务编号', 'No re-upload or manual task ID'), t('仅适用于同账号已完成的 H3 768P 源任务。', 'Only eligible completed H3 768P tasks from the same account.'))}`
    if (region)
      controls = `<div class="row" style="margin-top:12px">${button(state.variant === 'selected' ? t('清除选区', 'Clear selection') : t('选择示例区域', 'Select example region'), 'mask', 'btn small')}<span class="small muted">${t('选区按原图尺寸保存', 'Selection is stored in source-image coordinates')}</span></div><textarea id="edit-prompt" aria-label="${t('局部修改描述', 'Region edit instruction')}">${esc(state.editPrompt || t('把选中的天空改成更深的橙色晚霞，保留温暖的黄昏光线。', 'Make the selected sky a deeper orange sunset; preserve the warm dusk lighting.'))}</textarea>`
    if (video)
      controls = `<textarea id="edit-prompt" aria-label="${t('视频编辑描述', 'Video edit instruction')}">${esc(state.editPrompt || (state.variant === 'extend' ? t('继续这段视频：镜头缓缓拉远，两人看向晚霞。', 'Extend this video: slowly pull the camera back as they watch the sunset.') : t('修改这段视频：把天空改为更深的橙色，保留角色动作。', 'Edit this video: make the sky a deeper orange and preserve character motion.')))}</textarea><div class="fields">${field(t('画幅', 'Aspect'), t('跟随原视频', 'Follow source'))}${field(t('时长', 'Duration'), state.variant === 'extend' ? t('按续拍模式确认', 'Confirm for extension') : t('跟随源片段', 'Follow source'))}</div>${callout(t('确认预计费用和预扣上限', 'Review the estimate and preauthorization'), t('编辑模式可能先按最长输出预扣，完成后按实际结果结算。当前示例未取得该规格报价。', 'Editing may reserve for the maximum output before final settlement. This demo has no quote for these settings.'), 'warn')}`
    if (audio)
      controls = importState
        ? callout(
            state.variant === 'imported'
              ? t('人声与伴奏已加入项目', 'Vocals and accompaniment added')
              : state.variant === 'import-failed'
                ? t('分轨已完成，导入未完成', 'Separation completed; import incomplete')
                : t('音轨包已保存，正在导入', 'Stem archive saved; importing'),
            t(
              '保留原任务、源音乐与音轨包。导入失败只处理原包，不重新分轨。',
              'Keep the task, source music and archive. Retry importing the same archive, not separation.',
            ),
            state.variant === 'import-failed' ? 'warn' : 'good',
          )
        : state.variant === 'stems'
          ? callout(
              t('人声与伴奏分别交付', 'Vocals and accompaniment'),
              t(
                '平台返回一个音轨压缩包。Nomi 先保存并校验，再把可识别音轨加入项目。',
                'The platform returns a stem archive. Nomi saves and validates it before adding recognized audio tracks.',
              ),
            )
          : `<div class="fields">${state.variant === 'extend' ? field(t('从此处续写', 'Extend from'), '00:30') + field(t('延长时长', 'Extension length'), '00:30') : field(t('开始', 'Start'), '00:10') + field(t('结束', 'End'), '00:20')}</div><textarea id="edit-prompt" aria-label="${t('音乐修改描述', 'Music instruction')}">${esc(state.editPrompt || t('保留原曲情绪，使用更轻的钢琴与弦乐。', 'Keep the mood and use lighter piano and strings.'))}</textarea>`
    return `<section class="editor"><header class="editor-head"><h3>${title}</h3>${go(t('回到源结果', 'Back to source'), 'S12', 'link')}</header><div class="editor-body">${media}<div class="metadata"><strong>${source}</strong><span>${importState ? t('原任务结果 · 源音乐保留', 'Original task result · source music preserved') : t('新派生草稿 · 原结果不变', 'New derived draft · source unchanged')}</span></div>${modes.length ? `<div class="segmented">${modes.map((x) => button(t(x[1], x[2]), 'variant:' + x[0], state.variant === x[0] ? 'active' : '')).join('')}</div>` : ''}${controls}${unavailable ? callout(t('这一步暂时无法继续', 'This step is unavailable'), isH3 ? t('当前来源不满足 H3 2K 条件。保留原结果，返回源作品检查。', 'This source is not eligible for H3 2K. Keep the result and check the source project.') : t('当前连接没有可用的视频上传方式。先配置素材运输，草稿不会丢失。', 'This connection has no usable video upload route. Configure transport; the draft is preserved.'), 'warn') : ''}</div><footer class="editor-footer"><span class="muted">${importState ? t('仅处理原音轨包，不再次分轨', 'Process the original archive; no new separation') : t('先准备，报价确认后再生成', 'Prepare first; review pricing before generating')}</span>${importState ? button(state.variant === 'import-failed' ? t('重试导入原包', 'Retry original archive import') : t('查看源任务', 'View source task'), 'archive-import', 'btn') : unavailable ? go(t('查看连接与来源', 'Check connection and source'), isH3 ? 'S12' : 'S18', 'btn') : button(t('准备生成草稿 →', 'Prepare generation draft →'), 'prepare:' + kind, 'btn primary', region && state.variant === 'empty' ? 'disabled' : '')}</footer></section>`
  }

  function advanced() {
    const rows = [
      ['APIMart · 主连接', 'APIMart · Primary', '地址 / Key / 代理', 'Endpoint / key / proxy'],
      ['APIMart · 第二个账户', 'APIMart · Second account', '独立保存，不覆盖其他连接', 'Stored independently'],
      [
        '已有其他平台 / 本地模型',
        'Other providers / local models',
        '保留原模型和历史任务',
        'Keep models and past tasks',
      ],
      [
        '模型库与高级接入',
        'Model catalog and advanced setup',
        '搜索、手工添加、契约与脚本',
        'Search, manual entries, contracts and scripts',
      ],
      [
        '导入 / 导出配置',
        'Import / export configuration',
        '导出不包含密钥，冲突由用户确认',
        'Exports exclude keys; conflicts need confirmation',
      ],
      [
        '网络诊断 / 外部助手',
        'Network / external assistants',
        '保留各自设置与真实连接状态',
        'Keep their settings and actual connection states',
      ],
    ]
    return settings(
      `<h2>${t('我的模型连接', 'My model connections')}</h2><p class="intro">${t('推荐入口与已有连接共用这一处设置。', 'Recommended and existing connections share these settings.')}</p>${rows.map((x) => `<button class="advanced-row" data-action="advanced"><div><strong>${t(x[0], x[1])}</strong><small>${t(x[2], x[3])}</small></div><span>→</span></button>`).join('')}<div class="row" style="margin-top:16px">${button(t('添加其他平台 / 本地连接', 'Add another provider / local connection'), 'advanced', 'link')}</div>`,
      go(t('返回作品', 'Return to project'), 'S07', 'btn primary'),
    )
  }

  function overlay() {
    if (!state.overlay) return ''
    const price = state.overlay === 'price'
    return `<div class="scrim"><section class="popover"><div class="row spread"><h3>${price ? t('价格展示规则', 'How prices are shown') : t('为什么推荐 APIMart', 'Why APIMart')}</h3>${button('×', 'close-overlay', 'link')}</div><div class="stack">${price ? `<p>${t('只比较同模型、渠道能力、规格和计费单位。公开报价标注来源与时间，账户优惠以真实资格为准。', 'Compare identical models, channel capabilities, settings and units. Public rates carry a source and timestamp; account offers depend on eligibility.')}</p>${callout(t('尚无已确认的专属优惠', 'No confirmed exclusive offer'), t('邀请码不自动等于折扣码，不写未经证实的节省比例。', 'A referral code is not automatically a discount code. No unverified savings claims.'))}` : `<p><strong>${t('少配置。', 'Less setup.')}</strong> ${t('地址、常用模型与参数由 Nomi 准备。', 'Nomi prepares endpoints, common models and settings.')}</p><p><strong>${t('接着做。', 'Keep creating.')}</strong> ${t('图像到视频、局部修改和任务取回留在同一作品。', 'Images, video, edits and task retrieval stay in one project.')}</p><p><strong>${t('费用有依据。', 'Costs have a source.')}</strong> ${t('生成前参考估价，完成后看实际费用。', 'Review an estimate first and the actual charge afterward.')}</p><p class="small muted">${t('合资格的邀请充值可给 Nomi 带来返佣。已有其他连接仍可继续使用；没有虚构稳定性数据。', 'Eligible referral top-ups may earn Nomi a commission. Existing providers remain available; no invented reliability metrics.')}</p>`}</div><div class="row" style="margin-top:20px">${button(t('回到刚才的位置', 'Back to where I was'), 'close-overlay', 'btn primary')}${!price ? button(t('价格依据', 'Pricing evidence'), 'price-source', 'link') : ''}</div></section></div>`
  }

  let content
  if (page.id === 'S01') content = library()
  else if (page.id === 'S03') content = external()
  else if (['S13', 'S14', 'S15', 'S16'].includes(page.id)) content = edit(page.id)
  else {
    content = canvas()
    if (page.id === 'S02') content += connect()
    if (page.id === 'S04') content += checks()
    if (page.id === 'S05') content += connectionError()
    if (page.id === 'S06') content += balance()
    if (page.id === 'S08') content += picker()
    if (page.id === 'S09') content += quote()
    if (page.id === 'S17') content += balance(true)
    if (page.id === 'S18') content += advanced()
  }
  return `<div class="frame"><header class="app-head"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="wordmark">Nomi</span>${go(t('项目库', 'Projects'), 'S01', 'link')}<span class="crumb">/ ${t('屋顶上的朋友', 'Friends on the rooftop')}</span><span class="grow"></span><span class="small muted">${t('演示数据', 'Demo data')}</span>${go(t('设置', 'Settings'), 'S18', 'link')}</header><div class="app-body">${content}${overlay()}</div></div>`
}
