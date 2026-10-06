# Catalog and Ownership Database Model — Revised

This document reflects the decisions and corrections marked in `DB_MODEL_OPTION_4.md`.

The model has two separate SQLite databases:

```text
data/
├── catalog.db
└── ownership.db

cards/
└── set-slugs-and-images/
```

The databases represent two separate concerns:

- **Catalog** — the sets and cards available in the archive
- **Ownership** — how many copies of each card are owned

Images remain in the repository filesystem. The catalog database stores paths to those images.

# Domain model

## Set

A `Set` represents one Pokémon card set, such as:

- `CRI`
- `30C`
- `POR`
- `PBL`
- `PFL`
- `M6`

The `set_code` is a globally unique domain identifier. It is not an identifier generated specifically by Liga Pokémon, even though Liga currently provides these codes.

A set has:

- a local database ID
- a globally unique set code
- Portuguese and English names
- a stable slug
- the Liga Pokémon download URL
- an optional logo path
- the expected total number of cards

## Set card

A `SetCard` represents one card number within one set.

For example:

```text
Set: M6
Card number: 001
Name: Weedle
```

The card number is unique within a set, not necessarily across all sets.

Therefore, the logical identity of a set card is:

```text
(set_id, set_card_id)
```

The `set_card_id` is the card number inside the set. We should preserve it as text, such as `"001"`, rather than converting it to the integer `1`, because the leading zero is meaningful for display and future sources may use values such as `TG01` or `SVP001`.

## Owned card

An `OwnedCard` represents the number of copies owned for one set card.

The initial model stores an aggregate quantity:

```text
set M6, card 001 → 2 copies owned
```

There is no need to model each physical card separately at this point.

# `catalog.db`

`catalog.db` contains metadata about sets and cards. It does not contain personal ownership information.

## `sets`

Final column proposal:

```text
sets
----
id
set_code
name_pt
name_en
slug
source_url
logo_path
card_count
```

### Columns

| Column | Meaning |
| --- | --- |
| `id` | Local auto-incrementing primary key for the set. |
| `set_code` | Globally unique set code, such as `M6` or `30C`. |
| `name_pt` | Portuguese set name. |
| `name_en` | English set name, if available. |
| `slug` | Stable filesystem and display slug, such as `Storm-Emeralda-M6`. |
| `source_url` | The Liga Pokémon URL used to download the set. |
| `logo_path` | Path from the project root to the set logo. |
| `card_count` | Total number of cards in the set. |

`card_count` is used instead of `card_number` because `card_number` could be confused with the number of an individual card.

Example:

```text
id:          1
set_code:    M6
name_pt:     Storm Emeralda
name_en:     Storm Emerald
slug:        Storm-Emeralda-M6
source_url:  https://www.ligapokemon.com.br/?view=cards/search&card=edid=806%20ed=M6
logo_path:   cards/Storm-Emeralda-M6/logo.png
card_count:  113
```

### Set schema

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
```

There are intentionally no `source_id`, `active`, `created_at`, or `updated_at` columns in this initial model.

## `set_cards`

Final column proposal:

```text
set_cards
---------
id
set_id
name_pt
name_en
element_code
rarity_code
image_path
sort_key
illustrator
```

### Columns

| Column | Meaning |
| --- | --- |
| `id` | The card number within the set, such as `001`. This is a set-local identifier. |
| `set_id` | Foreign-key relationship to `sets.id` inside `catalog.db`. |
| `name_pt` | Portuguese card name. |
| `name_en` | English card name, if available. |
| `element_code` | Liga’s element or energy code, such as `G`, `R`, or `W`. |
| `rarity_code` | Normalized rarity code, such as `C`, `IR`, or `RD`. |
| `image_path` | Path from the project root to the card image. |
| `sort_key` | Liga’s `dN` value. Cards are already ordered by their number in the set, and the page sorts by this field. |
| `illustrator` | Card illustrator. This will be populated when the source data is available. |

The previous fields have been removed or renamed:

- `card_key` becomes `id`.
- `set_key` becomes `set_id`.
- `collector_number` is removed because `id` is the collector/card number.
- `sort_key` stays. It stores Liga’s `dN`, which is the card’s order in the set.
- `front_filename` becomes `image_path`.
- `back_filename` is removed. Card backs are not stored and are not downloaded.
- `source_id` is removed.
- `card_kind` is removed because Liga does not provide reliable card-category data.
- `active` is removed.
- `created_at` is removed.
- `updated_at` is removed.

### Important identity detail

The card number is unique only inside its set.

This is valid:

```text
M6 + 001
30C + 001
```

Both sets can contain card number `001`.

Therefore, `set_cards.id` cannot be the only primary key in a central catalog database. The database identity must be composite:

```text
(set_id, id)
```

The `id` column still represents exactly the card number inside the collection, but it is scoped by `set_id`.

### Set card schema

```sql
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

Every connection to `catalog.db` runs `PRAGMA foreign_keys = ON` before use. SQLite leaves foreign keys off unless that pragma is set, so the `set_cards` foreign key does nothing without it. The primary key already indexes `(set_id, id)`, so there is no extra index on those columns.

Example:

```text
set_id:        1
id:            001
name_pt:       Weedle
name_en:       Weedle
element_code:  G
rarity_code:   C
image_path:    cards/Storm-Emeralda-M6/001_G_Weedle.jpg
sort_key:      001
illustrator:   Example Illustrator
```

# `ownership.db`

`ownership.db` contains only local binder state.

## `owned_cards`

Final column proposal:

```text
owned_cards
-----------
set_card_id
set_id
copies
updated_at
```

### Columns

