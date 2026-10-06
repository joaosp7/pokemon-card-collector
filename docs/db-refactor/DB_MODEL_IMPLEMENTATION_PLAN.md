# Catalog and Ownership Database Implementation Plan

This plan implements the model described in `DB_MODEL_OPTION_4_REVISED.md`.

The target architecture is:

```text
data/
├── catalog.db
└── ownership.db

cards/
└── {set-slug}/
    ├── card images
    └── logo image
```

The two databases have separate responsibilities:

- `catalog.db` stores sets and set cards imported from Liga Pokémon.
- `ownership.db` stores the number of copies owned for each set card.
- Image files remain under `cards/`.

The implementation should be incremental so the existing downloader and binder continue working during the migration.

# Important model decisions

These decisions should be treated as prerequisites for implementation:

1. `sets.id` is an auto-incrementing local database ID.
2. `sets.set_code` is the globally unique set code, such as `M6` or `30C`.
3. `set_cards.id` is the card number within a set, stored as text so values such as `001`, `TG01`, and `SVP001` remain possible.
4. A set card is identified by `(set_id, set_cards.id)`.
5. Ownership is identified by `(set_id, set_card_id)`.
6. `card_count` means the total number of cards in the set catalog.
7. `source_url` is the Liga Pokémon URL used to download the set.
8. `logo_path` and `image_path` are paths relative to the project root.
9. Catalog tables do not initially contain `active`, `source_id`, `created_at`, or `updated_at`.
10. Ownership stores aggregate `copies`, not individual physical card records.
11. Cross-database foreign-key enforcement is out of scope for the first implementation.
12. The slug is treated as stable for this project and remains the filesystem/display identifier.
13. Card backs are not stored and are not downloaded. The downloader ignores Liga’s `f_sP` and does not write `_back.jpg` files.
14. `rarity_code` is stored as `TEXT` using normalized codes such as `C`, `R`, `IR`, and `RD`, not Liga’s raw numeric `iR` IDs.
15. `sort_key` stores Liga’s `dN`. Cards from Liga are already ordered by their number in the set, and every card list sorts by `sort_key`.
16. The set logo is passed to the import command together with the Liga URL. The app does not scan the set folder for a logo.
17. Every `catalog.db` connection runs `PRAGMA foreign_keys = ON`.
18. The displayed card name is `name_pt` when present, otherwise `name_en`.

# Target schemas

## `data/catalog.db`

```sql
CREATE TABLE sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_code TEXT NOT NULL UNIQUE,
  name_pt TEXT,
  name_en TEXT,
  slug TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  logo_path TEXT,
  card_count INTEGER NOT NULL CHECK (card_count >= 0)
);

CREATE TABLE set_cards (
  id TEXT NOT NULL,
  set_id INTEGER NOT NULL,
  name_pt TEXT,
  name_en TEXT,
  element_code TEXT,
  rarity_code TEXT,
  image_path TEXT NOT NULL,
  sort_key TEXT NOT NULL,
  illustrator TEXT,
  PRIMARY KEY (set_id, id),
  FOREIGN KEY (set_id) REFERENCES sets(id)
);
```

The primary key already indexes `(set_id, id)`. Do not add a second index on those columns.

Open `catalog.db` with foreign keys enabled:

```sql
PRAGMA foreign_keys = ON;
```

## `data/ownership.db`

```sql
CREATE TABLE owned_cards (
  set_card_id TEXT NOT NULL,
  set_id INTEGER NOT NULL,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (set_id, set_card_id)
);
```

`set_id` is stored in the ownership database for direct set-level queries. Because the databases are separate, the relationship to the catalog is logical and must be validated by application code.

# Phase 0: Add shared path and schema contracts

Before changing application behavior, define the database locations and schemas in one place per language.

## Python work

Add a small reusable module, likely:

```text
scripts/catalog_db.py
```

Responsibilities:

- resolve the repository root
- resolve `data/catalog.db`
- create the `data/` directory when needed
- create the catalog schema
- open a SQLite connection with `PRAGMA foreign_keys = ON`
- upsert sets
- upsert set cards
- resolve project-root-relative image and logo paths

Use Python’s standard-library `sqlite3`; no new dependency is needed.

The module should expose small helpers rather than putting SQL throughout `download_collection.py`.

## TypeScript work

