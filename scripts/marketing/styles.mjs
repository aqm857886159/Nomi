// 官网样式：沿用 Nomi 软件本身的设计语言（纸色底、墨色字、Nomi 蓝做唯一强调色，
// 英文 Fraunces、中文 Noto Sans SC；页面底是一张画布的点阵）。样张：https://claude.ai/artifact/UpqjKQGtiN9hMkrCpwqn6r
/** 两页共用：设计 token、排版、按钮、顶栏、页脚、下载选项、弹窗。 */
export const baseCss = `
:root {
  --ground: #faf9f6;
  --paper: #ffffff;
  --ink: #1e1b17;
  --ink-2: #4a463f;
  --ink-3: #6b665e;
  --ink-4: #a19b92;
  --line: #e6e2db;
  --line-soft: #efece6;
  --dot: #e2ddd5;
  --accent: #2e6cb4;
  --accent-soft: #e9f0f9;
  --shadow-node: 0 1px 2px rgb(30 27 23 / 0.05), 0 12px 32px rgb(30 27 23 / 0.07);
  --shadow-window: 0 2px 4px rgb(30 27 23 / 0.05), 0 30px 70px rgb(30 27 23 / 0.13);
  --font-en: "Fraunces", Georgia, "Times New Roman", serif;
  --font-zh: "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --font-ui: "Inter", "Noto Sans SC", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
  --radius: 10px;
  --radius-lg: 16px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #151311;
    --paper: #1d1b18;
    --ink: #eeeae3;
    --ink-2: #cdc7bd;
    --ink-3: #a29b90;
    --ink-4: #6f695f;
    --line: #2f2c27;
    --line-soft: #26231f;
    --dot: #2a2723;
    --accent: #78a6e0;
    --accent-soft: #1e2a3a;
    --shadow-node: 0 1px 2px rgb(0 0 0 / 0.3), 0 12px 32px rgb(0 0 0 / 0.35);
    --shadow-window: 0 2px 4px rgb(0 0 0 / 0.3), 0 30px 70px rgb(0 0 0 / 0.5);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body {
  margin: 0;
  background-color: var(--ground);
  background-image: radial-gradient(var(--dot) 1px, transparent 1.2px);
  background-size: 22px 22px;
  color: var(--ink);
  font-family: var(--font-zh);
  font-size: 16px;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}
html[lang="en"] body { font-family: var(--font-ui); }
body.modal-open { overflow: hidden; }
a { color: inherit; }
img, video { max-width: 100%; display: block; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }
.skip-link { position: absolute; left: 16px; top: -48px; z-index: 50; background: var(--ink); color: var(--ground); padding: 8px 14px; border-radius: 8px; }
.skip-link:focus { top: 12px; }
.wrap { width: 100%; max-width: 1180px; margin: 0 auto; padding-inline: 24px; }
@media (max-width: 560px) { .wrap { padding-inline: 16px; } }

.eyebrow { margin: 0; font-family: var(--font-ui); font-size: 13px; font-weight: 500; letter-spacing: 0.06em; color: var(--ink-3); text-transform: uppercase; }
.display { margin: 14px 0 0; font-weight: 900; letter-spacing: -0.01em; text-wrap: balance; font-size: clamp(40px, 5.4vw, 68px); line-height: 1.12; }
.display em { font-style: normal; color: var(--accent); }
html[lang="en"] .display { font-family: var(--font-en); font-weight: 600; letter-spacing: -0.02em; line-height: 1.04; }
.lede { margin: 22px 0 0; font-size: 19px; line-height: 1.75; color: var(--ink-2); max-width: 30em; }
h2 { margin: 10px 0 0; font-weight: 900; font-size: clamp(30px, 3.6vw, 44px); line-height: 1.2; letter-spacing: -0.005em; text-wrap: balance; }
html[lang="en"] h2 { font-family: var(--font-en); font-weight: 600; letter-spacing: -0.015em; }
.body { margin: 16px 0 0; color: var(--ink-2); font-size: 17px; max-width: 34em; }

.button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font-family: var(--font-ui); font-weight: 600; font-size: 15px; line-height: 1;
  padding: 13px 20px; border-radius: 999px; text-decoration: none; cursor: pointer; border: 1px solid transparent;
  background: none; color: inherit;
  transition: transform 140ms cubic-bezier(.2,.7,.3,1), background-color 140ms, border-color 140ms;
}
.button:active { transform: translateY(1px); }
.button.primary { background: var(--ink); color: var(--ground); }
.button.primary:hover { background: var(--ink-2); }
.button.quiet { background: var(--paper); color: var(--ink); border-color: var(--line); }
.button.quiet:hover { border-color: var(--ink-4); }
.button.small { padding: 9px 15px; font-size: 14px; }

.site-header { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--ground) 88%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border-bottom: 1px solid var(--line-soft); }
.nav { display: flex; align-items: center; gap: 28px; height: 60px; }
.brand { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; flex-shrink: 0; }
.wordmark { font-family: var(--font-en); font-weight: 600; font-size: 24px; letter-spacing: -0.01em; line-height: 1; }
.wordmark span { color: var(--accent); }
.wordmark.small { font-size: 20px; }
.nav-links { display: flex; gap: 22px; font-family: var(--font-ui); font-size: 14px; color: var(--ink-3); }
.nav-links a { text-decoration: none; white-space: nowrap; }
.nav-links a:hover, .nav-links a[aria-current="page"] { color: var(--ink); }
.nav-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.locale { font-family: var(--font-ui); font-size: 13px; color: var(--ink-3); border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; text-decoration: none; white-space: nowrap; }
.locale:hover { color: var(--ink); border-color: var(--ink-4); }
.menu-toggle { display: none; font-family: var(--font-ui); font-size: 13px; background: none; border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; color: var(--ink); cursor: pointer; }
/* 英文导航最宽，要 820px 才放得下；860px 以下收成「菜单」按钮，中英文用同一个断点。 */
@media (max-width: 860px) {
  .menu-toggle { display: inline-flex; }
  .nav-links { display: none; position: absolute; top: 60px; left: 0; right: 0; flex-direction: column; gap: 0; background: var(--ground); border-bottom: 1px solid var(--line); padding: 8px 16px 16px; }
  .nav-links.open { display: flex; }
  .nav-links a { padding: 10px 0; font-size: 16px; }
  .nav { gap: 12px; }
}

.block { padding-block: 72px; }
@media (max-width: 760px) { .block { padding-block: 48px; } }
.block-head { max-width: 44rem; }

.footer { padding-block: 40px 56px; font-family: var(--font-ui); font-size: 13px; color: var(--ink-4); }
.footer .wrap { display: flex; flex-wrap: wrap; gap: 10px 26px; align-items: center; }
.footer a { text-decoration: none; }
.footer-links { display: flex; flex-wrap: wrap; gap: 10px 20px; }
.footer a:hover { color: var(--ink); }

.download-options { display: grid; gap: 8px; margin-top: 14px; }
.download-option { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); text-decoration: none; font-family: var(--font-ui); }
.download-option:hover { border-color: var(--ink-4); }
.download-option strong { display: block; font-size: 15px; }
.download-option small { display: block; color: var(--ink-3); font-size: 12px; }
.download-option > span:last-child { color: var(--accent); font-weight: 600; font-size: 13px; white-space: nowrap; }
.mac-install-guide { margin-top: 18px; padding: 14px 16px; border-radius: var(--radius); background: var(--line-soft); font-size: 14px; color: var(--ink-2); }
.mac-install-guide p, .mac-install-guide ol { margin: 8px 0 0; }
.mac-install-guide ol { padding-left: 20px; }
.mac-install-command { display: block; margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--paper); border: 1px solid var(--line); font-family: var(--font-mono); font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
.download-fallback { padding-block: 40px; }

dialog { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 0; background: var(--ground); color: var(--ink); box-shadow: var(--shadow-window); }
dialog::backdrop { background: rgb(20 18 16 / 0.45); }
.dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border-bottom: 1px solid var(--line-soft); font-family: var(--font-ui); }
.dialog-close { background: none; border: 0; font-size: 22px; line-height: 1; cursor: pointer; color: var(--ink-3); padding: 4px 8px; }
.dialog-body { padding: 16px 18px 20px; overflow-y: auto; }
.dialog-body > p { margin: 0; color: var(--ink-2); font-size: 14px; }
`

