import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Environment variables type definition
interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  OPENAI_API_KEY: string
  NEWS_API_KEY: string
}

// Create a type-safe environment configuration
const env: Env = {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL') ?? '',
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  OPENAI_API_KEY: Deno.env.get('OPENAI_API_KEY') ?? '',
  NEWS_API_KEY: Deno.env.get('NEWS_API_KEY') ?? ''
}

// Validate required environment variables
const requiredEnvVars: (keyof Env)[] = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'NEWS_API_KEY'
]

for (const key of requiredEnvVars) {
  if (!env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

// Create and export the Supabase client
export const supabase = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

// Export environment variables for other functions to use
export { env } 