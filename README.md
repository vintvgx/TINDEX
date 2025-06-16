# Blog Generator Project

AI-powered blog generation app with React Native frontend and Supabase backend.

## Project Structure

```
blog-generator-project/
├── mobile/          # React Native app
├── supabase/        # Backend functions & database
├── shared/          # Shared types & constants
└── package.json     # Root scripts
```

## Quick Start

```bash
# Install dependencies
npm run setup

# Start development
npm run dev

# Mobile development
npm run mobile:android
npm run mobile:ios

# Backend development
npm run supabase:start
npm run supabase:deploy
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Add your API keys:
   - Supabase project credentials
   - OpenAI API key
   - News API key
   - SERP API key

## Development Workflow

1. **Backend Changes**: Work in `supabase/`
2. **Mobile Changes**: Work in `mobile/`
3. **Shared Types**: Update `shared/types.ts`
4. **Deploy Backend**: `npm run supabase:deploy`
5. **Build Mobile**: `npm run mobile:android`

## Tech Stack

- **Frontend**: React Native + TypeScript
- **Backend**: Supabase Edge Functions
- **Database**: PostgreSQL (Supabase)
- **AI**: OpenAI GPT-4
- **State**: Redux Toolkit
- **Navigation**: React Navigation
