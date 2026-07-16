"""
"Parse for" keyword filtering — docs/features/social-signal-contracts.md §4.

Case-insensitive substring match against a normalized copy of both the tweet
text and each configured phrase, so minor formatting drift (e.g. "$1,000" vs
"$1000") doesn't cause a false negative on an otherwise-matching phrase.
Deliberately plain substring matching, not fuzzy/semantic — these are
verbatim phrases a given account uses consistently, not natural-language
queries.
"""

import re


def _normalize(text: str) -> str:
    text = text.lower()
    text = text.replace("$", "").replace(",", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def matches(tweet_text: str, keywords: list[str]) -> bool:
    """
    True if `tweet_text` contains any of `keywords` (normalized substring
    match). An empty/unset keyword list means "parse everything" — the
    default for a freshly-followed account with no phrases configured yet.
    """
    if not keywords:
        return True
    normalized_text = _normalize(tweet_text)
    return any(_normalize(kw) in normalized_text for kw in keywords if kw.strip())
