"""Turn written text into something a speech engine reads correctly.

The watchlist is written to be spoken, but hand-added entries usually are not:
people paste "$27M ARR (YC W26)" and a TTS voice reads it as "dollar twenty
seven M A R R". Everything here exists to stop that.
"""

from __future__ import annotations

import re

# Read as-is; a voice handles these letter-by-letter and that is what we want.
_ACRONYMS_OK = {"AI", "API", "SDK", "CEO", "CTO", "MRI", "SaaS", "B2B", "IP", "OS"}

_PHRASES = [
    (r"\bYC\b", "Y Combinator"),
    (r"\ba16z\b", "Andreessen Horowitz"),
    (r"\bARR\b", "annual recurring revenue"),
    (r"\bMRR\b", "monthly recurring revenue"),
    (r"\bDAUs?\b", "daily active users"),
    (r"\bMAUs?\b", "monthly active users"),
    (r"\bMoM\b", "month over month"),
    (r"\bYoY\b", "year over year"),
    (r"\bWoW\b", "week over week"),
    (r"\bSMR\b", "small modular reactor"),
    (r"\bSAFE\b", "safe note"),
    (r"\bpre-seed\b", "pre seed"),
    (r"\bW(\d\d)\b", r"Winter 20\1"),
    (r"\bS(\d\d)\b", r"Summer 20\1"),
    (r"\bSeries ([A-G])\b", r"Series \1"),
    (r"&", " and "),
    (r"\s*/\s*", " / "),
]

_SCALES = [("T", "trillion"), ("B", "billion"), ("M", "million"), ("K", "thousand")]

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
         "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
         "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
         "eighty", "ninety"]


def _small_number(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, ones = divmod(n, 10)
        return _TENS[tens] + (f"-{_ONES[ones]}" if ones else "")
    hundreds, rest = divmod(n, 100)
    out = f"{_ONES[hundreds]} hundred"
    return out + (f" and {_small_number(rest)}" if rest else "")


def spell_number(value: float) -> str:
    """Spell a modest number in words; fall back to digits when it gets silly."""
    if value != int(value):
        whole, frac = str(round(value, 2)).split(".")
        return f"{spell_number(int(whole))} point {' '.join(_ONES[int(d)] for d in frac)}"
    n = int(value)
    if n < 0:
        return "minus " + spell_number(-n)
    if n < 1000:
        return _small_number(n)
    return f"{n:,}"


def _money(match: re.Match[str]) -> str:
    amount = float(match.group(1))
    suffix = (match.group(2) or "").upper()
    scale = next((word for letter, word in _SCALES if letter == suffix), "")
    words = spell_number(amount)
    return f"{words} {scale} dollars".replace("  ", " ") if scale else f"{words} dollars"


def _bare_scaled(match: re.Match[str]) -> str:
    amount = float(match.group(1))
    scale = next(word for letter, word in _SCALES if letter == match.group(2).upper())
    return f"{spell_number(amount)} {scale}"


def speakable(text: str) -> str:
    """Normalise `text` for a text-to-speech voice."""
    out = text.strip()
    out = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", out)          # markdown links
    out = re.sub(r"https?://\S+", "", out)                        # bare urls
    out = re.sub(r"[*_`#>]", "", out)                             # markdown noise
    out = re.sub(r"\$\s?([\d.]+)\s?([TBMK])?\b", _money, out, flags=re.I)
    out = re.sub(r"\b([\d.]+)\s?([TBMK])\b(?!\w)", _bare_scaled, out)
    out = re.sub(r"\b([\d.]+)%", lambda m: f"{spell_number(float(m.group(1)))} percent", out)
    for pattern, replacement in _PHRASES:
        out = re.sub(pattern, replacement, out)
    # "$24M seed" reads as "twenty-four million dollar seed", not "dollars seed".
    out = re.sub(r"\bdollars (?=(seed|round|valuation|cheque|check|deal|Series)\b)",
                 "dollar ", out)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\s+([,.;:!?])", r"\1", out)
    return out.strip()


def sentences(text: str) -> list[str]:
    """Split into speakable chunks. Long utterances get truncated by browsers."""
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]


def estimate_seconds(text: str, words_per_minute: int = 155) -> int:
    words = len(text.split())
    return max(1, round(words / words_per_minute * 60))
