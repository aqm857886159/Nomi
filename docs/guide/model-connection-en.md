# Connect your first model

This is the English tutorial for adding a model to Nomi. It covers the path that matters when you arrive with your own provider: connect one model, prove the request shape, then use it in a storyboard.

Nomi stores projects, prompts, and API keys on your computer. Do not paste a key into a GitHub issue, Discussion, screenshot, or tutorial comment.

## 1. Start with the latest desktop build

Download the current macOS or Windows build from [GitHub Releases](https://github.com/aqm857886159/Nomi/releases/latest), then open Nomi and create or open a project.

For a first test, use one text model and one image model. You can add video after the image path works.

## 2. Add a provider

Open **Model setup** in the top toolbar and choose **Add provider**.

Fill in:

1. **Provider name** — a name you will recognise, such as `My OpenAI relay`.
2. **API Base URL** — use the base URL from that provider's official documentation. Do not guess whether `/v1` belongs in the URL; follow the provider's example request.
3. **API key** — enter it in Nomi's secure form. It is kept in local app storage.
4. **Model ID** — copy the exact model identifier from the provider documentation. A display name is not enough.

Choose the model kind and task mode that match the documented endpoint:

| You want to do | Mode | Typical request shape |
|---|---|---|
| Write a script or split shots | Text | Chat or Responses API |
| Generate an image | Text to image | `POST /v1/images/generations` or the provider's documented equivalent |
| Edit an image with references | Image edit | `POST /v1/images/edits`, multipart, or the provider's documented multimodal route |
| Generate a video | Text to video / Image to video | The provider's documented create and polling endpoints |

The route and body are a contract, not a guess. For example, an OpenAI-compatible image endpoint expects a pixel `size` such as `1024x1024`; a different provider may call the same control `aspect_ratio` or `resolution`.

### OpenAI GPT Image 2

For the official OpenAI API, choose the **OpenAI** preset (`https://api.openai.com/v1`), add model ID `gpt-image-2`, and choose **Image** rather than **Text**. The official image generation path is the [Images API](https://developers.openai.com/api/docs/guides/images-vision): use `POST /v1/images/generations` for text-to-image and `POST /v1/images/edits` with multipart image files for image editing. Chat Completions is the documented path for image understanding and text responses, not the path to use for creating an image.

In Nomi, **Auto** means “let the image endpoint choose the size” and therefore omits the `size` field. If you choose a concrete ratio, Nomi translates it to a pixel size such as `1024x576` before sending an OpenAI-compatible request. This distinction is what prevents the `Invalid size ""` error reported in [Issue #237](https://github.com/aqm857886159/Nomi/issues/237).

## 3. Test before you build a storyboard

Click **Test** in the provider form before saving. The test should prove the selected model and mode, not just that the host is reachable.

If the test passes, save the provider and select the model in an image or video node. Run one small generation first. Only after that should you add many references or start a long storyboard.

If the test says that the guessed call shape does not match, changing the URL or key repeatedly will not fix it. Re-open the provider's official API example and check these values one by one:

- base URL and API version;
- authentication header or query parameter;
- model ID;
- operation path (`images/generations`, `images/edits`, chat, or another route);
- JSON vs multipart body;
- required parameter names and value types;
- response field containing the image/video URL or task ID.

## 4. Add references deliberately

For image edit or image-to-video, add one reference first and test it. Providers differ in what they accept:

- a public `https://` image URL;
- a local file uploaded through the provider's endpoint;
- a base64 data URL;
- a provider-specific reference field.

If Nomi reports **“All no-configuration upload hosts failed”**, that is an upload transport problem (network, proxy, or a blocked anonymous host), not proof that your model key is wrong. Use a configured provider upload path or a network that can reach the host. Do not upload confidential production references to an anonymous host.

## 5. Common errors

| Error | What it usually means | Next action |
|---|---|---|
| `Invalid size ""` | An OpenAI-compatible image request received an empty pixel size. | Update to a build containing the Issue #237 fix, or choose an explicit ratio/size such as `1:1` / `1024x1024` for now. |
| `The model and connection are still saved` | Credentials were saved, but the production call has not passed verification. | Keep the model disabled until a real test succeeds. |
| `call shape ... does not match theirs` | The adapter shape does not match the provider contract. | Follow the provider's official request example and correct the operation/body; do not keep rotating keys. |
| `Provider request failed (HTTP 500)` | The upstream endpoint or relay returned a server error. | Check the exact endpoint, model ID, provider status, and a minimal request outside Nomi; redact secrets before sharing logs. |

## 6. Ask for help with enough evidence

Use [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions) for setup questions and [Issues](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml) for reproducible bugs. Include:

- Nomi version and operating system;
- provider type and API base host (omit keys and private paths);
- model ID and task mode;
- the redacted request shape and response/error body;
- whether a text-only or one-image minimal test works.

Never include API keys, phone numbers, private email addresses, or confidential reference images in a public post.

## Official places to follow Nomi

- [Nomi website](https://nomiaqm.com/en/)
- Workflow support: **2373272608@qq.com**
- [Nomi on X / Twitter](https://x.com/sdf297417627618)
- [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- [Business inquiry](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml)

## Want Codex to investigate a bug?

If you can run Codex with a GitHub checkout, use the [copy-paste Codex issue-fix prompt](codex-issue-fix-prompt-en.md). It tells Codex how to clone the repository, inspect the provider contract, reproduce the request with a mock, protect secrets, and deliver a branch/PR instead of changing `main` directly.

If you need to connect a provider urgently without opening a PR, use the [Codex / Claude Code provider-setup prompt](model-integration-prompt-en.md). It uses Nomi's `model-integration` Skill and MCP tools first; if the installed build lacks a provider-private upload route, it limits local source work to a documented Runway upload channel and does not add a Runway model adapter.
