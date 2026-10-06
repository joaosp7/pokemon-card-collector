# Pokemon DB binder

Next.js app for the local Liga Pokémon archive. It reads catalog metadata from SQLite and serves image files from `cards/`. It does not scrape Liga Pokémon.

Run it from this directory:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The process working directory is `web/`. Database helpers step up one level and open the repository-root files:

- `data/catalog.db` — sets and set cards. Lists are ordered by `sort_key`, which stores Liga’s `dN` (or `sN` when `dN` is missing).
- `data/ownership.db` — copies owned, keyed by `(set_id, set_card_id)`.

Adding or removing a copy writes only `data/ownership.db`. The app does not open `web/data/collection.db`.

Images stay under `cards/{set-slug}/`. A logo is shown only when `sets.logo_path` points at a non-empty file. That path is recorded by `migrate_collection.py --logo`. The app does not scan the set folder for `logo.png`. A missing logo shows the set-code badge. Card backs are not downloaded and are not part of the catalog.

`cards/`, `data/*.db`, and `web/data/collection.db` are local data. Do not commit them.

## One-time migration

Back up `cards/`, `web/data/collection.db`, and any existing `data/catalog.db` and `data/ownership.db` before these commands. From the repository root:

```bash
uv run python scripts/migrate_collection.py \
  "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C" \
  --logo path/to/logo.png

uv run python scripts/migrate_ownership.py
```

Run `migrate_collection.py` once per downloaded set, then `migrate_ownership.py` once. See the repository `README.md` for the download CLI and what each command changes.

## Tests

```bash
npm test
```