/** 只有首页用：首屏片子窗口、价差、功能段、文件夹、愿景与社区。 */
const homeCss = `
@media (max-width: 380px) {
  .nav { gap: 6px; }
  .brand { gap: 6px; }
  .wordmark { font-size: 19px; }
  .nav-actions { gap: 5px; }
  .nav-actions .button.small { padding: 7px 10px; font-size: 12px; }
  .locale, .menu-toggle { padding: 5px 8px; font-size: 12px; }
}
.button.on-dark { color: var(--ground); border-color: color-mix(in srgb, var(--ground) 30%, transparent); }
.button.on-dark:hover { border-color: var(--ground); }
.hero { padding-block: 72px 56px; }
.hero-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 56px; align-items: center; }
@media (max-width: 960px) { .hero-grid { grid-template-columns: 1fr; gap: 40px; } .hero { padding-block: 44px 36px; } }
.hero-actions { margin-top: 30px; display: flex; flex-wrap: wrap; gap: 12px; }
.hero-meta { margin: 18px 0 0; font-family: var(--font-ui); font-size: 13px; color: var(--ink-4); }
.mac-download-note { margin: 6px 0 0; font-size: 13px; color: var(--ink-3); }
.mac-download-note a { color: var(--accent); }
.window { margin: 0; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: var(--shadow-window); overflow: hidden; }
.window-bar { display: flex; align-items: center; gap: 7px; height: 34px; padding-inline: 14px; border-bottom: 1px solid var(--line-soft); }
.window-bar i { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
.window-bar span { margin-left: 10px; font-family: var(--font-ui); font-size: 12px; color: var(--ink-4); }
.film { position: relative; aspect-ratio: 16 / 9; max-width: 100%; background: #111; }
.film-video { width: 100%; height: 100%; object-fit: cover; }
/* 样张里的「播放宣传片（有声音）」：放在右侧图片区上方，不压海报标题、不压原生控件条。脚本在才显示。 */
.film-play { position: absolute; right: clamp(12px, 3%, 28px); top: 38%; display: inline-flex; align-items: center; gap: 10px; border: 0; cursor: pointer; background: var(--ink); color: var(--ground); font-family: var(--font-ui); font-weight: 600; font-size: 15px; padding: 12px 20px 12px 16px; border-radius: 999px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.25); }
.film-play:hover { background: var(--ink-2); }
@media (max-width: 560px) { .film-play { font-size: 13px; padding: 8px 13px 8px 11px; top: 24%; } }
.gap-card { margin-top: 36px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 32px clamp(20px, 4vw, 44px); }
.bar-row + .bar-row { margin-top: 26px; }
.bar-label { font-size: 15px; color: var(--ink-3); }
.bar { margin-top: 10px; height: 16px; border-radius: 999px; }
.bar.commercial { width: 100%; background: var(--ink); }
.bar.yours { width: 22%; background: var(--accent); }
.gap-note { margin: 22px 0 0; font-size: 14px; color: var(--ink-3); }
.facts { margin-top: 28px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 820px) { .facts { grid-template-columns: 1fr; } }
.fact { padding: 18px 20px 4px; border-top: 2px solid var(--ink); }
.fact h3 { margin: 0; font-size: 17px; font-weight: 700; }
.fact p { margin: 6px 0 0; font-size: 15px; color: var(--ink-3); }
.feature { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 56px; align-items: center; padding-block: 44px; }
.feature.flip .feature-text { order: 2; }
@media (max-width: 960px) { .feature, .feature.flip { grid-template-columns: 1fr; gap: 20px; padding-block: 32px; } .feature.flip .feature-text { order: 0; } }
.feature h3 { margin: 8px 0 0; font-size: clamp(24px, 2.6vw, 32px); font-weight: 900; line-height: 1.25; text-wrap: balance; }
html[lang="en"] .feature h3 { font-family: var(--font-en); font-weight: 600; letter-spacing: -0.01em; }
.feature p { margin: 12px 0 0; color: var(--ink-2); max-width: 30em; }
.feature .kicker { margin: 0; font-family: var(--font-ui); font-size: 13px; color: var(--accent); font-weight: 600; }
.node-title { margin: 0 0 6px 2px; font-family: var(--font-ui); font-size: 12px; color: var(--ink-4); }
.node-frame { position: relative; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line); box-shadow: var(--shadow-node); background: #111; aspect-ratio: 16 / 9; max-width: 100%; }
.node-frame video { width: 100%; height: 100%; object-fit: cover; }
.node-frame::before, .node-frame::after { content: ""; position: absolute; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; border-radius: 50%; background: var(--paper); border: 1px solid var(--ink-4); z-index: 2; }
.node-frame::before { left: 6px; }
.node-frame::after { right: 6px; }
.segment-time { position: absolute; right: 10px; bottom: 10px; z-index: 2; font-family: var(--font-ui); font-size: 11px; color: #fff; background: rgb(20 18 16 / 0.62); padding: 2px 7px; border-radius: 6px; font-variant-numeric: tabular-nums; }
.open-grid { margin-top: 32px; display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 40px; align-items: start; }
@media (max-width: 900px) { .open-grid { grid-template-columns: 1fr; } }
.tree { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 24px 26px; font-family: var(--font-mono); font-size: 15px; line-height: 2; overflow-x: auto; }
.tree div { display: flex; gap: 24px; white-space: nowrap; }
.tree .root { font-weight: 600; }
.tree .note { color: var(--ink-4); font-family: var(--font-zh); font-size: 14px; }
html[lang="en"] .tree .note { font-family: var(--font-ui); }
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; }
.checks li { padding-left: 26px; position: relative; color: var(--ink-2); }
.checks li::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 12px; height: 7px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); transform: rotate(-45deg); }
.open-actions { margin-top: 24px; display: flex; flex-wrap: wrap; gap: 12px; }
.vision { background: var(--ink); color: var(--ground); border-radius: var(--radius-lg); padding: clamp(28px, 5vw, 56px); display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 40px; align-items: center; }
@media (max-width: 900px) { .vision { grid-template-columns: 1fr; } }
.vision .eyebrow { color: color-mix(in srgb, var(--ground) 60%, transparent); }
.vision h2 { color: var(--ground); }
.vision .body { color: color-mix(in srgb, var(--ground) 78%, transparent); }
.qr-row { display: flex; gap: 18px; flex-wrap: wrap; align-items: stretch; min-width: 0; }
.qr { margin: 0; background: #fff; border-radius: var(--radius); padding: 10px; width: 150px; max-width: 100%; flex-shrink: 0; }
.qr img { width: 100%; height: auto; }
.qr figcaption { font-size: 12px; color: #4a463f; text-align: center; margin-top: 6px; line-height: 1.4; overflow-wrap: anywhere; }
.teams { margin-top: 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 32px; padding: 24px clamp(20px, 4vw, 32px); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--paper); }
.teams h3 { margin: 0; font-size: 18px; }
.teams p { margin: 4px 0 0; color: var(--ink-3); font-size: 15px; }
.teams .hero-actions { margin-top: 0; }
.qr-content { display: grid; justify-items: center; gap: 12px; text-align: center; }
.qr-content img { width: min(240px, 70vw); height: auto; border-radius: var(--radius); background: #fff; padding: 8px; }
`

