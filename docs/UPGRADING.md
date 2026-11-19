# Releasing a new version without touching people's data

Written for whoever builds and ships SuryaSetu. Every rule here exists so that installing a new version — website,
installed web app or Android APK — never loses or damages what people saved with an older one.

## What protects the data

| Where data lives | What keeps it safe on an update |
|---|---|
| **Device mode** (browser or Android app): records in IndexedDB (`ss1-records`, moved there from localStorage by version 1.1.0 the first time each list is read — copied, read back, then removed), files in IndexedDB (`ss1-files`); small settings stay in localStorage | The **data format** of each business is stored (`ss1:format`, `ss1:w:<id>:format`). On start, `LocalBackend.prepare()` upgrades older data **once**, after a full **safety copy** (IndexedDB `ss1-safety`). Data saved by a **newer** app is opened read-only. A record list that cannot be read is never overwritten. A daily safety copy is kept as well. |
| **Cloud mode**: Supabase `records` table and `files` bucket | Records are JSON, so new fields need no table change. `supabase/schema.sql` only uses `create … if not exists`, `add column if not exists`, `create or replace`; re-running it keeps every record, user, number and access right (tested in `schema.test.ts`). Migrations are applied to records as they are read. |
| **Backups** (JSON) | Carry `format` and `appVersion`; older backups are upgraded on restore, newer ones are refused with a clear message. Device-mode backups include the attached files and the staff list (no passwords). All backups carry the document counters, and a restore never moves a counter back. |
| **Android app** | Same app id `in.suryasetu.erp`, **same signing key** every time, `versionCode` always higher. Android then installs over the old app and keeps its data. |
| **Open tabs** | A new version switches to the new version by itself, with no message, the next time they open another screen (or while the app is in the background with no form open); never while someone is typing. A screen of the old version that needs a replaced file reloads into the new one. |

## Rules when changing the code

1. **Never rename or remove** a stored key, entity key or field key. Add new ones; keep reading the old.
2. **Need records in a new shape?** Add a step to `MIGRATIONS` in `src/lib/store/safety.ts` and raise `DATA_FORMAT` to its `to`.
   - It must keep every record and every field it does not change, never delete records, and give the same result when run twice (cloud mode runs it on every read).
   - Never edit or remove a step that has shipped.
   - Add a test in `src/lib/store/safety.test.ts` with data as the old version saved it.
3. **Database changes** go into `supabase/schema.sql` in re-runnable form only (no `drop table`, no `truncate`, no `drop column`). Run `npx vitest run src/lib/store/schema.test.ts`.
4. New code must accept records written by every older version (missing fields, old values).

## Release checklist

1. Raise `version` in `package.json` (e.g. 1.1.0 → 1.2.0). It is shown in Settings → Backup & data and becomes the Android `versionCode` (1.2.0 → 10200).
2. `npx vitest run`, `npm run e2e`, `npm run acceptance` (and `BROWSER=firefox …`), and after `npm run build` also `npm run offline` (the installed website still opens without internet, styled).
3. **Cloud mode: run `supabase/schema.sql` first** (Supabase → SQL Editor) whenever it changed, *before* uploading the website. If `supabase/functions/` changed, deploy them next: `SKIP_SECRETS=1 PROJECT_REF=<id> bash scripts/deploy-payments.sh`. Older apps keep working with the new database, but a new app on an old database may not. Version 1.1.0 needs it: invoices are numbered by the database when issued (a new app on the old database would issue invoices without a number), and supplier payments are a new record type.
4. Website: `npm run build`, upload `dist/`.
5. Android: `npm run apk` → `../SuryaSetu-<version>.apk`. Always use `npm run apk`: it builds with `CAP_BUILD=1`, which puts the Content-Security-Policy into the app (a plain `npx cap sync` would leave it out).
   - First time on a machine: `npm run android-tools` (Java 17 and the Android SDK into your home folder; accepts the Android SDK licence).
   - The first build makes the signing key `android/suryasetu-release.jks` and `android/keystore.properties`. **Back up both** (e.g. an encrypted drive). Lose them and the next APK cannot update the installed app — people would have to uninstall it, which deletes its data.
6. Tell people to download a backup before a big update (good habit, not required).

## Version 1.2.0: many businesses and subscriptions (cloud mode)

Run `supabase/schema.sql` once, as always. A database made by an older version then changes **by itself, once**:
- a business is created for the existing company, owned by its first active admin, named after the company name in
  Settings, with a fresh **15-day free trial**;
- every existing person and record is put into that business, and the document counters carry on inside it
  (the next invoice number follows the last one);
- the old "owner email becomes admin" setting is no longer used.

Then:
- Give your existing company a paid period if it should not start a trial (provider, SQL Editor):
  `select public.vendor_extend((select id from businesses order by created_at limit 1), 365);`
- Deploy the payment server (`scripts/deploy-payments.sh`, `GO-LIVE-STEPS.md` step 5b) before anyone pays.
- Staff who sign up from now on use the business's company code (Settings → Users & access). Accounts that already
  exist need nothing.
- The website enquiry form now needs the business in its link: copy it from Settings → General and replace the old
  `#/enquiry` link on your website and social pages.

Running the file again later also keeps two lists up to date by itself: which business each login joined (for the
files of former staff) and the emails and numbers that already had a free trial.

Tested in `src/lib/store/schema.test.ts` ("a database from before businesses becomes one business on upgrade").
Device mode is not affected.

