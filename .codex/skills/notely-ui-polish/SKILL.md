---
name: notely-ui-polish
description: Use this for focused UI polish in Notely pages and components without broad refactoring.
---

# Notely UI polish workflow

## Goal
Make small, safe UI improvements in Notely without breaking working flows.

## Rules
- Prefer minimal visual changes
- Do not refactor architecture unless required by the bug
- Preserve Danish UI copy unless a clearer Danish phrasing is needed
- Reuse existing components and spacing patterns
- Keep desktop stable and avoid mobile regressions

## Process
1. Identify the smallest file set needed
2. Explain root cause briefly
3. Apply the smallest safe patch
4. Verify visually affected states:
   - loading
   - empty state
   - error state
   - mobile layout if relevant
5. Run the smallest relevant check

## Typical files
- app/traener/**/*
- app/notes/**/*
- components/**/*
- app/_ui/**/*

## Preferred output
- Root cause
- Files changed
- Before/after behavior
- PowerShell verification commands