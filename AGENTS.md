# AGENTS.md

## Project
Notely v2 is a Danish study platform built with Next.js 15 App Router, Supabase, and OpenAI models.
The product is in a stabilization and launch phase. Prefer robust, minimal-risk changes over ambitious rewrites.

## Core priorities
1. Do not break existing working flows.
2. Prefer small, focused patches.
3. Keep desktop stable; mobile can be simpler, but should not regress.
4. Preserve Danish UX copy unless a clearer Danish formulation is needed.
5. Favor practical completion over architectural perfection.

## Stack and conventions
- Framework: Next.js 15 App Router
- Backend/data: Supabase
- Dev environment: Windows + PowerShell
- Typical commands are PowerShell-friendly
- Prefer existing helpers and patterns over introducing new abstractions
- Avoid adding dependencies unless clearly necessary

## Auth and session conventions
- Reuse the project’s existing auth/session helpers and established patterns
- Be careful with SSR/session handling and preview-vs-prod differences
- Do not replace working auth flows unless explicitly requested

## UI conventions
- UI text is Danish by default
- Tone: calm, clear, trustworthy, not hype
- Prefer minimal visual changes unless the task is explicitly about UI polish
- Keep section-specific UI behavior isolated to the relevant section/page

## API and data conventions
- Preserve owner scoping and plan/quota enforcement
- Avoid schema changes unless explicitly required
- Prefer backwards-compatible route changes
- When changing retrieval/evaluation behavior, preserve existing contracts used by the UI

## Retrieval conventions
- Canonical scoring import:
  import { applyAcademicDanishScoring } from '@/lib/retrieval/score';
- Keep retrieval/scoring logic in the retrieval layer, not scattered through route handlers

## Coding style
- Make the smallest safe change that solves the task
- Reuse existing components/helpers before creating new ones
- Do not rename files, move folders, or restructure imports unless necessary
- Keep patches easy to review

## Testing and verification
After code changes, prefer running the smallest relevant checks first.
Use PowerShell commands where possible.

Typical checks:
- npm run build
- npm run lint
- npm run typecheck

For targeted work, also suggest the smallest relevant smoke test.

## Output expectations
When proposing a fix:
1. State root cause briefly
2. List exact files changed
3. Explain before/after behavior
4. Give copy/paste-friendly PowerShell commands when relevant

## Review guidelines
- Watch for regressions in auth, quota, uploads, trainer, oral exam, notes, and overview flows
- Check owner scoping and plan enforcement
- Check that user-facing Danish text remains coherent
- Flag risky multi-file rewrites when a smaller patch would work
- Treat broken auth/session handling, plan leaks, or data-scope bugs as high priority

## What to avoid
- No broad rewrites unless explicitly requested
- No speculative refactors
- No unnecessary new dependencies
- No English UI copy in Danish user flows unless explicitly requested
- Do not “improve” architecture at the cost of shipping velocity

## Preferred working style
- Think in concrete patches
- Prefer step-by-step PowerShell instructions
- For larger multi-file tasks, propose a Codex-driven workflow with clear file targets