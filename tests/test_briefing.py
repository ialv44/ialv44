"""Run with: python -m unittest discover -s tests"""

import json
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from briefing import feed, model, render, rotation, script, speech  # noqa: E402

WATCHLIST = ROOT / "data" / "watchlist.json"
TEMPLATE = ROOT / "templates" / "player.html"


class SpeechTests(unittest.TestCase):
    def test_money_becomes_words(self):
        self.assertIn("twenty-seven million dollars", speech.speakable("$27M in revenue"))
        self.assertIn("one billion dollar valuation", speech.speakable("a $1B valuation"))

    def test_jargon_is_expanded(self):
        spoken = speech.speakable("YC W26, a16z led, 50% MoM, $2M ARR")
        self.assertIn("Y Combinator", spoken)
        self.assertIn("Winter 2026", spoken)
        self.assertIn("Andreessen Horowitz", spoken)
        self.assertIn("fifty percent", spoken)
        self.assertIn("month over month", spoken)
        self.assertIn("annual recurring revenue", spoken)

    def test_markdown_and_links_are_stripped(self):
        self.assertEqual(
            speech.speakable("**Bold** and [a link](https://example.com) here"),
            "Bold and a link here",
        )

    def test_sentences_split_on_terminators(self):
        self.assertEqual(len(speech.sentences("One. Two! Three? Four")), 4)

    def test_duration_estimate_scales_with_length(self):
        short = speech.estimate_seconds("word " * 20)
        long = speech.estimate_seconds("word " * 200)
        self.assertLess(short, long)


class WatchlistTests(unittest.TestCase):
    def setUp(self):
        self.watchlist = model.load(WATCHLIST)

    def test_real_watchlist_loads(self):
        self.assertGreaterEqual(len(self.watchlist.companies), 30)

    def test_every_company_has_a_source_and_a_date(self):
        for company in self.watchlist.companies:
            self.assertTrue(company.sources, f"{company.id} has no source")
            self.assertTrue(company.as_of, f"{company.id} has no as_of date")

    def test_momentum_drives_rotation_slots(self):
        counts = {c.momentum: c.slots for c in self.watchlist.companies}
        self.assertEqual(counts.get(5, 3), 3)
        self.assertLessEqual(counts.get(3, 1), 2)

    def test_duplicate_ids_are_rejected(self):
        raw = json.loads(WATCHLIST.read_text(encoding="utf-8"))
        raw["companies"] = [raw["companies"][0], dict(raw["companies"][0])]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(raw, handle)
        with self.assertRaises(ValueError):
            model.load(handle.name)

    def test_missing_fields_are_rejected(self):
        raw = json.loads(WATCHLIST.read_text(encoding="utf-8"))
        raw["companies"] = [{"id": "x", "name": "X"}]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(raw, handle)
        with self.assertRaises(ValueError) as caught:
            model.load(handle.name)
        self.assertIn("missing fields", str(caught.exception))


class RotationTests(unittest.TestCase):
    def setUp(self):
        self.watchlist = model.load(WATCHLIST)

    def test_same_date_gives_same_lineup(self):
        first = rotation.lineup(self.watchlist, date(2026, 9, 3))
        second = rotation.lineup(self.watchlist, date(2026, 9, 3))
        self.assertEqual([c.id for c in first], [c.id for c in second])

    def test_no_repeats_inside_one_episode(self):
        picks = rotation.lineup(self.watchlist, date(2026, 9, 12), count=10)
        self.assertEqual(len(picks), len(set(c.id for c in picks)))

    def test_every_episode_has_headliners(self):
        for offset in range(14):
            picks = rotation.lineup(self.watchlist, date(2026, 9, 3) + timedelta(days=offset))
            hot = [c for c in picks if c.momentum >= 5]
            self.assertGreaterEqual(len(hot), 2, f"day {offset} had no headliners")

    def test_two_weeks_covers_most_of_the_watchlist(self):
        seen = set()
        for offset in range(14):
            seen.update(c.id for c in rotation.lineup(
                self.watchlist, date(2026, 9, 3) + timedelta(days=offset)))
        self.assertGreater(len(seen), len(self.watchlist.companies) * 0.8)

    def test_excluded_companies_never_appear(self):
        skip = {self.watchlist.companies[0].id, self.watchlist.companies[1].id}
        picks = rotation.lineup(self.watchlist, date(2026, 9, 5), exclude=skip)
        self.assertFalse(skip & {c.id for c in picks})

    def test_strongest_company_leads(self):
        picks = rotation.lineup(self.watchlist, date(2026, 9, 7))
        self.assertEqual(picks[0].momentum, max(c.momentum for c in picks))


