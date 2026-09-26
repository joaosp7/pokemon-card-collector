import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

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


if __name__ == "__main__":
    unittest.main()
