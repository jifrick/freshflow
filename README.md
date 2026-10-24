# FreshFlow

FreshFlow helps fresh food suppliers identify stock that needs attention, discover relevant buyer demand, compare feasible actions, and record outcomes. The startup showcase opens on a public landing page and includes a deterministic, local-only demo scenario. The demo requires no account or Supabase configuration.

## Run locally

Requirements: Node.js 20.19+ and npm.

```powershell
npm install
npm run dev
```

Open the Vite URL. Choose **Explore the interactive demo** to enter the sample workflow. Sample inventory, requirements, offers, and outcomes stay in the browser and are visibly marked as demo. Demo actions do not write to Supabase. **Restart demo** restores the initial scenario.

To present the review workflow, choose **Preview simulated admin review** in the landing page footer. Approve/reject confirmations affect only the sample queue. No real listing is published.

An optional live workspace requires valid Supabase public configuration and an authenticated account. Choose **Existing account? Continue to live sign-in** from the landing page. Without Supabase configuration, the live path remains unavailable; the public demo still works. Demo and live records are cleared from the in-memory workspace when switching into live sign-in.

## Supabase live mode

1. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using browser-safe project values. Never use a service-role or secret key in this Vite application.
2. Configure the existing Google OAuth client in Supabase Auth. Keep the OAuth secret in Supabase's provider configuration. Confirm the provider callback and add the local and approved production app origins to Supabase Auth's redirect allow list.
3. The repository preserves Cloudflare as the intended hosting direction. It currently contains no Cloudflare Pages, Workers, or Wrangler deployment configuration. Inspect the existing Cloudflare account and deployment before adding hosting files or changing DNS.
4. The previously observed remote history contained four migration versions through `20261023210157`, while the local photo migration is named `20261024000100`. Their deployed SQL equivalence has not been established, so the mismatch remains unresolved and neither migration file should be replayed or renamed as a reconciliation. `20261024000200_mvp_integrity.sql` is new and has **not** been applied or PostgreSQL-validated. First compare the remote migration ledger and deployed objects with the local photo migration, then validate the additive migration against an isolated database matching the remote schema. Do not reset production or run `db push` until that review is complete.

The private inventory photo bucket and RLS-based application schema remain part of the Supabase architecture. The pending integrity migration adds seller-cost isolation and review RPCs that check the trusted JWT `app_metadata.role = admin` claim. Client visibility is only a convenience; the database RPC makes the authorization decision.

### Admin review setup (live mode)

The public **Preview simulated admin review** link is local-only and never publishes an inventory batch. The live admin screen appears only when the authenticated session carries the trusted admin claim, and the database still enforces it on each call.

Before enabling live review:

1. Validate `20261024000200_mvp_integrity.sql` on an isolated database matching the deployed schema. The migration is not applied or PostgreSQL-validated from this workspace.
2. Apply it through the reviewed Supabase migration process only after inspecting the migration history. It changes seller publish requests into `pending_review` submissions and removes direct client write access to `is_published`.
3. Provision the designated administrator through a trusted server-side Supabase Auth Admin API operation that sets `app_metadata.role` to `admin`. Never set an admin role in user-editable `user_metadata`, frontend code, or a `VITE_*` variable. Refresh the administrator's session so the signed JWT includes the claim.
4. Verify that an ordinary authenticated user receives `Admin authorization required` from both admin RPCs, that an admin can list pending/reviewed rows, and that approval publishes only the selected submission. Verify private photo access and the audit event in a non-production project.

The optional live admin screen appears for the signed-in account only when its refreshed session contains that trusted role claim. Its database authorization is enforced independently of the client-side menu visibility. Provisioning should be performed by a trusted server using the Supabase Auth Admin API (`supabase.auth.admin.updateUserById(userId, { app_metadata: { role: 'admin' } })`); never put the service key or this call in browser code.

No administrator has been provisioned in this session. No database migration was applied. Live admin review, migration behavior, and Cloudflare deployment are not verified here.

### OpenAI inventory analysis

The **Analyze inventory** action is available only for an authenticated live inventory batch. The `analyze-inventory` Supabase Edge Function verifies the caller, fetches their batch and published requirements under the user's RLS context, and reuses the application's deterministic freshness, matching, and economics code. OpenAI supplies only qualitative, evidence-referenced explanation; the response cannot submit an offer or change inventory. The public workspace does not call the function and displays an unavailable notice instead of a fabricated report.

The function defaults to `gpt-5-mini`, which supports the Responses API and Structured Outputs. The server can override the model with `OPENAI_MODEL`. No OpenAI key belongs in `.env.local`, a `VITE_*` variable, or the browser.

For a linked Supabase project, add the key in **Supabase Dashboard → Edge Functions → Secrets** with key `OPENAI_API_KEY` and the newly rotated value. The CLI alternative avoids putting the secret in shell history: create the ignored file `supabase/functions/.env` locally with `OPENAI_API_KEY=<fresh-key>` and optionally `OPENAI_MODEL=gpt-5-mini`, then run:

```powershell
npx supabase secrets set --env-file supabase/functions/.env --project-ref <project-ref>
```

Do not commit that file. To run the function locally, start the local Supabase stack and use:

```powershell
npx supabase functions serve analyze-inventory --env-file supabase/functions/.env
```

The deployment command, after reviewing the linked project and migration compatibility, is `npx supabase functions deploy analyze-inventory --project-ref <project-ref>`. The function reads inventory fields added by the pending MVP integrity migration. Do not deploy it or run migrations until the existing remote migration-history mismatch is safely reconciled. The function's per-user limit is isolate-local and best-effort, not a globally coordinated quota; monitor provider usage and add shared rate limiting before broad public deployment.

The API key that was pasted into the project conversation must be revoked and replaced before any setup. Do not put it in a local file or secret manager.

## Development checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

The Supabase integration suite is credential-gated. Use two isolated test accounts in a non-production Supabase project; never use production records for concurrency or access-control experiments. Demo data is not an integration-test substitute.

## Current showcase scope

- Public startup landing page explains the problem, workflow, measurement approach, business-model hypotheses, and staged roadmap without claiming traction or proven impact.
- The interactive scenario reuses deterministic matching, freshness prioritisation, quantity availability, and economic calculations.
- Sample values are illustrative, and outcomes remain simulated and local.
- Google OAuth, database migration verification, multi-user RLS/Storage tests, Cloudflare account inspection, real buyer or provider integrations, AI services, payments, and independently verified recovery remain outside this showcase verification.
