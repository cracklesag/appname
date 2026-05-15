# APP_NAME

Mobile-first field record keeping for fertiliser, slurry, lime and cuts.
Built with Next.js 14 (App Router) and Supabase (Postgres + Auth).

---

## What this is

A Progressive Web App (PWA) you open from a phone or laptop browser.
- Phone: opens at the same URL, can be "added to home screen" to behave like an installed app
- Multi-user ready (one farm for now, each user signs in with email + password)
- Data lives in Postgres on Supabase, behind row-level security
- Deploys automatically when you push to GitHub

---

## You will need

- A **Windows PC**
- A **GitHub** account: https://github.com/signup
- A **Vercel** account (sign in with GitHub): https://vercel.com/signup
- A **Supabase** account (sign in with GitHub): https://supabase.com
- **Node.js 20+** installed: https://nodejs.org (pick the LTS installer)
- **Git** installed: https://git-scm.com/downloads

Total cost: £0 to start. Optional domain ~£12/year (skip for now if you want).

---

## Step 1 — Create your Supabase project

1. Open https://supabase.com → sign in with GitHub
2. Click **New Project**
3. Pick the **Free** tier
4. Name it whatever you like (e.g. `app-name`)
5. Set a strong database password — **save it somewhere safe**
6. Region: pick **West EU (London / Frankfurt)** for UK
7. Wait ~2 minutes for provisioning

When ready, go to **Project Settings → API** and copy these three values somewhere:

- `Project URL`            → looks like `https://xxxxx.supabase.co`
- `anon public` key         → starts with `eyJ...`
- `service_role secret` key → starts with `eyJ...` (keep this one secret)

---

## Step 2 — Create the database schema

In Supabase, click **SQL Editor** in the left sidebar → **New query**.

Open the file `supabase/schema.sql` from this project, copy everything, paste it into the SQL editor, and click **Run**.

You should see "Success. No rows returned." If anything errors, scroll up and read what failed.

---

## Step 3 — Create your first user

