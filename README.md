# Rentwise

Rentwise is a mobile-first, installable rent-management PWA for landlords. Each landlord has an isolated workspace for properties, tenants, agreements, rent collection, receipts, expenses and reports. A single platform administrator can manage account access without ever seeing an existing password.

## Production stack

- Next.js application with a standard Vercel production build
- Supabase Auth, PostgreSQL, Row Level Security and private Storage
- Vercel deployment, with an optional Cloudflare Sites build retained as a fallback
- Geist typography, Lucide icons and a responsive app shell

If Supabase environment variables are absent, the application starts in an interactive sample workspace. Sample changes intentionally reset on reload.

## Production status

The hosted Rentwise project is connected to its own Supabase backend. The initial schema, private attachment bucket, email/password authentication settings and single administrator role have been applied. Deployment secrets are managed by the hosting platform and are intentionally not committed to this repository.

## Local browser test

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Use **Explore sample workspace** to test every screen without creating an account.

Validation commands:

```bash
npm run lint
npx tsc --noEmit
npm test
```

## Connect Supabase

1. Create a Supabase project.
2. In Authentication settings, keep email/password enabled and disable **Confirm email** for this version.
3. Run `supabase/migrations/202608130001_initial_schema.sql` in the SQL editor.
4. Copy `.env.example` to `.env.local` and set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Restart the development server and register the first landlord account.

The service-role key is server-only. Never prefix it with `NEXT_PUBLIC_` or expose it in browser code.

## Create the single administrator

Create the intended admin through the normal registration form first. Then edit the email placeholder in `supabase/seed.sql` and run that file in the Supabase SQL editor. A database uniqueness rule guarantees that only one profile can have `is_admin = true`.

The admin panel can:

- deactivate and reactivate landlord access;
- replace a forgotten password with a temporary password;
- require the landlord to choose a new password at the next login.

Passwords are handled by Supabase Auth and stored as secure hashes. Existing passwords are never readable by the application or administrator.

## Data and ID rules

Visible IDs are account-specific, sequential and contain no hyphens:

- Property: `PRP0001`
- Tenant: `TEN0001`
- Agreement: `AGR0001`
- Rent receipt: `RCV000001`
- Expense: `EXP000001`

Internal UUIDs are used for relationships. Database triggers prevent visible IDs and ownership from being rewritten. Row Level Security and relationship validation keep landlord data separated. Rent collection and expense allocation are transactional database functions, so financial records cannot be partially saved.

Unused properties and tenants may be permanently deleted. Once connected to an agreement, attachment or financial record, they can only be archived, preserving history.

## Deployment

Set the same three environment variables in Vercel, import the GitHub repository, and deploy. The default `npm run build` command produces the Vercel-ready Next.js build. `npm run build:sites` remains available for the previous Cloudflare Sites target. The app exposes `/api/health` for deployment checks.

After deployment, verify signup, login, admin password reset, one rent receipt, one multi-property expense, private attachment access, report printing and Add to Home Screen on both iOS and Android.
