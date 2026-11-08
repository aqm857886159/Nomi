// 「操作 → 界面到位」的页内计时器（性能场景表 tests/perf/scenarios/ 的 response 类指标共用这一个）。
//
// 量法：输入事件（捕获阶段）的 event.timeStamp 起表——它带着输入排队的时间，和用户手指按下去那一刻最近；
// 之后每一帧问一次「到位了没」，到位后再过两帧（样式重算 + 布局 + 绘制都算进去）停表。
// 不自写剖析器：页面自己的 performance 时钟 + rAF + PerformanceObserver(longtask)。
//
// 判据按名字登记在页里（PREDICATES），不在页里 new Function：渲染进程有 CSP，页内动态编译会被拦；
// 这段源码经 page.evaluate(字符串) 走 CDP Runtime.evaluate 装进去，不受页面 CSP 管。
// 画布 store 桥（window.__nomiCanvasStore，只在 localStorage __nomiE2E=1 时挂）在的话，顺带数一次操作里 store 写了几次。

const INSTALL_SOURCE = `(() => {
  if (window.__nomiPerfResponse) return 'exists'
  const visible = (element) => Boolean(element) && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
  const composerOf = (nodeId) => document.querySelector('article[data-node-id="' + CSS.escape(nodeId) + '"] [data-composer-host="canvas"]')
  // 画布节点外壳（任何细节层级都有它；外部高亮 data-external-highlight 挂在这一层）。按 React Flow 节点包层的 data-id 找，不按 DOM 里第一个 data-node-id。
  const shellOf = (nodeId) => document.querySelector('.react-flow__node[data-id="' + CSS.escape(nodeId) + '"] .generation-canvas-react-flow__node-shell')
  const PREDICATES = {
    // 生成框真内容可见：浮框挂上、提示词编辑器在、里面没有任何「加载中」骨架（懒加载骨架 / 模型清单骨架都带 aria-busy）。
    composerReady(nodeId) {
      const composer = composerOf(nodeId)
      return visible(composer) && Boolean(composer.querySelector('.ProseMirror')) && !composer.querySelector('[aria-busy="true"]')
    },
    // 第一眼反馈：浮框或它的懒加载骨架出现在这张卡下面（骨架算「看到东西了」，不算「能用了」）。
    composerAny(nodeId) {
      const article = document.querySelector('article[data-node-id="' + CSS.escape(nodeId) + '"]')
      return Boolean(article) && (visible(composerOf(nodeId)) || Boolean(article.querySelector('[aria-busy="true"]')))
    },
    // 选中拆解表到位：上方浮条与下方拆解栏都挂在这张表的 React Flow 节点里且可见（两者是 article 的兄弟，不在 article 里面）。
    shotTableEngaged(nodeId) {
      const host = document.querySelector('.react-flow__node[data-id="' + CSS.escape(nodeId) + '"]')
      return Boolean(host) && visible(host.querySelector('[data-node-floating-toolbar]')) && visible(host.querySelector('[data-shot-table-composer]'))
    },
    // 拆解表行高切到位：浮条上的档位已换，且表里每一行都按新行高排好（首末两行都量，200 行一次渲完才算）。
    shotTableRowHeight({ nodeId, step, px }) {
      const host = document.querySelector('.react-flow__node[data-id="' + CSS.escape(nodeId) + '"]')
      const rows = host ? host.querySelectorAll('[data-shot-table-row]') : []
      return Boolean(host && host.querySelector('[data-shot-table-row-height="' + step + '"]')) && rows.length > 0
        && rows[0].offsetHeight >= px && rows[rows.length - 1].offsetHeight >= px
    },
    // 生成框里参考行的小图到齐（B3 最坏规模：30 张）。
    composerRefTilesReady(count) {
      return document.querySelectorAll('[data-composer-host] [data-reference-row] [data-asset-tile]').length >= count
    },
    // 悬停一张参考小图：名字 + 来源的小提示出现（刚停上去的那一阶段，不含 0.45 秒的大图延迟）。
    refHoverTip() {
      return visible(document.querySelector('[data-asset-tile-tip]'))
    },
    // 点参数摘要钮：参数面板出现，生成方式那一组在里面。
    paramPanelOpen() {
      const panel = document.querySelector('[data-agent-parameter-panel]')
      return visible(panel) && Boolean(panel.querySelector('[data-agent-generation-mode]'))
    },
    // 在面板里切生成方式：高亮的分段变成了 label，且参考行已经按新方式重排（首尾帧 = 出现「首帧」格）。
    modeSwitched(label) {
      const active = document.querySelector('[data-agent-generation-mode] [role="radio"][aria-checked="true"]')
      return Boolean(active) && active.textContent.trim() === label && document.querySelectorAll('[data-asset-slot-label]').length >= 2
    },
    // 聊天里的指向元素（D2，NodePointer 板）：悬停它 → 画布上那个节点的外壳亮起（hover）。
    pointerNodeLit(nodeId) {
      return shellOf(nodeId)?.getAttribute('data-external-highlight') === 'hover'
    },
    // 点它 → 那个节点在闪（flash 压过 hover），且画布已经开始对焦（视口离开了点下去之前那一刻的位置）。
    // 对焦本身是一段 220ms 的滑动（设计如此，不是延迟）：滑完的时刻由场景另记，只看。视口变换读内联样式，不逼一次样式重算。
    pointerFocusStarted({ nodeId, before }) {
      const viewport = document.querySelector('.react-flow__viewport')
      return shellOf(nodeId)?.getAttribute('data-external-highlight') === 'flash' && Boolean(viewport) && viewport.style.transform !== before
    },
    // 在节点生成框里改了一个参数 → 付费卡组下方那一行摘要换了字（卡从节点现算，不留第二份）。
    spendSummaryChanged({ card, before }) {
      const line = document.querySelector(card + ' [data-node-pointer-group-summary]')
      return Boolean(line) && line.textContent.trim() !== before
    },
    nodeCountAbove(count) {
      return document.querySelectorAll('.react-flow__node').length > count
    },
    listQueueSettled(nodeId) {
      const card = document.querySelector('[data-list-card="' + CSS.escape(nodeId) + '"]')
      return visible(card) && !card.querySelector('[data-list-status="queued"]')
    },
    stageReady(mode) {
      if (mode === 'creation') {
        const root = document.querySelector('.workbench-creation')
        return visible(root) && visible(root.querySelector('.ProseMirror'))
      }
      if (mode === 'preview') {
        const root = document.querySelector('.workbench-preview')
        return visible(root) && visible(root.querySelector('.workbench-timeline__tracks'))
      }
      if (mode === 'generation') {
        const surface = document.querySelector('[data-generation-canvas-surface]')
        return visible(surface) && [...document.querySelectorAll('.react-flow__node')].some(visible)
      }
      if (mode === 'list') {
        const list = document.querySelector('[data-generation-list]')
        return visible(list) && list.querySelectorAll('*').length > 20
      }
      throw new Error('未知阶段 ' + mode)
    },
    libraryReady(count) {
      return [...document.querySelectorAll('[data-project-card]')].filter(visible).length >= count
    },
    // 技能库 / 提示词库抽屉打开：抽屉在、里面第一张卡可见（技能条卡或提示词卡）。
    libraryDrawerReady(item) {
      const drawer = document.querySelector('[data-shell-drawer="' + item + '"]')
      return visible(drawer) && visible(drawer.querySelector('[data-skill-card], [data-prompt-card]'))
    },
    // 库里搜索的一键：搜索框已经是这一键之后的字（受控输入框，值和列表是同一次提交画上去的）。
    libraryQueryShown({ item, query }) {
      const input = document.querySelector('[data-shell-drawer="' + item + '"] input[type="search"]')
      return Boolean(input) && input.value === query
    },
    // 分镜方案打开到「首屏可编辑」（tests/perf/document-switch-bench.mjs）：行区报出逻辑总数 count，且视口里有带可编辑提示词框的行。
    // 分镜表窗口化（2026-10-16）后只挂视口附近的行，「count 个行盒子都在屏上」永远不成立；末镜够得着由量具停表后另验。
    storyboardPlanOpenReady(count) {
      const box = document.querySelector('[data-storyboard-rows][data-storyboard-row-count="' + count + '"]')
      return Boolean(box) && [...box.querySelectorAll('[data-storyboard-row]')]
        .some((element) => element.getClientRects().length > 0 && Boolean(element.querySelector('[data-prompt-box] [contenteditable="true"]')))
    },
    // 内联画板能操作：编辑器挂上、画布在、初始图导入完（「导入图片」钮从禁用变可用）。
    whiteboardEditorReady() {
      const editor = document.querySelector('[data-nomi-inline-whiteboard="true"]')
      const importButton = editor ? editor.querySelector('[data-toolbar-action="whiteboard-importImage"]') : null
      return visible(editor) && Boolean(editor.querySelector('canvas')) && Boolean(importButton) && !importButton.disabled
    },
    // 画板完成：编辑器收起，节点上换成刚导出的那张图，并且图已解码可见（导出 + 落盘 + 节点结果 + 画布预览整段）。
    whiteboardResultVisible(nodeId) {
      if (document.querySelector('[data-nomi-inline-whiteboard="true"]')) return false
      const image = document.querySelector('article[data-node-id="' + CSS.escape(nodeId) + '"] [data-testid="whiteboard-open-preview"] img')
      return visible(image) && image.complete && image.naturalWidth > 0
    },
    // 画板完成的第一眼反馈：「完成」钮变成「保存中」（aria-busy），或者图已经到位。
    whiteboardSaving(nodeId) {
      const done = document.querySelector('[data-nomi-inline-whiteboard="true"] [data-toolbar-action="whiteboard-done"][aria-busy="true"]')
      return visible(done) || PREDICATES.whiteboardResultVisible(nodeId)
    },
    // 内联画板打字：工具条里的文字框已经是 value（同一帧里画布按它重排，量到的是输入 → 画面的整段）。
    whiteboardTextValue({ label, value }) {
      const input = document.querySelector('[data-nomi-inline-whiteboard="true"] [role="toolbar"] input[aria-label="' + CSS.escape(label) + '"]')
      return Boolean(input) && input.value === value
    },
    // 写作区 AI 编辑：条出现且输入框在（点「AI 编辑」之后）。
    rewriteBarReady() {
      const bar = document.querySelector('.workbench-ai-rewrite-bar')
      return visible(bar) && Boolean(bar.querySelector('input'))
    },
    // 写作区 AI 编辑：结果就地画完——划线的删除部分、标出来的新增部分、段尾 ✓ ✕ 都在。
    rewriteResultReady() {
      return Boolean(document.querySelector('[data-rewrite-status="result"]'))
        && document.querySelectorAll('.nomi-ai-rewrite-del').length > 0
        && document.querySelectorAll('[data-rewrite-add]').length > 0
        && document.querySelectorAll('[data-rewrite-action]').length === 2
    },
    // 切文稿：顶栏文稿切换钮写着目标标题，编辑器里是那份文稿的正文（marker 是正文里的标记句）。
    documentShown({ title, marker }) {
      const switcher = document.querySelector('[data-creation-document-switcher]')
      const editor = document.querySelector('.ProseMirror')
      return Boolean(switcher) && switcher.textContent.includes(title) && Boolean(editor) && editor.textContent.includes(marker)
    },
  }
  window.__nomiPerfResponse = {
    arm({ trigger, predicate, arg, early, timeoutMs }) {
      const check = PREDICATES[predicate]
      const earlyCheck = early ? PREDICATES[early] : null
      if (!check) throw new Error('未知判据 ' + predicate)
      let longTasks = 0
      let observer = null
      try {
        observer = new PerformanceObserver((list) => { longTasks += list.getEntries().length })
        observer.observe({ type: 'longtask' })
      } catch { /* 没有长任务支持时其余数照样有效 */ }
      const store = window.__nomiCanvasStore
      let storeWrites = 0
      const unsubscribe = store && typeof store.subscribe === 'function' ? store.subscribe(() => { storeWrites += 1 }) : null
      this.pending = new Promise((resolve, reject) => {
        const finish = (value) => { observer?.disconnect(); unsubscribe?.(); resolve(value) }
        document.addEventListener(trigger, (event) => {
          const t0 = event.timeStamp || performance.now()
          let earlyMs = null
          const deadline = performance.now() + timeoutMs
          const tick = () => {
            let ok = false
            try {
              if (earlyCheck && earlyMs === null && earlyCheck(arg)) earlyMs = performance.now() - t0
              ok = check(arg)
            } catch (error) { observer?.disconnect(); unsubscribe?.(); reject(error); return }
            if (ok) {
              requestAnimationFrame(() => requestAnimationFrame(() => finish({
                ms: Math.round((performance.now() - t0) * 10) / 10,
                earlyMs: earlyMs === null ? null : Math.round(earlyMs * 10) / 10,
                longTasks,
                storeWrites: unsubscribe ? storeWrites : null,
                t0: Math.round(t0 * 10) / 10,
              })))
              return
            }
            if (performance.now() > deadline) { observer?.disconnect(); unsubscribe?.(); reject(new Error('等「' + predicate + '」到位超时 ' + timeoutMs + 'ms')); return }
            requestAnimationFrame(tick)
          }
          tick()
        }, { capture: true, once: true })
      })
      return 'armed'
    },
    take() { return this.pending },
  }
  return 'installed'
})()`

/** 装计时器（同一页装一次即可，重复调用无害）。 */
export async function installResponseTimer(page) {
  await page.evaluate(INSTALL_SOURCE)
}

/**
 * 下一次 `trigger` 事件（捕获阶段）起表，`predicate(arg)` 成立后再过两帧停表。
 * 先 arm、再做动作、再 take：动作本身由调用方用真实鼠标 / 键盘做。
 */
export async function armResponse(page, { trigger = 'pointerdown', predicate, arg = null, early = null, timeoutMs = 20_000 }) {
  await installResponseTimer(page)
  await page.evaluate((options) => window.__nomiPerfResponse.arm(options), { trigger, predicate, arg, early, timeoutMs })
}

/** 取上一次 arm 的结果：{ ms, earlyMs, longTasks, storeWrites, t0 }（t0 = 起表那一下输入事件的页内时间戳，和 performance.now() 同一时基）。 */
export async function takeResponse(page) {
  return page.evaluate(() => window.__nomiPerfResponse.take())
}
