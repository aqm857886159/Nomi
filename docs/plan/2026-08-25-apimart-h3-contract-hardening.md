# APIMart MiniMax H3 契约加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to execute each task in order.

**Goal:** 让 MiniMax H3 的最终请求体在发送前严格满足 APIMart 的首尾帧/多模态参考互斥契约，并把 headless 视频轮询默认值对齐到官方建议。

**Architecture:** 保留 APIMart 单一异步端点和当前模式投影；在模板渲染完成后的请求变换层增加 H3 专属、可审计的契约护栏，发现混发或音频单独输入时在扣费前失败。轮询预算抽成纯函数，UI 行为不变，MCP/headless 视频默认等待 15 分钟并继续允许 `NOMI_POLL_TIMEOUT_MS` 覆盖。

**Tech Stack:** Electron + TypeScript + Vitest + APIMart curated catalog.

---

### Task 1: H3 最终请求体互斥护栏

**Files:**
- Modify: `electron/catalog/apimartVideos.ts`
- Modify: `electron/tasks/requestTransforms.ts` (only if registration needs a shared import boundary)
- Create: `electron/catalog/apimartMinimaxH3.ts` if the transform is kept beside the APIMart recipe
- Test: `electron/catalog/apimartSeedance25H3.test.ts`

- [x] **Step 1: Write failing tests**

  Render the H3 `image_to_video` mapping with both frame and reference fields populated. Assert that the named request transform rejects the body before transport. Render an audio-only R2V body and assert the same transform rejects it. Assert a valid frame body removes the ignored `aspect_ratio` and empty `webhook` fields.

- [x] **Step 2: Run the focused test and verify the expected failure**

  Run `pnpm vitest run electron/catalog/apimartSeedance25H3.test.ts --reporter=verbose`.

- [x] **Step 3: Implement the smallest request transform**

  Register `apimart-minimax-h3` and attach it only to the H3 `image_to_video` mapping. The transform must inspect the rendered body, throw a user-facing deterministic error for frame/reference mixing or audio-only reference input, and delete `aspect_ratio` for frame requests plus empty optional `webhook` values.

- [x] **Step 4: Run the focused test and verify it passes**

  Run the same Vitest command and confirm all H3 tests pass.

### Task 2: Headless polling budget

**Files:**
- Modify: `electron/capabilityCore/core.ts`
- Test: `electron/capabilityCore/core.test.ts`

- [x] **Step 1: Write a failing pure-function test**

  Export a resolver for the effective poll timeout and assert video kinds default to `900000`, non-video kinds remain `240000`, and a positive `NOMI_POLL_TIMEOUT_MS` value still wins.

- [x] **Step 2: Run the focused test and verify the expected failure**

  Run `pnpm vitest run electron/capabilityCore/core.test.ts --reporter=verbose`.

- [x] **Step 3: Implement the resolver and use it in the existing loop**

  Replace the inline `300000` video default with the resolver; preserve the existing timeout error and no-resubmit behavior.

- [x] **Step 4: Run focused tests**

  Run the H3 test and core test together.

### Task 3: Verification and delivery

**Files:**
- No additional source files.

- [x] Run focused tests, then `pnpm run check:filesize`, `pnpm run check:tokens`, `pnpm run check:i18n`, `pnpm run lint:ci`, `pnpm run typecheck`, `pnpm run test`, and `pnpm run build`.
- [ ] Inspect the diff, commit only scoped files, push `codex/apimart-h3-contract-fix-20260825`, and open a pull request against `main`.
