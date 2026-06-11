# ADR-011 — Supabase backend for cloud sync

**Status:** Accepted · 2026-06-11

## Context
ADR-003 needs: Apple/Google auth, blob storage, a metadata table, row-level security, account deletion — and nothing else for years. Solo maintainer; ops budget ≈ zero.

## Decision
Supabase: Auth (Sign in with Apple + Google), Storage (save blobs, user-scoped paths), Postgres (`cities` metadata: cityId, generation, simVersion, thumbnail, updatedAt) with RLS per-user, one edge function for account-deletion cascade. Sync client lives in `packages/backend`; **the rest of the app must not know Supabase exists** (interface in protocol terms) [binding] — swap-out stays a weekend, not a rewrite.

## Consequences
- Auth+storage+DB+RLS in days of work; free tier covers beta, costs scale gently; open-source/self-hostable hedge against vendor risk.
- Postgres ready for Level 2 (sharing/leaderboards) without re-platforming.
- We accept: vendor dependency (hedged above), store-compliance work (privacy policy, deletion flow) which any account system costs.

## Alternatives
- Firebase: equivalent capability; rejected on lock-in (no self-host hedge) + Postgres being more useful later than Firestore.
- CloudKit: free + native; rejected — iOS-only, breaks Android/web sync.
- Custom server: rejected — undifferentiated ops for a solo dev; revisit only at Level 2 scale if economics demand.
