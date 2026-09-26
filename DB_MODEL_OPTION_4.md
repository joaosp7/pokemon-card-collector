# Option 4: Separate Catalog and Ownership Databases

Option 4 separates two different kinds of data:

- **Catalog data** — what cards exist and what Liga Pokémon says about them
- **Ownership data** — what you personally own

Those have different lifecycles, so keeping them in separate databases is defensible.

```text
catalog.db
├── sets
└── set_cards

ownership.db
└── owned_cards
```

The catalog database can be regenerated or refreshed from Liga Pokémon without touching ownership. The ownership database is personal state and should persist independently.

## 1. `catalog.db`

This database represents the external card catalog.

```sql
sets
----
set_key
set_code
name_pt
name_en
slug
source_url
source_id
logo_filename
active
created_at
updated_at
```

```sql
set_cards
---------
card_key
set_key
collector_number
sort_key
name_pt
name_en
element_code
card_kind
rarity
front_filename
back_filename
source_id
active
created_at
updated_at
```

Possible example:

```text
set_key:          liga:806
set_code:         M6
name_pt:          Storm Emeralda
slug:             Storm-Emeralda-M6

card_key:         liga:806:001
collector_number: 001
name_pt:          Weedle
element_code:     G
front_filename:   001_G_Weedle.jpg
```

The important part is that the key should not be based on the display slug if possible.

This is fragile:

```text
Storm-Emeralda-M6:001
```

The title or slug could change.

This is more stable:

```text
liga:806:001
```

where `806` comes from the Liga source identifier or URL.

## 2. `ownership.db`

This database represents local binder state.

The initial model can remain very small:

```sql
owned_cards
-----------
card_key
copies
updated_at
```

Example:

```text
card_key: liga:806:001
copies:   2
```

A missing row means zero copies owned. That is the same behavior the current application has.

The ownership database should not need to duplicate the card name, set title, image filename, or element. Those belong to the catalog database.

## Why this separation makes sense

### Catalog data is replaceable

Liga Pokémon may:

- correct a card name
- add a missing card
- change an image path
- update a set logo
- change the set title
- remove or deactivate an entry

Those changes should be safe to apply without affecting:

```text
I own two copies of this card.
```

### Ownership data is personal

Ownership could eventually contain:

- copies owned
- condition
- language
- favorite status
- notes
- acquisition date
- price paid
- trade status

None of those should be overwritten by a catalog refresh.

### The databases have different backup needs

The catalog can probably be reconstructed from the source and downloaded images.

The ownership database is the irreplaceable personal state. It should be easy to back up separately.

This also makes it possible to share the catalog without sharing personal ownership information.

# The main technical cost: no cross-database foreign key

SQLite cannot enforce a foreign key from `ownership.db` into `catalog.db`.

So this cannot be enforced directly by SQLite:

```text
ownership.card_key → catalog.set_cards.card_key
```

The application has to maintain the relationship.

There are several ways to handle that.

## Strategy A: Application-level validation

When adding ownership:

1. Receive a `card_key`.
2. Confirm that the key exists in `catalog.db`.
3. Update `ownership.db`.

The API should not blindly accept arbitrary card keys.

We can also have a diagnostic query that reports ownership rows whose card no longer exists in the catalog.

This is probably enough for the application.

## Strategy B: Use SQLite `ATTACH DATABASE`

SQLite can attach both files to one connection:

```sql
ATTACH DATABASE 'catalog.db' AS catalog;
```

Then the application can query across them:

```sql
SELECT
  c.card_key,
  c.collector_number,
  c.name_pt,
  COALESCE(o.copies, 0) AS copies
FROM catalog.set_cards AS c
LEFT JOIN owned_cards AS o
  ON o.card_key = c.card_key
WHERE c.set_key = ?;
```

This gives convenient cross-database reads, but it does not make the foreign key enforceable. It also means the database connection needs to be configured carefully.

## Strategy C: Keep ownership keys deliberately stable

Instead of relying on an auto-incremented catalog row ID, both databases store a stable domain key:

```text
liga:806:001
```

That makes the separation safer.

Avoid this:

