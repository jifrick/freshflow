# FreshFlow

FreshFlow helps food suppliers identify inventory that needs a decision, match it with published buyer requirements, compare the economics of feasible actions, and record completed outcomes.

## Requirements

- Node.js 24 (Node 20.19+ should also work with the pinned Vite version).
- npm 11.
- A Supabase project for Google sign-in and shared, database-backed use.
- Supabase CLI and Docker only when running the local database.

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Without Supabase values, the app opens in **Workspace preview** mode. Its seeded produce and buyer records are examples; browser changes are saved locally and do not represent real users, offers, purchases, or recovered food. Configure a Supabase project to use live accounts and shared records.

## Supabase setup

1. Create a Supabase project and copy its Project URL and publishable key into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are browser-safe values; never use a service-role/secret key in this app.
2. In Supabase Auth, enable Google and add `http://localhost:5173` to the allowed redirect URLs. The Google OAuth client ID and secret stay in Supabase Auth provider settings.
3. Apply the migration with the Supabase CLI:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   For a local Supabase stack, use `npx supabase start` followed by `npx supabase db reset`.
4. Restart the Vite dev server after changing `.env.local`.

The migrations explicitly enable RLS and grant only needed Data API privileges. The schema is already applied to the connected Supabase project named `freshflow`; no application rows were seeded. Users can manage their own records; published inventory and requirements are discoverable by signed-in users. Seller approval submits an offer. A separate buyer acceptance atomically reserves stock and creates the transaction. A seller records completion after handover. Estimated or unknown costs are not treated as zero.

## Commands

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

The RLS integration test is skipped unless all of these are set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `TEST_USER_A_ACCESS_TOKEN`, and `TEST_USER_B_ACCESS_TOKEN`. Use two isolated test users in a non-production project. The concurrency test also needs `TEST_SUPABASE_SERVICE_ROLE_KEY` only for cleanup. It creates a unique one-kilogram batch and two buyer offers, accepts them concurrently, and verifies exactly one acceptance reserves the stock. Never use production users or data for integration tests.

## Current scope

- Built: responsive workspace, English/Malayalam language selector, inventory and demand forms, transparent matching/risk rules, deterministic cost comparison, offer approval, buyer acceptance, transaction handover recording, Supabase Google OAuth client flow, ownership RLS, and migration-backed database operations.
- Preview-only: local sample data and sandbox workflow; it is clearly labeled and is not a real marketplace.
- Not implemented: operational partner integrations, donation verification, real transport quotes, forecasting, photo/AI extraction, payments, admin workflows, production-validated freshness rules, comprehensive Malayalam translations, and user-facing controls to unpublish/edit existing records.
- Google OAuth provider setup and live database validation require credentials/configuration from the project owner.
