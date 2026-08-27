# Marketing GitHub Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the latest `origin/main` Nomi marketing homepage so both locales have a same-sized GitHub collaboration CTA, no hero-only English float label, and no 60-second workflow CTA while preserving the existing layout and SEO.

**Architecture:** Keep `scripts/marketing/content.mjs` as the bilingual copy source, `scripts/marketing/template.mjs` as the semantic HTML renderer, and `scripts/marketing/styles.mjs` as the shared token-based presentation layer. The generated `marketing/index.html` and `marketing/en/index.html` are rebuilt by `pnpm run build:site`; the existing marketing static and Playwright visual tests become the contract for the new CTA and removed hero entry.

**Tech Stack:** Node.js ESM marketing build scripts, static HTML, shared CSS template string, Playwright, Vitest project gates.

---

### Task 1: Lock the new hero contract in tests

**Files:**
- Modify: `tests/ux/marketing-home.static.mjs`
- Modify: `tests/ux/marketing-home.visual.mjs`

- [ ] **Step 1: Replace the old hero assertions with the new bilingual CTA contract**

In `tests/ux/marketing-home.static.mjs`, keep the existing localized H1, section, metadata, and asset checks. Replace the assertion that requires the localized film dialog with these assertions inside the `for (const html of [zh, en])` loop:

```js
  expect(html.includes('class="hero-actions"'), 'hero actions remain present')
  expect(html.includes('data-github-hero'), 'hero GitHub CTA is marked for verification')
  expect(html.includes('https://github.com/aqm857886159/Nomi'), 'hero GitHub CTA uses the canonical repository')
  expect(html.includes('target="_blank" rel="noreferrer"'), 'hero GitHub CTA opens an external repository safely')
  expect(!html.includes('data-open-dialog="launch-film"'), 'hero no longer opens the 60-second workflow dialog')
  expect(!html.includes('观看 60 秒工作流') && !html.includes('Watch the 60s workflow'), '60-second hero copy is removed')
  expect(!html.includes('OPEN-SOURCE · LOCAL-FIRST · AI VIDEO WORKBENCH'), 'hero-only generic English float label is removed')
```

Remove the existing `html.includes('<dialog id="launch-film"') && html.includes('<track kind="captions"')` expectation. Keep the film asset existence checks because assets are not removed until a full reference search proves they are unused outside the homepage.

- [ ] **Step 2: Run the focused static test and verify it fails for the old hero**

Run: `node tests/ux/marketing-home.static.mjs`

Expected: FAIL because the generated `marketing/index.html` and `marketing/en/index.html` still contain the old hero eyebrow, film trigger, and film dialog.

- [ ] **Step 3: Add visual facts for the new CTA and the removed hero elements**

In `tests/ux/marketing-home.visual.mjs`, extend the `page.evaluate` facts object in `auditStandardCase` with:

```js
    heroGithub: (() => {
      const link = document.querySelector('[data-github-hero]')
      if (!link) return false
      const style = getComputedStyle(link)
      const download = document.querySelector('.hero-actions [data-download-nomi]')
      const downloadRect = download?.getBoundingClientRect()
      const linkRect = link.getBoundingClientRect()
      return Boolean(
        link.href === 'https://github.com/aqm857886159/Nomi' &&
          link.target === '_blank' &&
          link.rel.includes('noreferrer') &&
          style.borderColor &&
          downloadRect &&
          Math.abs(linkRect.height - downloadRect.height) <= 1 &&
          style.minHeight === getComputedStyle(download).minHeight &&
          style.paddingLeft === getComputedStyle(download).paddingLeft &&
          style.paddingRight === getComputedStyle(download).paddingRight &&
          style.fontSize === getComputedStyle(download).fontSize &&
          style.fontWeight === getComputedStyle(download).fontWeight &&
          style.borderRadius === getComputedStyle(download).borderRadius,
      )
    })(),
    heroGenericEyebrow: Boolean(document.querySelector('.hero .eyebrow')),
    heroFilmTrigger: Boolean(document.querySelector('.hero [data-open-dialog="launch-film"]')),
    heroContribution: Boolean(document.querySelector('.hero .hero-contribution')),
```

