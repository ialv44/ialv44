# Daily startup briefings, for listening

A daily audio brief on startups that have raised real money and are moving
fast — Y Combinator, a16z Speedrun and Andreessen Horowitz's own portfolio, HF0,
South Park Commons, plus the breakout companies everyone else is benchmarked
against.

It is built for the car. You press play once, and it talks you through a handful
of companies: what they do, what traction they have, where the money came from,
why it matters, and one thing you could steal for your own idea. It ends with
three questions to think about while you finish the drive.

## Listen now, with nothing installed

```bash
PYTHONPATH=src python -m briefing brief      # writes out/index.html
open out/index.html                          # or double-click it
```

The page speaks itself using the voice already built into your browser or phone.
Big controls, auto-advance to the next company, speed control, and it remembers
where you stopped. Lock-screen and steering-wheel media buttons work where the
browser supports them. Tap any company in the watchlist below the player to hear
just that one, any time — "tell me about Mercor" is a tap.

## Put it in a podcast app

For real audio files you can subscribe to in the car:

```bash
pip install edge-tts                                     # any TTS engine works
PYTHONPATH=src python -m briefing brief --audio
PYTHONPATH=src python -m briefing feed --base-url https://you.github.io/repo
```

That writes an MP3 per episode plus `out/feed.xml`. Host `out/` anywhere
(GitHub Pages works) and subscribe to the feed URL in Apple Podcasts, Pocket
Casts, Overcast, or Spotify. `edge-tts`, `piper`, macOS `say` and `espeak-ng`
are all detected automatically, in that order.

The included GitHub Action does all of this every morning at 05:30 UTC and
commits the result, so a new episode is waiting when you get in the car.

## Commands

| Command | What it does |
| --- | --- |
| `brief` | Build a day's episode. `--date`, `--count`, `--exclude`, `--audio` |
| `feed` | Write the podcast RSS for everything in `out/` |
| `check` | Validate the watchlist and show how the rotation is spread |
| `list` | Print the watchlist. `--program a16z` to filter |

## The watchlist

`data/watchlist.json` holds every company, hand-written to be *spoken* rather
than read. Each entry carries what they do, traction, funding, why it matters,
a "steal this" note for your own idea, a momentum score, and the sources the
numbers came from.

Edit it freely — it is the whole content layer:

```jsonc
{
  "id": "your-company",
  "name": "Your Company",
  "program": "yc",              // yc | speedrun | a16z | hf0 | spc | breakout
  "batch": "W26",
  "momentum": 5,                // 5 = headliner, heard three times as often
  "one_liner": "One sentence a person would say out loud.",
  "what_they_do": "…", "traction": "…", "funding": "…",
  "why_it_matters": "…", "founder_angle": "…",
  "tags": ["agents"], "sources": ["https://…"], "as_of": "2026-09-03"
}
```

Numbers are written as words where it matters, but you can paste `$27M ARR`
and `YC W26` straight in — `briefing.speech` converts that into
"twenty-seven million dollars in annual recurring revenue" and "Y Combinator,
Winter 2026" before it reaches the voice.

Run `python -m briefing check` after editing. It fails loudly on a missing
field, a duplicate id, or a company with no source.

## How the daily line-up is chosen

Two rotations run side by side. Momentum-5 companies sit on a "headliners"
wheel and every episode takes at least two from it; everything else fills the
rest of the slots from a second wheel. Each wheel resumes where yesterday
stopped, so you work through the whole watchlist before anything comes back —
about two weeks at eight a day, with the busiest companies recurring sooner.

It is stateless: a given date always produces the same episode, on any machine,
with no history file to lose. `--seed` reshuffles everything if you want a
different order.

## Layout

```
data/watchlist.json      the companies — the part worth editing
src/briefing/speech.py   makes written text speakable ($27M -> words)
src/briefing/rotation.py which companies you hear today
src/briefing/script.py   assembles the episode: intro, companies, pattern, outro
src/briefing/render.py   page, markdown and JSON output
src/briefing/tts.py      optional audio files
src/briefing/feed.py     podcast RSS
templates/player.html    the listening page
tests/                   python -m unittest discover -s tests
```

## A caution on the numbers

Valuations, revenue and round sizes are as *reported* by the sources listed on
each entry, mostly around the 2026 Demo Day cycles. Private-company figures are
frequently leaked, estimated, or spun. Treat them as directionally useful and
check anything you would act on.
