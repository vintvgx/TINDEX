-- Freeform notes/TODOs pinned to a specific Daily Review date. Independent
-- of performance_reviews (and its paper_mode split) — these are general
-- app/project notes ("add functionality to X"), not account-specific trade
-- commentary, so a single note applies regardless of which account mode the
-- calendar happens to be showing.

create table if not exists review_notes (
    id          uuid primary key default gen_random_uuid(),
    note_date   date not null,
    kind        text not null check (kind in ('note', 'todo')),
    content     text not null,
    is_done     boolean not null default false,   -- todo only; ignored for note
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists idx_review_notes_date on review_notes (note_date);
create index if not exists idx_review_notes_kind_done on review_notes (kind, is_done);
