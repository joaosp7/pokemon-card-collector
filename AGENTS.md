# Pokemon DB

Local archive of Liga Pokémon collection images. The CLI `download-collection` is on PATH (`uv tool install -e .`).

## How the downloader works

Liga Pokémon search pages (`?view=cards/search&card=edid=…`) do **not** put the full set in the DOM. They render 24 cards and load more with “Mostrar mais”. The complete catalog is already in page JS:

- `cardsjson` — full list embedded in the HTML
- `edc.obj` — that list after the current UI sort

[`scripts/download_collection.py`](scripts/download_collection.py) opens the URL with **headless Playwright**, waits for one of those arrays, and prefers `edc.obj` when it is non-empty. It never clicks “Mostrar mais” and never scrapes visible `<img>` tags.

Each card includes:

| Field | Meaning |
| ----- | ------- |
| `sSigla` | Set code (`30C`, `M6`) |
| `sN` / `dN` | Collector number and padded sort key |
| `nPT` / `nEN` | Portuguese name (may be empty) / English name (`Articuno (#018/128)`) |
| `sP` / `f_sP` | Front image path; optional back face |

Image files are fetched from `https://repositorio.sbrauble.com` + `sP` (HTML stays behind Cloudflare; the image CDN does not need a browser). Names are HTML-unescaped. Cards are sorted by `dN` so the folder lists in collector-number order.

Output always goes under this repo’s `cards/` directory (resolved from the script location, not the current working directory).

**Folder:** `{Collection-Name}-{SET}` from the page title (text before `|`) plus `sSigla`. Keep the site’s capitalization, turn spaces into hyphens, strip accents (`ç`→`c`, `ã`→`a`).

- `Celebração de 30 Anos` + `30C` → `cards/Celebracao-de-30-Anos-30C/`
- `Storm Emeralda` + `M6` → `cards/Storm-Emeralda-M6/`

**Files:** `{sN}_{Name}.jpg` (Portuguese name if present, otherwise English without the `(#…)` suffix). Dual-faced cards also write `{sN}_{Name}_back.jpg`. Existing non-empty files are skipped.

## CLI

```bash
download-collection --help
```

Dry-run (catalog only; no downloads, no folders created):

```bash
download-collection --dry-run "https://www.ligapokemon.com.br/?view=cards/search&card=edid=806%20ed=M6"
```

```
Collection: Storm-Emeralda-M6
Save to: …/pokemon-db/cards/Storm-Emeralda-M6
Cards: 113
```

Download a collection:

```bash
download-collection "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C"
download-collection "https://www.ligapokemon.com.br/?view=cards/search&card=edid=806%20ed=M6"
```

`--dryrun` is an alias of `--dry-run`. `--headed` shows Chromium (only if a Cloudflare challenge blocks headless).

Re-running the same URL is safe: already-downloaded images are skipped. Exit code is `1` if any image fails after retries.

## Tests

```bash
uv run python -m unittest discover -s tests -v
```

Do not hit Liga Pokémon from tests. Fixture the `cardsjson` shape and assert folder slugs, filenames, sort order, and skip-existing.

## Agent notes

- Keep the script reusable: input is always a Liga collection search URL; set size and images change per collection.
- Do not scrape `.card-item` or paginate the grid.
- Do not commit files under `cards/` (gitignored).
- Prefer small, testable helpers over extra flags or config files unless asked.

## Web app

Local Next.js binder for downloaded sets. Do not invent a download UI; the CLI still owns fetching.

```bash
cd web && npm run dev
```

Open http://localhost:3000.

- Catalog is the `cards/` directory (filesystem). The app does not hit Liga Pokémon.
- Ownership is SQLite at `web/data/collection.db`.
- Optional collection emblem: `cards/{slug}/logo.{png,webp,jpg,jpeg}`. Home tiles use the first existing non-empty file in that order (`png` → `webp` → `jpg` → `jpeg`). Missing logos show a typographic set-code badge, not the first card. `listCards` still only parses `NNN_Name.jpg`, so a `logo.jpg` is never a card.
- Do not commit `cards/` or the sqlite file (both gitignored).
