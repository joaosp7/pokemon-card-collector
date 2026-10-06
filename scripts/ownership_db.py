"""Ownership database paths and schema."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from catalog_db import _connect_writable, data_dir

OWNERSHIP_SCHEMA = """
CREATE TABLE IF NOT EXISTS owned_cards (
  set_card_id TEXT NOT NULL,
  set_id INTEGER NOT NULL,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (set_id, set_card_id)
);
"""


def ownership_db_path() -> Path:
    return data_dir() / "ownership.db"


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open ownership.db and create data/ when writing a file database."""
    conn = _connect_writable(ownership_db_path() if db_path is None else db_path)
    conn.executescript(OWNERSHIP_SCHEMA)
    return conn