class EpisodeTests(unittest.TestCase):
    def setUp(self):
        self.watchlist = model.load(WATCHLIST)
        self.episode = script.build(self.watchlist, date(2026, 9, 3), count=6)

    def test_shape_is_intro_companies_patterns_outro(self):
        kinds = [s.kind for s in self.episode.segments]
        self.assertEqual(kinds[0], "intro")
        self.assertEqual(kinds[-2:], ["patterns", "outro"])
        self.assertEqual(kinds.count("company"), 6)

    def test_every_segment_has_speakable_text(self):
        for segment in self.episode.segments:
            self.assertGreater(len(segment.speak.split()), 20, segment.id)
            self.assertNotIn("$", segment.speak)
            self.assertNotIn("**", segment.speak)
            self.assertGreater(segment.seconds, 0)

    def test_length_is_a_commute_not_a_lecture(self):
        self.assertLess(self.episode.seconds, 20 * 60)
        self.assertGreater(self.episode.seconds, 60)

    def test_solo_segment_stands_on_its_own(self):
        company = self.watchlist.companies[0]
        solo = script.company_solo(company, self.watchlist)
        self.assertTrue(solo.speak.startswith(company.name))
        self.assertNotIn("Number 1 of", solo.speak)


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.watchlist = model.load(WATCHLIST)
        self.episode = script.build(self.watchlist, date(2026, 9, 3), count=5)

    def test_html_carries_the_data_and_drops_the_placeholder(self):
        page = render.html(self.episode, self.watchlist, TEMPLATE)
        self.assertNotIn(render.PLACEHOLDER, page)
        self.assertIn('const DATA = {"episode"', page)
        self.assertIn("Startup Brief Radio", page)
        # An unescaped </ inside the JSON would close the <script> element early.
        data_line = page.split("const DATA = ", 1)[1].split("\n", 1)[0]
        self.assertNotIn("</", data_line)

    def test_library_holds_the_whole_watchlist(self):
        data = render.payload(self.episode, self.watchlist)
        self.assertEqual(len(data["library"]), len(self.watchlist.companies))
        self.assertTrue(all(entry["speak"] for entry in data["library"]))

    def test_markdown_lists_sources(self):
        text = render.markdown(self.episode, self.watchlist)
        self.assertIn("Sources:", text)
        self.assertIn("Steal this.", text)

    def test_write_all_produces_a_latest_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            written = render.write_all(self.episode, self.watchlist, Path(tmp), TEMPLATE)
            for path in written.values():
                self.assertTrue(path.exists(), path)
            self.assertEqual(
                written["latest"].read_text(encoding="utf-8"),
                written["html"].read_text(encoding="utf-8"),
            )


class FeedTests(unittest.TestCase):
    def test_feed_is_valid_rss_with_an_enclosure(self):
        xml = feed.build(
            [{"date": "2026-09-03", "title": "Brief", "seconds": 480,
              "audio": "brief.mp3", "bytes": 100}],
            "https://example.com/briefs",
        )
        root = ET.fromstring(xml)
        item = root.find("./channel/item")
        self.assertEqual(item.find("title").text, "Brief")
        self.assertEqual(
            item.find("enclosure").get("url"), "https://example.com/briefs/brief.mp3")


if __name__ == "__main__":
    unittest.main()
