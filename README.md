# Pokemon DB

Local archive of Liga Pokémon card images, plus a small Next.js binder to mark which cards you own.

This is meant to run on your machine. Images and ownership data stay on disk and are gitignored.

## Download a set

Install the CLI once:

```bash
uv tool install -e . --force
uv run playwright install chromium
```

Then pass a Liga Pokémon collection search URL:

```bash
download-collection --dry-run "https://www.ligapokemon.com.br/?view=cards/search&card=edid=806%20ed=M6"
download-collection "https://www.ligapokemon.com.br/?view=cards/search&card=edid=806%20ed=M6"
```

Images land under `cards/{Collection-Name}-{SET}/`, named `{number}_{Name}.jpg`. Re-running the same URL skips files that are already there. Use `--headed` if a Cloudflare challenge blocks headless Chromium.

## Browse your binder

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. Home lists downloaded sets. Open a set to add or remove copies and filter All / Missing / Owned.

Ownership is stored in `web/data/collection.db`. The app reads `cards/`; it does not download from Liga Pokémon.

## Tests

```bash
uv run python -m unittest discover -s tests -v
cd web && npm test
```
