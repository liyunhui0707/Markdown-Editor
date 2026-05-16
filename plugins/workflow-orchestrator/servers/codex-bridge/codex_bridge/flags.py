"""Canonical and forbidden Codex CLI flags.

CANONICAL lists the flag NAMES the bridge always passes (values are filled in
by argv.build_codex_argv). DENYLIST blocks any flag a caller could try to
sneak in via extra_args. The bypass flag is the only entry today; keep this
list narrow.
"""

CANONICAL: frozenset[str] = frozenset(
    {
        "--ask-for-approval",
        "--cd",
        "--sandbox",
        "--output-schema",
        "--output-last-message",
    }
)

DENYLIST: frozenset[str] = frozenset(
    {
        "--dangerously-bypass-approvals-and-sandbox",
    }
)
