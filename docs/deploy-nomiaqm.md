# Deploy `nomiaqm.com`

This repo contains a static marketing site in `site/`.

## Recommended Hosting

Use Cloudflare Pages with GitHub integration.

Why:

- `site/index.html` is static and does not need a server runtime.
- GitHub integration deploys automatically after each push to `main`.
- Cloudflare can manage `nomiaqm.com` DNS, HTTPS, CDN, cache headers, and future redirects in one place.
- If the site later needs edge logic, it can be moved to Workers without changing the public domain.

## Cloudflare Pages Settings

Create a Pages project from GitHub:

- Repository: `aqm857886159/Nomi`
- Production branch: `main`
- Framework preset: `None`
- Build command: leave empty
- Build output directory: `site`

## Custom Domain

Use the apex domain:

- Domain: `nomiaqm.com`

For an apex domain, add `nomiaqm.com` as a Cloudflare zone and point the domain registrar nameservers to the two nameservers Cloudflare provides.

After the nameservers are active:

1. Open Cloudflare Dashboard.
2. Go to Workers & Pages.
3. Open the Nomi Pages project.
4. Go to Custom domains.
5. Add `nomiaqm.com`.
6. Cloudflare will create the required DNS record and issue HTTPS automatically.

Optional:

- Add `www.nomiaqm.com` as a second custom domain.
- Redirect `www.nomiaqm.com` to `https://nomiaqm.com/`.

## SEO Files

The static site includes:

- `site/index.html`
- `site/robots.txt`
- `site/sitemap.xml`
- `site/_headers`

The canonical URL is:

```txt
https://nomiaqm.com/
```

