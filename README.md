# Endless Alchemy Lab

A shared web-based alchemy game built with Next.js, Supabase, and OpenAI.

## What it does

- Starts every player with `Earth`, `Air`, `Water`, and `Fire`
- Includes a large built-in recipe book so most early and mid-game combinations are instant
- Only calls Supabase when a combination is not already known locally
- Checks the shared Supabase table before generating anything new
- Uses OpenAI structured JSON output for brand-new combinations
- Saves new combinations back to Supabase so discoveries become globally shared
- Celebrates new discoveries with a full-screen reveal

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy [`.env.example`](/C:/Users/bkushio/OneDrive%20-%20Granite%20School%20District/Documents/codex/.env.example) to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional, defaults to `gpt-5-mini`)

3. In Supabase SQL editor, run [schema.sql](/C:/Users/bkushio/OneDrive%20-%20Granite%20School%20District/Documents/codex/supabase/schema.sql)

4. Start the app:

```bash
npm run dev
```

## OpenAI notes

The API route uses the Responses API with JSON schema output so generated results are constrained to:

```json
{
  "emoji": "⛰️",
  "element": "Mountain"
}
```

The route then sanitizes the output again and keeps only a single emoji grapheme before saving it.

Official references:

- [Responses API](https://platform.openai.com/docs/api-reference/responses)
- [Structured outputs](https://platform.openai.com/docs/guides/structured-outputs)

## Gameplay controls

- Double-click an element in the left panel to add it to the workbench
- Drag one workbench item on top of another to combine them
- Use `Clear workstation` to remove only the current board items
- Use `Start over` to reset discoveries back to the four starters

## Architecture

- [app/api/combine/route.ts](/C:/Users/bkushio/OneDrive%20-%20Granite%20School%20District/Documents/codex/app/api/combine/route.ts): cache-first combination resolution
- [components/game.tsx](/C:/Users/bkushio/OneDrive%20-%20Granite%20School%20District/Documents/codex/components/game.tsx): client gameplay loop and drag/drop workbench
- [lib/predefined-elements.ts](/C:/Users/bkushio/OneDrive%20-%20Granite%20School%20District/Documents/codex/lib/predefined-elements.ts): starter elements and built-in recipes