Split the current database responsibilities into clear modules, for example:

```text
web/lib/catalog-db.ts
web/lib/ownership-db.ts
```

Possible responsibilities:

- `catalog-db.ts` opens `data/catalog.db` and reads sets/cards.
- `ownership-db.ts` opens `data/ownership.db` and reads/writes ownership.
- A shared path helper resolves repository-level `data/`. The Next.js working directory is `web/`, so the helper steps up to the repository root (`path.resolve(process.cwd(), "..", "data")`). `catalog.db` and `ownership.db` are not created under `web/data/`.

The existing `web/lib/db.ts` can either become the ownership database module or remain as a low-level connection helper. The important outcome is that the ownership database is no longer named or modeled as `collection.db`.

Use separate connection instances unless there is a concrete need for SQLite `ATTACH DATABASE`.

## Verification

Add schema tests before changing the application:

- creating both databases creates the expected tables
- `catalog.db` connections have foreign keys enabled
- creating them repeatedly is safe
- `set_cards` allows `001` in more than one set
- ownership allows `001` in more than one set
- copies cannot be zero or negative

# Phase 1: Migrate existing collections into `catalog.db`

Existing card images are already present under `cards/`, but their metadata is not in `catalog.db`. Migrate each existing set by supplying its original Liga Pokémon URL.

The collection migration script fetches the complete source catalog and updates database metadata. It does not download card images again.

## Migration command

Run once for each downloaded set:

```bash
uv run python scripts/migrate_collection.py \
  "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C" \
  --logo path/to/logo.png
```

`--logo` is optional. When it is passed, the script copies that file into the set folder as `logo.png`, `logo.webp`, `logo.jpg`, or `logo.jpeg` (keeping the source extension) and stores the project-relative path in `sets.logo_path`. When it is omitted, the existing `logo_path` and logo file stay as they are. The script does not search the set folder for a logo.

The script should:

1. Fetch the complete catalog from Liga page JavaScript.
2. Derive the set code, title, slug, source URL, and source card count.
3. Upsert the set by `set_code` while preserving `sets.id`.
4. Upsert cards by `(set_id, sN)`, storing Liga’s `dN` as `sort_key`.
5. Normalize names, element, and rarity using the shared helpers.
6. Resolve existing local image paths without downloading or renaming files.
7. Copy and store a logo only when `--logo` is passed.
8. Report source cards whose local image is missing.
9. Be safe to rerun.

For image resolution, prefer the current generated filename, then an existing legacy filename. If neither exists, store the expected path and report the missing file.

The source URL is supplied directly to the command, so no set-to-URL mapping file is needed. The script must not invent URLs.

## Verification

Use temporary directories, mocked page data, and temporary databases to test:

- metadata migration for an existing set
- no image-download function is called
- existing current and legacy filenames are found
- missing images are reported
- source card count is stored
- rerunning the migration is idempotent
- `--logo` copies the file into the set folder and stores `logo_path`
- a rerun without `--logo` leaves the saved logo in place
- duplicate card numbers across sets remain independent

# Phase 2: Make `download_collection.py` handle new and existing collections

Update `scripts/download_collection.py` so downloading a set updates `catalog.db` in addition to writing images. A new collection and an existing collection use the same upsert path:

- new collection: create the set/card rows and download images
- existing collection: update set/card metadata and skip existing non-empty images

Extract shared catalog fetch, normalization, and persistence helpers so `migrate_collection.py` can use them with image downloading disabled.

## Catalog values from Liga data

Map the existing source fields as follows:

| Liga/source value | Catalog field |
| --- | --- |
| sanitized download URL | `sets.source_url` |
| `sSigla` | `sets.set_code` |
| page title before `\|` | `sets.name_pt` or the primary set name |
| derived slug | `sets.slug` |
| catalog length | `sets.card_count` |
| `sN` | `set_cards.id` |
| `nPT` | `set_cards.name_pt` |
| `nEN` | `set_cards.name_en` |
| `sC` | `set_cards.element_code` |
| `iR` mapped through Liga’s rarity table | `set_cards.rarity_code` |
| `dN`, or `sN` when `dN` is missing | `set_cards.sort_key` |
| front filename | `set_cards.image_path` |

`card_kind` is not part of the initial model because Liga does not provide reliable card-category information. `illustrator` remains null until a source provides it.

