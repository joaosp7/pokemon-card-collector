# Pokemon DB

Local archive of Liga Pokémon collection images. The CLI `download-collection` is on PATH (`uv tool install -e . --force`). The web app does not use that PATH copy; it runs `uv run download-collection`, which loads the package installed in `.venv`. After CLI script changes, refresh both:

```bash
uv tool install -e . --force
uv sync --reinstall-package pokemon-db
```

## How the downloader works

Liga Pokémon search pages (`?view=cards/search&card=edid=…`) do **not** put the full set in the DOM. They render 24 cards and load more with “Mostrar mais”. The complete catalog is already in page JS:

- `cardsjson` — full list embedded in the HTML
- `edc.obj` — that list after the current UI sort

[`scripts/download_collection.py`](scripts/download_collection.py) opens the URL with **headless Playwright**, waits for one of those arrays, and prefers `edc.obj` when it is non-empty. It never clicks “Mostrar mais” and never scrapes visible `<img>` tags.

Each card includes:

| Field | Meaning |
| ----- | ------- |
| `sSigla` | Set code (`30C`, `M6`) |
| `sN` / `dN` | Collector number and padded sort key. `sort_key` in `catalog.db` stores `dN`. If `dN` is missing, store `sN` |
| `nPT` / `nEN` | Portuguese name (may be empty) / English name (`Articuno (#018/128)`) |
| `sC` | Card type code from Liga: one of `W R G L P F D M Y O C E`. Missing, empty, or any other value becomes our filename fallback `N` (not a Liga code) |
| `sP` / `f_sP` | Front image path. `f_sP` is ignored. Card backs are not stored and are not downloaded |

Image files are fetched from `https://repositorio.sbrauble.com` + `sP` (HTML stays behind Cloudflare; the image CDN does not need a browser). Names are HTML-unescaped. Cards are sorted by `dN` so the folder lists in collector-number order. A real download upserts the set and its front-image rows into `data/catalog.db`. It does not set `logo_path`, so an existing logo stays in place. `--dry-run` prints the plan and writes no folders, images, or database rows.

Output always goes under this repo’s `cards/` directory (resolved from the script location, not the current working directory).

**Folder:** `{Collection-Name}-{SET}` from the page title (text before `|`) plus `sSigla`. Keep the site’s capitalization, turn spaces into hyphens, strip accents (`ç`→`c`, `ã`→`a`).

- `Celebração de 30 Anos` + `30C` → `cards/Celebracao-de-30-Anos-30C/`
- `Storm Emeralda` + `M6` → `cards/Storm-Emeralda-M6/`

**Files:** `{sN}_{code}_{Name}.jpg` where `code` is Liga `sC` when it is one of the 12 codes above, otherwise `N` (Portuguese name if present, otherwise English without the `(#…)` suffix). Front images only. The downloader does not write `{sN}_{code}_{Name}_back.jpg`. Existing non-empty front files are skipped. On re-run, if the new path is absent and a legacy `{sN}_{Name}.jpg` exists and is non-empty, that file is renamed to the new path before download so it is skipped.

## CLI

```bash
download-collection --help
```

Dry-run (catalog plan only; no downloads, no folders, no database writes):

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

Re-running the same URL is safe: already-downloaded images are skipped, and the catalog upsert reuses the existing `sets.id`. Exit code is `1` if any image fails after retries.

## Existing-data migration

Back up `cards/`, `web/data/collection.db`, and any existing `data/catalog.db` and `data/ownership.db` before these commands. They write the new databases. `migrate_collection.py` can also copy a logo into the set folder. They do not delete card images or the legacy ownership file.

For each downloaded set, import catalog metadata without downloading images. Pass the logo file when you have one:

```bash
uv run python scripts/migrate_collection.py \
  "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C" \
  --logo path/to/logo.png
```

After every collection has been migrated, copy quantities from `web/data/collection.db` into `data/ownership.db`:

```bash
uv run python scripts/migrate_ownership.py
```

Re-running either command does not duplicate sets, cards, or quantities. After that one-time migration, `download_collection.py` handles new collections and updates.

## Tests

```bash
uv run python -m unittest discover -s tests -v
cd web && npm test
```

Do not hit Liga Pokémon from tests. Fixture the `cardsjson` shape and assert folder slugs, filenames, sort order, skip-existing, and catalog upserts.

## Agent notes

- Keep the script reusable: input is always a Liga collection search URL; set size and images change per collection.
- Do not scrape `.card-item` or paginate the grid.
- Do not commit `cards/` or database files. `data/*.db` and `web/data/collection.db` are gitignored. A `data/.gitkeep` or `web/data/.gitkeep` may stay tracked.
- Prefer small, testable helpers over extra flags or config files unless asked.

## Web app

Local Next.js binder. Home header can trigger `download-collection` via POST `/api/collections` (URL only; no scrape in Next.js). The CLI still owns fetching (Playwright + CDN). The app must not scrape `.card-item` or parse `cardsjson`. It must not derive card metadata from filenames.

```bash
cd web && npm run dev
```

Open http://localhost:3000.

The Next.js working directory is `web/`. Helpers step up one level and open repository-root databases. They do not create `web/data/catalog.db` or `web/data/ownership.db`.

- Catalog metadata is SQLite at `data/catalog.db`. Card lists sort by `sort_key` (Liga `dN`, or `sN` when `dN` is missing). The displayed name is `name_pt` when present, otherwise `name_en`.
- Ownership is SQLite at `data/ownership.db`, keyed by `(set_id, set_card_id)`. Adding or removing copies changes only that file.
- Images remain files under `cards/`. Serving checks the catalog-approved path, then confirms the file is a non-empty image inside `cards/`.
- A set logo is passed to `migrate_collection.py` with `--logo` and stored as `logo_path`. The app does not scan the set folder for a logo. A missing logo shows a typographic set-code badge.
- Card backs are not downloaded and are not catalog rows.
- `web/data/collection.db` is the legacy ownership backup used by `migrate_ownership.py`. The running app does not open it.
- Do not commit `cards/` or database files.
