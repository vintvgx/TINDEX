# ===========================================
# STEP 7: LOCAL DEVELOPMENT COMMANDS
# ===========================================

# Start local Supabase (runs database + edge functions locally)
supabase start

# Serve functions locally for testing
supabase functions serve --env-file .env.local

# Test your function locally
curl -X POST 'http://localhost:54321/functions/v1/generate-blog-post' \
  -H 'Authorization: Bearer YOUR_SUPABASE_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "topicId": "some-uuid",
    "userId": "some-user-uuid",
    "targetLength": 800
  }'

# ===========================================
# STEP 8: DEPLOYMENT COMMANDS
# ===========================================

# Deploy database changes
supabase db push

# Deploy edge functions
supabase functions deploy

# Deploy specific function
supabase functions deploy generate-blog-post

# Set production environment variables
supabase secrets set OPENAI_API_KEY=your_actual_key
supabase secrets set NEWS_API_KEY=your_actual_key
supabase secrets set SERP_API_KEY=your_actual_key


# ===========================================
# STEP 11: TESTING SETUP
# ===========================================

# Add some sample data
cat > supabase/seed.sql << 'EOF'
-- Insert sample topics
INSERT INTO topics (id, name, description, category) VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'Artificial Intelligence', 'Latest developments in AI technology', 'Technology'),
  ('550e8400-e29b-41d4-a716-446655440001', 'Climate Change', 'Environmental updates and climate science', 'Environment'),
  ('550e8400-e29b-41d4-a716-446655440002', 'Space Exploration', 'Latest space missions and discoveries', 'Science'),
  ('550e8400-e29b-41d4-a716-446655440003', 'Renewable Energy', 'Clean energy innovations and trends', 'Technology'),
  ('550e8400-e29b-41d4-a716-446655440004', 'Digital Marketing', 'Marketing trends and strategies', 'Business');
EOF

# Apply seed data
supabase db reset --with-seed


# ================
# Set secrets in Supabase from local env 
# ================
npx supabase secrets set SUPABASE_URL=https://djpgoofhctzmbgcuxdqr.supabase.co
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqcGdvb2ZoY3R6bWJnY3V4ZHFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTAwMzI2MDgsImV4cCI6MjA2NTYwODYwOH0
npx supabase secrets set OPENAI_API_KEY=your_key
npx supabase secrets set NEWS_API_KEY=your_key



# =======================
#
#
# Run supabase functions with the defined environemtn vars 
#
# ===========
npx supabase functions serve generate-blog-post --env-file .env
