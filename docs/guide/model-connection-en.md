# Connect your first model

This is the English tutorial for adding a model to Nomi. It covers the path that matters when you arrive with your own provider: connect one model, prove the request shape, then use it in a storyboard.

Nomi stores projects, prompts, and API keys on your computer. Do not paste a key into a GitHub issue, Discussion, screenshot, or tutorial comment.

## 1. Start with the latest desktop build

Download the current macOS or Windows build from [GitHub Releases](https://github.com/aqm857886159/Nomi/releases/latest), then open Nomi and create or open a project.

For a first test, use one text model and one image model. You can add video after the image path works.

## 2. Add a provider

Open **Settings → Models** and choose **Custom API / gateway** under **Other connection methods**. If you already have connections, expand **Local runtimes and Dreamina membership** under **Other methods** to find that entry. If your provider has a preset, use its connection card instead. Older builds called this screen **Model setup**; update first if your controls differ.

Fill in:

1. **Source name** — a provider/connection name you will recognise, such as `My image API`.
2. **Base URL** — use the base URL from that provider's official documentation. Do not guess whether `/v1` belongs in the URL; follow the provider's example request.
3. **API key** — enter it in Nomi's secure form. It is kept in local app storage.
4. Click **Save connection**. Saving preserves the connection locally; it is not a successful generation test.
5. Choose models from **Get Models**, or use **Enter Manually** if the provider has no model-list endpoint. For **Model ID**, copy the exact identifier from its documentation. A display name is not enough. A failed model-list request does not discard the saved connection.
6. Check **Model type** in the model's settings: choose **Image**, **Video**, or **Text** as appropriate. In **Inputs and generation**, check the available modes and reference slots. In **Request method**, check how those inputs are sent. A text protocol choice alone does not configure an image API.

Choose the model type and task mode that match the documented endpoint. The Mode column uses the labels shown in the model's settings:

| You want to do | Model type | Mode | Request contract to check |
|---|---|---|---|
| Write a script or split shots | **Text** | **Text generation** | Provider's Chat or Responses API |
| Generate an image | **Image** | **Text to image** | Images generation or the provider's documented equivalent |
| Edit an image with references | **Image** | **Reference image edit** | Multipart image edits or the provider's documented multimodal route |
| Generate a video | **Video** | **Text to video** or **Reference image video** | Provider's create and result/polling endpoints |

The route and body are a contract, not a guess. For example, an OpenAI-compatible image endpoint expects a pixel `size` such as `1024x1024`; a different provider may call the same control `aspect_ratio` or `resolution`.

### OpenAI GPT Image 2

For the official OpenAI API, connect `https://api.openai.com/v1`, add model ID `gpt-image-2`, and choose **Image**. Check the [model reference](https://developers.openai.com/api/docs/models/gpt-image-2) and [Images API guide](https://developers.openai.com/api/docs/guides/image-generation): JSON `POST /v1/images/generations` creates images; multipart `POST /v1/images/edits` sends reference files in `image[]`. Common fields include `model`, `prompt`, integer `n`, and optional `size` and `quality`. GPT Image 2 returns image data in `data[].b64_json`; a relay may document a different response. The [images and vision guide](https://developers.openai.com/api/docs/guides/images-vision) also covers image understanding, which is a different task from creating an image.

In Nomi's OpenAI-compatible image mapping, **Auto** omits `size`; it must not send `size: ""`. Concrete ratios and resolution tiers become pixel dimensions. GPT Image 2 requires dimensions divisible by 16, a longest edge no greater than 3840, a ratio no wider than 3:1, and 655,360–8,294,400 pixels. For example, `1024x1024` is valid, but `1024x576` is too small. The derived 1K landscape size may therefore be larger than 1024 pixels on its long edge (16:9 becomes `1088x608`). A ratio wider than 3:1 cannot be expressed in that field, so Nomi refuses it before sending and asks you to pick another ratio instead of silently dropping `size`. Check these constraints in the guide's **Earlier GPT Image models** section, not the newer 2.5 settings.

A relay is a separate contract: do not infer its endpoint, parameter names, or response shape from “OpenAI-compatible” or the model name. A custom request script also owns its own HTTP calls; updating the built-in catalog does not rewrite that script.

## 3. Test before you build a storyboard

**Test connection** is optional. It sends an upstream request and can establish reachability/authentication; it does not prove that image generation or editing works. **Save connection** only saves locally. The model **Self-check** checks the connection and call contract without generating an image. A model marked **not tried yet** still needs a real generation.

After setup, create one image node in **Generate**, select the connection/model, and enter a simple prompt such as “A blue paper square on a white background”. If the node shows a generation-mode switch (a GPT Image 2 node offers **Text-to-image** and **Image-to-image**), leave it on **Text-to-image**. Choose Auto or a supported square size and run that one node when ready for a provider generation request. Confirm that an image appears. Then test editing separately; only after both work should you build a long storyboard.

If the test says that the guessed call shape does not match, changing the URL or key repeatedly will not fix it. Re-open the provider's official API example and check these values one by one:

- base URL and API version;
- authentication header or query parameter;
- model ID;
- operation path (`images/generations`, `images/edits`, chat, or another route);
- JSON vs multipart body;
- required parameter names and value types;
- response field containing the image/video URL or task ID.

## 4. Add references deliberately

Start with one non-confidential PNG or JPEG on your computer:

1. Select the image node and switch its generation mode to the reference-edit mode: **Image-to-image** on a GPT Image 2 node, which is the mode declared as **Reference image edit** in **Inputs and generation**. If the node has no such mode, inspect **Inputs and generation** and **Request method** for the model; a text-only mode does not imply edit support.
2. Use the node's reference-image upload control and choose the file, for example `Pictures/reference.png` on macOS or `Pictures\reference.png` on Windows. The file picker selects the actual local file; typing a disk path in the prompt does not attach an image. Alternatively, connect an existing image node to the reference input.
3. Confirm its thumbnail appears in the reference slot. Enter an edit such as “Keep the square's shape; change its colour to red”. Run this node once and inspect the result.
4. On a declared multipart edit route, Nomi reads the imported local reference bytes and sends them directly to the selected provider as file parts. This path does not need an anonymous public upload host. A provider that requires URLs instead needs a supported upload/ingestion route.

Providers differ in what they accept:

- a public `https://` image URL;
- a local file uploaded through the provider's endpoint;
- a base64 data URL;
- a provider-specific reference field.

If Nomi reports **“All no-configuration upload hosts failed”** and names `litterbox.catbox.moe` or `tmpfiles.org`, the failed step is reference upload, not evidence that the model key is wrong. First check whether the documented edit operation accepts direct multipart bytes. For URL-only operations, use a configured provider-private upload path when available and inspect the upload host/network/proxy error separately. Do not upload confidential references to an anonymous host. This guide does not claim that any external host is currently available.

## 5. Common errors

| Error | What it usually means | Next action |
|---|---|---|
| `Invalid size ""` | An image request received an empty size. | Update Nomi; inspect the request method, including any custom script. Auto should omit the field. A supported square such as `1024x1024` is a useful isolated test. |
| Invalid concrete size | The dimensions violate that provider's constraints. | For GPT Image 2, check pixel area as well as the 16-pixel grid. Do not copy a size from another model's guide. |
| `This generation was not sent: the aspect ratio you picked is outside this model's supported range` | The selected ratio is wider than 3:1 (or taller than 1:3), which the OpenAI-compatible `size` field cannot express. Nothing was sent. | Pick another ratio on the node (for example 16:9, 1:1 or 9:16) and retry, or use a model that supports the ratio you need. |
| GPT Image edit goes to `chat/completions` | A legacy mapping or custom script may use an image-understanding route. | Update and reopen Nomi to apply catalog migrations. For a custom script, compare its request to the provider's documented edit example; use multipart `images/edits` for the official Images API. |
| `All no-configuration upload hosts failed` | Reference transport failed before generation. | Check direct multipart support or a configured private upload route; diagnose the named host separately from model authentication. |
| `The model and connection are still saved` | Credentials were saved, but the production call has not passed verification. | Inspect the error and correct the call contract before attempting one real generation. |
| `call shape ... does not match theirs` | The adapter shape does not match the provider contract. | Follow the provider's official request example and correct the operation/body; do not keep rotating keys. |
| `Provider request failed (HTTP 500)` | The upstream endpoint or relay returned a server error. | Check the exact endpoint, model ID, provider status, and a minimal request outside Nomi; redact secrets before sharing logs. |

## 6. Ask for help with enough evidence

Use [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions) for setup questions and [Issues](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml) for reproducible bugs. Include:

- Nomi version and operating system;
- provider's public API documentation/example URL, exact base-URL host and API path prefix (omit credentials and private paths);
- model ID and task mode;
- operation path, JSON vs multipart, field names/types, HTTP status, and the redacted response/error body;
- whether the reference was a local file or public URL, and which upload route was selected;
- whether a text-only or one-image minimal test works.

Never include API keys, phone numbers, private email addresses, or confidential reference images in a public post.

If the provider contract is unknown, use this follow-up: “Please share the public request example, base-URL host/path prefix, exact model ID, selected mode, request field names and types, and redacted response/error. Was the reference local or a public URL? Which Nomi version and OS are you using?” Do not substitute another provider's API shape while waiting for that evidence.

## 7. Move the working model into a storyboard

Write the script in **Create**, split it into shots, and use those shot/image nodes in **Generate**. Keep recurring characters, locations, and props as explicit references. Test one shot before generating a batch, then place accepted clips on the timeline for preview/export. The [storyboard table and poster-factory explainer](2026-08-23-storyboard-table-and-poster-factory-explainer.md) is historical background in Chinese: a storyboard table is a view of shot nodes; reference-video reconstruction and poster-image export are separate workflows. It is not a promise that every feature described there is available in your build.

## Official places to follow Nomi

- [Nomi website](https://nomiaqm.com/en/)
- Workflow support: **2373272608@qq.com**
- [Nomi on X / Twitter](https://x.com/sdf297417627618)
- [GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- [Business inquiry](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml)

## Want Codex to investigate a bug?

If you can run Codex with a GitHub checkout, use the [copy-paste Codex issue-fix prompt](codex-issue-fix-prompt-en.md). It tells Codex how to clone the repository, inspect the provider contract, reproduce the request with a mock, protect secrets, and deliver a branch/PR instead of changing `main` directly.

If you need to connect a provider urgently without opening a PR, use the [Codex / Claude Code provider-setup prompt](model-integration-prompt-en.md). It uses Nomi's `model-integration` Skill and MCP tools first; if the installed build lacks a provider-private upload route, it limits local source work to a documented Runway upload channel and does not add a Runway model adapter.