Add these assertions after the existing download-path assertion:

```js
  assert(facts.heroGithub && facts.heroContribution, `${testCase.name}: hero GitHub CTA matches download sizing and has an invitation`)
  assert(!facts.heroGenericEyebrow && !facts.heroFilmTrigger, `${testCase.name}: generic hero eyebrow and film trigger are removed`)
```

Replace the film-dialog interaction block in `auditStandardCase` (the `expectedTrack` declaration through the Escape/wait block) with:

```js
  assert(await page.locator('[data-github-hero]').count() === 1, `${testCase.name}: one hero GitHub CTA exists`)
```

In `auditNoJavaScript`, replace the `watchHref` lookup and its film-link assertion with:

```js
  const heroGithub = await page.locator('[data-github-hero]').count()
  const heroFilm = await page.locator('.hero [data-open-dialog="launch-film"]').count()
  const heroContribution = await page.locator('.hero .hero-contribution').count()
  assert(heroGithub === 1 && heroFilm === 0 && heroContribution === 1, `${locale}: no-JS hero GitHub path remains without the film path`)
```

Keep the existing direct installer assertions and all other dialog tests, because the download and maintainer dialogs remain in scope.

- [ ] **Step 4: Run the focused visual test and verify the old implementation fails the new contract**

Run: `node tests/ux/marketing-home.visual.mjs`

Expected: FAIL on the new hero CTA/removed-element assertions before implementation.

- [ ] **Step 5: Commit the contract changes**

```bash
git add tests/ux/marketing-home.static.mjs tests/ux/marketing-home.visual.mjs
git commit -m "test(marketing): specify hero GitHub collaboration CTA"
```

### Task 2: Render the bilingual hero CTA from the remote source of truth

**Files:**
- Modify: `scripts/marketing/content.mjs`
- Modify: `scripts/marketing/template.mjs:70-88`

- [ ] **Step 1: Replace only hero content fields in both locale objects**

In the Chinese `hero` object, remove `eyebrow` and `watch`, and add:

```js
    github: '去 GitHub 参与改进 ↗',
    contribution: '项目还在快速迭代。遇到问题欢迎提 Issue，想一起改进可以提交 PR。',
```

In the English `hero` object, remove `eyebrow` and `watch`, and add:

```js
    github: 'Help improve it on GitHub ↗',
    contribution: 'Nomi is still evolving. Found a problem? Open an issue. Want to help shape it? Send a pull request.',
```

Do not alter either locale’s title, lede, macOS notice, truth note, ribbon, image alt, metadata, or section eyebrow fields.

- [ ] **Step 2: Update `renderHero` without changing the surrounding hero structure**

In `scripts/marketing/template.mjs`, change `renderHero` to render this exact hero body after the existing heading and lede:

```js
    <div class="hero-actions">
      <a class="button primary" data-download-nomi href="#download-options">${escapeText(content.hero.download)}</a>
      <a class="button hero-github" data-github-hero href="${escapeAttr(shared.repositoryUrl)}" ${externalAttrs}>${escapeText(content.hero.github)}</a>
    </div>
    <p class="hero-contribution">${escapeText(content.hero.contribution)}</p>
```

Remove the hero eyebrow output and the old `data-open-dialog="launch-film"` link. Leave `hero-product`, the ribbon, and all dialog rendering unchanged until the reference search in Task 3 confirms whether the film dialog can be safely removed.

- [ ] **Step 3: Rebuild the generated homepage and rerun static tests**

Run: `pnpm run build:site && node tests/ux/marketing-home.static.mjs`

Expected: the build check passes; the static test now passes its new CTA, float-label, and 60-second hero assertions, while the existing film-dialog assertion has already been removed.

- [ ] **Step 4: Commit the content/template change**

```bash
git add scripts/marketing/content.mjs scripts/marketing/template.mjs marketing/index.html marketing/en/index.html
git commit -m "feat(marketing): add bilingual hero GitHub CTA"
```

