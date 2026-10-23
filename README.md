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

1. Use the existing Supabase project and copy its Project URL and publishable key into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. These are browser-safe values; never use a service-role/secret key in this app.
2. Preserve the existing Google Cloud OAuth client. In Supabase Auth > Sign In / Providers > Google, configure that client's ID and secret. Keep the secret in Supabase's provider configuration, never in `VITE_*` variables.
3. In Google Cloud, the authorized redirect URI must exactly match the callback shown by the Supabase Google provider settings. For the current project's default Supabase URL, it is expected to be `https://debfmpbbfkslrfsqmdqy.supabase.co/auth/v1/callback`; confirm the provider page displays this URI before changing Google Cloud. The application redirect is a separate setting: add `http://localhost:5173` and the verified production app origin to Supabase Auth's redirect URL allow list. `src/App.tsx` sends users back to the app's current origin after Supabase completes OAuth.
4. Keep any existing Cloudflare role and configuration. This repository has no Cloudflare/Wrangler or Vercel deployment files, and no Cloudflare account connection was available to inspect DNS, proxying, or hosting. No hosting or DNS migration is configured here.
5. Apply outstanding migrations with the Supabase CLI:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   For a local Supabase stack, use `npx supabase start` followed by `npx supabase db reset`.
6. Restart the Vite dev server after changing `.env.local`.

The migrations explicitly enable RLS and grant only needed Data API privileges. The schema and private `inventory-photos` Storage bucket are applied to the connected Supabase project named `freshflow`; no application rows or photos were seeded. Photos are private, limited to JPG/PNG/WebP up to 5 MB, and stored under the signed-in owner's folder. Users can manage their own records; published inventory and requirements are discoverable by signed-in users. Seller approval submits an offer. A separate buyer acceptance atomically reserves stock and creates the transaction. A seller records completion after handover. Estimated or unknown costs are not treated as zero.

## Commands

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

The RLS/Storage integration tests are skipped unless all of these are set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `TEST_USER_A_ACCESS_TOKEN`, and `TEST_USER_B_ACCESS_TOKEN`. Use two isolated test users in a non-production project. The concurrency test also needs `TEST_SUPABASE_SERVICE_ROLE_KEY` only for cleanup. It creates a unique one-kilogram batch and two buyer offers, accepts them concurrently, and verifies exactly one acceptance reserves the stock. Storage coverage uploads a tiny test image and confirms another user cannot read it. Never use production users or data for integration tests.

## Current scope

- Built: responsive workspace, English/Malayalam language selector, inventory and demand forms, private inventory photo uploads through Supabase Storage, transparent matching/risk rules, deterministic cost comparison, offer approval, buyer acceptance, transaction handover recording, Supabase Google OAuth client flow, ownership RLS, and migration-backed database operations.
- Preview-only: local sample data and sandbox workflow; it is clearly labeled and is not a real marketplace.
- Not implemented: operational partner integrations, donation verification, real transport quotes, forecasting, photo/AI extraction, payments, admin workflows, production-validated freshness rules, comprehensive Malayalam translations, and user-facing controls to unpublish/edit existing records.
- Google Cloud and Supabase provider settings could not be inspected from this session; OAuth client/secret preservation and redirect URI equality remain unverified. Live sign-in, Storage RLS, and two-user database validation require existing provider setup and two isolated test accounts.
