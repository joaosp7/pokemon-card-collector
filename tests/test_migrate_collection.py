import io
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import catalog_db  # noqa: E402
import catalog_fields as cf  # noqa: E402
import download_collection as dc  # noqa: E402
import migrate_collection as mc  # noqa: E402

URL = "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C"
TITLE = "Celebração de 30 Anos | LigaPokemon"
SLUG = "Celebracao-de-30-Anos-30C"
SET_CODE = "30C"


def card_001(**overrides: object) -> dict:
    card = {
        "id": "55501",
        "sN": "001",
        "dN": "000000000000001",
        "nPT": "Nidoran F&ecirc;mea",
        "nEN": "Nidoran Female (#001/076)",
        "sC": "G",
        "iR": 1,
        "sP": "images/001.jpg",
        "f_sP": "images/001-back.jpg",
        "sSigla": SET_CODE,
    }
    card.update(overrides)
    return card


def card_002(**overrides: object) -> dict:
    card = {
        "id": "55502",
        "sN": "002",
        "dN": "000000000000002",
        "nPT": "Pikachu",
        "nEN": "Pikachu (#002/076)",
        "sC": "L",
        "iR": 3,
        "sP": "images/002.jpg",
        "f_sP": "images/002-back.jpg",
        "sSigla": SET_CODE,
    }
    card.update(overrides)
    return card


def card_018(**overrides: object) -> dict:
    card = {
        "id": "55518",
        "sN": "018",
        "dN": "000000000000018",
        "nPT": "",
        "nEN": "Articuno (#018/128)",
        "sC": "W",
        "iR": 17,
        "sP": "images/018.jpg",
        "f_sP": "images/018-back.jpg",
        "sSigla": SET_CODE,
    }
    card.update(overrides)
    return card


def catalog_pair() -> list[dict]:
    return [card_002(), card_001()]


class MigrateCollectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._patchers = [
            mock.patch(
                "migrate_collection.fetch_page_data",
                side_effect=AssertionError("real catalog fetch"),
            ),
            mock.patch(
                "download_collection.download_to",
                side_effect=AssertionError("download_to"),
            ),
            mock.patch(
                "download_collection.card_image_jobs",
                side_effect=AssertionError("card_image_jobs"),
            ),
            mock.patch(
                "download_collection.urlopen",
                side_effect=AssertionError("cdn urlopen"),
            ),
            mock.patch(
                "urllib.request.urlopen",
                side_effect=AssertionError("urllib urlopen"),
            ),
        ]
        self.download_to = self._patchers[1].start()
        self.card_image_jobs = self._patchers[2].start()
        self.cdn_urlopen = self._patchers[3].start()
        self.urllib_urlopen = self._patchers[4].start()
        self._patchers[0].start()

    def tearDown(self) -> None:
        for patcher in reversed(self._patchers):
            patcher.stop()

    def assert_no_image_download(self) -> None:
        self.download_to.assert_not_called()
        self.card_image_jobs.assert_not_called()
        self.cdn_urlopen.assert_not_called()
        self.urllib_urlopen.assert_not_called()

    def migrate(
        self,
        tmp: str,
        catalog: list[dict],
        *,
        logo: Path | None = None,
        url: str = URL,
        title: str = TITLE,
        sigla: str = SET_CODE,
    ) -> mc.MigrationReport:
        def fetch(page_url: str) -> tuple[str, list[dict], str]:
            self.assertEqual(page_url, dc.sanitize_collection_url(url))
            return title, catalog, sigla

        return mc.migrate(
            url,
            logo=logo,
            db_path=Path(tmp) / "catalog.db",
            cards_dir=Path(tmp) / "cards",
            fetch=fetch,
        )

    def connect(self, tmp: str) -> sqlite3.Connection:
        return catalog_db.connect(Path(tmp) / "catalog.db")

    def test_migrate_url_into_empty_catalog(self) -> None:
        escaped = URL.replace("?", "\\?").replace("&", "\\&").replace("=", "\\=")
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "catalog.db"
            self.assertFalse(db_path.exists())
            report = self.migrate(tmp, catalog_pair(), url=escaped)
            conn = self.connect(tmp)
            try:
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 1
                )
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0], 2
                )
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(stored["id"], report.set_id)
            self.assertEqual(stored["set_code"], SET_CODE)
            self.assertEqual(stored["name_pt"], "Celebração de 30 Anos")
            self.assertIsNone(stored["name_en"])
            self.assertEqual(stored["slug"], SLUG)
            self.assertEqual(stored["source_url"], URL)
            self.assertEqual(stored["card_count"], 2)
            self.assertIsNone(stored["logo_path"])
            self.assert_no_image_download()

    def test_existing_local_files_do_not_call_downloader(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            set_dir = Path(tmp) / "cards" / SLUG
            set_dir.mkdir(parents=True)
            current = set_dir / dc.card_filename(card_001())
            legacy = set_dir / dc.legacy_card_filename(card_002())
            current.write_bytes(b"current-bytes")
            legacy.write_bytes(b"legacy-bytes")
            extra = set_dir / "999_N_Extra.jpg"
            extra.write_bytes(b"extra")
            before = {
                path.name: path.read_bytes() for path in set_dir.iterdir() if path.is_file()
            }
            self.migrate(tmp, catalog_pair())
            after = {
                path.name: path.read_bytes() for path in set_dir.iterdir() if path.is_file()
            }
            self.assertEqual(after, before)
            self.assert_no_image_download()

    def test_imports_cards_001_002_and_logo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            logo = Path(tmp) / "emblem.png"
            logo.write_bytes(b"png-logo")
            report = self.migrate(tmp, catalog_pair(), logo=logo)
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                set_id = int(stored["id"])
                card_ids = [
                    row[0]
                    for row in conn.execute(
                        "SELECT id FROM set_cards WHERE set_id = ? ORDER BY id",
                        (set_id,),
                    )
                ]
            finally:
                conn.close()
            self.assertEqual(card_ids, ["001", "002"])
            copied = Path(tmp) / "cards" / SLUG / "logo.png"
            self.assertEqual(copied.read_bytes(), b"png-logo")
            self.assertEqual(logo.read_bytes(), b"png-logo")
            self.assertEqual(stored["logo_path"], f"cards/{SLUG}/logo.png")
            self.assertEqual(report.logo_path, f"cards/{SLUG}/logo.png")
            self.assertFalse((Path(tmp) / "cards" / SLUG / "logo.webp").exists())

    def test_logo_keeps_source_extension(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            logo = Path(tmp) / "emblem.WEBP"
            logo.write_bytes(b"webp-logo")
            report = self.migrate(tmp, [card_001()], logo=logo)
            copied = Path(tmp) / "cards" / SLUG / "logo.webp"
            self.assertEqual(copied.read_bytes(), b"webp-logo")
            self.assertEqual(report.logo_path, f"cards/{SLUG}/logo.webp")

    def test_preserves_leading_zeroes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.migrate(tmp, catalog_pair())
            conn = self.connect(tmp)
            try:
                ids = [
                    row[0]
                    for row in conn.execute("SELECT id FROM set_cards ORDER BY id")
                ]
            finally:
                conn.close()
            self.assertEqual(ids, ["001", "002"])
            self.assertNotIn("1", ids)
            self.assertNotIn("2", ids)

    def test_stores_normalized_names_rarity_and_sort_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.migrate(tmp, [card_001(), card_002()])
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                first = catalog_db.find_set_card(conn, int(stored["id"]), "001")
                second = catalog_db.find_set_card(conn, int(stored["id"]), "002")
            finally:
                conn.close()
            assert first is not None and second is not None
            expected = cf.normalize_card(card_001(), slug=SLUG)
            self.assertEqual(first["name_pt"], "Nidoran Fêmea")
            self.assertEqual(first["name_en"], "Nidoran Female")
            self.assertEqual(first["element_code"], "G")
            self.assertEqual(first["rarity_code"], "C")
            self.assertEqual(first["sort_key"], "000000000000001")
            self.assertIsInstance(first["sort_key"], str)
            self.assertEqual(first["name_pt"], expected["name_pt"])
            self.assertEqual(first["rarity_code"], expected["rarity_code"])
            self.assertEqual(first["sort_key"], expected["sort_key"])
            self.assertEqual(second["rarity_code"], "R")
            self.assertEqual(second["element_code"], "L")
            self.assertEqual(second["sort_key"], "000000000000002")
            self.assertIsNone(first["illustrator"])

    def test_uses_current_filename_when_present(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            set_dir = Path(tmp) / "cards" / SLUG
            set_dir.mkdir(parents=True)
            source = card_001()
            current = set_dir / dc.card_filename(source)
            legacy = set_dir / dc.legacy_card_filename(source)
            current.write_bytes(b"front")
            legacy.write_bytes(b"old-front")
            report = self.migrate(tmp, [source])
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                row = catalog_db.find_set_card(conn, int(stored["id"]), "001")
            finally:
                conn.close()
            assert row is not None
            self.assertEqual(row["image_path"], f"cards/{SLUG}/{current.name}")
            self.assertEqual(current.read_bytes(), b"front")
            self.assertEqual(legacy.read_bytes(), b"old-front")
            self.assertEqual(report.missing_images, [])

    def test_uses_legacy_filename_without_renaming(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            set_dir = Path(tmp) / "cards" / SLUG
            set_dir.mkdir(parents=True)
            source = card_002()
            current = set_dir / dc.card_filename(source)
            legacy = set_dir / dc.legacy_card_filename(source)
            legacy.write_bytes(b"legacy-only")
            self.migrate(tmp, [source])
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                row = catalog_db.find_set_card(conn, int(stored["id"]), "002")
            finally:
                conn.close()
            assert row is not None
            self.assertEqual(row["image_path"], f"cards/{SLUG}/{legacy.name}")
            self.assertEqual(legacy.read_bytes(), b"legacy-only")
            self.assertFalse(current.exists())
            self.assert_no_image_download()

    def test_reports_missing_image_and_persists_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = card_018()
            expected = cf.image_path(source, SLUG)

            def fetch(page_url: str) -> tuple[str, list[dict], str]:
                return TITLE, [source], SET_CODE

            stdout = io.StringIO()
            with redirect_stdout(stdout):
                code = mc.main(
                    [URL],
                    db_path=Path(tmp) / "catalog.db",
                    cards_dir=Path(tmp) / "cards",
                    fetch=fetch,
                )
            self.assertEqual(code, 0)
            self.assertIn(f"missing {expected}", stdout.getvalue())
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                row = catalog_db.find_set_card(conn, int(stored["id"]), "018")
                card_rows = conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0]
            finally:
                conn.close()
            assert row is not None
            self.assertEqual(card_rows, 1)
            self.assertEqual(row["image_path"], expected)
            self.assertEqual(row["name_en"], "Articuno")
            self.assertIsNone(row["name_pt"])
            self.assertEqual(row["rarity_code"], "IR")
            self.assertEqual(stored["card_count"], 1)
            self.assertFalse((Path(tmp) / "cards").exists())
            self.assert_no_image_download()

    def test_rerun_does_not_duplicate_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            first = self.migrate(tmp, catalog_pair())
            second = self.migrate(tmp, catalog_pair())
            self.assertEqual(second.set_id, first.set_id)
            conn = self.connect(tmp)
            try:
                sets = conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
                cards = conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0]
            finally:
                conn.close()
            self.assertEqual(sets, 1)
            self.assertEqual(cards, 2)

    def test_rerun_updates_changed_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            set_dir = Path(tmp) / "cards" / SLUG
            set_dir.mkdir(parents=True)
            original = card_001()
            original_file = set_dir / dc.card_filename(original)
            original_file.write_bytes(b"keep-me")
            self.migrate(tmp, [original])
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                catalog_db.update_set(conn, int(stored["id"]), {"name_en": "30th Celebration"})
                conn.commit()
            finally:
                conn.close()

            revised = card_001(
                nPT="Nidorina",
                nEN="Nidorina (#001/076)",
                iR=11,
                dN="000000000000099",
                sC="G",
            )
            revised_url = URL + "&rev=2"
            report = self.migrate(tmp, [revised], url=revised_url)
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                row = catalog_db.find_set_card(conn, int(stored["id"]), "001")
                card_rows = conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0]
            finally:
                conn.close()
            assert row is not None
            self.assertEqual(card_rows, 1)
            self.assertEqual(report.set_id, stored["id"])
            self.assertEqual(row["name_pt"], "Nidorina")
            self.assertEqual(row["name_en"], "Nidorina")
            self.assertEqual(row["rarity_code"], "S")
            self.assertEqual(row["sort_key"], "000000000000099")
            self.assertEqual(row["image_path"], cf.image_path(revised, SLUG))
            self.assertEqual(stored["source_url"], revised_url)
            self.assertEqual(stored["name_en"], "30th Celebration")
            self.assertEqual(original_file.read_bytes(), b"keep-me")
            self.assertFalse((set_dir / dc.card_filename(revised)).exists())
            self.assertIn(cf.image_path(revised, SLUG), report.missing_images)

    def test_rerun_preserves_set_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            conn = self.connect(tmp)
            try:
                other_id = catalog_db.insert_set(
                    conn,
                    {
                        "set_code": "M6",
                        "name_pt": "Storm Emeralda",
                        "slug": "Storm-Emeralda-M6",
                        "source_url": "https://example.test/m6",
                        "card_count": 1,
                    },
                )
                conn.commit()
            finally:
                conn.close()
            first = self.migrate(tmp, catalog_pair())
            second = self.migrate(tmp, [card_001(nPT="Nidorina", iR=11)])
            self.assertNotEqual(first.set_id, other_id)
            self.assertEqual(second.set_id, first.set_id)
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                sets = conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(stored["id"], first.set_id)
            self.assertEqual(sets, 2)

    def test_rerun_without_logo_keeps_saved_logo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            logo = Path(tmp) / "emblem.jpg"
            logo.write_bytes(b"logo-v1")
            first = self.migrate(tmp, catalog_pair(), logo=logo)
            copied = Path(tmp) / "cards" / SLUG / "logo.jpg"
            self.assertEqual(first.logo_path, f"cards/{SLUG}/logo.jpg")
            second = self.migrate(
                tmp,
                [card_001(nEN="Nidoran Female (#099/076)"), card_002()],
            )
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(second.logo_path, first.logo_path)
            self.assertEqual(stored["logo_path"], f"cards/{SLUG}/logo.jpg")
            self.assertEqual(copied.read_bytes(), b"logo-v1")
            self.assertEqual(logo.read_bytes(), b"logo-v1")

    def test_omitted_logo_does_not_scan_set_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            set_dir = Path(tmp) / "cards" / SLUG
            set_dir.mkdir(parents=True)
            planted = set_dir / "logo.png"
            planted.write_bytes(b"already-there")
            report = self.migrate(tmp, [card_001()])
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
            finally:
                conn.close()
            assert stored is not None
            self.assertIsNone(stored["logo_path"])
            self.assertIsNone(report.logo_path)
            self.assertEqual(planted.read_bytes(), b"already-there")

    def test_card_count_comes_from_catalog_not_local_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            set_dir = Path(tmp) / "cards" / SLUG
            set_dir.mkdir(parents=True)
            (set_dir / dc.card_filename(card_001())).write_bytes(b"one")
            (set_dir / "050_N_Unlisted.jpg").write_bytes(b"stray")
            (set_dir / "051_N_Unlisted.jpg").write_bytes(b"stray-2")
            catalog = [card_001(), card_002(), card_018()]
            report = self.migrate(tmp, catalog)
            conn = self.connect(tmp)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                rows = conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0]
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(len(catalog), 3)
            self.assertEqual(stored["card_count"], 3)
            self.assertEqual(report.card_count, 3)
            self.assertEqual(rows, 3)
            self.assertEqual((set_dir / "050_N_Unlisted.jpg").read_bytes(), b"stray")

    def test_does_not_invoke_cdn_download(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.migrate(tmp, [card_001(), card_002(), card_018()])
            self.assert_no_image_download()

    def test_does_not_write_back_image_when_fixture_has_f_sp(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            set_dir = Path(tmp) / "cards" / SLUG
            set_dir.mkdir(parents=True)
            existing_back = set_dir / "001_G_Nidoran Fêmea_back.jpg"
            existing_back.write_bytes(b"preexisting-back")
            front = set_dir / dc.card_filename(card_001())
            front.write_bytes(b"front")
            names_before = sorted(path.name for path in set_dir.iterdir())
            self.migrate(tmp, [card_001(), card_002()])
            names_after = sorted(path.name for path in set_dir.iterdir())
            self.assertEqual(names_after, names_before)
            self.assertEqual(existing_back.read_bytes(), b"preexisting-back")
            self.assertEqual(front.read_bytes(), b"front")
            self.assertEqual(list(Path(tmp).rglob("*002*back*")), [])
            conn = self.connect(tmp)
            try:
                paths = [
                    row[0]
                    for row in conn.execute("SELECT image_path FROM set_cards")
                ]
            finally:
                conn.close()
            for path in paths:
                self.assertNotIn("_back", path)
                self.assertNotIn("f_sP", path)
                self.assertNotIn("back.jpg", path)
            self.assert_no_image_download()

    def test_cli_logo_argument_is_optional(self) -> None:
        with_logo = mc.parse_args([URL, "--logo", "path/to/logo.png"])
        self.assertEqual(with_logo.url, URL)
        self.assertEqual(with_logo.logo, Path("path/to/logo.png"))
        without = mc.parse_args([URL])
        self.assertIsNone(without.logo)


if __name__ == "__main__":
    unittest.main()
