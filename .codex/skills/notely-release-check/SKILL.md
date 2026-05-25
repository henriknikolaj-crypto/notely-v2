---
name: notely-release-check
description: Use this before merging or deploying Notely changes to run a practical release-risk pass.
---

# Notely release check workflow

## Goal
Do a practical pre-merge or pre-release pass focused on regressions.

## Checklist
- Auth/session still works
- Plan gating still works
- Quota usage still updates correctly
- Upload/import still works
- Trainer/generate/evaluate flows still work
- Notes and overview pages still render correctly
- Mobile did not regress for touched flows
- No accidental English copy in Danish UI paths

## Commands
Prefer PowerShell-friendly commands.

Typical checks:
- npm run build
- npm run lint
- npm run typecheck

If a route was changed, suggest one targeted smoke test.

## Review priority
Flag these as high priority:
- broken auth/session
- owner-scope leaks
- plan/quota bypass
- broken core study flows
- silent API failures

## Preferred output
- Release risk summary
- Blocking vs non-blocking findings
- Exact commands to run