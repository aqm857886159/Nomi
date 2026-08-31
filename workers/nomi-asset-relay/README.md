# Nomi asset relay

This Worker is a bounded Nomi-owned fallback upload channel. Configured provider upload APIs are tried first; the built-in public relay is used only when those channels are unavailable or fail. It keeps R2 credentials server-side, accepts limited public multipart uploads at `POST /v1/assets`, supports private bearer uploads for self-hosted users, serves short-lived model-readable URLs at `GET /v1/assets/:key`, and removes expired objects from its hourly scheduled cleanup.

## Deploy

Create the bucket once, set a real `PUBLIC_BASE_URL` in `wrangler.toml` or the Cloudflare dashboard, then run:

```sh
wrangler r2 bucket create nomi-assets
wrangler secret put RELAY_TOKEN
wrangler deploy
```

The published desktop build uses the public relay URL without asking users for a token. Enable it with `PUBLIC_UPLOAD_ENABLED=true`; the private `RELAY_TOKEN` remains only for administrators and self-hosted installations. Configure the optional rate-limit binding before enabling public mode.

For a self-hosted/custom relay, launch Nomi with:

```sh
NOMI_ASSET_RELAY_URL=https://<your-worker-or-custom-domain>/v1/assets \
NOMI_ASSET_RELAY_TOKEN=<the-same-secret> \
pnpm dev
```

The token is read only by Electron main-process code. Never put it in renderer code, a public `.env`, or a provider request body. The desktop settings page also accepts a custom public endpoint or private endpoint; its token is stored in the OS secure store. `r2.dev` is intended for development; use a custom domain or Worker route for production.

## Cost guard and usage

The relay defaults to `MAX_STORAGE_BYTES=8000000000` and `MAX_MONTHLY_BUDGET_USD=0`. That keeps this bucket below the R2 free storage tier and refuses an upload that would create billable storage. Set both values explicitly if paid storage is intended; the per-file guard remains `MAX_UPLOAD_BYTES`.

Query the relay's current storage estimate with the same bearer token:

```sh
curl -H "Authorization: Bearer <RELAY_TOKEN>" https://<your-worker-or-custom-domain>/v1/usage
```

The response includes object count, bytes, free-tier headroom, configured budget, and estimated monthly storage cost. It intentionally labels itself `storage_estimate_only`: Cloudflare's R2 Billing Dashboard is the source of truth for Class A/Class B operation counts and the actual account bill. Keep the dashboard's budget alert enabled as a second notification layer; the Worker guard is the hard upload stop for this relay bucket.

The current account has a live dashboard deployment. For another account, replace the placeholder public base URL, bind its own R2 bucket, set `RELAY_TOKEN` as a Worker secret, configure the public upload switch and rate limiter if desired, and deploy through Wrangler or the Cloudflare dashboard. Public mode is deliberately a fallback with a hard stop, not a general-purpose file host.
