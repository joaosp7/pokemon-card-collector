"""Catalog database paths, schema, and persistence.

Persistence helpers write normalized catalog values. They do not fetch Liga
Pokémon or download images, and they never open ``ownership.db``.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

CATALOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_code TEXT NOT NULL UNIQUE,
  name_pt TEXT,
  name_en TEXT,
  slug TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  logo_path TEXT,
  card_count INTEGER NOT NULL CHECK (card_count >= 0)
);

CREATE TABLE IF NOT EXISTS set_cards (
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
"""


def project_root() -> Path:
    here = Path(__file__).resolve().parent
    if here.name == "scripts" and (here.parent / "pyproject.toml").is_file():
        return here.parent
    cwd = Path.cwd().resolve()
    for candidate in (cwd, *cwd.parents):
        marker = candidate / "scripts" / "download_collection.py"
        if (candidate / "pyproject.toml").is_file() and marker.is_file():
            return candidate
    return here.parent


def data_dir() -> Path:
    return project_root() / "data"


def catalog_db_path() -> Path:
    return data_dir() / "catalog.db"


def normalize_project_relative(path: str) -> str:
    """Keep an image or logo path relative to the repository root."""
    if path.startswith("/") or (len(path) >= 2 and path[1] == ":"):
        raise ValueError("path must be project-root-relative")
    parts = Path(path).parts
    if any(part == ".." for part in parts):
        raise ValueError("path must stay inside the repository")
    return Path(*parts).as_posix() if parts else ""


def resolve_project_path(path: str) -> Path:
    return project_root() / normalize_project_relative(path)


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open catalog.db, create data/ when writing, and enable foreign keys."""
    conn = _connect_writable(catalog_db_path() if db_path is None else db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(CATALOG_SCHEMA)
    return conn


def _connect_writable(db_path: Path | str) -> sqlite3.Connection:
    if db_path == ":memory:":
        return sqlite3.connect(":memory:")
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(path)


_SET_COLUMNS = (
    "set_code",
    "name_pt",
    "name_en",
    "slug",
    "source_url",
    "logo_path",
    "card_count",
)
_SET_REQUIRED = ("set_code", "slug", "source_url", "card_count")


def find_set_by_code(conn: sqlite3.Connection, set_code: str) -> dict[str, Any] | None:
    """Return the set row whose import identity is ``set_code``, if it exists."""
    return _fetch_one(
        conn,
        """
        SELECT id, set_code, name_pt, name_en, slug, source_url, logo_path, card_count
        FROM sets
        WHERE set_code = ?
        """,
        (_required_text(set_code, "set_code"),),
    )


def find_set_card(
    conn: sqlite3.Connection, set_id: int, card_id: str
) -> dict[str, Any] | None:
    """Return one set card by its ``(set_id, id)`` identity."""
    return _fetch_one(
        conn,
        """
        SELECT
            id, set_id, name_pt, name_en, element_code, rarity_code,
            image_path, sort_key, illustrator
        FROM set_cards
        WHERE set_id = ? AND id = ?
        """,
        (_set_id(set_id), _required_text(card_id, "id")),
    )


def insert_set(conn: sqlite3.Connection, fields: Mapping[str, Any]) -> int:
    """Insert a new set and return ``sets.id``. Does not commit."""
    values = _set_values(fields, partial=False)
    cursor = conn.execute(
        """
        INSERT INTO sets (
            set_code, name_pt, name_en, slug, source_url, logo_path, card_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        tuple(values[column] for column in _SET_COLUMNS),
    )
    if cursor.lastrowid is None:
        raise sqlite3.DatabaseError("set insert did not return an id")
    return int(cursor.lastrowid)


def update_set(
    conn: sqlite3.Connection, set_id: int, fields: Mapping[str, Any]
) -> None:
    """Update set columns in ``fields``. ``sets.id`` is never changed."""
    row_id = _set_id(set_id)
    if _fetch_one(conn, "SELECT id FROM sets WHERE id = ?", (row_id,)) is None:
        raise LookupError(f"set id {row_id} does not exist")
    values = _set_values(fields, partial=True)
    assignments = [column for column in _SET_COLUMNS if column in values]
    if not assignments:
        return
    conn.execute(
        f"UPDATE sets SET {', '.join(f'{column} = ?' for column in assignments)} "
        "WHERE id = ?",
        tuple(values[column] for column in assignments) + (row_id,),
    )


def upsert_set(conn: sqlite3.Connection, fields: Mapping[str, Any]) -> int:
    """Insert or update a set by ``set_code`` and return the stable ``sets.id``."""
    set_code = _required_text(fields.get("set_code"), "set_code")
    existing = find_set_by_code(conn, set_code)
    if existing is None:
        return insert_set(conn, fields)
    set_id = int(existing["id"])
    update_set(conn, set_id, fields)
    return set_id


