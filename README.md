# Pokemon DB

Local archive of Liga Pokémon card images, plus a small Next.js binder to mark which cards you own.

This is meant to run on your machine. Images and databases stay on disk and are gitignored.

## Data layout

```text
data/
├── catalog.db
└── ownership.db

cards/
└── {set-slug}/
    ├── card images
    └── logo image
```

- `data/catalog.db` stores sets and set cards imported from Liga Pokémon.
- `data/ownership.db` stores how many copies you own, keyed by `(set_id, set_card_id)`.
- Card images stay files under `cards/`.
- `sort_key` stores Liga’s `dN`. Card lists sort by that value. If `dN` is missing, the stored key is `sN`.
- A set logo is passed to `migrate_collection.py` with `--logo`. The app does not scan the set folder for a logo.
- Card backs are not stored and are not downloaded. The downloader ignores `f_sP` and does not write `_back.jpg`.
- `cards/`, `data/catalog.db`, and `data/ownership.db` are local ignored data. `web/data/collection.db` is the old ownership file and stays ignored too. Do not commit them.

The Next.js app runs from `web/` and opens `data/` at the repository root.

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

Front images land under `cards/{Collection-Name}-{SET}/`, named `{number}_{code}_{Name}.jpg`. A real download also upserts that set into `data/catalog.db`. Re-running the same URL skips image files that are already there and reuses the existing set id. `--dry-run` prints the plan and writes nothing. Use `--headed` if a Cloudflare challenge blocks headless Chromium.

## Migrate existing local data

Back up local data before either command. Copy `cards/`, `web/data/collection.db`, and any existing `data/catalog.db` and `data/ownership.db` somewhere outside the repository. These commands write the new databases. `migrate_collection.py` can also copy a logo file into the set folder. They do not delete card images or `web/data/collection.db`.

Import each downloaded set into the catalog. This reads Liga metadata and does not download images. Pass a logo only when you have one:

```bash
uv run python scripts/migrate_collection.py \
  "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C" \
  --logo path/to/logo.png
```

After every collection has been imported, copy ownership counts from `web/data/collection.db` into `data/ownership.db`:

```bash
uv run python scripts/migrate_ownership.py
```

Re-running either command does not duplicate sets, cards, or quantities. After that one-time migration, `download-collection` handles new collections and updates.

## Browse your binder

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. Home lists sets from `catalog.db`. Use Add Collection on the home header with a Liga search URL, or run the CLI in a terminal. Open a set to add or remove copies and filter All / Missing / Owned. Copy changes are written only to `data/ownership.db`.

## Tests

```bash
uv run python -m unittest discover -s tests -v
cd web && npm test
```

Tests use fixtures and temporary databases. They do not contact Liga Pokémon.
