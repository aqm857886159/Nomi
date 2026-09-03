# 落地页：GSAP 轻量动画 + SEO 标准修补

> 裁决：已被 CSS-only 静态营销站取代；证据：`tests/ux/marketing-home.static.mjs:196-198`、`docs/superpowers/specs/2026-08-01-nomi-bilingual-growth-destination-design.md:111-120`。

> 范围决策（用户拍板）：GSAP **轻量打磨** · 装 **gsap-skills** · SEO **标准修补**。
> 只动 `marketing/`，纯静态站，Cloudflare 静态部署不变。

## 不动什么
- 不改设计 / 配色 / 文案（文案已在上一次诚实重写定稿）。
- 不改构建流程（`build:site` 仍是 no-op 校验）。
- 不引入 npm 依赖：GSAP 走 CDN `<script>`，零构建。
- 不重新编码图片（属"深度优化"，本次不做）。

## 1. GSAP 轻量动画（marketing/index.html）
CDN：`gsap` + `ScrollTrigger`（jsDelivr 固定版本）。注入在 `</body>` 前。

效果（克制、尊重无障碍）：
- **Hero 入场**：`.hero-row` 四行 + mascot 卡 + `.hero-foot` 时间轴 stagger（autoAlpha + y），页面加载即播。
- **滚动渐入**：`.section-head / .pillar-row / .showcase-shot / .philo-text / .os-grid 子项 / .repo-card / .manifesto-quote / .eq-line / .eq-foot` 用 `ScrollTrigger.batch` 进入视口时 stagger 上浮渐入（once）。
- **mascot 微浮动**：`y` 轻微 repeat/yoyo 循环。
- **overlay 进度条**：`.ov-progress span` 宽度从 0 填到 62%。

防闪烁 + 容错：
- head 内联 `document.documentElement.classList.add('anim')`，CSS `html.anim <选择器>{opacity:0}` 预隐藏 → 无 FOUC。
- 若 GSAP CDN 加载失败（`!window.gsap`）：脚本移除 `.anim`，全部内容恢复可见（绝不把内容永久藏掉）。
- `gsap.matchMedia()` + CSS `@media (prefers-reduced-motion: reduce)` 双保险：减少动态偏好下全部直接可见、零位移。

## 2. SEO 标准修补
- **favicon**：`<link rel="icon" type="image/svg+xml" href="/assets/nomi-logo.svg">` + `apple-touch-icon`（mascot.png）。
- **社交补全**：`og:locale=zh_CN`、`og:image:width/height/alt`、`twitter:image:alt`。
- **JSON-LD 扩展**：加 `inLanguage`、`offers`(price 0, 免费)、`featureList`、`screenshot`、`author/publisher`(Organization)。
- **图片**：4 张 `<img>` 补 `width`/`height`（防 CLS）+ 首屏外的 3 张截图加 `loading="lazy" decoding="async"`（mascot 首屏 eager）。
  - mascot 666×660；screen-*.png 3834×1914。
- **sitemap.xml**：`lastmod` 2026-05-05 → 2026-06-01。

## 回滚策略
单文件改动为主（index.html + sitemap.xml），`git revert` 即可。GSAP 失败有运行时容错，不影响内容可读。

## 验收门
1. `pnpm run build:site` 绿。
2. 本地 4321 预览：首屏入场动画播放、滚动各区渐入、reduced-motion 下内容全可见。
3. `view-source` 确认 favicon / og 补全 / JSON-LD 扩展 / img 带尺寸 / sitemap lastmod 更新。
4. 控制台无报错；GSAP 全局存在。