For the observed 30C catalog, the source rarity IDs normalize as follows:

| Liga `iR` | `rarity_code` | Label |
| ---: | --- | --- |
| `1` | `C` | Comum |
| `3` | `R` | Rara |
| `11` | `S` | Promocional |
| `17` | `IR` | Ilustração Rara |
| `18` | `IS` | Ilustração Rara Especial |
| `20` | `RD` | Rara Dupla |
| `25` | `FR` | Rara Futurista |

Implement this mapping in a small normalization helper. Store the code in the database and map it to a display label in the application. Do not store only the opaque numeric source ID.

The downloader should HTML-unescape `nPT` before storing it and remove the `(#...)` suffix from `nEN` before storing it. `nPTSA` is an accent-normalized search name and is not needed in the initial schema.

The current `card_type_code()` behavior is still useful for filenames, but the database should store the normalized element code separately from the filename.

## Download flow

For a normal download:

1. Fetch the complete catalog from Liga.
2. Derive the set code, title, slug, and card count.
3. Create or find the set row by `set_code`, preserving an existing `sets.id`.
4. Download or skip existing front images. Do not download `f_sP` and do not write `_back.jpg`.
5. Upsert each set card using `(set_id, sN)` and store `dN` as `sort_key`.
6. Store the expected project-relative image path.
7. Leave `logo_path` unchanged. Logos are attached by the import command, not by the downloader.
8. Report download failures using the existing exit-code behavior.

The first implementation should preserve the existing image filename format. The database becomes the metadata source without requiring an image rename migration.

When the URL belongs to an existing collection, the downloader must update the catalog while allowing the existing non-empty image files to be skipped.

## Dry-run behavior

`--dry-run` must remain side-effect free:

- do not create `data/catalog.db`
- do not create set directories
- do not write catalog rows
- do not download images

It should continue reporting the derived set and card count only.

## Card back behavior

Do not add a database column for card backs.

Remove the downloader’s `f_sP` handling. A download writes the front image only. It does not request the back image and does not create `_back.jpg` files. The web catalog shows the front image path only.

## Stable set IDs

When a set is downloaded again:

1. Look up the set by `set_code`.
2. Reuse its existing `sets.id`.
3. Update its metadata without creating a new set row.

This is essential because ownership rows store `set_id`.

## Verification

Extend Python tests to cover:

- catalog insertion from a fixture-shaped Liga catalog
- set code and source URL persistence
- card number preservation, including leading zeroes
- image path generation
- card count persistence
- downloading a new set and creating its catalog rows
- downloading an existing set and updating its catalog rows without duplicate rows
- reusing the original set ID
- dry-run not creating a database
- failed image downloads still producing the expected CLI exit code
- rarity ID normalization, including unknown IDs becoming null or an explicit unknown value
- HTML entity decoding for Portuguese names
- English collector suffix removal
- `dN` stored as `sort_key`
- no `_back.jpg` file written when the fixture includes `f_sP`

Tests must continue to use fixtures and must not hit Liga Pokémon.

# Phase 3: Change the web catalog from filesystem metadata to SQLite

Once the catalog database is populated, change the web app to use it as the metadata source.

## Replace catalog reads

Update `web/lib/catalog.ts` or split it into catalog and filesystem concerns.

Database-backed functions should include equivalents of:

```text
listCollections()
getCollection(slug)
listCards(setId)
getCard(setId, setCardId)
```

The returned types should use database-backed fields:

```ts
export type Collection = {
  id: number;
  setCode: string;
  namePt: string | null;
  nameEn: string | null;
  slug: string;
  sourceUrl: string;
  logoPath: string | null;
  cardCount: number;
};

export type Card = {
  setId: number;
  setCardId: string;
  namePt: string | null;
  nameEn: string | null;
  elementCode: string | null;
  rarityCode: string | null;
  imagePath: string;
  sortKey: string;
  illustrator: string | null;
};
```

The UI may expose a derived `collectorNumber` property equal to `setCardId` for readability, but the database should use the agreed column names.

The displayed card name is `namePt` when it is present, and `nameEn` otherwise.

## Slugs

Routes can continue using slugs:

```text
/collections/Storm-Emeralda-M6
```

The slug should be used to look up the set row. The page should no longer reconstruct the title and set code by splitting the slug when catalog data is available.

