import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import catalog_fields as cf  # noqa: E402
import download_collection as dc  # noqa: E402

SLUG = "Celebracao-de-30-Anos-30C"

KNOWN_RARITIES = {
    1: "C",
    3: "R",
    11: "S",
    17: "IR",
    18: "IS",
    20: "RD",
    25: "FR",
}


def _card(**overrides: object) -> dict:
    card = {
        "id": "99999",
        "sN": "001",
        "dN": "001",
        "nPT": "Articuno",
        "nEN": "Articuno (#132/128)",
        "sC": "W",
        "iR": 1,
        "sP": "images/front.jpg",
        "f_sP": "images/back.jpg",
    }
    card.update(overrides)
    return card


class CardNumberTests(unittest.TestCase):
    def test_sn_keeps_leading_zeroes(self):
        self.assertEqual(cf.card_number({"sN": "001"}), "001")

    def test_source_id_is_ignored(self):
        card = {"id": "42", "sN": "001"}
        self.assertEqual(cf.card_number(card), "001")
        self.assertEqual(cf.normalize_card(card, slug=SLUG)["id"], "001")

    def test_missing_sn_is_rejected(self):
        for card in ({}, {"sN": None}, {"sN": ""}, {"sN": "   "}, {"id": "42"}):
            with self.subTest(card=card):
                with self.assertRaises(ValueError):
                    cf.card_number(card)


class NameTests(unittest.TestCase):
    def test_portuguese_html_entity(self):
        card = {"nPT": "Nidoran F&ecirc;mea"}
        self.assertEqual(cf.portuguese_name(card), "Nidoran Fêmea")

    def test_portuguese_trims_and_unescapes(self):
        card = {"nPT": "  Nidoran F&ecirc;mea  "}
        self.assertEqual(cf.portuguese_name(card), "Nidoran Fêmea")

    def test_english_suffix_stripped(self):
        card = {"nEN": "Articuno (#132/128)"}
        self.assertEqual(cf.english_name(card), "Articuno")

    def test_english_trims_and_strips_suffix(self):
        card = {"nEN": "  Articuno (#132/128)  "}
        self.assertEqual(cf.english_name(card), "Articuno")

    def test_display_name_prefers_portuguese(self):
        card = {"nPT": "Nidoran F&ecirc;mea", "nEN": "Nidoran Female (#041/076)"}
        self.assertEqual(cf.display_name(card), "Nidoran Fêmea")

    def test_display_name_falls_back_to_cleaned_english(self):
        card = {"nPT": "", "nEN": "Articuno (#132/128)"}
        self.assertEqual(cf.display_name(card), "Articuno")


class ElementTests(unittest.TestCase):
    def test_known_sc_stays(self):
        self.assertEqual(cf.element_code({"sC": "W"}), "W")

    def test_every_recognized_element_code_is_preserved(self):
        for code in ("W", "R", "G", "L", "P", "F", "D", "M", "Y", "O", "C", "E"):
            with self.subTest(sC=code):
                self.assertEqual(cf.element_code({"sC": code}), code)

    def test_unknown_sc_is_null(self):
        for sC in ("Z", "N", "", None, "água"):
            with self.subTest(sC=sC):
                self.assertIsNone(cf.element_code({"sC": sC}))
        self.assertIsNone(cf.element_code({}))


class RarityTests(unittest.TestCase):
    def test_each_known_ir_maps_to_code(self):
        for i_r, code in KNOWN_RARITIES.items():
            with self.subTest(iR=i_r):
                self.assertEqual(cf.rarity_code({"iR": i_r}), code)

    def test_unknown_ir_is_null(self):
        for i_r in (2, 0, 99, None, "", "IR", "nope"):
            with self.subTest(iR=i_r):
                self.assertIsNone(cf.rarity_code({"iR": i_r}))

    def test_rarity_stores_code_without_display_label(self):
        labels = (
            "Comum",
            "Rara",
            "Promocional",
            "Ilustração Rara",
            "Ilustração Rara Especial",
            "Rara Dupla",
            "Rara Futurista",
        )
        card = _card(iR=1)
        code = cf.rarity_code(card)
        self.assertEqual(code, "C")
        self.assertNotIn("Comum", str(code))
        normalized = cf.normalize_card(card, slug=SLUG)
        self.assertEqual(normalized["rarity_code"], "C")
        stored = " ".join(str(value) for value in normalized.values())
        for label in labels:
            self.assertNotIn(label, stored)


class SortKeyTests(unittest.TestCase):
    def test_dn_stored_unchanged(self):
        self.assertEqual(cf.sort_key({"sN": "001", "dN": "001"}), "001")
        self.assertEqual(cf.sort_key({"sN": "010", "dN": "010"}), "010")
        self.assertIsInstance(cf.sort_key({"sN": "001", "dN": "001"}), str)

    def test_dn_unchanged_when_it_differs_from_sn(self):
        key = cf.sort_key({"sN": "001", "dN": "0001"})
        self.assertEqual(key, "0001")
        self.assertIsInstance(key, str)
        self.assertNotEqual(key, "001")

    def test_missing_dn_falls_back_to_sn(self):
        for card in (
            {"sN": "001"},
            {"sN": "001", "dN": None},
            {"sN": "001", "dN": ""},
        ):
            with self.subTest(card=card):
                self.assertEqual(cf.sort_key(card), "001")


class ImagePathTests(unittest.TestCase):
    def test_path_is_cards_slug_filename_and_not_absolute(self):
        card = _card(sN="132", nPT="Articuno", sC="W")
        path = cf.image_path(card, SLUG)
        self.assertEqual(path, f"cards/{SLUG}/{dc.card_filename(card)}")
        self.assertFalse(Path(path).is_absolute())
        self.assertFalse(path.startswith("/"))

    def test_f_sp_does_not_produce_back_image_path(self):
        card = _card(
            sN="132",
            nPT="Articuno",
            sC="W",
            sP="images/front.jpg",
            f_sP="images/back.jpg",
        )
        normalized = cf.normalize_card(card, slug=SLUG)
        self.assertEqual(
            normalized["image_path"],
            f"cards/{SLUG}/132_W_Articuno.jpg",
        )
        self.assertNotIn("_back", normalized["image_path"])
        self.assertNotIn("back.jpg", normalized["image_path"])
        joined = " ".join(str(value) for value in normalized.values())
        self.assertNotIn("_back", joined)
        self.assertNotIn(card["f_sP"], joined)