1. In Supabase, go to **Authentication → Users**
2. Click **Add user → Create new user**
3. Email: yours. Password: a real one (you'll log in with this). Tick **Auto Confirm User**.
4. Click **Create user**
5. From the row that appears, copy the **User UID** — it's a long uuid like `abc12345-...`

---

## Step 4 — Clone this project locally

Open **PowerShell** or **Command Prompt** (any folder):

```powershell
cd Documents
git clone <your-github-repo-url> app-name
cd app-name
npm install
```

---

## Step 5 — Configure local environment

Copy the env template:

```powershell
copy .env.example .env.local
```

Open `.env.local` in Notepad and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon key>
SUPABASE_SERVICE_ROLE_KEY=<your service role key>
SEED_USER_ID=<the user UID from step 3>
```

Save and close.

---

## Step 6 — Load Mill Farm seed data

```powershell
npm run seed
```

You should see:
```
✓ 28 fields inserted
✓ 65 applications inserted
✅ Seed complete.
```

---

## Step 7 — Run locally

```powershell
npm run dev
```

Open http://localhost:3000 in your browser. Sign in with the email and password you created in step 3. You should see all 28 fields.

---

## Step 8 — Push to GitHub

If you haven't already created the repo:

1. Go to https://github.com/new
2. Name: `app-name` (or whatever). **Private**. Don't add a README, .gitignore, or licence (we have these).
3. Create the repo
4. Follow GitHub's instructions for "push an existing repository":

```powershell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/app-name.git
git push -u origin main
```

---

## Step 9 — Deploy to Vercel

1. Go to https://vercel.com → **Add New → Project**
2. Import your GitHub repo
3. Framework preset: **Next.js** (auto-detected)
4. **Environment Variables** — add these three (same values as `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Deploy** — takes ~2 minutes
6. You'll get a URL like `app-name-xyz.vercel.app`

**Important:** in Supabase → Authentication → URL Configuration, add your Vercel URL to the **Site URL** and the **Additional Redirect URLs** list. Otherwise sign-in won't work in production.

---

## Step 10 — Install on phone

1. Open the Vercel URL in your phone's browser (Chrome on Android, Safari on iOS)
2. Sign in
3. iOS: tap Share → **Add to Home Screen**
   Android: tap menu → **Install app** or **Add to home screen**
4. App icon appears on home screen — opens full-screen like a native app

---

## How to make changes after this

The workflow is:

```powershell
# edit code in VS Code or your editor
git add .
git commit -m "Short message describing the change"
git push
```

Vercel auto-deploys within ~1 minute. Test on the live URL.

For local development:
```powershell
npm run dev
```

---

## Project structure

```
app/
  page.tsx                    # Field list (home)
  login/page.tsx              # Sign in
  activity/page.tsx           # Cross-farm history with filters
  settings/page.tsx           # Units, targets, multipliers
  fields/[id]/
    page.tsx                  # Field detail — Overview & Season tabs
    log/page.tsx              # Log slurry / fert / lime
    cut/page.tsx              # Log a cut
    soil/page.tsx             # Update soil sample / events
    plan/page.tsx             # Edit cut plan
  auth/callback/route.ts      # OAuth callback (for future magic links)
  layout.tsx                  # Root layout, bottom nav, SW register
  globals.css                 # All styles
components/
  Header.tsx
  BottomNav.tsx
  NutrientBar.tsx             # Progress bar + MiniBar
  ProductPill.tsx
  FieldDetailCards.tsx        # ApplicationCard, CutEntry, NAvailabilityStrip
  LogApplicationForm.tsx      # Client component
  LogCutForm.tsx              # Client component
  EditPlanForm.tsx            # Client component
  ServiceWorkerRegister.tsx
lib/
  types.ts                    # All TypeScript interfaces + DEFAULT_SETTINGS
  rules.ts                    # Nutrient calc engine, conversions, season helpers
  data.ts                     # Supabase queries
  actions.ts                  # Server actions for save/update
  supabase/
    client.ts                 # Browser client
    server.ts                 # Server client (RSC + actions)
middleware.ts                 # Auth gate
public/
  manifest.webmanifest        # PWA manifest
  sw.js                       # Service worker
  icons/                      # App icons in all sizes
supabase/
  schema.sql                  # Run this in Supabase SQL editor
scripts/
  seed.ts                     # Mill Farm seed data
```

---

## Common issues

**"Auth session missing" or login loop**
- Check the Supabase Site URL setting includes your Vercel URL
- Make sure the three env vars on Vercel match those in `.env.local`

**Build fails on Vercel but works locally**
- Check Vercel's build log — most often a missing env var
- Or a TypeScript error that didn't show because you didn't run `npx tsc --noEmit` first

**"Row violates row-level security policy"**
- The seed script uses the service role key which bypasses RLS — make sure that's set correctly
- The app itself uses the anon key — RLS policies in `schema.sql` allow users to read/write only their own rows

**My phone won't install the app**
- iOS: must be Safari, not Chrome
- Android: must be Chrome
- The site must be served over HTTPS (Vercel does this automatically)
- Try a hard refresh first

---

## What's NOT in this MVP

These are known gaps to add later. None block your day-to-day use:

- **Edit / delete** existing applications and cuts (currently log-only)
- **Add a new field** from the UI (use Supabase dashboard for now, or extend the schema)
- **Offline data writes** — the service worker caches the app shell so it loads without signal, but saving an application requires connection
- **Reset data** in Settings
- **Forgot password** flow
- **CSV export** of records
- **Multi-farm** (multi-tenant) — RLS is set up for it, but no farm-switching UI yet

When you're ready for any of these, the hooks are all in place.

---

## Where the rules live

If you need to adjust the nutrient calc — different K-build rates, different N targets, a new yield class — look in `lib/rules.ts`. The relevant tables are right at the top: `YIELDS_BY_CUT_PROFILE`, `OFFTAKE_PER_T_DM`, `slurryNAvailability`. Settings the user can change at runtime are in `lib/types.ts` under `DEFAULT_SETTINGS`.

---

## When you change the app's name

Search the repo for `APP_NAME` and replace it with your chosen name. Files to check:
- `package.json` (the `name` field)
- `app/layout.tsx` (metadata)
- `app/login/page.tsx` (subtitle)
- `app/page.tsx` (subtitle on field list)
- `public/manifest.webmanifest`
- This `README.md`

Then commit and push.
