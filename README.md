This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## OpenAI Model Configuration

`.env.local` er source of truth for feature -> model mapping.

- `OPENAI_MODEL` (global fallback)
- `OPENAI_MODEL_TRAINER`
- `OPENAI_MODEL_SIMULATOR`
- `OPENAI_MODEL_ORAL`
- `OPENAI_MODEL_ORAL_QUESTION`
- `OPENAI_MODEL_ORAL_EVAL`
- `OPENAI_MODEL_WEAKNESS`
- `OPENAI_MODEL_NOTES`
- `OPENAI_MODEL_MC`
- `OPENAI_MODEL_FLASHCARDS`
- `OPENAI_MODEL_GENERATE_QUESTION`
- `OPENAI_TRANSCRIBE_MODEL`
- `OPENAI_TTS_MODEL`

Routes kalder et centralt compatibility layer i `lib/openai/buildRequest.ts`:

- `resolveModelForFeature(feature)` vælger model ud fra env + fallback.
- `sanitizeOpenAIPayload(model, payload)` fjerner model-inkompatible felter (fx sampling-params for GPT-5).
- `createChatCompletion(...)` anvender disse regler ét sted og logger dev-only:
  - feature
  - resolved model
  - fjernede payload-felter
