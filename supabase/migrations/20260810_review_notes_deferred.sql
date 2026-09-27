-- "Deferred" as a third state for TODO-kind review_notes, distinct from
-- "Resolved" (is_done alone) — set aside for later without pretending it was
-- actually finished. Deferring also sets is_done=true (see the PATCH route)
-- so a deferred item drops out of every existing ?done=false query (the
-- backlog's open list, /work-todos itself) with no change needed to any
-- read/filter path — is_deferred only exists to distinguish "why" a note
-- left the open queue, for display purposes.

alter table review_notes
    add column if not exists is_deferred boolean not null default false;
