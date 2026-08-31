export const homepageCss = `
:root {
  --paper: #f4f2ec;
  --surface: #fbfaf7;
  --ink: #171715;
  --ink-soft: #4f4d48;
  --muted: #86827a;
  --rule: #cfcbc2;
  --coral: #ef6a49;
  --coral-dark: #b83c24;
  --white: #ffffff;
  --blue: #2768d8;
  --shadow: 0 24px 70px rgba(23, 23, 21, 0.15);
  --page: min(1320px, calc(100vw - 64px));
  --nav-h: 72px;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; background: var(--paper); }
body { margin: 0; color: var(--ink); background: var(--paper); font-family: "Manrope", "Noto Sans SC", system-ui, sans-serif; font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
body.modal-open { overflow: hidden; }
a { color: inherit; }
button, a { -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
img, video { display: block; max-width: 100%; }
::selection { color: var(--white); background: var(--coral); }
section[id] { scroll-margin-top: calc(var(--nav-h) + 12px); }
:focus-visible { outline: 2px solid var(--blue); outline-offset: 3px; }
.skip-link { position: fixed; left: 16px; top: -80px; z-index: 200; padding: 10px 14px; color: var(--white); background: var(--ink); }
.skip-link:focus { top: 16px; }
.wrap { width: var(--page); margin: 0 auto; }
.eyebrow { margin: 0 0 18px; color: var(--coral-dark); font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }

.site-header { position: sticky; top: 0; z-index: 80; border-bottom: 1px solid color-mix(in srgb, var(--rule) 82%, transparent); background: color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter: blur(14px); }
.nav { width: var(--page); min-height: var(--nav-h); margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 28px; }
.brand { display: inline-flex; align-items: center; gap: 11px; flex: none; font-size: 21px; font-weight: 800; text-decoration: none; }
.brand img { width: 30px; height: 30px; }
.nav-links { display: flex; align-items: center; justify-content: center; gap: 28px; }
.nav-links a { color: var(--ink-soft); font-size: 14px; font-weight: 600; text-decoration: none; }
.nav-links a:hover { color: var(--ink); }
.nav-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex: none; }
.locale { min-width: 44px; min-height: 44px; padding: 0 8px; display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--ink-soft); text-decoration: none; font-size: 13px; font-weight: 700; }
.locale:hover { color: var(--ink); }
.menu-toggle { display: none; min-width: 52px; min-height: 44px; border: 1px solid var(--ink); background: transparent; font-size: 12px; font-weight: 800; cursor: pointer; }

.button { min-height: 46px; padding: 0 18px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--ink); border-radius: 5px; color: var(--ink); background: transparent; font-size: 14px; font-weight: 800; text-decoration: none; text-align: center; cursor: pointer; transition: transform 180ms ease, color 180ms ease, background 180ms ease; }
.button:hover { transform: translateY(-2px); }
.button:active { transform: translateY(0); }
.button.primary { color: var(--white); background: var(--ink); }
.button.primary:hover { background: var(--coral-dark); }
.button.light { color: var(--ink); background: var(--white); border-color: var(--white); }
.button.coral { color: var(--ink); background: var(--coral); border-color: var(--coral); }

.hero { min-height: calc(100vh - var(--nav-h)); padding: 72px 0 0; overflow: hidden; }
.hero-copy { max-width: 1120px; margin: 0 auto; text-align: center; animation: hero-enter 520ms ease both; }
.hero h1 { max-width: 1050px; margin: 0 auto; font-size: 88px; line-height: 1.04; font-weight: 900; letter-spacing: 0; }
.hero h1 .line { display: block; }
.hero h1 .hit { position: relative; color: var(--coral-dark); }
.hero h1 .hit::after { content: ""; position: absolute; left: 0; right: 0; bottom: 2px; height: 7px; background: var(--coral); transform: rotate(-1.5deg); z-index: -1; }
.hero-lede { max-width: 800px; margin: 28px auto 0; color: var(--ink-soft); font-size: 19px; line-height: 1.7; }
.hero-actions { margin-top: 28px; display: flex; justify-content: center; flex-wrap: wrap; gap: 12px; }
.mac-download-note { max-width: 720px; margin: 14px auto 0; color: var(--ink-soft); font-size: 13px; }
.mac-download-note a { color: var(--coral-dark); font-weight: 800; text-underline-offset: 3px; }
.truth-note { margin: 18px auto 0; color: var(--muted); font-size: 12px; }
.hero-product { width: var(--page); margin: 48px auto 0; position: relative; }
.cost-ribbon { position: relative; z-index: 2; display: grid; grid-template-columns: repeat(4, 1fr); background: var(--coral); border: 1px solid var(--ink); }
.cost-ribbon span { padding: 12px 18px; border-right: 1px solid var(--ink); font-size: 13px; font-weight: 800; text-align: center; text-decoration: line-through 2px var(--ink); }
.cost-ribbon span:last-child { border-right: 0; }
.product-shot, .cost-evidence, .workflow-image-frame, .agent-image { position: relative; overflow: hidden; }
.product-shot img, .cost-evidence img, .workflow-image-frame img, .agent-image img { width: 100%; height: 100%; object-fit: cover; object-position: top center; }
.product-shot { aspect-ratio: 21 / 9; margin-top: -1px; border: 1px solid var(--ink); border-radius: 0 0 6px 6px; box-shadow: var(--shadow); background: var(--white); }

.cost-section { margin-top: 88px; padding: 104px 0; color: var(--white); background: var(--ink); }
.cost-heading { display: grid; grid-template-columns: 1.1fr .7fr; align-items: end; gap: 64px; }
.cost-heading h2, .workflow h2, .stack h2, .open-source h2, .start h2, .community h2, .closing h2 { margin: 0; font-size: 58px; line-height: 1.08; font-weight: 800; letter-spacing: 0; }
.cost-heading > p { margin: 0; color: #b9b6ad; font-size: 17px; }
.cost-tabs { margin-top: 58px; display: grid; grid-template-columns: repeat(4, 1fr); border-block: 1px solid #3d3c38; }
.cost-tab { min-height: 70px; padding: 12px; border: 0; border-right: 1px solid #3d3c38; color: #aaa79f; background: transparent; font-weight: 700; cursor: pointer; }
.cost-tab:last-child { border-right: 0; }
.cost-tab[aria-selected="true"] { color: var(--white); background: var(--coral-dark); }
.cost-panel { padding-top: 54px; display: grid; grid-template-columns: .76fr 1.24fr; gap: 56px; align-items: stretch; }
.cost-panel-copy { align-self: stretch; display: flex; flex-direction: column; justify-content: space-between; }
.cost-index { color: var(--coral); font-size: 15px; font-weight: 800; }
.cost-panel h3 { margin: 28px 0 20px; font-size: 42px; line-height: 1.14; }
.cost-panel p { margin: 0; color: #c7c4bb; font-size: 17px; }
.cost-proof { padding-top: 28px; border-top: 1px solid #3d3c38; color: var(--white); font-weight: 700; }
.cost-evidence { aspect-ratio: 16 / 9.4; max-height: 500px; border: 1px solid #4b4944; border-radius: 6px; background: #20201d; }

.stack { padding: 124px 0; }
.stack-head { max-width: 980px; }
.stack-head p { max-width: 720px; margin: 24px 0 0; color: var(--ink-soft); font-size: 18px; }
.stack-map { margin-top: 72px; border-block: 1px solid var(--ink); }
.stack-row { display: grid; grid-template-columns: 190px 1fr 56px 1fr; align-items: center; min-height: 118px; border-bottom: 1px solid var(--rule); }
.stack-row:last-child { border-bottom: 0; }
.stack-label { color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
.stack-items { display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 20px; font-weight: 700; }
.stack-arrow { color: var(--coral-dark); font-size: 26px; font-weight: 800; text-align: center; }
.stack-result { font-size: 20px; font-weight: 700; }

.workflow { padding: 104px 0; background: var(--surface); border-block: 1px solid var(--rule); }
.workflow-grid { margin-top: 56px; display: grid; grid-template-columns: minmax(280px, 320px) minmax(0, 1fr); gap: 56px; align-items: stretch; }
.workflow-tabs { display: grid; grid-template-rows: repeat(4, 1fr); border-top: 1px solid var(--ink); }
.workflow-tab { width: 100%; min-height: 0; padding: 16px 8px; display: grid; grid-template-columns: 44px 1fr; gap: 12px; align-items: center; border: 0; border-bottom: 1px solid var(--rule); background: transparent; color: var(--muted); text-align: left; cursor: pointer; }
.workflow-tab[aria-selected="true"] { color: var(--ink); }
.workflow-tab span:first-child { font-size: 12px; font-weight: 800; }
.workflow-tab strong { font-size: 18px; }
.workflow-visual { min-width: 0; display: flex; flex-direction: column; }
.workflow-image-frame { width: 100%; max-height: 460px; aspect-ratio: 21 / 10; border: 1px solid var(--ink); border-radius: 6px; background: var(--white); }
.workflow-caption { min-height: 66px; margin: 16px 0 0; color: var(--ink-soft); font-size: 16px; }

.agent-band { color: var(--white); background: #242c29; }
.agent-grid { width: var(--page); margin: 0 auto; padding: 96px 0; display: grid; grid-template-columns: .88fr 1.12fr; align-items: center; gap: 64px; }
.agent-copy h2 { margin: 0; font-size: 56px; line-height: 1.08; }
.agent-copy p { margin: 24px 0 0; color: #c2c8c4; font-size: 17px; }
.agent-list { margin: 34px 0 0; padding: 0; list-style: none; }
.agent-list li { padding: 13px 0; border-bottom: 1px solid #48514d; font-weight: 700; }
.agent-list li::before { content: "✓"; margin-right: 12px; color: #58d598; }
.agent-image { width: 100%; max-height: 480px; aspect-ratio: 16 / 10; border: 1px solid #5c6661; border-radius: 6px; background: #303a36; }

.open-source { padding: 118px 0; background: var(--coral); }
.open-grid { display: grid; grid-template-columns: 1fr .72fr; gap: 100px; align-items: end; }
.open-source h2 { max-width: 810px; }
.open-facts { border-top: 1px solid var(--ink); }
.open-fact { padding: 17px 0; display: flex; justify-content: space-between; gap: 24px; border-bottom: 1px solid color-mix(in srgb, var(--ink) 55%, transparent); font-weight: 700; }
.open-fact span:last-child { text-align: right; }
.open-actions { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 12px; }

.start { padding: 120px 0; }
.start-grid { margin-top: 58px; border-top: 1px solid var(--ink); }
.start-row { min-height: 120px; display: grid; grid-template-columns: 80px 1fr 1fr; gap: 34px; align-items: center; border-bottom: 1px solid var(--rule); }
.start-number { color: var(--coral-dark); font-size: 14px; font-weight: 800; }
.start-row h3 { margin: 0; font-size: 24px; }
.start-row p { margin: 0; color: var(--ink-soft); }
.manual-links { margin-top: 34px; display: flex; flex-wrap: wrap; gap: 12px; }

.community { padding: 118px 0; background: var(--white); border-top: 1px solid var(--rule); }
.community-head { max-width: 980px; }
.community-head p { max-width: 720px; margin: 22px 0 0; color: var(--ink-soft); }
.community-grid { margin-top: 54px; display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.community-card { min-height: 350px; padding: 34px; display: flex; flex-direction: column; justify-content: space-between; border: 1px solid var(--ink); border-radius: 6px; background: var(--paper); }
.community-card.user-community { display: grid; grid-template-columns: minmax(0, 1fr) 172px; gap: 28px; align-items: stretch; }
.community-card.dark { color: var(--white); background: var(--ink); }
.community-card h3 { max-width: 520px; margin: 0; font-size: 32px; line-height: 1.16; }
.community-card p { max-width: 540px; margin: 18px 0 0; color: var(--ink-soft); }
.community-card.dark p { color: #bab7ae; }
.card-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.community-copy { display: flex; min-width: 0; flex-direction: column; justify-content: space-between; gap: 28px; }
.community-qr { margin: 0; padding: 14px; align-self: center; border: 1px solid var(--rule); border-radius: 5px; background: var(--white); scroll-margin-top: calc(var(--nav-h) + 24px); }
.community-qr img { width: 140px; height: 210px; object-fit: contain; }
.community-qr figcaption { max-width: 140px; margin-top: 10px; color: var(--ink-soft); font-size: 12px; font-weight: 700; text-align: center; }

.closing { padding: 110px 0 70px; color: var(--white); background: var(--ink); text-align: center; }
.closing h2 { max-width: 980px; margin: 0 auto; font-size: 68px; }
.closing > .wrap > p:not(.eyebrow) { max-width: 720px; margin: 24px auto 0; color: #bdbab1; }
.closing .hero-actions { margin-top: 34px; }
.footer { margin-top: 80px; padding-top: 28px; display: flex; justify-content: space-between; gap: 24px; border-top: 1px solid #3d3c38; color: #8f8c84; font-size: 12px; text-align: left; }
.footer a { text-underline-offset: 3px; }

dialog { width: min(900px, calc(100vw - 36px)); max-height: calc(100vh - 36px); padding: 0; overflow: auto; border: 1px solid var(--ink); border-radius: 6px; background: var(--paper); color: var(--ink); }
dialog::backdrop { background: rgba(0,0,0,.72); }
.dialog-head { min-height: 62px; padding: 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--rule); }
.dialog-head strong { font-size: 16px; }
.dialog-close { width: 44px; height: 44px; flex: none; border: 0; background: transparent; font-size: 25px; cursor: pointer; }
.dialog-body { padding: 22px; }
.dialog-body video { width: 100%; background: #000; }
.qr-content { max-width: 360px; margin: 0 auto; text-align: center; }
.qr-content img { width: min(300px, 100%); margin: 0 auto; border: 1px solid var(--rule); }
.qr-content p { margin: 16px 0 0; color: var(--ink-soft); }
.download-dialog-body > p { margin: 0 0 22px; color: var(--ink-soft); }
.download-options { border-top: 1px solid var(--ink); }
.download-option { min-height: 76px; padding: 14px 4px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--rule); text-decoration: none; }
.download-option:hover strong { color: var(--coral-dark); }
.download-option span:first-child { min-width: 0; }
.download-option strong, .download-option small { display: block; }
.download-option strong { font-size: 16px; }
.download-option small { margin-top: 3px; color: var(--muted); font-size: 12px; }
.download-option > span:last-child { flex: none; color: var(--coral-dark); font-size: 12px; font-weight: 800; }
.mac-install-guide { margin-top: 26px; padding-top: 24px; border-top: 1px solid var(--ink); }
.mac-install-guide-title { display: block; font-size: 16px; }
.mac-install-guide p { margin: 10px 0 0; color: var(--ink-soft); }
.mac-install-guide ol { margin: 14px 0 0; padding-left: 22px; }
.mac-install-guide li + li { margin-top: 8px; }
.mac-install-command { margin-top: 12px; padding: 12px 14px; display: block; max-width: 100%; overflow-wrap: anywhere; border: 1px solid var(--ink); background: var(--ink); color: var(--white); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
.mac-install-guide .mac-install-safety { color: var(--muted); font-size: 12px; }
.download-fallback { padding: 82px 0; background: var(--surface); border-top: 1px solid var(--rule); }
.download-fallback h2 { margin: 0; font-size: 42px; line-height: 1.1; }
.download-fallback p { max-width: 680px; color: var(--ink-soft); }
.download-fallback .download-options { max-width: 760px; margin-top: 28px; }
.download-fallback .mac-install-guide { max-width: 760px; }

[data-reveal] { animation: reveal 520ms ease both; }
@keyframes hero-enter { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes reveal { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

@media (max-width: 1140px) {
  .nav { gap: 18px; }
  .nav-links { gap: 18px; }
  .nav-links a { font-size: 13px; }
}
@media (max-width: 1050px) {
  .hero h1 { font-size: 66px; }
  .cost-heading h2, .workflow h2, .stack h2, .open-source h2, .start h2, .community h2 { font-size: 48px; }
  .nav-links { display: none; }
  .workflow-grid { grid-template-columns: 260px minmax(0, 1fr); gap: 40px; }
  .agent-grid { grid-template-columns: 1fr; min-height: 0; }
  .agent-image { justify-self: center; }
  .open-grid { gap: 48px; }
}
@media (max-width: 760px) {
  :root { --page: calc(100vw - 32px); --nav-h: 64px; }
  .nav-download { display: none; }
  .menu-toggle { display: inline-flex; align-items: center; justify-content: center; }
  .nav-links.open { position: fixed; inset: var(--nav-h) 0 auto; padding: 20px 16px; display: grid; gap: 0; background: var(--paper); border-bottom: 1px solid var(--ink); box-shadow: 0 18px 35px rgba(23,23,21,.12); }
  .nav-links.open a { min-height: 48px; display: flex; align-items: center; border-bottom: 1px solid var(--rule); }
  .hero { padding-top: 54px; }
  .hero h1 { font-size: 45px; line-height: 1.08; }
  .hero-lede { font-size: 16px; }
  .hero-actions .button { width: 100%; }
  .cost-ribbon { grid-template-columns: 1fr 1fr; }
  .cost-ribbon span { border-bottom: 1px solid var(--ink); }
  .cost-ribbon span:nth-child(2) { border-right: 0; }
  .cost-ribbon span:nth-child(n+3) { border-bottom: 0; }
  .product-shot { aspect-ratio: 4 / 3; }
  .product-shot img { object-position: 52% top; }
  .cost-section { margin-top: 72px; padding: 82px 0; }
  .cost-heading, .cost-panel, .open-grid { grid-template-columns: 1fr; }
  .cost-heading { gap: 24px; }
  .cost-heading h2, .workflow h2, .stack h2, .open-source h2, .start h2, .community h2 { font-size: 38px; }
  .cost-tabs { grid-template-columns: 1fr 1fr; }
  .cost-tab { border-bottom: 1px solid #3d3c38; }
  .cost-tab:nth-child(2) { border-right: 0; }
  .cost-tab:nth-child(n+3) { border-bottom: 0; }
  .cost-panel { min-height: 0; gap: 36px; }
  .cost-panel-copy { gap: 34px; }
  .cost-panel h3 { font-size: 32px; }
  .cost-evidence { width: 100%; max-height: none; aspect-ratio: 4 / 3; }
  .stack, .workflow, .open-source, .start, .community { padding: 82px 0; }
  .stack-row { padding: 24px 0; grid-template-columns: 1fr; gap: 12px; }
  .stack-arrow { width: 24px; text-align: left; transform: rotate(90deg); }
  .workflow-grid { grid-template-columns: 1fr; gap: 28px; }
  .workflow-tabs { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-rows: repeat(2, 1fr); }
  .workflow-tab { min-width: 0; grid-template-columns: 30px minmax(0, 1fr); min-height: 72px; padding-right: 12px; }
  .workflow-image-frame { max-height: none; aspect-ratio: 4 / 3; }
  .agent-grid { width: var(--page); padding: 82px 0; gap: 42px; }
  .agent-copy h2 { font-size: 40px; }
  .agent-image { max-height: none; aspect-ratio: 4 / 3; }
  .open-grid { gap: 48px; }
  .start-row { padding: 24px 0; grid-template-columns: 44px 1fr; gap: 12px; }
  .start-row p { grid-column: 2; }
  .community-grid { grid-template-columns: 1fr; }
  .community-card { min-height: 310px; padding: 26px; }
  .community-card.user-community { grid-template-columns: 1fr; gap: 28px; }
  .community-qr { justify-self: center; }
  .closing { padding-top: 82px; }
  .closing h2 { font-size: 44px; }
  .footer { flex-direction: column; }
  .download-fallback h2 { font-size: 34px; }
}
@media (max-width: 360px) {
  :root { --page: calc(100vw - 24px); }
  .brand span { display: none; }
  .actions, .closing-actions { flex-direction: column; }
  .button { max-width: 100%; }
  .community-card { padding-inline: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
  .hero-copy, [data-reveal] { animation: none; }
}
`
