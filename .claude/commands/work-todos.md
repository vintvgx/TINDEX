---
description: Pull open TODOs from the Daily Review backlog and implement them
---

Work through open TODOs from the app's Daily Review backlog (the `review_notes`
Supabase table, `kind = 'todo'`). Each TODO's `content` is a freeform request
written by the user (e.g. "add functionality to X") — treat it as a real task
description, not a code comment.

Arguments: `$ARGUMENTS` — optional. A specific note id to work on, or a
keyword/filter to narrow which open TODOs to pick up. If empty, work through
all open TODOs one at a time, most recently created first.

## Base URL

Use the Railway backend the app is currently pointed at — check the
`ENVIRONMENT` constant in `mobile/lib/railway.config.ts` and use the matching
URL from `RAILWAY_URLS` (engineering: `https://alethia-test-eng.up.railway.app`,
production: `https://alethia-production.up.railway.app`). This is a
single-tenant personal app with no auth, so plain `curl` against these routes
works with no headers beyond `Content-Type: application/json`.

## Steps, per TODO

1. **Fetch open TODOs:**
   `curl "$BASE_URL/review/notes?kind=todo&done=false"`
   Filter/select by `$ARGUMENTS` if given.

2. **Understand the request.** Read `content`. If it's ambiguous or you
   genuinely cannot tell what's being asked, skip it and say so in your final
   summary rather than guessing at something destructive or wide-reaching.

3. **Implement it** using your normal engineering judgment — read the
   relevant code first, make the smallest correct change, follow existing
   patterns in the touched files. Don't expand scope beyond what the TODO
   asks for.

4. **Verify.** Run whatever is appropriate for what you touched (typecheck,
   relevant tests, lint). Don't mark a TODO done on unverified code.

5. **Record completion.** PATCH the note with what changed and mark it done:
   ```
   curl -X PATCH "$BASE_URL/review/notes/<id>" \
     -H "Content-Type: application/json" \
     -d '{"is_done": true, "completion_note": "<2-4 sentence summary of what changed, key files touched, and any caveats>"}'
   ```
   The server stamps `completed_at` automatically — don't try to set it
   yourself. Write `completion_note` for the user's future self: what
   changed and why, not a restatement of the TODO text.

6. If a TODO turns out to be too large/ambiguous to safely complete
   autonomously, leave it open (don't PATCH `is_done`) and flag it clearly in
   your final summary instead of forcing a half-finished change through.

## When done

Report a short summary: which TODOs were completed (with their
`completion_note`), which were skipped and why, and whether anything needs
the user's review (e.g. a schema change, a destructive-looking request, or
tests you couldn't run).
