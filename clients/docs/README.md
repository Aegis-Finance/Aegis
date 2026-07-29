# Aegis documentation (`doc.aegisprotocol.org`)

[VitePress](https://vitepress.dev/) static docs. Deploy on **Cloudflare Pages** project `aegis-docs`.

```bash
npm ci
npm run dev      # local preview
npm run build    # docs/.vitepress/dist → symlink/copy as `dist` for CF or set output path
```

**Cloudflare output directory:** `docs/.vitepress/dist` (or add `"build": "vitepress build docs && node -e \"require('fs').cpSync('docs/.vitepress/dist','dist',{recursive:true})\""`).

See `docs/ops/frontends_clouadflare.md`.
