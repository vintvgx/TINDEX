-- Migration: AI Agent (TINDEX assistant) persistence tables
-- Description: Conversations + messages for the in-app AI chat, plus per-contract
--              AI scores. The mobile app reads these tables directly (RLS-scoped to
--              the owning user); the Railway backend writes to them with the service
--              role key (which bypasses RLS).

BEGIN;

-- ── Conversations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker     TEXT,                       -- optional context ticker the chat was opened with
  title      TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_conversations_user_updated_idx
  ON ai_conversations (user_id, updated_at DESC);

-- ── Messages ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
  ON ai_messages (conversation_id, created_at ASC);

-- ── Contract scores ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_contract_scores (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tracked_contract_id UUID,
  ticker              TEXT NOT NULL,
  contract_symbol     TEXT NOT NULL,
  score               INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  signal              TEXT NOT NULL CHECK (signal IN ('STRONG_BUY','BUY','HOLD','SELL','STRONG_SELL')),
  reasoning           TEXT NOT NULL DEFAULT '',
  factors             JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_contract_scores_user_created_idx
  ON ai_contract_scores (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_contract_scores_tracked_idx
  ON ai_contract_scores (tracked_contract_id);

-- ── Row Level Security ───────────────────────────────────────────────────────────
-- Service-role writes from the backend bypass RLS; these policies just let each
-- authenticated user read (and clean up) their own rows from the mobile client.
ALTER TABLE ai_conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_contract_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_conversations_owner ON ai_conversations;
CREATE POLICY ai_conversations_owner ON ai_conversations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ai_messages_owner ON ai_messages;
CREATE POLICY ai_messages_owner ON ai_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = ai_messages.conversation_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ai_contract_scores_owner ON ai_contract_scores;
CREATE POLICY ai_contract_scores_owner ON ai_contract_scores
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMIT;
