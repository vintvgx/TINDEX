-- Pre-market "Market Digest" — one row per trading day, generated ~8:30 AM
-- ET before the open. Unlike performance_reviews (markdown, one blob), this
-- is structured JSON so the mobile app can render distinct typed slides
-- (stat tiles, charts, headline cards) in the full-screen story modal
-- instead of parsing markdown at display time.
create table if not exists market_digests (
    id           uuid primary key default gen_random_uuid(),
    digest_date  date not null unique,
    content_json jsonb not null,   -- see MarketDigestGenerator for the slide schema
    created_at   timestamptz default now()
);

create index if not exists idx_market_digests_date
    on market_digests (digest_date desc);
