"""Command line: build today's brief, render audio, publish a feed."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

from . import feed as feed_mod
from . import model, render, rotation, script, site as site_mod, tts

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_WATCHLIST = ROOT / "data" / "watchlist.json"
DEFAULT_TEMPLATE = ROOT / "templates" / "player.html"
DEFAULT_OUT = ROOT / "out"


def _parse_date(value: str | None) -> date:
    return date.fromisoformat(value) if value else date.today()


def cmd_brief(args: argparse.Namespace) -> int:
    watchlist = model.load(args.watchlist)
    on = _parse_date(args.date)
    episode = script.build(
        watchlist, on, count=args.count, seed=args.seed,
        exclude=set(args.exclude or []),
    )
    written = render.write_all(episode, watchlist, Path(args.out), Path(args.template))

    print(f"{episode.title}")
    print(f"  {episode.seconds // 60} min {episode.seconds % 60} s, "
          f"{len(episode.segments)} segments")
    for segment in episode.segments:
        if segment.kind == "company":
            print(f"  · {segment.heading} — {segment.subhead}")
    for label, path in written.items():
        print(f"  {label:9} {path.relative_to(ROOT) if ROOT in path.parents else path}")

    if args.audio:
        backend = tts.detect()
        if backend is None:
            print("  audio     skipped — no speech engine found "
                  "(`pip install edge-tts`). The HTML page still speaks.")
        else:
            audio_dir = Path(args.out) / f"audio-{episode.date}"
            parts = tts.synthesize(episode, audio_dir, voice=args.voice, backend=backend)
            joined = tts.stitch(parts, Path(args.out) / f"brief-{episode.date}.mp3")
            tts.playlist(parts, audio_dir / "playlist.m3u")
            print(f"  audio     {len(parts)} files via {backend.name} in {audio_dir}")
            if joined:
                print(f"  episode   {joined}")
    return 0


def cmd_feed(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    episodes = []
    for path in sorted(out_dir.glob("brief-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        audio = out_dir / f"brief-{data['date']}.mp3"
        episodes.append({
            "date": data["date"],
            "title": data["title"],
            "seconds": data["seconds"],
            "summary": " ".join(
                s["heading"] for s in data["segments"] if s["kind"] == "company"),
            "audio": audio.name if audio.exists() else "",
            "bytes": audio.stat().st_size if audio.exists() else 0,
        })
    if not episodes:
        print("No episodes in out/ yet. Run `brief` first.", file=sys.stderr)
        return 1
    path = feed_mod.write(out_dir / "feed.xml", episodes, args.base_url)
    print(f"{len(episodes)} episodes -> {path}")
    return 0


def cmd_site(args: argparse.Namespace) -> int:
    """Rebuild the installable app from every brief in out/."""
    watchlist = model.load(args.watchlist)
    out_dir = Path(args.out)
    episodes = []
    for path in sorted(out_dir.glob("brief-*.json"), reverse=True):
        stamp = path.stem.replace("brief-", "")
        episodes.append((
            script.build(watchlist, date.fromisoformat(stamp),
                         count=args.count, seed=args.seed),
            watchlist,
        ))
    if not episodes:
        print("No briefs in out/ yet. Run `brief` first.", file=sys.stderr)
        return 1

    written = site_mod.build(episodes, Path(args.site), Path(args.template),
                             source_dir=out_dir, base_url=args.base_url)
    print(f"{len(episodes)} episodes -> {args.site}")
    for label, path in written.items():
        print(f"  {label:15} {path}")
    print(f"  serve locally:  python -m http.server -d {args.site} 8000")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    watchlist = model.load(args.watchlist)
    programs: dict[str, int] = {}
    for company in watchlist.companies:
        programs[company.program] = programs.get(company.program, 0) + 1
        if not company.sources:
            print(f"  warning: {company.id} has no sources")
    print(f"{len(watchlist.companies)} companies, curated {watchlist.curated_on}")
    for key, count in sorted(programs.items(), key=lambda kv: -kv[1]):
        print(f"  {watchlist.program_name(key):24} {count}")
    print(f"  full rotation repeats every "
          f"{rotation.days_until_repeat(watchlist, args.count):.0f} days "
          f"at {args.count} a day")
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    watchlist = model.load(args.watchlist)
    for company in watchlist.companies:
        if args.program and company.program != args.program:
            continue
        print(f"{company.momentum}  {company.id:22} {company.name:22} {company.one_liner}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="briefing", description=__doc__)
    parser.add_argument("--watchlist", default=str(DEFAULT_WATCHLIST))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    sub = parser.add_subparsers(dest="command", required=True)

    brief = sub.add_parser("brief", help="build a day's brief (default: today)")
    brief.add_argument("--date")
    brief.add_argument("--count", type=int, default=8, help="companies in the episode")
    brief.add_argument("--seed", default="v1", help="change to reshuffle the rotation")
    brief.add_argument("--exclude", nargs="*", help="company ids to skip")
    brief.add_argument("--template", default=str(DEFAULT_TEMPLATE))
    brief.add_argument("--audio", action="store_true", help="also render audio files")
    brief.add_argument("--voice", default="", help="voice name for the speech engine")
    brief.set_defaults(func=cmd_brief)

    feed = sub.add_parser("feed", help="write a podcast RSS feed for out/")
    feed.add_argument("--base-url", required=True,
                      help="public URL the audio files are served from")
    feed.set_defaults(func=cmd_feed)

    site = sub.add_parser("site", help="build the installable app in site/")
    site.add_argument("--site", default=str(ROOT / "site"))
    site.add_argument("--template", default=str(DEFAULT_TEMPLATE))
    site.add_argument("--count", type=int, default=8)
    site.add_argument("--seed", default="v1")
    site.add_argument("--base-url", default="",
                      help="public URL, needed only for the podcast feed")
    site.set_defaults(func=cmd_site)

    check = sub.add_parser("check", help="validate the watchlist")
    check.add_argument("--count", type=int, default=8)
    check.set_defaults(func=cmd_check)

    listing = sub.add_parser("list", help="print the watchlist")
    listing.add_argument("--program", help="yc, speedrun, hf0, spc, breakout")
    listing.set_defaults(func=cmd_list)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
