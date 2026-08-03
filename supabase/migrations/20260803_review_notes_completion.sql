-- Completion trail for TODO-kind review_notes, so Claude Code (or anyone)
-- can record what changed and when a TODO was actually resolved, instead of
-- just flipping is_done with no record of the work done.

alter table review_notes
    add column if not exists completion_note text,
    add column if not exists completed_at    timestamptz;