```text
catalog set_cards.id = 42
ownership.owned_cards.card_id = 42
```

because rebuilding or reimporting the catalog could assign a different ID to the same card.

# What should `card_key` be?

This is probably the most important design decision.

A reasonable initial key could be:

```text
{source}:{set-source-id}:{collector-number}
```

Example:

```text
liga:806:001
```

However, we need to account for possible duplicate collector numbers.

Some possible cases:

```text
same set + same collector number + different variant
same card + normal holo
same card + reverse holo
same number + alternate language
```

If the source provides a stable card identifier, use that:

```text
liga-card:123456
```

If not, we might need:

```text
liga:806:001:default
liga:806:001:reverse-holo
```

Do not enforce `UNIQUE(set_key, collector_number)` until we have verified that Liga’s data guarantees it.

The current catalog appears to use the collector number as the practical identity, but the database model should leave room for variants.

# Catalog refresh behavior

A catalog import could work like this:

1. Fetch a set from Liga Pokémon.
2. Upsert the set record.
3. Upsert each `set_card`.
4. Update catalog metadata and image filenames.
5. Mark previously known cards that disappeared as inactive.
6. Never modify `ownership.db`.

The important part is to avoid hard-deleting cards from the catalog.

Suppose a card is owned and Liga later stops returning it. If we delete the catalog row, the ownership database contains an orphaned record.

A safer model is:

```text
active = false
```

The UI could then show it as:

- inactive
- unavailable in the current source catalog
- still owned
- needing review

This preserves history.

# What happens if a set slug changes?

The slug should be treated as a display and filesystem concern, not as the identity of the set.

For example:

```text
set_key: liga:806
slug:    Storm-Emeralda-M6
```

If the title changes:

```text
set_key: liga:806
slug:    Storm-Emeralda-Updated-M6
```

The ownership key remains:

```text
liga:806:001
```

That means a title change does not orphan ownership data.

The filesystem would need to handle a directory rename separately, but that is much safer than making the directory name the primary key.

# Images should remain outside the database

Images should not be stored as binary blobs inside SQLite.

Keep:

```text
cards/
└── Storm-Emeralda-M6/
    ├── 001_G_Weedle.jpg
    ├── 002_G_Kakuna.jpg
    └── logo.png
```

Store references in the catalog:

```text
front_filename: 001_G_Weedle.jpg
back_filename:  null
```

This gives us:

- database-backed metadata
- filesystem-backed image storage
- easier image inspection and backup
- no large binary blobs inside SQLite

The database should not need to reconstruct filenames from card names. It should store the actual filename.

# Where should the databases live?

Possible layout:

```text
data/
├── catalog.db
└── ownership.db

cards/
└── set-slugs-and-images/
```

or:

```text
web/data/catalog.db
web/data/ownership.db

cards/
└── set-slugs-and-images/
```

A repository-level data directory is probably preferable:

```text
data/catalog.db
data/ownership.db
```

The downloader is Python and the web app is Next.js. Both should be able to access the catalog without treating it as web-only data.

The existing ownership database is currently under:

```text
web/data/collection.db
```

That could eventually become:

```text
data/ownership.db
```

or remain under `web/data/` if the ownership store is considered specific to the web application.

Conceptually, this is preferable:

```text
data/catalog.db
data/ownership.db
```

with both explicitly ignored by Git.

# Suggested initial schema

## Catalog database

```sql
CREATE TABLE sets (
  set_key TEXT PRIMARY KEY,
  set_code TEXT NOT NULL,
  name_pt TEXT NOT NULL,
  name_en TEXT,
  slug TEXT NOT NULL UNIQUE,
  source_url TEXT,
  source_id TEXT,
  logo_filename TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE set_cards (
  card_key TEXT PRIMARY KEY,
  set_key TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  sort_key TEXT,
  name_pt TEXT,
  name_en TEXT,
  element_code TEXT,
  card_kind TEXT,
  rarity TEXT,
  front_filename TEXT,
  back_filename TEXT,
  source_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (set_key) REFERENCES sets(set_key)
);

CREATE INDEX set_cards_by_set
  ON set_cards(set_key, sort_key);
```