`parseSlug()` can remain temporarily for migration compatibility, but it should no longer be the authoritative source of set metadata.

## Card listing

`listCards()` should query `set_cards` by `set_id` and order by `sort_key`. Liga already orders each card by its number in the set through `dN`, and that value is what `sort_key` stores.

## Image paths

The page should build image URLs from the catalog’s `image_path`, not reconstruct names from card metadata.

The image endpoint must:

1. Resolve the project root.
2. Resolve the stored relative path.
3. Reject paths that escape the project root.
4. Reject paths outside the allowed cards directory.
5. Confirm the target is a regular file.
6. Determine the content type from the file extension.

The existing slug/filename route may be retained initially if the database filename matches the current folder layout, but the resolver should ultimately use the catalog-approved `image_path` rather than trusting arbitrary request paths.

## Logos

Home tiles should use `sets.logo_path` when it points to a non-empty existing file. A null or missing logo shows the typographic set-code badge. The page does not scan the set folder for `logo.png`.

# Phase 4: Migrate ownership after all collections are cataloged

The current ownership table uses:

```text
collection_slug + collector_number
```

The target uses:

```text
set_id + set_card_id
```

## Required run order

Run the collection migration once for every existing downloaded set:

```bash
uv run python scripts/migrate_collection.py "<set Liga URL>" --logo path/to/logo.png
```

`--logo` is optional on this command. Pass it for each set that has a logo image.

Only after every existing set has been migrated, run the ownership migration:

```bash
uv run python scripts/migrate_ownership.py
```

The ownership migration does not fetch Liga and does not need a URL. It depends on every old set/card being present in `catalog.db`.

## Ownership database migration

Create `data/ownership.db` with the new schema.

Read existing rows from the current ownership database at:

```text
web/data/collection.db
```

For each row:

1. Resolve the set using the old `collection_slug`.
2. Find the corresponding catalog `sets.id`.
3. Find the corresponding `set_cards.id` using the old collector number.
4. Insert `(set_id, set_card_id, copies)` into `ownership.db`.
5. Preserve copy counts exactly.

Do not delete the old database until the migration has been verified and a backup has been made.

If the existing ownership database is empty, the migration still needs to create the new database and schema.

## Migration command

Add a dedicated script:

```text
scripts/migrate_ownership.py
```

The migration must be safe to run more than once. It should use an upsert or replace strategy for target ownership rows, never incrementing during migration.

## Ownership API changes

Update ownership functions to accept the new key pair:

```ts
getCopies(setId, setCardId)
getOwnedMap(setId)
addCopy(setId, setCardId)
removeCopy(setId, setCardId)
countOwned(setId)
```

`getOwnedMap(setId)` can continue returning:

```ts
Map<string, number>
```

where the map key is `setCardId`, because every result is already scoped to one set.

## Validation

Before changing ownership:

1. Validate that the set exists in `catalog.db`.
2. Validate that the set card exists within that set.
3. Update only `ownership.db`.

The web application should silently reject invalid ownership requests in the same spirit as the current actions, or return an explicit validation error if the API is later expanded.

# Phase 5: Update the web UI and server actions

Update the collection page and components after the catalog and ownership libraries are ready.

## Collection page

Change `web/app/collections/[slug]/page.tsx` to:

1. Load the set from `catalog.db` by slug.
2. Load set cards from `catalog.db`.
3. Load ownership using `set.id`.
4. Display the database set name (`name_pt`, otherwise `name_en`) and code.
5. Use `set_card.id` as the card identity.
6. Use `image_path` to render the image.
7. Display `card_count` or the actual card list count consistently.

The existing filters should continue to work with the new `Card` shape.

## Server actions

Update `web/app/actions.ts` so actions receive:

```text
setId
setCardId
```

The action should validate the pair against `catalog.db` before calling ownership functions.

The route slug can still be passed separately for cache revalidation:

```text
addCopyAction(slug, setId, setCardId)
removeCopyAction(slug, setId, setCardId)
```

Alternatively, the set can be resolved from `setId`; the important part is that ownership writes use database identifiers rather than filenames.

## Copy controls

Update `CopyControls` to receive:

```ts
{
  slug: string;
  setId: number;
  setCardId: string;
  copies: number;
}
```

The visual behavior does not need to change.

## Filtering

