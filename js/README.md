# Orion Tab — Supabase Migration Files
## What's in this folder

| File | What it does |
|------|--------------|
| `supabase.js` | Supabase client — import this everywhere you need Supabase |
| `schema.sql` | Run once in Supabase SQL Editor to create tables |
| `supabase-sync.js` | Patches save/load to write to Supabase + localStorage |
| `supabase-auth.js` | Drop-in replacement for auth.js |
| `migration.js` | One-time script to push existing data to Supabase |

---

## Step 1 — Run the SQL schema

1. Open your Supabase project dashboard
2. Click **SQL Editor** → **New Query**
3. Paste the contents of `schema.sql` and click **Run**

---

## Step 2 — Fill in your Supabase credentials

Open `supabase.js` and replace the two placeholder values:

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_PUBLIC_KEY';
```

Get these from: Supabase dashboard → Settings → API

---

## Step 3 — Copy the 5 new files into your project

Drop all 5 files alongside your existing JS files.

---

## Step 4 — Swap auth.js for supabase-auth.js

Find every import of auth.js in your project and change it:

```js
// BEFORE
import { handleLogin, logout, registerUser, ... } from './auth.js';

// AFTER
import { handleLogin, logout, registerUser, ... } from './supabase-auth.js';
```

The exports are identical — nothing else in your app needs to change.

---

## Step 5 — Wire supabase-sync.js into main.js

At the TOP of main.js (before anything else runs), add:

```js
import { save, saveNow, loadFromSupabase } from './supabase-sync.js';
import { restoreSession } from './supabase-auth.js';

// On startup: restore Supabase session and load remote data
async function init() {
    await restoreSession();   // restores login after page refresh
    await loadFromSupabase(); // pulls latest tournament data from cloud
    // ... rest of your existing init code
}

init();
```

Also replace any direct imports of `save`/`saveNow` from `state.js` in
other files with the versions from `supabase-sync.js`:

```js
// BEFORE
import { save, saveNow } from './state.js';

// AFTER
import { save, saveNow } from './supabase-sync.js';
```

---

## Step 6 — Run the one-time data migration

1. Open your app in the browser and log in as admin
2. Open DevTools → Console (F12)
3. Run:

```js
import('/migration.js').then(m => m.runMigration())
```

The console will print:
- Which tournaments were migrated
- Which users were migrated  
- A table of **temporary passwords** for existing users

Share those temporary passwords with your users and tell them to use
**Forgot Password** to set their own.

To verify everything landed correctly, run:

```js
import('/migration.js').then(m => m.verifyMigration())
```

---

## Step 7 — Test

- [ ] Sign up for a new account — check the `user_profiles` table in Supabase
- [ ] Log in — check that the session survives a page refresh
- [ ] Create a tournament round — check the `tournaments` table updates
- [ ] Open the app on a second device — confirm data syncs

---

## What stays the same

- All tournament data logic (draw.js, teams.js, judges.js, etc.) — unchanged
- The state proxy and watcher system — unchanged
- All existing UI code — unchanged
- The ID system and migrate-ids.js — unchanged

## What changes

- Passwords are no longer stored in localStorage or state — Supabase handles them
- `save()` now writes to both localStorage AND Supabase
- Sessions survive page refreshes without re-logging in
- Data is available on any device after login