Because this is the catalog database, the `set_key` relationship can be enforced locally.

## Ownership database

```sql
CREATE TABLE owned_cards (
  card_key TEXT PRIMARY KEY,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  updated_at TEXT NOT NULL
);
```

This keeps the ownership database intentionally independent.

Later, if multiple binders or users are needed:

```sql
CREATE TABLE binders (
  binder_key TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE owned_cards (
  binder_key TEXT NOT NULL,
  card_key TEXT NOT NULL,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (binder_key, card_key)
);
```

That complexity should wait until there is an actual need for multiple binders or profiles.

# Quantity versus individual physical cards

The initial ownership model should probably continue storing an aggregate quantity:

```text
card_key → copies
```

That is simpler and matches the current application.

We should not immediately create one row per physical card unless individual differences need to be tracked.

## Aggregate model

```text
card_key: liga:806:001
copies: 3
```

Good for:

- simple binder tracking
- missing/owned filters
- counting cards
- adding and removing copies

## Individual inventory model

```text
owned_card_instances
--------------------
instance_id
card_key
condition
language
grading
purchase_price
notes
```

Good for:

- cards with different conditions
- graded cards
- multiple languages
- trade inventory
- individual purchase history

The aggregate model is the right starting point. The database boundary should not force individual-card modeling prematurely.

# Web app read flow

A set page would conceptually do this:

1. Query `catalog.db` for the set and its cards.
2. Collect the returned `card_key` values.
3. Query `ownership.db` for ownership rows for those keys.
4. Merge the two datasets in application code.
5. Render cards with `copies = 0` when no ownership row exists.

The result would be conceptually:

```ts
{
  cardKey: "liga:806:001",
  collectorNumber: "001",
  name: "Weedle",
  element: "Planta",
  image: "001_G_Weedle.jpg",
  copies: 2
}
```

The catalog and ownership data remain separate even though the UI presents them together.

# Downloader flow

The downloader currently:

- fetches the Liga catalog
- creates the set directory
- downloads images
- encodes metadata in filenames

Under this model, it would additionally:

- open or update `catalog.db`
- upsert the set
- upsert each `set_card`
- store image filenames in the catalog

The image download and catalog update should be coordinated carefully.

One safe order would be:

1. Fetch and parse the complete source catalog.
2. Upsert metadata into a staging area or transaction.
3. Download images.
4. Record the image filename after a successful download.
5. Mark the set sync as complete.

Alternatively, the catalog can record the expected filename before the download, and the web app can verify that the file exists before displaying it.

The latter is simpler, but it means the catalog may temporarily refer to missing images if a download fails.

# Recommended decisions so far

If we proceed with Option 4, the initial rules could be:

1. Call the two concerns **Catalog** and **Ownership**.
2. Use `catalog.db` for sets and set-specific card records.
3. Use `ownership.db` for local binder state.
4. Use `SetCard` as the domain name for a card’s appearance in a set.
5. Use stable `card_key` values rather than auto-increment IDs.
6. Do not use the display slug as the ownership identity.
7. Keep images on disk.
8. Store image filenames in the catalog database.
9. Keep ownership as aggregate `copies` initially.
10. Never hard-delete catalog cards during refreshes; mark them inactive instead.
11. Validate ownership keys at the application boundary.
12. Preserve Portuguese and English names separately.
13. Treat the current `sC` field as an element/energy field until proven otherwise.
14. Keep catalog refreshes completely independent from ownership updates.

# Questions to settle next

The next design questions are focused:

1. Should the canonical set key come from Liga’s `edid`, `sSigla`, or both?
2. Does Liga provide a stable unique card identifier?
3. Can a set contain multiple entries with the same collector number?
4. Should the catalog include every card returned by Liga, even if an image failed to download?
5. Should inactive cards remain visible in the binder?
6. Should metadata refreshes be automatic, manual, or only happen when downloading a set?
7. Should `catalog.db` and `ownership.db` live in the repository-level `data/` directory?
8. Do we want catalog records to preserve the raw Liga payload for future fields?

The most important answers are probably the first three. They determine whether ownership can safely reference cards without relying on fragile display names or filenames.