def upsert_set_card(
    conn: sqlite3.Connection, set_id: int, card: Mapping[str, Any]
) -> None:
    """Insert or update one card. Identity is ``(set_id, id)`` and is not rewritten."""
    row_id = _set_id(set_id)
    card_id = _required_text(card.get("id"), "id")
    values = _card_values(card)
    conn.execute(
        """
        INSERT INTO set_cards (
            id, set_id, name_pt, name_en, element_code, rarity_code,
            image_path, sort_key, illustrator
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(set_id, id) DO UPDATE SET
            name_pt = excluded.name_pt,
            name_en = excluded.name_en,
            element_code = excluded.element_code,
            rarity_code = excluded.rarity_code,
            image_path = excluded.image_path,
            sort_key = excluded.sort_key,
            illustrator = excluded.illustrator
        """,
        (
            card_id,
            row_id,
            values["name_pt"],
            values["name_en"],
            values["element_code"],
            values["rarity_code"],
            values["image_path"],
            values["sort_key"],
            values["illustrator"],
        ),
    )


def import_set(
    conn: sqlite3.Connection,
    fields: Mapping[str, Any],
    cards: Sequence[Mapping[str, Any]],
) -> int:
    """Commit one set and its cards together. Roll back if any card write fails.

    Lower-level insert and upsert helpers leave the connection's transaction
    open so this function can commit or roll them back as one import.
    """
    with conn:
        set_id = upsert_set(conn, fields)
        for card in cards:
            upsert_set_card(conn, set_id, card)
    return set_id


def _fetch_one(
    conn: sqlite3.Connection, sql: str, params: tuple[Any, ...]
) -> dict[str, Any] | None:
    cursor = conn.execute(sql, params)
    row = cursor.fetchone()
    if row is None or cursor.description is None:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row, strict=True))


def _set_values(fields: Mapping[str, Any], *, partial: bool) -> dict[str, Any]:
    if not partial:
        missing = [column for column in _SET_REQUIRED if column not in fields]
        if missing:
            raise ValueError(f"missing set fields: {', '.join(missing)}")
    values: dict[str, Any] = {}
    for column in _SET_COLUMNS:
        if column not in fields:
            if partial:
                continue
            values[column] = _coerce_set_column(column, None)
            continue
        values[column] = _coerce_set_column(column, fields[column])
    return values


def _coerce_set_column(column: str, value: Any) -> Any:
    if column == "set_code":
        return _required_text(value, "set_code")
    if column == "slug":
        return _required_text(value, "slug")
    if column == "source_url":
        return _required_text(value, "source_url")
    if column == "card_count":
        return _card_count(value)
    if column == "logo_path":
        return _optional_project_path(value, "logo_path")
    if column in ("name_pt", "name_en"):
        return _optional_text(value, column)
    raise ValueError(f"unknown set column: {column}")


def _card_values(card: Mapping[str, Any]) -> dict[str, Any]:
    if "image_path" not in card:
        raise ValueError("image_path is required")
    if "sort_key" not in card:
        raise ValueError("sort_key is required")
    return {
        "name_pt": _optional_text(card.get("name_pt"), "name_pt"),
        "name_en": _optional_text(card.get("name_en"), "name_en"),
        "element_code": _optional_text(card.get("element_code"), "element_code"),
        "rarity_code": _optional_text(card.get("rarity_code"), "rarity_code"),
        "image_path": _required_project_path(card.get("image_path"), "image_path"),
        "sort_key": _sort_key(card.get("sort_key")),
        "illustrator": _optional_text(card.get("illustrator"), "illustrator"),
    }


def _set_id(set_id: Any) -> int:
    if isinstance(set_id, bool) or not isinstance(set_id, int):
        raise ValueError("set_id must be an integer")
    if set_id < 1:
        raise ValueError("set_id must be positive")
    return set_id


def _card_count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("card_count must be an integer")
    if value < 0:
        raise ValueError("card_count must be >= 0")
    return value


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    text = value.strip()
    if not text:
        raise ValueError(f"{field} is required")
    return text


def _optional_text(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    text = value.strip()
    return text or None


def _sort_key(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("sort_key must be text")
    if not value.strip():
        raise ValueError("sort_key is required")
    return value


def _optional_project_path(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    text = value.strip()
    if not text:
        return None
    return normalize_project_relative(text)


def _required_project_path(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be text")
    text = value.strip()
    if not text:
        raise ValueError(f"{field} is required")
    return normalize_project_relative(text)
