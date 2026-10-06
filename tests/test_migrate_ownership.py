import io
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import catalog_db  # noqa: E402
import migrate_ownership  # noqa: E402
import ownership_db  # noqa: E402

LEGACY_SCHEMA = """
CREATE TABLE owned_cards (
  collection_slug TEXT NOT NULL,
  collector_number TEXT NOT NULL,
  copies INTEGER NOT NULL CHECK (copies >= 1),
  PRIMARY KEY (collection_slug, collector_number)
);
"""

M6 = {
    "set_code": "M6",
    "name_pt": "Storm Emeralda",
    "name_en": "Storm Emeralda",
    "slug": "Storm-Emeralda-M6",
    "source_url": "https://example.test/m6",
    "card_count": 2,
}
THIRTY = {
    "set_code": "30C",
    "name_pt": "Celebração de 30 Anos",
    "name_en": "30th Celebration",
    "slug": "Celebracao-de-30-Anos-30C",
    "source_url": "https://example.test/30c",
    "card_count": 1,
}
MIGRATED_AT = "2026-10-06T12:00:00+00:00"


def card(number: str, slug: str) -> dict[str, object]:
    return {
        "id": number,
        "name_pt": f"Carta {number}",
        "name_en": f"Card {number}",
        "element_code": "G",
        "rarity_code": "C",
        "image_path": f"cards/{slug}/{number}_G_Card.jpg",
        "sort_key": number,
        "illustrator": None,
    }


def owned_rows(path: Path) -> list[tuple]:
    conn = ownership_db.connect(path)
    try:
        return conn.execute(
            """
            SELECT set_id, set_card_id, copies, updated_at
            FROM owned_cards
            ORDER BY set_id, set_card_id
            """
        ).fetchall()
    finally:
        conn.close()


class OwnershipMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.source = root / "collection.db"
        self.catalog = root / "catalog.db"
        self.target = root / "ownership.db"

    def seed_catalog(self, *sets: tuple[dict[str, object], list[dict[str, object]]]) -> dict[str, int]:
        conn = catalog_db.connect(self.catalog)
        ids: dict[str, int] = {}
        try:
            for fields, cards in sets:
                ids[str(fields["slug"])] = catalog_db.import_set(conn, fields, cards)
        finally:
            conn.close()
        return ids

    def seed_source(self, rows: list[tuple[str, str, int]]) -> None:
        conn = sqlite3.connect(self.source)
        try:
            conn.execute(LEGACY_SCHEMA)
            conn.executemany(
                """
                INSERT INTO owned_cards (collection_slug, collector_number, copies)
                VALUES (?, ?, ?)
                """,
                rows,
            )
            conn.commit()
        finally:
            conn.close()

    def migrate(self, **kwargs: object) -> migrate_ownership.MigrationReport:
        dry_run = bool(kwargs.get("dry_run", False))
        migrated_at = kwargs.get("migrated_at", MIGRATED_AT)
        assert migrated_at is None or isinstance(migrated_at, str)
        return migrate_ownership.migrate(
            source=self.source,
            target=self.target,
            catalog=self.catalog,
            dry_run=dry_run,
            migrated_at=migrated_at,
        )

    def test_default_paths(self) -> None:
        source, target, catalog = migrate_ownership.default_paths()
        root = catalog_db.project_root()
        self.assertEqual(source, root / "web" / "data" / "collection.db")
        self.assertEqual(target, root / "data" / "ownership.db")
        self.assertEqual(catalog, root / "data" / "catalog.db")

    def test_migrate_one_card_preserves_quantity(self) -> None:
        ids = self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source([(M6["slug"], "001", 1)])

        report = self.migrate()

        self.assertEqual(report.written, 1)
        self.assertEqual(report.unresolved, ())
        self.assertEqual(
            owned_rows(self.target),
            [(ids[M6["slug"]], "001", 1, MIGRATED_AT)],
        )

    def test_migrate_multiple_cards_in_one_set(self) -> None:
        ids = self.seed_catalog(
            (M6, [card("001", M6["slug"]), card("002", M6["slug"])])
        )
        self.seed_source(
            [(M6["slug"], "001", 1), (M6["slug"], "002", 2)]
        )

        self.migrate()

        self.assertEqual(
            owned_rows(self.target),
            [
                (ids[M6["slug"]], "001", 1, MIGRATED_AT),
                (ids[M6["slug"]], "002", 2, MIGRATED_AT),
            ],
        )

    def test_second_run_replaces_without_duplicating(self) -> None:
        ids = self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source([(M6["slug"], "001", 2)])
        self.migrate()

        conn = ownership_db.connect(self.target)
        try:
            conn.execute("UPDATE owned_cards SET copies = 9")
            conn.commit()
        finally:
            conn.close()

        report = self.migrate(migrated_at="2026-10-06T13:00:00+00:00")

        self.assertEqual(report.written, 1)
        self.assertEqual(
            owned_rows(self.target),
            [(ids[M6["slug"]], "001", 2, "2026-10-06T13:00:00+00:00")],
        )

    def test_same_collector_number_stays_separate_across_sets(self) -> None:
        ids = self.seed_catalog(
            (M6, [card("001", M6["slug"])]),
            (THIRTY, [card("001", THIRTY["slug"])]),
        )
        self.seed_source(
            [(M6["slug"], "001", 1), (THIRTY["slug"], "001", 4)]
        )

        self.migrate()

        self.assertEqual(
            owned_rows(self.target),
            [
                (ids[M6["slug"]], "001", 1, MIGRATED_AT),
                (ids[THIRTY["slug"]], "001", 4, MIGRATED_AT),
            ],
        )
        self.assertNotEqual(ids[M6["slug"]], ids[THIRTY["slug"]])

    def test_reports_unknown_collection_slug(self) -> None:
        ids = self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source(
            [
                ("No-Such-Set", "001", 3),
                (M6["slug"], "001", 1),
            ]
        )

        report = self.migrate()
        text = migrate_ownership.format_report(report)

        self.assertEqual(len(report.unresolved), 1)
        self.assertEqual(report.unresolved[0].reason, "unknown set")
        self.assertEqual(report.unresolved[0].collection_slug, "No-Such-Set")
        self.assertEqual(report.unresolved[0].collector_number, "001")
        self.assertEqual(report.unresolved[0].copies, 3)
        self.assertIn("unknown set", text)
        self.assertIn("No-Such-Set", text)
        self.assertEqual(
            owned_rows(self.target),
            [(ids[M6["slug"]], "001", 1, MIGRATED_AT)],
        )

    def test_reports_unknown_card_number_in_known_set(self) -> None:
        ids = self.seed_catalog(
            (M6, [card("001", M6["slug"]), card("002", M6["slug"])])
        )
        self.seed_source(
            [
                (M6["slug"], "999", 7),
                (M6["slug"], "002", 2),
            ]
        )

        report = self.migrate()
        text = migrate_ownership.format_report(report)

        self.assertEqual(len(report.unresolved), 1)
        self.assertEqual(report.unresolved[0].reason, "unknown card")
        self.assertEqual(report.unresolved[0].collection_slug, M6["slug"])
        self.assertEqual(report.unresolved[0].collector_number, "999")
        self.assertEqual(report.unresolved[0].copies, 7)
        self.assertIn("unknown card", text)
        self.assertIn("999", text)
        self.assertIn(M6["slug"], text)
        self.assertEqual(
            owned_rows(self.target),
            [(ids[M6["slug"]], "002", 2, MIGRATED_AT)],
        )

    def test_creates_target_database_when_missing(self) -> None:
        self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source([(M6["slug"], "001", 1)])
        self.assertFalse(self.target.exists())

        self.migrate()

        self.assertTrue(self.target.is_file())
        conn = ownership_db.connect(self.target)
        try:
            table = conn.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name = 'owned_cards'
                """
            ).fetchone()
            self.assertIsNotNone(table)
            self.assertEqual(
                conn.execute("SELECT copies FROM owned_cards").fetchone()[0],
                1,
            )
        finally:
            conn.close()

    def test_empty_source_creates_target_schema(self) -> None:
        self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source([])
        self.assertFalse(self.target.exists())

        report = self.migrate()

        self.assertEqual(report.planned, ())
        self.assertEqual(report.written, 0)
        self.assertTrue(self.target.is_file())
        self.assertEqual(owned_rows(self.target), [])

    def test_preserves_quantities_greater_than_one(self) -> None:
        ids = self.seed_catalog((M6, [card("018", M6["slug"])]))
        self.seed_source([(M6["slug"], "018", 5)])

        self.migrate(migrated_at=None)

        rows = owned_rows(self.target)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], ids[M6["slug"]])
        self.assertEqual(rows[0][1], "018")
        self.assertEqual(rows[0][2], 5)
        parsed = datetime.fromisoformat(rows[0][3])
        self.assertIsNotNone(parsed.tzinfo)

    def test_preserves_historical_timestamp_when_present(self) -> None:
        self.seed_catalog((M6, [card("001", M6["slug"]), card("002", M6["slug"])]))
        conn = sqlite3.connect(self.source)
        try:
            conn.execute(
                """
                CREATE TABLE owned_cards (
                  collection_slug TEXT NOT NULL,
                  collector_number TEXT NOT NULL,
                  copies INTEGER NOT NULL,
                  updated_at TEXT,
                  PRIMARY KEY (collection_slug, collector_number)
                )
                """
            )
            conn.executemany(
                """
                INSERT INTO owned_cards (
                  collection_slug, collector_number, copies, updated_at
                ) VALUES (?, ?, ?, ?)
                """,
                [
                    (M6["slug"], "001", 2, "2020-01-02T03:04:05+00:00"),
                    (M6["slug"], "002", 1, None),
                ],
            )
            conn.commit()
        finally:
            conn.close()

        self.migrate()

        by_card = {row[1]: row for row in owned_rows(self.target)}
        self.assertEqual(by_card["001"][2], 2)
        self.assertEqual(by_card["001"][3], "2020-01-02T03:04:05+00:00")
        self.assertEqual(by_card["002"][2], 1)
        self.assertEqual(by_card["002"][3], MIGRATED_AT)

    def test_does_not_modify_source_or_catalog(self) -> None:
        self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source([(M6["slug"], "001", 4)])
        source_before = self.source.read_bytes()
        catalog_before = self.catalog.read_bytes()

        self.migrate()

        self.assertTrue(self.source.is_file())
        self.assertEqual(self.source.read_bytes(), source_before)
        self.assertEqual(self.catalog.read_bytes(), catalog_before)
        source = sqlite3.connect(self.source)
        try:
            stored = source.execute(
                "SELECT collection_slug, collector_number, copies FROM owned_cards"
            ).fetchall()
        finally:
            source.close()
        self.assertEqual(stored, [(M6["slug"], "001", 4)])

    def test_does_not_perform_a_network_request(self) -> None:
        script = Path(migrate_ownership.__file__).read_text(encoding="utf-8")
        for token in ("urlopen", "playwright", "ligapokemon", "socket", "http"):
            self.assertNotIn(token, script)
        self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source([(M6["slug"], "001", 1)])

        def refuse_network(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("network request")

        with (
            patch("socket.create_connection", refuse_network),
            patch("urllib.request.urlopen", refuse_network),
        ):
            report = self.migrate()

        self.assertEqual(report.written, 1)
        self.assertEqual(report.unresolved, ())

    def test_dry_run_reports_planned_rows_without_writing(self) -> None:
        ids = self.seed_catalog((M6, [card("001", M6["slug"])]))
        self.seed_source([(M6["slug"], "001", 3)])
        source_before = self.source.read_bytes()
        catalog_before = self.catalog.read_bytes()

        stdout = io.StringIO()
        with redirect_stdout(stdout):
            code = migrate_ownership.main(
                [
                    "--source",
                    str(self.source),
                    "--catalog",
                    str(self.catalog),
                    "--target",
                    str(self.target),
                    "--dry-run",
                ]
            )

        output = stdout.getvalue()
        self.assertEqual(code, 0)
        self.assertFalse(self.target.exists())
        self.assertIn("Dry run:", output)
        self.assertIn("wrote nothing", output)
        self.assertIn(M6["slug"], output)
        self.assertIn("set_card_id=001", output)
        self.assertIn(f"set_id={ids[M6['slug']]}", output)
        self.assertIn("copies=3", output)
        self.assertIn("Unresolved: 0", output)
        self.assertEqual(self.source.read_bytes(), source_before)
        self.assertEqual(self.catalog.read_bytes(), catalog_before)

        conn = ownership_db.connect(self.target)
        try:
            conn.execute(
                """
                INSERT INTO owned_cards (set_id, set_card_id, copies, updated_at)
                VALUES (99, 'sentinel', 1, '2026-01-01T00:00:00+00:00')
                """
            )
            conn.commit()
        finally:
            conn.close()
        before = owned_rows(self.target)

        with redirect_stdout(io.StringIO()):
            code = migrate_ownership.main(
                [
                    "--source",
                    str(self.source),
                    "--catalog",
                    str(self.catalog),
                    "--target",
                    str(self.target),
                    "--dry-run",
                ]
            )

        self.assertEqual(code, 0)
        self.assertEqual(owned_rows(self.target), before)


if __name__ == "__main__":
    unittest.main()