| Column | Meaning |
| --- | --- |
| `set_card_id` | The card number inside the set. This corresponds to `set_cards.id`. |
| `set_id` | The set ID. This corresponds to `sets.id` and makes set-level counting easier. |
| `copies` | Number of owned copies. |
| `updated_at` | Time the ownership row was last changed. |

The logical ownership identity is:

```text
(set_id, set_card_id)
```

Example:

```text
set_id:       1
set_card_id:  001
copies:       2
```

A missing row means that zero copies are owned.

### Ownership schema

```sql
CREATE TABLE owned_cards (
  set_card_id TEXT NOT NULL,
  set_id INTEGER NOT NULL,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (set_id, set_card_id)
);
```

`set_id` and `set_card_id` together identify the catalog card. The relationship is logical because the catalog and ownership databases are separate files. Cross-database foreign-key enforcement is intentionally out of scope for now.

## Why store both `set_id` and `set_card_id`?

`set_card_id` alone is not globally unique. Card `001` can exist in many sets.

Keeping both values makes the ownership row self-describing:

```text
set_id:       1
set_card_id:  001
```

It also makes set-level queries straightforward, such as counting owned cards for one set.

The application must ensure that the pair exists in the catalog before creating or changing ownership.

# Image paths

Images remain outside SQLite.

Example filesystem:

```text
cards/
└── Storm-Emeralda-M6/
    ├── 001_G_Weedle.jpg
    ├── 002_G_Kakuna.jpg
    └── logo.png
```

The database stores paths relative to the project root:

```text
cards/Storm-Emeralda-M6/001_G_Weedle.jpg
cards/Storm-Emeralda-M6/logo.png
```

This gives the application a direct path for rendering images without reconstructing a filename from the card name.

The paths should be relative to the project root rather than absolute machine-specific paths. That keeps the database portable if the project directory moves.

`image_path` points to the card image, and `logo_path` points to the optional set logo.

The import command takes the Liga URL and, when you have one, a logo file. It copies that file into the set folder as `logo.png`, `logo.webp`, `logo.jpg`, or `logo.jpeg`, then stores that project-relative path in `logo_path`. A later import without a logo leaves the saved logo alone. The app does not scan the set folder for a logo.

There is no back-image field. The downloader does not fetch Liga’s `f_sP` and does not write `_back.jpg` files.

# Database layout

The selected layout is:

```text
data/
├── catalog.db
└── ownership.db

cards/
└── {set-slug}/
    ├── card images
    └── logo image
```

Both database files should remain ignored by Git.

The repository-level location allows both the Python downloader and the Next.js web application to access the same files. The Next.js app’s working directory is `web/`, so it opens `data/` by stepping up to the repository root. It does not open `web/data/` for `catalog.db` or `ownership.db`.

# Set code and set ID

There are two different identifiers for a set:

```text
sets.id        = local database identity
sets.set_code  = stable global domain code
```

Example:

```text
id:       1
set_code: M6
```

`set_code` is the meaningful global identifier. `id` is the internal relational identifier used by `set_cards` and `owned_cards`.

Because `ownership.db` stores `set_id`, the catalog database must preserve set IDs after they have been assigned. When importing a set again, the importer should find the existing set by `set_code` and keep its existing `id` rather than creating a new set row.

This is an important constraint: replacing `catalog.db` with a freshly generated database that assigns different IDs would invalidate ownership rows. The catalog database should therefore be updated in place, or ownership should eventually use `set_code` instead of the local numeric `set_id`.

# What is intentionally not included yet

The initial model does not include:

- a separate database per set
- a `card_kind` field
- cross-database foreign-key enforcement
- catalog refresh/deactivation behavior
- individual physical card records
- card conditions
- grading information
- purchase prices
- notes
- card back images, including downloading them
- source-specific card IDs
- created timestamps on catalog records
- updated timestamps on catalog records
- active flags

Ownership remains an aggregate quantity:

```text
one catalog card → number of copies owned
```

# Initial read model for the web app

To display a set page:

1. Read the set and its cards from `catalog.db`.
2. Order the cards by `sort_key`.
3. Read ownership rows from `ownership.db` using `set_id` and card IDs.
4. Merge the catalog card with its ownership quantity.
5. Treat a missing ownership row as `copies = 0`.

The displayed card name is `name_pt` when that value is present, and `name_en` otherwise.

A rendered card can look like:

```ts
{
  setId: 1,
  setCardId: "001",
  collectorNumber: "001",
  name: "Weedle",
  element: "Planta",
  imagePath: "cards/Storm-Emeralda-M6/001_G_Weedle.jpg",
  copies: 2
}
```

The application may call the `id` value `collectorNumber` in its view model even though the database column is named `id`. This keeps the UI vocabulary clear while allowing the database model to use the chosen set-local identifier.

# Decisions captured by this revision

1. Use `catalog.db` and `ownership.db`.
2. Store both files under the repository-level `data/` directory.
3. Use `sets.id` as an auto-incrementing local primary key.
4. Use `sets.set_code` as the globally unique set code.
5. Keep `slug` stable.
6. Store the Liga download URL as `source_url`.
7. Store image and logo locations as project-root-relative paths.
8. Add `card_count` to `sets`.
9. Use `set_cards.id` as the card number within a set.
10. Keep the set-card identity scoped by `(set_id, id)`.
11. Store Liga’s `dN` in `sort_key` and order cards by that field.
12. Add `illustrator` to `set_cards`.
13. Do not store or download card backs.
14. Store ownership using `(set_id, set_card_id)`.
15. Track aggregate `copies` only.
16. Do not model individual card conditions, grading, prices, or notes yet.
17. Defer cross-database foreign-key enforcement.
18. Enable foreign keys on every `catalog.db` connection.
19. Pass the set logo into the import command. Do not discover it by scanning the folder.
20. Display `name_pt` when present, otherwise `name_en`.
