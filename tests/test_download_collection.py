import io
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock
from urllib.error import URLError

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import catalog_db  # noqa: E402
import download_collection as dc  # noqa: E402


class ProjectRootTests(unittest.TestCase):
    def test_resolves_to_repo_with_pyproject(self):
        root = dc.project_root()
        self.assertTrue((root / "pyproject.toml").is_file())
        self.assertTrue((root / "scripts" / "download_collection.py").is_file())


class CollectionFolderNameTests(unittest.TestCase):
    def test_celebracao_de_30_anos(self):
        self.assertEqual(
            dc.collection_folder_name("Celebração de 30 Anos | LigaPokemon", "30C"),
            "Celebracao-de-30-Anos-30C",
        )

    def test_storm_emeralda(self):
        self.assertEqual(
            dc.collection_folder_name("Storm Emeralda | LigaPokemon", "M6"),
            "Storm-Emeralda-M6",
        )


class CardFilenameTests(unittest.TestCase):
    def test_filename_from_portuguese_name(self):
        card = {"sN": "018", "nPT": "Articuno", "nEN": "Articuno (#018/128)"}
        self.assertEqual(dc.card_filename(card), "018_N_Articuno.jpg")

    def test_filename_from_english_when_portuguese_empty(self):
        card = {"sN": "068", "nPT": "", "nEN": "Aarune (#068/076)"}
        self.assertEqual(dc.card_filename(card), "068_N_Aarune.jpg")

    def test_back_face_filename(self):
        card = {"sN": "001", "nPT": "Pikachu", "nEN": "Pikachu (#001/076)"}
        self.assertEqual(dc.card_filename(card, back=True), "001_N_Pikachu_back.jpg")

    def test_decodes_html_entities_in_name(self):
        card = {
            "sN": "041",
            "nPT": "Nidoran F&ecirc;mea",
            "nEN": "Nidoran Female (#041/076)",
        }
        self.assertEqual(dc.card_filename(card), "041_N_Nidoran Fêmea.jpg")

    def test_filename_includes_known_sc_code(self):
        card = {"sN": "132", "nPT": "Articuno", "sC": "W"}
        self.assertEqual(dc.card_filename(card), "132_W_Articuno.jpg")
        self.assertEqual(dc.card_filename(card, back=True), "132_W_Articuno_back.jpg")

    def test_unknown_sc_falls_back_to_n(self):
        for sC in ("Z", "água", "", None):
            card = {"sN": "132", "nPT": "Articuno", "sC": sC}
            self.assertEqual(dc.card_filename(card), "132_N_Articuno.jpg")
            self.assertEqual(dc.card_filename(card, back=True), "132_N_Articuno_back.jpg")

    def test_legacy_filename_omits_type_code(self):
        card = {"sN": "132", "nPT": "Articuno", "sC": "W"}
        self.assertEqual(dc.legacy_card_filename(card), "132_Articuno.jpg")
        self.assertEqual(dc.legacy_card_filename(card, back=True), "132_Articuno_back.jpg")