/** 只有快速上手用：步骤、截图、常见问题。 */
const quickstartCss = `
.qs-hero { padding-block: 64px 8px; }
.steps { list-style: none; margin: 0; padding: 0; counter-reset: step; }
.step { counter-increment: step; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 48px; padding-block: 40px; border-top: 1px solid var(--line); align-items: start; }
@media (max-width: 900px) { .step { grid-template-columns: 1fr; gap: 20px; } }
.step-label { margin: 0; font-family: var(--font-ui); font-weight: 600; font-size: 13px; color: var(--accent); }
.step-label::before { content: counter(step, decimal-leading-zero) " · "; }
.step h2 { margin-top: 6px; font-size: 24px; line-height: 1.3; }
.step p { margin: 10px 0 0; color: var(--ink-2); }
.shot { border-radius: var(--radius); overflow: hidden; border: 1px solid var(--line); box-shadow: var(--shadow-node); background: var(--paper); }
.shot img { width: 100%; height: auto; }
.latest { margin: 0; font-family: var(--font-ui); font-size: 13px; color: var(--ink-3); }
.tip { margin: 14px 0 0; font-size: 14px; color: var(--ink-2); background: var(--accent-soft); border-radius: var(--radius); padding: 12px 14px; }
.faq-head { margin-top: 48px; }
.faq { margin-top: 12px; }
.faq details { border-top: 1px solid var(--line); padding-block: 18px; }
.faq details:last-child { border-bottom: 1px solid var(--line); }
.faq summary { cursor: pointer; font-weight: 700; font-size: 17px; list-style: none; display: flex; justify-content: space-between; gap: 16px; }
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: "+"; font-family: var(--font-ui); font-weight: 400; color: var(--ink-4); }
.faq details[open] summary::after { content: "–"; }
.faq p { margin: 10px 0 0; color: var(--ink-2); max-width: 44em; }
.routes { margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.route { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; scroll-margin-top: 80px; }
.route h3 { margin: 0; font-size: 17px; line-height: 1.4; }
.route p { margin: 6px 0 0; font-size: 15px; color: var(--ink-2); }
.route a { display: inline-block; margin-top: 8px; font-family: var(--font-ui); font-size: 14px; font-weight: 600; color: var(--accent); text-decoration: none; }
.next-links { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 10px; }
`

/** 每页只带自己用得到的样式（评审：快速上手曾把首页的样式整份带上）。 */
export function pageCss(pageKey) {
  return baseCss + (pageKey === 'home' ? homeCss : quickstartCss)
}
