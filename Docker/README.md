# Docker

This folder contains everything needed to build and run `ForgeLab` in Docker.

## Files

- `Dockerfile`: multi-stage production image for Next.js standalone output
- `compose.yaml`: optional local container runner
- `.env.docker.example`: environment variable template

## Build the image

Run this from the project root:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=your-supabase-url \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key \
  -f Docker/Dockerfile \
  -t forgelab .
```

PowerShell version:

```powershell
docker build `
  --build-arg NEXT_PUBLIC_SUPABASE_URL=your-supabase-url `
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key `
  -f Docker/Dockerfile `
  -t forgelab .
```

## Run the container directly

```bash
docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=your-supabase-url \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key \
  -e OPENAI_API_KEY=your-openai-api-key \
  -e OPENAI_MODEL=gpt-5-mini \
  forgelab
```

PowerShell version:

```powershell
docker run --rm -p 3000:3000 `
  -e NEXT_PUBLIC_SUPABASE_URL=your-supabase-url `
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key `
  -e OPENAI_API_KEY=your-openai-api-key `
  -e OPENAI_MODEL=gpt-5-mini `
  forgelab
```

## Run with Docker Compose

1. Copy `Docker/.env.docker.example` to `Docker/.env.docker.local`
2. Fill in your real keys
3. Start it:

```bash
docker compose -f Docker/compose.yaml up --build
```

## Notes

- The container serves the app on port `3000`
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be present at build time and runtime
- `OPENAI_API_KEY` and `OPENAI_MODEL` are still runtime environment variables
- The build uses Next.js `standalone` output to keep the runtime image smaller
