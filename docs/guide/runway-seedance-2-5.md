# Runway Seedance 2.5 in Nomi

> ⚠️ **未发布 · 随方案一起打捞入库（2026-09-02）。** 本文写于 2026-08-30 的
> `codex/runway-seedance25-onboarding` 分支，该分支实测**只含文档、没有任何代码改动**且从未合并。
> 截至打捞时 `electron/providerAdapter/` 与 `electron/vendor/` 下**没有 Runway 一手适配器**，
> 所以下面描述的是**计划中的**连接，不是当前版本已具备的能力。配套方案见
> [`docs/plan/2026-08-30-runway-seedance25-onboarding.md`](../plan/2026-08-30-runway-seedance25-onboarding.md)。
> 真接入之后请删掉本横幅。

This guide covers the native Runway Dev connection included in the next Nomi release. Nomi sends requests directly to Runway with the API key you enter locally; Nomi does not proxy or resell Runway generation.

## What is supported

- **Text to video**: prompt, aspect ratio, resolution, duration, and audio options from the Seedance 2.5 capability profile.
- **Image to video**: one storyboard/keyframe image plus the same video controls.
- **Task polling**: Nomi follows the Runway task until it succeeds or fails and stores the resulting video in the local project.

Runway's native `promptImage` field is a single-image input. The existing KIE/APIMart Seedance connections remain the choice for Seedance multi-reference modes (multiple images, videos, or audio) until a Runway-specific multi-reference contract is verified.

## Configure the provider

1. Open **Model connections** and choose **Runway Dev**.
2. Create a Runway API secret in the Runway developer console and paste it into Nomi. The key is stored in the local catalog only.
3. Add or enable **Seedance 2.5 · Runway**.
4. Start with a 5-second, 720p test. Select **Text to video** for a prompt-only test or **Image to video** and connect one approved storyboard frame.
5. Run the test and confirm that the task reaches a terminal state before using it for a batch.

The native endpoint is `https://api.dev.runwayml.com`; Nomi adds the required `X-Runway-Version` request header and uses the provider's task endpoint for polling.

## Reference-image transport and the anonymous-upload error

For a local image connected to Runway, Nomi uses a provider-private `data:` URI in `promptImage`. It does not use the anonymous `litterbox.catbox.moe` → `tmpfiles.org` fallback chain for this path. This is important for the recurring error:

```text
All no-configuration upload hosts failed: litterbox.catbox.moe ... tmpfiles.org ...
```

If an image is too large for Runway's data-URI limit, Nomi will stop before spending credits and explain that a supported private upload channel is required. Do not solve this by posting private production references to a public anonymous host. Resize or compress the storyboard frame, or use KIE/APIMart for a flow that needs provider-hosted references.

## Storyboard workflow

Nomi's next storyboard iteration will add a **storyboard settings** surface for choosing the shot defaults before materializing the plan. It is intentionally a settings layer, not a promise that every storyboard can be generated automatically in one step. After release, try it with your own script and reference set; feedback about confusing defaults, missing controls, or continuity problems will guide the next iteration.

## Troubleshooting checklist

- **401/403**: check that the Runway API secret is active and was pasted without extra spaces.
- **A local frame is rejected before the request**: check the file type and reduce its size; keep the original project file local.
- **The task fails after submission**: copy the redacted task id and provider error message. Never share the API key or private image URLs.
- **You need multiple reference images/videos/audio**: use the existing KIE/APIMart Seedance 2.5 connection for now and tell us which Runway workflow should be supported next.

For help with a redacted setup, contact **2373272608@qq.com** or message us on [X/Twitter](https://x.com/sdf297417627618). Public issues should contain only non-sensitive details.

## Official Runway references

- [Runway model catalogue](https://docs.dev.runwayml.com/guides/models/)
- [Runway input assets](https://docs.dev.runwayml.com/assets/inputs/)
- [Runway API guide](https://docs.dev.runwayml.com/guides/using-the-api/)
- [Runway task polling](https://docs.dev.runwayml.com/api-details/sdks/)
