import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import catalog_db  # noqa: E402

M6 = {
    "set_code": "M6",
    "name_pt": "Storm Emeralda",
    "name_en": "Storm Emeralda",
    "slug": "Storm-Emeralda-M6",
    "source_url": "https://example.test/m6",
    "logo_path": "cards/Storm-Emeralda-M6/logo.png",
    "card_count": 113,
}
THIRTY = {
    "set_code": "30C",
    "name_pt": "Celebração de 30 Anos",
    "name_en": "30th Celebration",
    "slug": "Celebracao-de-30-Anos-30C",
    "source_url": "https://example.test/30c",
    "logo_path": "cards/Celebracao-de-30-Anos-30C/logo.png",
    "card_count": 25,
}


def card(number: str, slug: str, **overrides: object) -> dict[str, object]:
    values: dict[str, object] = {
        "id": number,
        "name_pt": f"Carta {number}",
        "name_en": f"Card {number}",
        "element_code": "G",
        "rarity_code": "C",
        "image_path": f"cards/{slug}/{number}_G_Card.jpg",
        "sort_key": number,
        "illustrator": None,
    }
    values.update(overrides)
    return values


class CatalogStoreTests(unittest.TestCase):
    def test_insert_new_set_receives_an_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                set_id = catalog_db.insert_set(conn, M6)
                self.assertIsInstance(set_id, int)
                self.assertGreater(set_id, 0)
                stored = catalog_db.find_set_by_code(conn, "M6")
                self.assertIsNotNone(stored)
                assert stored is not None
                self.assertEqual(stored["id"], set_id)
                self.assertEqual(stored["set_code"], "M6")
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 1
                )
            finally:
                conn.close()

    def test_same_set_code_keeps_the_same_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                first = catalog_db.upsert_set(conn, M6)
                second = catalog_db.upsert_set(
                    conn,
                    {**M6, "id": 999, "card_count": 120},
                )
                self.assertEqual(second, first)
                stored = catalog_db.find_set_by_code(conn, "M6")
                assert stored is not None
                self.assertEqual(stored["id"], first)
                self.assertEqual(stored["card_count"], 120)
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 1
                )
            finally:
                conn.close()

    def test_update_set_changes_title_and_logo_without_duplicating(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                set_id = catalog_db.insert_set(conn, M6)
                catalog_db.update_set(
                    conn,
                    set_id,
                    {
                        "id": 999,
                        "name_pt": "Tempestade Esmeralda",
                        "logo_path": "cards/Storm-Emeralda-M6/logo.webp",
                    },
                )
                stored = catalog_db.find_set_by_code(conn, "M6")
                assert stored is not None
                self.assertEqual(stored["id"], set_id)
                self.assertEqual(stored["name_pt"], "Tempestade Esmeralda")
                self.assertEqual(
                    stored["logo_path"], "cards/Storm-Emeralda-M6/logo.webp"
                )
                self.assertEqual(stored["slug"], M6["slug"])
                self.assertEqual(stored["source_url"], M6["source_url"])
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 1
                )
            finally:
                conn.close()

    def test_insert_cards_001_and_002_for_one_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                set_id = catalog_db.import_set(
                    conn,
                    M6,
                    [
                        card("001", M6["slug"]),
                        card("002", M6["slug"]),
                    ],
                )
                rows = conn.execute(
                    "SELECT id FROM set_cards WHERE set_id = ? ORDER BY id",
                    (set_id,),
                ).fetchall()
                self.assertEqual(rows, [("001",), ("002",)])
            finally:
                conn.close()

    def test_card_001_in_a_second_set_does_not_collide(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                first = catalog_db.import_set(conn, M6, [card("001", M6["slug"])])
                second = catalog_db.import_set(
                    conn, THIRTY, [card("001", THIRTY["slug"])]
                )
                self.assertNotEqual(first, second)
                rows = conn.execute(
                    "SELECT set_id, id FROM set_cards ORDER BY set_id, id"
                ).fetchall()
                self.assertEqual(rows, [(first, "001"), (second, "001")])
            finally:
                conn.close()

    def test_upsert_card_leaves_one_row_for_set_and_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                set_id = catalog_db.import_set(
                    conn,
                    M6,
                    [card("001", M6["slug"], name_pt="Weedle")],
                )
                catalog_db.upsert_set_card(
                    conn,
                    set_id,
                    card("001", M6["slug"], name_pt="Weedle atualizado"),
                )
                conn.commit()
                rows = conn.execute(
                    "SELECT set_id, id, name_pt FROM set_cards"
                ).fetchall()
                self.assertEqual(rows, [(set_id, "001", "Weedle atualizado")])
            finally:
                conn.close()

    def test_store_and_retrieve_relative_paths_and_sort_key(self):
        image = "cards/Storm-Emeralda-M6/001_G_Weedle.jpg"
        logo = "cards/Storm-Emeralda-M6/logo.png"
        sort_key = "0018"
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "catalog.db"
            conn = catalog_db.connect(db_path)
            try:
                set_id = catalog_db.import_set(
                    conn,
                    {**M6, "logo_path": logo, "card_count": 113},
                    [card("001", M6["slug"], image_path=image, sort_key=sort_key)],
                )
            finally:
                conn.close()

            reopened = catalog_db.connect(db_path)
            try:
                stored = catalog_db.find_set_by_code(reopened, "M6")
                assert stored is not None
                found = catalog_db.find_set_card(reopened, set_id, "001")
                assert found is not None
                self.assertEqual(stored["id"], set_id)
                self.assertEqual(stored["slug"], M6["slug"])
                self.assertEqual(stored["source_url"], M6["source_url"])
                self.assertEqual(stored["card_count"], 113)
                self.assertEqual(stored["logo_path"], logo)
                self.assertEqual(found["image_path"], image)
                self.assertEqual(found["sort_key"], sort_key)
                self.assertIsInstance(found["sort_key"], str)
                root = catalog_db.project_root()
                self.assertEqual(
                    catalog_db.resolve_project_path(found["image_path"]), root / image
                )
                self.assertEqual(
                    catalog_db.resolve_project_path(stored["logo_path"]), root / logo
                )
                self.assertFalse((Path(tmp) / "ownership.db").exists())
            finally:
                reopened.close()

    def test_import_rolls_back_when_a_card_insert_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "catalog.db"
            conn = catalog_db.connect(db_path)
            try:
                conn.execute(
                    """
                    CREATE TRIGGER fail_card_002
                    BEFORE INSERT ON set_cards
                    WHEN NEW.id = '002'
                    BEGIN
                        SELECT RAISE(ABORT, 'card insert failed');
                    END
                    """
                )
                with self.assertRaises(sqlite3.IntegrityError):
                    catalog_db.import_set(
                        conn,
                        M6,
                        [
                            card("001", M6["slug"]),
                            card("002", M6["slug"]),
                        ],
                    )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 0
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0], 0
                )
            finally:
                conn.close()

            reopened = catalog_db.connect(db_path)
            try:
                self.assertEqual(
                    reopened.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 0
                )
                self.assertEqual(
                    reopened.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0],
                    0,
                )
                self.assertFalse((Path(tmp) / "ownership.db").exists())
            finally:
                reopened.close()

    def test_schema_does_not_contain_card_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = catalog_db.connect(Path(tmp) / "catalog.db")
            try:
                scripts = conn.execute(
                    """
                    SELECT sql FROM sqlite_master
                    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                    """
                ).fetchall()
                combined = "\n".join(row[0] for row in scripts)
                self.assertNotIn("card_kind", combined)
                for table in ("sets", "set_cards"):
                    columns = [
                        row[1]
                        for row in conn.execute(f"PRAGMA table_info({table})")
                    ]
                    self.assertNotIn("card_kind", columns)
            finally:
                conn.close()
