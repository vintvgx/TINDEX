-- AI Agent: Conversations, Messages, Contract Scores

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ticker TEXT,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Soft reference to tracked_option_contracts (no FK to avoid coupling with Railway-managed tables)
CREATE TABLE IF NOT EXISTS ai_contract_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tracked_contract_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  contract_symbol TEXT NOT NULL,
  score INTEGER CHECK (score >= 0 AND score <= 100),
  signal TEXT CHECK (signal IN ('STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL')),
  reasoning TEXT NOT NULL,
  factors JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS ai_conversations_user_id_idx ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS ai_conversations_updated_at_idx ON ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_id_idx ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS ai_messages_created_at_idx ON ai_messages(created_at);
CREATE INDEX IF NOT EXISTS ai_contract_scores_user_id_idx ON ai_contract_scores(user_id);
CREATE INDEX IF NOT EXISTS ai_contract_scores_tracked_id_idx ON ai_contract_scores(tracked_contract_id);

-- Auto-update updated_at on ai_conversations
CREATE OR REPLACE FUNCTION update_ai_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE ai_conversations SET updated_at = NOW() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_messages_update_conversation_timestamp
  AFTER INSERT ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION update_ai_conversations_updated_at();

-- Row Level Security
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_contract_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own conversations"
  ON ai_conversations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their conversation messages"
  ON ai_messages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE id = ai_messages.conversation_id AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations
      WHERE id = ai_messages.conversation_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage their contract scores"
  ON ai_contract_scores FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