### Task 3: Match the CTA styling and remove only dead film wiring

**Files:**
- Modify: `scripts/marketing/styles.mjs:45-61`
- Modify: `scripts/marketing/template.mjs` only if the reference search proves the dialog is dead
- Modify: `tests/ux/marketing-home.static.mjs` only if dead-film assertions need a precise asset/reference update

- [ ] **Step 1: Verify all launch-film references before deleting anything**

Run:

```bash
rg -n "launch-film|data-open-dialog=\"launch-film\"|demo\.mp4|launch-film-(zh|en)" marketing scripts tests docs README.md README.zh-CN.md
```

Expected: after Task 2, no hero trigger remains. If the only remaining `launch-film` references are the dialog markup, its localized captions, and the generic dialog behavior, remove the dialog markup from `scripts/marketing/template.mjs` and remove only the film-specific static asset assertions if the files become intentionally unreferenced. Do not remove `demo.mp4` or launch-film files solely because the hero trigger is gone if another page or documentation still references them.

- [ ] **Step 2: Add the minimal existing-token style for the GitHub button and invitation**

Immediately after the existing `.button.coral` rule in `scripts/marketing/styles.mjs`, add:

```css
.button.hero-github { color: var(--coral-dark); border-color: var(--coral-dark); }
.button.hero-github:hover { color: var(--white); background: var(--coral-dark); }
.hero-contribution { max-width: 720px; margin: 12px auto 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
```

Do not change `.button`, `.hero-actions`, `.hero-lede`, `.mac-download-note`, `.truth-note`, or the mobile `.hero-actions .button { width: 100%; }` rule; this guarantees equal button dimensions and existing responsive behavior.

- [ ] **Step 3: Rebuild and run the focused visual test**

Run: `pnpm run test:site:visual`

Expected: all desktop/mobile, no-JS, reduced-motion, blocked-media, and locale-preference checks pass, including equal hero button dimensions and no hero eyebrow/film trigger.

- [ ] **Step 4: Commit the style and dead-code cleanup**

```bash
git add scripts/marketing/styles.mjs scripts/marketing/template.mjs tests/ux/marketing-home.static.mjs marketing/index.html marketing/en/index.html
git commit -m "refactor(marketing): simplify hero collaboration actions"
```

### Task 4: Full verification and visual handoff

**Files:**
- Modify: none unless a focused verification exposes a scoped regression
- Inspect: `marketing/index.html`, `marketing/en/index.html`, `marketing/sitemap.xml`, generated screenshots under `tests/ux/_marketing/`

- [ ] **Step 1: Run all website gates**

Run:

```bash
pnpm run test:site
pnpm run test:site:visual
```

Expected: both commands exit 0; the generated pages preserve canonical URLs, reciprocal hreflang, descriptions, OG/Twitter metadata, direct downloads, and community/business paths.

- [ ] **Step 2: Inspect fresh screenshots at all required breakpoints**

Review `tests/ux/_marketing/home-zh-desktop-first.png`, `home-en-desktop-first.png`, `home-zh-mobile-first.png`, `home-en-mobile-first.png`, and `home-en-320-first.png`. Confirm visually that the GitHub button is the same height, font, weight, and spacing as download; the coral outline is the only new visual emphasis; hero content did not become a banner or a new layout; and the invitation wraps cleanly on mobile.

- [ ] **Step 3: Perform a generated-file and diff audit**

Run:

```bash
git diff origin/main --stat
git diff --check
git status --short --branch
```

Expected: only the scoped design/plan docs, marketing content/template/style/tests, and generated homepage files differ from `origin/main`; no current-workspace files are present because this branch is isolated.

- [ ] **Step 4: Commit any final test-only adjustment and report the handoff**

```bash
git log --oneline --decorate -4
git status --short --branch
```

Report the isolated branch, commit IDs, exact verification commands/results, screenshot paths, and explicitly distinguish local completion from push/PR status.