Update `web/lib/filter.ts` so it uses `setCardId` rather than the old filesystem-derived `collectorNumber` field.

The UI can still label the value as the collector number because `setCardId` is the card number inside the set.

# Phase 6: Remove old catalog and ownership paths

Only after the new path is working and tested:

1. Remove filesystem-based metadata parsing from normal web reads.
2. Remove `collection_slug` and `collector_number` from the active ownership schema.
3. Rename or archive `web/data/collection.db` after migration.
4. Remove obsolete filename parsing tests that no longer represent application behavior.
5. Keep low-level image filename/path safety tests where they are still relevant.
6. Update the root README and web documentation.
7. Update `AGENTS.md` so the database model matches the implementation.

The downloader may continue using filenames for physical storage. The important distinction is that the web app and database no longer infer catalog metadata from those filenames.

# Test plan

## Python tests

Add or update tests for:

- catalog schema creation
- set upsert by `set_code`
- stable reuse of `sets.id`
- card insertion using text IDs such as `001`
- duplicate card numbers across different sets
- source URL storage
- card count storage
- image path storage
- logo path storage
- collection migration from Liga URLs without image downloads
- ownership migration from old slug/number keys after all collection migrations
- dry-run side-effect behavior
- no network access in tests

## Web tests

Add or update tests for:

- catalog queries return database metadata
- rarity codes are returned as text and display labels are derived separately
- set lookup by slug
- cards are ordered by `sort_key`
- ownership is keyed by `(set_id, set_card_id)`
- ownership operations increment and decrement correctly
- two sets can both own card `001` without collision
- invalid set/card pairs are rejected
- filters work with set card IDs
- image path traversal is rejected
- logo paths resolve safely
- the collection page combines catalog and ownership data

## Integration scenario

Use at least two sets with the same card number:

```text
Set A + 001
Set B + 001
```

Verify that:

- both cards exist in `catalog.db`
- ownership for Set A does not affect Set B
- set counts remain independent
- the UI renders both correctly

# Acceptance criteria

The migration is complete when:

- `data/catalog.db` contains all downloaded sets and cards.
- `data/ownership.db` contains migrated ownership counts.
- A new download writes both images and catalog records.
- Re-downloading a set reuses its set ID and does not duplicate rows.
- `--dry-run` does not create databases or folders.
- The web app reads set and card metadata from `catalog.db`.
- The web app reads and writes quantities in `ownership.db`.
- Card number `001` in one set cannot collide with card number `001` in another set.
- Card and logo paths are stored relative to the project root.
- Invalid ownership keys cannot be written.
- Existing card images continue to render.
- Existing ownership counts survive migration.
- Tests do not contact Liga Pokémon.

# Risks and safeguards

## Set ID instability

Because ownership stores numeric `set_id`, catalog imports must preserve the existing row ID for each `set_code`.

Safeguard:

- upsert sets by `set_code`
- never delete and recreate existing sets during normal downloads
- back up both databases together

## Missing source URLs for old sets

Existing folders may not contain enough information to reconstruct their original Liga URL.

Safeguard:

- provide a migration mapping, or
- temporarily allow a null URL for historical sets

## Image paths pointing to missing files

A catalog row may exist while its image download failed.

Safeguard:

- keep the CLI failure exit code
- have the image route return `404`
- do not treat a missing image as a reason to corrupt ownership data

## Card-number assumptions

Current numbers are zero-padded, but future source data may include alphanumeric numbers.

Safeguard:

- store set-card IDs as text
- do not cast them to integers
- preserve the source representation

# Suggested implementation order

1. Add database path helpers and schemas.
2. Add catalog field normalization tests.
3. Add the reusable Python catalog store.
4. Add `migrate_collection.py`, including the optional `--logo` argument.
5. Run `migrate_collection.py` once per existing set URL against a backup of local data.
6. Update `download_collection.py` to upsert new and existing collections and to stop downloading card backs.
7. Add downloader/catalog integration tests.
8. Update web catalog reads to use SQLite.
9. Add `migrate_ownership.py` and run it once after all collection migrations.
10. Update ownership functions and server actions.
11. Update the collection page, filters, and copy controls.
12. Update image and logo resolution to use stored paths safely.
13. Remove old filesystem metadata reads.
14. Update documentation and `AGENTS.md`.
15. Run the full Python and web test suites.
