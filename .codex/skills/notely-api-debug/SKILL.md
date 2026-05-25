---
name: notely-api-debug
description: Use this for debugging and patching Notely API routes with minimal blast radius.
---

# Notely API debug workflow

## Goal
Fix API route issues quickly and safely.

## Rules
- Prefer route-local fixes before broader refactors
- Preserve response shape unless explicitly changing contract
- Respect auth, owner scoping, plan gating, and quota behavior
- Avoid schema changes unless explicitly requested
- Reuse existing helpers for auth/session/Supabase access

## Process
1. Identify failing route and exact symptom
2. Trace auth/session, input validation, data access, and response shape
3. Patch the smallest safe file set
4. Verify with the smallest relevant smoke test
5. Call out any remaining risk clearly

## Focus areas
- app/api/generate-question/route.ts
- app/api/evaluate/route.ts
- app/api/oral/**/*
- app/api/files/**/*
- app/api/notes/**/*
- lib/auth/**/*
- lib/retrieval/**/*

## Preferred output
- Root cause
- Exact files changed
- Why the bug happened
- PowerShell smoke commands