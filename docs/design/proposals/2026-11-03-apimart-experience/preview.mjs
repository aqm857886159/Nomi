import { pages, features, phases } from './catalog.mjs'
import { productView } from './views.mjs'

const params = new URLSearchParams(location.search)
const initial = pages.find((p) => p.id === params.get('screen')) || pages[0]
const state = {
  screen: initial.id,
  variant: params.get('variant') || initial.variants[0]?.[0] || '',
  lang: params.get('lang') === 'en' ? 'en' : 'zh',
  theme: params.get('theme') === 'dark' ? 'dark' : 'light',
  view: 'screens',
  connected: Number(initial.id.slice(1)) >= 6,
  demoKey: false,
  prompt: null,
  editPrompt: '',
  model: 'Nano Banana 2',
  resolution: '1K',
  returnId: 'S01',
  overlay: null,
  job: 'Nano Banana 2',
  prepared: null,
  preparedVariant: '',
  preparedPrompt: '',
}
const t = (zh, en) => (state.lang === 'zh' ? zh : en)
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
let noticeTimer
function note(zh, en) {
  const el = document.getElementById('notice')
  el.textContent = t(zh, en)
  el.hidden = false
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    el.hidden = true
  }, 5000)
}
function route(id, review = false) {
  const next = pages.find((p) => p.id === id)
  if (!next) return
  if (id === 'S02' && state.screen !== 'S03' && state.screen !== 'S05') state.returnId = state.screen
  state.screen = id
  state.variant = next.variants[0]?.[0] || ''
  state.overlay = null
  state.view = 'screens'
  if (review) {
    state.connected = Number(id.slice(1)) >= 6
    state.prepared = null
  }
  render()
}
function header() {
  return `<header class="review-top"><div class="review-brand">Nomi × APIMart<small>${t('接入与持续创作 · 整合方案 / exploration', 'Onboarding and ongoing creation · exploration')}</small></div><nav aria-label="${t('评审视图', 'Review views')}">${[
    ['screens', '页面设计', 'Screen designs'],
    ['features', '功能与接口', 'Features and APIs'],
    ['plan', '实施顺序', 'Delivery sequence'],
  ]
    .map((x) => `<button class="${state.view === x[0] ? 'active' : ''}" data-view="${x[0]}">${t(x[1], x[2])}</button>`)
    .join(
      '',
    )}</nav><div class="review-tools"><span>${t('仅设计演示 · 无真实请求', 'Design demo · no live requests')}</span><button data-action="lang">${state.lang === 'zh' ? 'EN' : '中文'}</button><button data-action="theme">${state.theme === 'light' ? t('深色', 'Dark') : t('浅色', 'Light')}</button></div></header>`
}
function nav() {
  return `<aside class="journey"><div class="journey-label">${t('18 个阶段 / 3 个原有宿主', '18 STATES / 3 EXISTING SURFACES')}</div>${pages.map((p) => `<button data-screen="${p.id}" class="${state.screen === p.id ? 'active' : ''}" aria-current="${state.screen === p.id ? 'page' : 'false'}"><span>${p.id.slice(1)}</span>${t(p.zh, p.en)}</button>`).join('')}<a href="README.md" target="_blank" rel="noopener">${t('整合方案文档 ↗', 'Full design document ↗')}</a></aside>`
}
function notes(p) {
  return `<aside class="review-notes"><section><h3>${t('这一阶段解决什么', 'Purpose of this state')}</h3><p>${t(p.goalZh, p.goalEn)}</p>${p.variants.length ? `<label for="variant">${t('评审状态切换', 'Review state')}</label><select id="variant">${p.variants.map((v) => `<option value="${v[0]}" ${state.variant === v[0] ? 'selected' : ''}>${t(v[1], v[2])}</option>`).join('')}</select>` : ''}<p class="help">${t('此栏是评审注释，不出现在产品中。', 'This column is review commentary, not product UI.')}</p></section><section><h3>${t('功能 / 接口 / 实现基础', 'Feature / API / implementation basis')}</h3>${p.features
    .map((id) => {
      const f = features.find((x) => x.id === id)
      return `<div class="feature-ref"><strong>${f.id} · ${t(f.zh, f.en)}</strong><code>${esc(f.api)}</code><p>${t(f.statusZh, f.statusEn)}</p><a href="${f.source}" target="_blank" rel="noopener">${t('依据 ↗', 'Source ↗')}</a></div>`
    })
    .join(
      '',
    )}<p class="help"><a href="contracts.md" target="_blank" rel="noopener">${t('字段、状态、失败与验收合同 ↗', 'Fields, states, failures and acceptance ↗')}</a></p></section></aside>`
}
function screenView() {
  const p = pages.find((x) => x.id === state.screen)
  return `<div class="layout">${nav()}<main class="content"><div class="page-heading"><div><h1>${p.id} · ${t(p.zh, p.en)}</h1><p>${t(p.hostZh, p.hostEn)} · ${t('位置与状态设计', 'Placement and state design')}</p></div><span class="counter">${t('页面状态，不是独立新页面', 'A state, not a new product page')}</span><div class="pager"><button data-action="previous" aria-label="${t('上一阶段', 'Previous stage')}">←</button><button data-action="next">${t('下一步演示', 'Next demo step')} →</button></div></div><div class="stage-layout">${productView(p, { t, state, esc })}${notes(p)}</div><p class="review-note-label">${t('EXPLORATION · 模型、余额、进度和费用均为示意；保留真实产品宿主，未接入服务。', 'EXPLORATION · Models, funds, progress and costs are illustrative. Existing product surfaces, no live service.')}</p></main></div>`
}
function featureView() {
  return `<main class="data-view"><span class="eyebrow">SCOPE → EXPERIENCE → API</span><h1>${t('每个接口，都落到一个用户动作。', 'Every API serves a user action.')}</h1><p class="muted">${t('点击页面编号查看设计；“已有”指源码基础，不代表新增体验已经发布。', 'Select a screen ID to inspect its design. Existing means code foundations, not a released experience.')}</p><div class="table-wrap"><table><thead><tr><th>${t('功能', 'Feature')}</th><th>${t('接口与状态', 'API and status')}</th><th>${t('页面', 'Screens')}</th><th>${t('阶段', 'Phase')}</th></tr></thead><tbody>${features.map((f) => `<tr><td><span class="mono">${f.id}</span><br><strong>${t(f.zh, f.en)}</strong></td><td><code>${esc(f.api)}</code>${t(f.statusZh, f.statusEn)}<br><a href="${f.source}" target="_blank" rel="noopener">${t('依据', 'Source')}</a></td><td><div class="screen-links">${f.screens.map((id) => `<button data-screen="${id}">${id}</button>`).join('') || t('暂不新增屏', 'No new screen yet')}</div></td><td>${f.phase}</td></tr>`).join('')}</tbody></table></div><p class="help">${t('接口字段、模型前置条件、数据owner、异常和验收见 contracts.md；不支持的合作能力没有虚构端点。', 'See contracts.md for fields, preconditions, owners, errors and acceptance. Unconfirmed partner APIs have no invented endpoints.')}</p></main>`
}
function planView() {
  return `<main class="data-view"><span class="eyebrow">SMALL, COMPLETE SLICES</span><h1>${t('先打通首次创作，再减少每次返工。', 'Complete the first creation, then reduce rework.')}</h1><p class="muted">${t('当前 PR 交付方案与预览；以下是后续实施切片，不是完成状态。', 'This PR delivers the design and preview. These are future implementation slices, not completion claims.')}</p>${phases.map((x) => `<section class="phase"><b>${x[0]}</b><div><h3>${t(x[1], x[2])}</h3><p>${x[3]}</p></div><a href="README.md" target="_blank" rel="noopener">${t('范围与验收 ↗', 'Scope and acceptance ↗')}</a></section>`).join('')}<div class="callout" style="margin-top:24px"><strong>${t('平台配合是独立依赖', 'Partner cooperation is a separate dependency')}</strong><p>${t('免 Key 授权、支付订单与邀请归属、音视频直传需要正式契约。拿不到配合时，官网 + 一次 Key 粘贴的主路仍可交付。', 'Keyless authorization, payment/referral status and media upload need formal contracts. The website plus one key paste remains deliverable without them.')}</p></div></main>`
}
function render() {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en'
  document.documentElement.dataset.mantineColorScheme = state.theme
  document.getElementById('review').innerHTML =
    header() + (state.view === 'screens' ? screenView() : state.view === 'features' ? featureView() : planView())
}
document.addEventListener('click', (event) => {
  const el = event.target.closest('button')
  if (!el || el.disabled) return
  if (el.dataset.screen) {
    route(el.dataset.screen, true)
    return
  }
  if (el.dataset.view) {
    state.view = el.dataset.view
    render()
    return
  }
  const action = el.dataset.action || ''
  if (action.startsWith('go:')) {
    route(action.slice(3))
    return
  }
  if (action.startsWith('variant:')) {
    state.variant = action.slice(8)
    state.editPrompt = ''
    render()
    return
  }
  if (action.startsWith('model:')) {
    state.model = ['Nano Banana 2', 'GPT Image 2 · official', 'Seedream'][Number(action.slice(6))]
    state.resolution = '1K'
    route('S07')
    return
  }
  if (action.startsWith('prepare:')) {
    state.preparedVariant = state.variant
    state.preparedPrompt =
      document.getElementById('edit-prompt')?.value ||
      t('沿用源任务内容与素材。', 'Inherit source task content and assets.')
    state.prepared = action.slice(8)
    state.job = { S13: 'H3 · 2K', S14: 'GPT Image 2 · official', S15: 'Seedance 2.5', S16: 'Flow Music' }[
      state.prepared
    ]
    route('S07')
    note(
      '派生草稿已准备。源结果保留；本规格报价取得后再确认提交。',
      'Derived draft prepared. Source preserved; confirm only after getting a quote.',
    )
    return
  }
  switch (action) {
    case 'lang':
      state.lang = state.lang === 'zh' ? 'en' : 'zh'
      render()
      break
    case 'theme':
      state.theme = state.theme === 'light' ? 'dark' : 'light'
      render()
      break
    case 'previous':
      route(pages[Math.max(0, pages.findIndex((p) => p.id === state.screen) - 1)].id, true)
      break
    case 'next':
      if (state.screen === 'S04') state.connected = true
      route(pages.find((p) => p.id === state.screen).next)
      break
    case 'return':
      route(pages.some((p) => p.id === state.returnId) ? state.returnId : 'S07')
      break
    case 'demo-key':
      state.demoKey = true
      render()
      break
    case 'copied':
      state.demoKey = true
      route('S02')
      break
    case 'check':
      if (state.demoKey) route('S04')
      break
    case 'save-pending':
      state.demoKey = true
      route('S05')
      state.variant = 'saved'
      render()
      break
    case 'archive-import':
      note(
        '此动作只处理原音轨包，不重新提交分轨。',
        'This only processes the original stem archive; it does not resubmit separation.',
      )
      break
    case 'image-video':
      state.prepared = 'image-video'
      state.preparedPrompt =
        state.prompt || t('沿用当前画面，镜头缓缓拉远。', 'Use the current frame and slowly pull back.')
      state.job = 'Veo 3.1 Fast'
      route('S07')
      note(
        '已用这张图准备视频首帧草稿。确认规格与报价后再生成。',
        'Prepared a video draft using this image as its first frame. Review settings and pricing before generating.',
      )
      break
    case 'submit':
      if (state.prepared || state.resolution !== '1K' || state.model !== 'Nano Banana 2') {
        route('S09')
        state.variant = 'unknown'
        render()
      } else {
        state.job = state.model
        route('S10')
      }
      break
    case 'recover':
      route('S12')
      note(
        '演示切到原任务取回后的画面，未发起真实请求。',
        'Showing the retrieved state in the demo; no real request was made.',
      )
      break
    case 'uncertain':
      note(
        '保留原请求身份。有幂等契约才核对重放；否则核对官方调用记录，不自动重提。',
        'Keep the original request identity. Replay only with a supported idempotency contract; otherwise reconcile the provider record.',
      )
      break
    case 'observe-later':
      note(
        '关闭本地等待不会取消平台任务或保证退款。原任务仍可取回。',
        'Closing local observation does not cancel the remote task or guarantee a refund. The original task remains retrievable.',
      )
      break
    case 'refresh':
      note(
        '演示：刷新账户事实，不代表某笔订单已确认，也不会自动生成。',
        'Demo: refresh account facts; this neither confirms a payment nor starts a generation.',
      )
      break
    case 'quote-refresh':
      note(
        '原型没有真实报价请求。生产中取得匹配当前规格的报价后再确认。',
        'The prototype makes no quote request. Production requires a quote matching the current settings.',
      )
      break
    case 'official':
      note(
        '评审稿不打开账户或付款。正式产品从当前设置打开官方页面，回来只刷新。',
        'The review does not open accounts or checkout. Production opens the official page and refreshes on return.',
      )
      break
    case 'why':
      state.overlay = 'why'
      render()
      break
    case 'price-source':
      state.overlay = 'price'
      render()
      break
    case 'close-overlay':
      state.overlay = null
      render()
      break
    case 'mask':
      state.variant = state.variant === 'selected' ? 'empty' : 'selected'
      render()
      break
    case 'draft-note':
      note(
        '提示词保存在本次演示会话，切换设置再返回仍保留。',
        'The prompt is kept in this demo session across settings navigation.',
      )
      break
    case 'provenance':
      note(
        '复用现有来源详情：模型、规格、原任务身份、实际费用和本地资产。',
        'Reuse existing provenance: model, settings, original task identity, actual cost and local assets.',
      )
      break
    case 'advanced':
      note(
        '该入口接回现有高级管理；本稿只设计归宿，不重做编辑器。详见功能普查。',
        'This returns to existing advanced management. The draft maps its location rather than rebuilding the editor; see the function census.',
      )
      break
  }
})
document.addEventListener('input', (event) => {
  if (event.target.id === 'prompt') state.prompt = event.target.value
  if (event.target.id === 'edit-prompt') state.editPrompt = event.target.value
})
document.addEventListener('change', (event) => {
  if (event.target.id === 'variant') {
    state.variant = event.target.value
    state.editPrompt = ''
    render()
  }
  if (event.target.id === 'resolution') {
    state.resolution = event.target.value
    render()
  }
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (state.overlay) {
      state.overlay = null
      render()
    } else if (['S02', 'S04', 'S05', 'S06', 'S17', 'S18'].includes(state.screen)) route(state.returnId)
  }
})
render()