class RenameLegacyIfNeededTests(unittest.TestCase):
    def test_renames_nonempty_legacy_when_dest_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "132_Articuno.jpg"
            dest = root / "132_W_Articuno.jpg"
            legacy.write_bytes(b"card-bytes")
            self.assertTrue(dc.rename_legacy_if_needed(dest, legacy))
            self.assertFalse(legacy.exists())
            self.assertEqual(dest.read_bytes(), b"card-bytes")

    def test_renames_legacy_back_face(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "001_Pikachu_back.jpg"
            dest = root / "001_N_Pikachu_back.jpg"
            legacy.write_bytes(b"back-bytes")
            self.assertTrue(dc.rename_legacy_if_needed(dest, legacy))
            self.assertFalse(legacy.exists())
            self.assertEqual(dest.read_bytes(), b"back-bytes")

    def test_leaves_both_when_dest_already_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "132_Articuno.jpg"
            dest = root / "132_W_Articuno.jpg"
            legacy.write_bytes(b"legacy")
            dest.write_bytes(b"new")
            self.assertFalse(dc.rename_legacy_if_needed(dest, legacy))
            self.assertEqual(legacy.read_bytes(), b"legacy")
            self.assertEqual(dest.read_bytes(), b"new")

    def test_skips_empty_legacy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "132_Articuno.jpg"
            dest = root / "132_N_Articuno.jpg"
            legacy.write_bytes(b"")
            self.assertFalse(dc.rename_legacy_if_needed(dest, legacy))
            self.assertTrue(legacy.exists())
            self.assertFalse(dest.exists())


class SortCardsTests(unittest.TestCase):
    def test_sort_by_dn_puts_001_before_132(self):
        cards = [
            {"sN": "132", "dN": "000000000000132"},
            {"sN": "001", "dN": "000000000000001"},
        ]
        sorted_cards = dc.sort_cards(cards)
        self.assertEqual([card["sN"] for card in sorted_cards], ["001", "132"])


class ImageUrlTests(unittest.TestCase):
    def test_strips_leading_slashes(self):
        self.assertEqual(
            dc.image_url("//arquivos/in/pokemon_bkp/cd/804/card.jpg"),
            "https://repositorio.sbrauble.com/arquivos/in/pokemon_bkp/cd/804/card.jpg",
        )


class PlannedOutputTests(unittest.TestCase):
    def test_reports_slug_path_and_card_count(self):
        catalog = [
            {"sN": "132", "dN": "000000000000132", "sSigla": "30C"},
            {"sN": "001", "dN": "000000000000001", "sSigla": "30C"},
        ]
        slug, out_dir, card_count = dc.planned_output(
            "Celebração de 30 Anos | LigaPokemon",
            catalog,
            "30C",
        )
        self.assertEqual(slug, "Celebracao-de-30-Anos-30C")
        self.assertEqual(out_dir, dc.project_root() / "cards" / slug)
        self.assertEqual(card_count, 2)


class SanitizeCollectionUrlTests(unittest.TestCase):
    def test_strips_zsh_backslashes_from_liga_search_url(self):
        self.assertEqual(
            dc.sanitize_collection_url(
                r"https://www.ligapokemon.com.br/\?view\=cards/search"
                r"\&card\=edid\=804%20ed\=30C"
            ),
            "https://www.ligapokemon.com.br/?view=cards/search"
            "&card=edid=804%20ed=30C",
        )

    def test_leaves_clean_url_unchanged(self):
        url = (
            "https://www.ligapokemon.com.br/?view=cards/search"
            "&card=edid=804%20ed=30C"
        )
        self.assertEqual(dc.sanitize_collection_url(url), url)

    def test_parse_args_returns_sanitized_url(self):
        args = dc.parse_args(
            [
                r"https://www.ligapokemon.com.br/\?view\=cards/search"
                r"\&card\=edid\=804%20ed\=30C"
            ]
        )
        self.assertEqual(
            args.url,
            "https://www.ligapokemon.com.br/?view=cards/search"
            "&card=edid=804%20ed=30C",
        )


class DryRunFlagTests(unittest.TestCase):
    def test_accepts_dryrun_alias(self):
        args = dc.parse_args(["https://example.test", "--dryrun"])
        self.assertTrue(args.dry_run)


class DownloadSkipTests(unittest.TestCase):
    def test_skip_existing_nonempty_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "018_N_Articuno.jpg"
            dest.write_bytes(b"already here")
            status = dc.download_to("http://example.invalid/missing.jpg", dest)
            self.assertEqual(status, "skipped")
            self.assertEqual(dest.read_bytes(), b"already here")

    def test_rename_then_skip_avoids_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            card = {"sN": "132", "nPT": "Articuno", "sC": "W"}
            legacy = root / dc.legacy_card_filename(card)
            dest = root / dc.card_filename(card)
            legacy.write_bytes(b"already here")
            dc.rename_legacy_if_needed(dest, legacy)
            status = dc.download_to("http://example.invalid/missing.jpg", dest)
            self.assertEqual(status, "skipped")
            self.assertFalse(legacy.exists())
            self.assertEqual(dest.read_bytes(), b"already here")


URL = "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C"
TITLE = "Celebração de 30 Anos | LigaPokemon"
SLUG = "Celebracao-de-30-Anos-30C"
SET_CODE = "30C"


def _fixture_cards() -> list[dict]:
    return [
        {
            "id": "55518",
            "sN": "018",
            "dN": "000000000000018",
            "nPT": "",
            "nEN": "Articuno (#018/128)",
            "sC": "W",
            "iR": 99,
            "sP": "images/018.jpg",
            "f_sP": "images/018-back.jpg",
            "sSigla": SET_CODE,
        },
        {
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
        },
        {
            "id": "55550",
            "sN": "050",
            "dN": "000000000000050",
            "nPT": "Pikachu",
            "nEN": "Pikachu (#050/076)",
            "sC": "Z",
            "iR": 3,
            "sP": "images/050.jpg",
            "f_sP": "images/050-back.jpg",
            "sSigla": SET_CODE,
        },
    ]


class _BytesResponse:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> "_BytesResponse":
        return self

    def __exit__(self, *_exc: object) -> bool:
        return False


class CatalogDownloadTests(unittest.TestCase):
    def setUp(self) -> None:
        self._real_db = catalog_db.catalog_db_path()
        self._real_db_existed = self._real_db.exists()
        self._real_db_mtime = (
            self._real_db.stat().st_mtime_ns if self._real_db_existed else None
        )
        patcher = mock.patch.object(
            dc,
            "fetch_page_data",
            side_effect=AssertionError("Liga fetch"),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self) -> None:
        if self._real_db_existed:
            self.assertEqual(self._real_db.stat().st_mtime_ns, self._real_db_mtime)
        else:
            self.assertFalse(self._real_db.exists())

    def run_download(
        self,
        root: Path,
        catalog: list[dict],
        argv: list[str] | None = None,
        *,
        title: str = TITLE,
        sigla: str = SET_CODE,
        urlopen_side_effect: object | None = None,
    ) -> tuple[int, str, str, list[str]]:
        opened: list[str] = []

        def record_urlopen(request: object, timeout: int = 30) -> _BytesResponse:
            opened.append(request.full_url)  # type: ignore[attr-defined]
            return _BytesResponse(b"front-bytes")

        if urlopen_side_effect is None:
            urlopen_side_effect = record_urlopen
        stdout, stderr = io.StringIO(), io.StringIO()
        with (
            mock.patch.object(dc, "project_root", return_value=root),
            mock.patch.object(
                dc,
                "fetch_page_data",
                return_value=(title, catalog, sigla),
            ),
            mock.patch.object(dc, "urlopen", side_effect=urlopen_side_effect),
            mock.patch.object(dc.time, "sleep"),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            code = dc.main([URL] if argv is None else argv)
        return code, stdout.getvalue(), stderr.getvalue(), opened

    def connect(self, root: Path) -> object:
        return catalog_db.connect(root / "data" / "catalog.db")

    def test_normal_fixture_writes_one_set_and_all_cards(self) -> None:
        catalog = _fixture_cards()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            code, _stdout, stderr, _opened = self.run_download(root, catalog)
            self.assertEqual(code, 0)
            self.assertEqual(stderr, "")
            conn = self.connect(root)
            try:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 1)
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0],
                    len(catalog),
                )
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                columns = {
                    row[1]
                    for row in conn.execute("PRAGMA table_info(set_cards)")
                }
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(stored["set_code"], SET_CODE)
            self.assertEqual(stored["name_pt"], "Celebração de 30 Anos")
            self.assertIsNone(stored["name_en"])
            self.assertEqual(stored["slug"], SLUG)
            self.assertEqual(stored["source_url"], URL)
            self.assertEqual(stored["card_count"], len(catalog))
            self.assertIsNone(stored["logo_path"])
            self.assertNotIn("card_kind", columns)
            for card in catalog:
                image = root / "cards" / SLUG / dc.card_filename(card)
                self.assertTrue(image.is_file())
                self.assertEqual(image.read_bytes(), b"front-bytes")

    def test_existing_set_updates_metadata_and_reuses_id(self) -> None:
        catalog = _fixture_cards()
        logo_path = f"cards/{SLUG}/logo.png"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conn = self.connect(root)
            try:
                original_id = catalog_db.insert_set(
                    conn,
                    {
                        "set_code": SET_CODE,
                        "name_pt": "Old Name",
                        "name_en": "Old English",
                        "slug": SLUG,
                        "source_url": "https://example.test/old",
                        "logo_path": logo_path,
                        "card_count": 1,
                    },
                )
                catalog_db.upsert_set_card(
                    conn,
                    original_id,
                    {
                        "id": "001",
                        "name_pt": "Old Card",
                        "name_en": "Old Card",
                        "element_code": "G",
                        "rarity_code": "C",
                        "image_path": f"cards/{SLUG}/001_G_Old.jpg",
                        "sort_key": "0",
                    },
                )
                conn.commit()
            finally:
                conn.close()

            code, _stdout, stderr, _opened = self.run_download(root, catalog)
            self.assertEqual(code, 0)
            self.assertEqual(stderr, "")
            conn = self.connect(root)
            try:
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0], 1)
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                card = catalog_db.find_set_card(conn, original_id, "001")
            finally:
                conn.close()
            assert stored is not None
            assert card is not None
            self.assertEqual(stored["id"], original_id)
            self.assertEqual(stored["name_pt"], "Celebração de 30 Anos")
            self.assertEqual(stored["name_en"], "Old English")
            self.assertEqual(stored["source_url"], URL)
            self.assertEqual(stored["card_count"], len(catalog))
            self.assertEqual(stored["logo_path"], logo_path)
            self.assertEqual(card["name_pt"], "Nidoran Fêmea")
            self.assertNotEqual(card["image_path"], f"cards/{SLUG}/001_G_Old.jpg")

    def test_sn_values_stay_text_with_leading_zeroes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.run_download(root, _fixture_cards())
            conn = self.connect(root)
            try:
                rows = conn.execute(
                    "SELECT id, typeof(id) FROM set_cards ORDER BY id"
                ).fetchall()
            finally:
                conn.close()
            self.assertEqual(
                rows,
                [("001", "text"), ("018", "text"), ("050", "text")],
            )

    def test_rerun_reuses_set_id_without_duplicate_rows(self) -> None:
        catalog = _fixture_cards()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first, _stdout, _stderr, _opened = self.run_download(root, catalog)
            self.assertEqual(first, 0)
            conn = self.connect(root)
            try:
                original = catalog_db.find_set_by_code(conn, SET_CODE)
            finally:
                conn.close()
            assert original is not None
            second, _stdout, _stderr, _opened = self.run_download(root, catalog)
            self.assertEqual(second, 0)
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                set_count = conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
                card_count = conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0]
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(stored["id"], original["id"])
            self.assertEqual(set_count, 1)
            self.assertEqual(card_count, len(catalog))

    def test_names_are_unescaped_and_english_suffixes_removed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.run_download(root, _fixture_cards())
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                nidoran = catalog_db.find_set_card(conn, stored["id"], "001")
                articuno = catalog_db.find_set_card(conn, stored["id"], "018")
            finally:
                conn.close()
            assert nidoran is not None
            assert articuno is not None
            self.assertEqual(nidoran["name_pt"], "Nidoran Fêmea")
            self.assertEqual(nidoran["name_en"], "Nidoran Female")
            self.assertIsNone(articuno["name_pt"])
            self.assertEqual(articuno["name_en"], "Articuno")
            self.assertNotIn("(#", nidoran["name_en"])
            self.assertNotIn("(#", articuno["name_en"])

    def test_rarity_ids_become_normalized_codes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.run_download(root, _fixture_cards())
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                common = catalog_db.find_set_card(conn, stored["id"], "001")
                rare = catalog_db.find_set_card(conn, stored["id"], "050")
            finally:
                conn.close()
            assert common is not None
            assert rare is not None
            self.assertEqual(common["rarity_code"], "C")
            self.assertEqual(rare["rarity_code"], "R")

    def test_unknown_rarity_id_becomes_null(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.run_download(root, _fixture_cards())
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                articuno = catalog_db.find_set_card(conn, stored["id"], "018")
            finally:
                conn.close()
            assert articuno is not None
            self.assertIsNone(articuno["rarity_code"])

    def test_dn_is_stored_as_sort_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.run_download(root, _fixture_cards())
            conn = self.connect(root)
            try:
                rows = conn.execute(
                    "SELECT id, sort_key FROM set_cards ORDER BY id"
                ).fetchall()
            finally:
                conn.close()
            self.assertEqual(
                rows,
                [
                    ("001", "000000000000001"),
                    ("018", "000000000000018"),
                    ("050", "000000000000050"),
                ],
            )

    def test_image_paths_point_at_local_card_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.run_download(root, _fixture_cards())
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                rows = {
                    row["id"]: row
                    for row in (
                        catalog_db.find_set_card(conn, stored["id"], card["sN"])
                        for card in _fixture_cards()
                    )
                }
            finally:
                conn.close()
            expected = {
                "001": f"cards/{SLUG}/001_G_Nidoran Fêmea.jpg",
                "018": f"cards/{SLUG}/018_W_Articuno.jpg",
                "050": f"cards/{SLUG}/050_N_Pikachu.jpg",
            }
            for card_id, path in expected.items():
                assert rows[card_id] is not None
                self.assertEqual(rows[card_id]["image_path"], path)
                self.assertFalse(Path(path).is_absolute())
                self.assertEqual((root / path).read_bytes(), b"front-bytes")
                self.assertIsNone(rows[card_id]["illustrator"])
            self.assertEqual(rows["001"]["element_code"], "G")
            self.assertEqual(rows["018"]["element_code"], "W")
            self.assertIsNone(rows["050"]["element_code"])

    def test_existing_front_images_are_skipped_without_changing_identity(self) -> None:
        catalog = _fixture_cards()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first, _stdout, _stderr, opened = self.run_download(root, catalog)
            self.assertEqual(first, 0)
            self.assertEqual(len(opened), len(catalog))
            conn = self.connect(root)
            try:
                original = catalog_db.find_set_by_code(conn, SET_CODE)
                original_cards = conn.execute(
                    "SELECT id, image_path FROM set_cards ORDER BY id"
                ).fetchall()
            finally:
                conn.close()
            assert original is not None
            set_dir = root / "cards" / SLUG
            before = {path.name: path.read_bytes() for path in set_dir.iterdir()}
            second, stdout, _stderr, _opened = self.run_download(
                root,
                catalog,
                urlopen_side_effect=AssertionError("image download"),
            )
            self.assertEqual(second, 0)
            self.assertIn("skipped", stdout)
            after = {path.name: path.read_bytes() for path in set_dir.iterdir()}
            self.assertEqual(after, before)
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                cards = conn.execute(
                    "SELECT id, image_path FROM set_cards ORDER BY id"
                ).fetchall()
                set_count = conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(stored["id"], original["id"])
            self.assertEqual(cards, original_cards)
            self.assertEqual(set_count, 1)

    def test_f_sp_does_not_download_or_write_back_image(self) -> None:
        catalog = _fixture_cards()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for card in catalog:
                jobs = dc.card_image_jobs(card)
                self.assertEqual(len(jobs), 1)
                url, filename, legacy = jobs[0]
                self.assertEqual(url, dc.image_url(card["sP"]))
                self.assertNotIn(card["f_sP"], url)
                self.assertFalse(filename.endswith("_back.jpg"))
                self.assertFalse(legacy.endswith("_back.jpg"))
            code, _stdout, _stderr, opened = self.run_download(root, catalog)
            self.assertEqual(code, 0)
            self.assertEqual(
                opened,
                [
                    dc.image_url(card["sP"])
                    for card in sorted(catalog, key=lambda item: str(item["dN"]))
                ],
            )
            written = [path.name for path in (root / "cards" / SLUG).iterdir()]
            self.assertTrue(written)
            self.assertFalse(any("_back" in name for name in written))
            self.assertFalse(any(card["f_sP"] in name for card in catalog for name in written))

    def test_download_does_not_set_or_clear_logo_path(self) -> None:
        catalog = _fixture_cards()
        logo_path = f"cards/{SLUG}/logo.png"
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            set_dir = root / "cards" / SLUG
            set_dir.mkdir(parents=True)
            (set_dir / "logo.png").write_bytes(b"logo-bytes")
            code, _stdout, _stderr, _opened = self.run_download(root, catalog)
            self.assertEqual(code, 0)
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
            finally:
                conn.close()
            assert stored is not None
            self.assertIsNone(stored["logo_path"])
            self.assertEqual((set_dir / "logo.png").read_bytes(), b"logo-bytes")

            conn = self.connect(root)
            try:
                catalog_db.update_set(conn, int(stored["id"]), {"logo_path": logo_path})
                conn.commit()
            finally:
                conn.close()
            code, _stdout, _stderr, _opened = self.run_download(root, catalog)
            self.assertEqual(code, 0)
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
            finally:
                conn.close()
            assert stored is not None
            self.assertEqual(stored["logo_path"], logo_path)
            self.assertEqual((set_dir / "logo.png").read_bytes(), b"logo-bytes")

    def test_failed_image_still_exits_nonzero_and_writes_catalog_row(self) -> None:
        catalog = _fixture_cards()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            def fail_urlopen(_request: object, timeout: int = 30) -> _BytesResponse:
                raise URLError("down")

            code, _stdout, stderr, _opened = self.run_download(
                root,
                catalog,
                urlopen_side_effect=fail_urlopen,
            )
            self.assertEqual(code, 1)
            self.assertIn("failed", stderr)
            conn = self.connect(root)
            try:
                stored = catalog_db.find_set_by_code(conn, SET_CODE)
                assert stored is not None
                self.assertEqual(
                    conn.execute("SELECT COUNT(*) FROM set_cards").fetchone()[0],
                    len(catalog),
                )
                articuno = catalog_db.find_set_card(conn, stored["id"], "018")
            finally:
                conn.close()
            assert articuno is not None
            expected = f"cards/{SLUG}/018_W_Articuno.jpg"
            self.assertEqual(articuno["image_path"], expected)
            self.assertFalse((root / expected).exists())

    def test_dry_run_has_no_database_or_filesystem_side_effects(self) -> None:
        catalog = _fixture_cards()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for flag in ("--dry-run", "--dryrun"):
                code, stdout, stderr, _opened = self.run_download(
                    root,
                    catalog,
                    argv=[URL, flag],
                    urlopen_side_effect=AssertionError("image download"),
                )
                self.assertEqual(code, 0, stderr)
                self.assertIn(f"Collection: {SLUG}", stdout)
                self.assertIn(f"Cards: {len(catalog)}", stdout)
                self.assertIn(str(root / "cards" / SLUG), stdout)
                self.assertFalse((root / "data").exists())
                self.assertFalse((root / "cards").exists())
                self.assertFalse((root / "data" / "catalog.db").exists())


if __name__ == "__main__":
    unittest.main()
