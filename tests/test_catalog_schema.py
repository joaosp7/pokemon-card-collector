import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import catalog_db  # noqa: E402
import ownership_db  # noqa: E402

SET_COLUMNS = [
    "id",
    "set_code",
    "name_pt",
    "name_en",
    "slug",
    "source_url",
    "logo_path",
    "card_count",
]
SET_CARD_COLUMNS = [
    "id",
    "set_id",
    "name_pt",
    "name_en",
    "element_code",
    "rarity_code",
    "image_path",
    "sort_key",
    "illustrator",
]
OWNED_COLUMNS = ["set_card_id", "set_id", "copies", "updated_at"]


def column_names(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def schema_objects(conn: sqlite3.Connection) -> list[tuple]:
    return conn.execute(
        """
        SELECT type, name, sql
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
        """
    ).fetchall()


class CatalogSchemaTests(unittest.TestCase):
    def test_open_creates_sets_and_set_cards_with_sort_key_and_no_extra_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "catalog.db"
            conn = catalog_db.connect(db_path)
            try:
                self.assertEqual(column_names(conn, "sets"), SET_COLUMNS)
                self.assertEqual(column_names(conn, "set_cards"), SET_CARD_COLUMNS)
                sort_key = conn.execute("PRAGMA table_info(set_cards)").fetchall()
                sort_key_row = next(row for row in sort_key if row[1] == "sort_key")
                self.assertEqual(sort_key_row[2], "TEXT")
                self.assertEqual(sort_key_row[3], 1)

                sets_sql = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sets'"
                ).fetchone()[0]
                cards_sql = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'set_cards'"
                ).fetchone()[0]
                self.assertIn("CHECK (card_count >= 0)", sets_sql)
                self.assertIn("FOREIGN KEY (set_id) REFERENCES sets(id)", cards_sql)
                self.assertNotIn("card_kind", cards_sql)
                self.assertNotIn("source_id", cards_sql)

                indexes = conn.execute(
                    """
                    SELECT name, sql
                    FROM sqlite_master
                    WHERE type = 'index' AND tbl_name = 'set_cards'
                    """
                ).fetchall()
                self.assertEqual(len(indexes), 1)
                self.assertIsNone(indexes[0][1])
                indexed_columns = [
                    row[2]
                    for row in conn.execute(f'PRAGMA index_info("{indexes[0][0]}")')
                ]
                self.assertEqual(indexed_columns, ["set_id", "id"])
                user_indexes = conn.execute(
                    """
                    SELECT sql FROM sqlite_master
                    WHERE type = 'index'
                      AND tbl_name = 'set_cards'
                      AND sql IS NOT NULL
                    """
                ).fetchall()
                self.assertEqual(user_indexes, [])
            finally:
                conn.close()

    def test_foreign_keys_enabled(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "catalog.db"
            conn = catalog_db.connect(db_path)
            try:
                self.assertEqual(conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)
                with self.assertRaises(sqlite3.IntegrityError):
                    conn.execute(
                        """
                        INSERT INTO set_cards (id, set_id, image_path, sort_key)
                        VALUES ('001', 99, 'cards/Storm-Emeralda-M6/001_G_Weedle.jpg', '001')
                        """
                    )
                conn.rollback()
            finally:
                conn.close()
            again = catalog_db.connect(db_path)
            try:
                self.assertEqual(again.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            finally:
                again.close()

    def test_reopen_does_not_duplicate_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "catalog.db"
            first = catalog_db.connect(db_path)
            try:
                before = schema_objects(first)
            finally:
                first.close()
            second = catalog_db.connect(db_path)
            try:
                self.assertEqual(schema_objects(second), before)
                self.assertEqual(
                    [row[0] for row in second.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sets', 'set_cards') ORDER BY name"
                    )],
                    ["set_cards", "sets"],
                )
            finally:
                second.close()

    def test_same_card_id_in_two_sets(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                conn.execute(
                    """
                    INSERT INTO sets (set_code, slug, source_url, card_count)
                    VALUES ('M6', 'Storm-Emeralda-M6', 'https://example.test/m6', 1)
                    """
                )
                set_one = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.execute(
                    """
                    INSERT INTO sets (set_code, slug, source_url, card_count)
                    VALUES ('30C', 'Celebracao-de-30-Anos-30C', 'https://example.test/30c', 1)
                    """
                )
                set_two = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                for set_id in (set_one, set_two):
                    conn.execute(
                        """
                        INSERT INTO set_cards (id, set_id, image_path, sort_key)
                        VALUES ('001', ?, 'cards/example/001.jpg', '001')
                        """,
                        (set_id,),
                    )
                rows = conn.execute(
                    "SELECT set_id, id FROM set_cards ORDER BY set_id"
                ).fetchall()
                self.assertEqual(rows, [(set_one, "001"), (set_two, "001")])
            finally:
                conn.close()

    def test_open_creates_parent_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "nested" / "data" / "catalog.db"
            self.assertFalse(db_path.parent.exists())
            conn = catalog_db.connect(db_path)
            try:
                self.assertTrue(db_path.is_file())
            finally:
                conn.close()

    def test_relative_image_and_logo_paths_resolve_under_repo_root(self):
        image = "cards/Storm-Emeralda-M6/001_G_Weedle.jpg"
        logo = "cards/Storm-Emeralda-M6/logo.png"
        self.assertEqual(catalog_db.normalize_project_relative(image), image)
        self.assertEqual(catalog_db.normalize_project_relative(logo), logo)
        self.assertFalse(Path(image).is_absolute())
        root = catalog_db.project_root()
        self.assertEqual(catalog_db.resolve_project_path(image), root / image)
        self.assertEqual(catalog_db.resolve_project_path(logo), root / logo)
        self.assertTrue((root / "pyproject.toml").is_file())
        with self.assertRaises(ValueError):
            catalog_db.normalize_project_relative("../outside.jpg")

        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                conn.execute(
                    """
                    INSERT INTO sets (set_code, slug, source_url, logo_path, card_count)
                    VALUES ('M6', 'Storm-Emeralda-M6', 'https://example.test/m6', ?, 1)
                    """,
                    (logo,),
                )
                set_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                conn.execute(
                    """
                    INSERT INTO set_cards (id, set_id, image_path, sort_key)
                    VALUES ('001', ?, ?, '001')
                    """,
                    (set_id, image),
                )
                stored_logo = conn.execute("SELECT logo_path FROM sets").fetchone()[0]
                stored_image = conn.execute(
                    "SELECT image_path FROM set_cards"
                ).fetchone()[0]
                self.assertEqual(stored_logo, logo)
                self.assertEqual(stored_image, image)
                self.assertEqual(catalog_db.resolve_project_path(stored_image), root / image)
                self.assertEqual(catalog_db.resolve_project_path(stored_logo), root / logo)
            finally:
                conn.close()

    def test_default_paths_live_next_to_cards(self):
        root = catalog_db.project_root()
        self.assertEqual(catalog_db.catalog_db_path(), root / "data" / "catalog.db")
        self.assertEqual(ownership_db.ownership_db_path(), root / "data" / "ownership.db")
        self.assertFalse(catalog_db.catalog_db_path().is_relative_to(root / "web"))


class OwnershipSchemaTests(unittest.TestCase):
    def test_open_creates_owned_cards(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = ownership_db.connect(Path(tmp) / "ownership.db")
            try:
                self.assertEqual(column_names(conn, "owned_cards"), OWNED_COLUMNS)
                sql = conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'owned_cards'"
                ).fetchone()[0]
                self.assertIn("CHECK (copies >= 1)", sql)
                self.assertIn("PRIMARY KEY (set_id, set_card_id)", sql)
            finally:
                conn.close()

    def test_reopen_does_not_duplicate_schema(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "ownership.db"
            first = ownership_db.connect(db_path)
            try:
                before = schema_objects(first)
            finally:
                first.close()
            second = ownership_db.connect(db_path)
            try:
                self.assertEqual(schema_objects(second), before)
            finally:
                second.close()

    def test_same_card_id_owned_in_two_sets(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = ownership_db.connect(Path(tmp) / "ownership.db")
            try:
                for set_id in (1, 2):
                    conn.execute(
                        """
                        INSERT INTO owned_cards (set_card_id, set_id, copies, updated_at)
                        VALUES ('001', ?, 1, '2026-10-06T00:00:00Z')
                        """,
                        (set_id,),
                    )
                rows = conn.execute(
                    "SELECT set_id, set_card_id, copies FROM owned_cards ORDER BY set_id"
                ).fetchall()
                self.assertEqual(rows, [(1, "001", 1), (2, "001", 1)])
            finally:
                conn.close()

    def test_copies_zero_and_negative_violate_constraint(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = ownership_db.connect(Path(tmp) / "ownership.db")
            try:
                for copies in (0, -1):
                    with self.assertRaises(sqlite3.IntegrityError):
                        conn.execute(
                            """
                            INSERT INTO owned_cards (set_card_id, set_id, copies, updated_at)
                            VALUES ('001', 1, ?, '2026-10-06T00:00:00Z')
                            """,
                            (copies,),
                        )
                    conn.rollback()
                conn.execute(
                    """
                    INSERT INTO owned_cards (set_card_id, set_id, copies, updated_at)
                    VALUES ('001', 1, 1, '2026-10-06T00:00:00Z')
                    """
                )
                stored = conn.execute("SELECT copies FROM owned_cards").fetchone()[0]
                self.assertEqual(stored, 1)
            finally:
                conn.close()

    def test_open_creates_parent_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "nested" / "data" / "ownership.db"
            self.assertFalse(db_path.parent.exists())
            conn = ownership_db.connect(db_path)
            try:
                self.assertTrue(db_path.is_file())
            finally:
                conn.close()
