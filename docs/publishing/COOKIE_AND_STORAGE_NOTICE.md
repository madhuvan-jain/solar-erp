# Cookie and Browser Storage Notice

> Template — have it reviewed by a lawyer before publishing.

**App:** SuryaSetu (“the App”), published by [Legal entity name]
**Effective date:** [Effective date]

## In short

- The App sets **no cookies**.
- It has **no advertising, analytics or tracking** code, and no third-party scripts. The only outside service it talks to is the Business’s own Supabase project, and only in cloud mode.
- It uses your browser’s storage only to make the App work: keep you signed in, remember your theme, work offline and, in device mode, hold the Business’s data on that device.

Because this storage is strictly needed for the App to work, there is no cookie banner. Nothing is used to track you across websites.

## What is stored in your browser

| Name (key) | Type | Mode | What it holds | Why | How long |
|---|---|---|---|---|---|
| `ss1:theme` | Local storage | Both | `light` or `dark` | Remembers your Appearance choice. Not stored if you pick “System”. | Until you change it or clear site data |
| `sb-<project>-auth-token` | Local storage (set by the Supabase library) | Cloud | Your sign-in session: access and refresh tokens, user id and email | Keeps you signed in and renews the session | Until you sign out or clear site data |
| `sb-<project>-auth-token-code-verifier` | Local storage (set by the Supabase library) | Cloud | A one-time code used while confirming an email or resetting a password | Secure sign-in (PKCE) | Removed after the link is used |
| `ss1:users` | Local storage | Device | Users’ names, emails, roles, active flag, and a salted PBKDF2 password hash (never the password) | Sign-in on this device | Until clear site data |
| `ss1:session` | Local storage | Device | The id of the signed-in user | Keeps you signed in | Until you sign out |
| `ss1:recovery` | Local storage | Device | A hash of the admin recovery code | Lets the admin reset a forgotten password | Until clear site data |
| `ss1:entities`, `ss1:counters`, `ss1:changed` | Local storage | Device | Which record types exist, document-number counters, a “changed” signal for other open tabs (records written by versions before 1.1.0 stay under `ss1:data:<type>` until moved) | Device mode bookkeeping | Until deleted in the App or clear site data |
| `ss1-records` | IndexedDB | Device | All business records (leads, customers, invoices…) in device mode, one list per record type | This is where device mode keeps its data (it outgrew the ~5 MB of local storage) | Until deleted in the App or clear site data |
| `ss1-files` | IndexedDB | Device | Attached files and photos (up to 15 MB each) | Device mode keeps attachments apart from the records | Until deleted with the browser's site data |
| `ss1-safety` | IndexedDB | Device | Safety copies of the records (daily, before updates and restores; newest 14) | So an app update or a wrong restore can be undone | Replaced as new copies are made; deleted with the site data |
| `ss1:layout`, `ss1:format` | Local storage | Device | Screen layout choice; the data format of the saved records | Phone/computer layout; safe upgrades | Until clear site data |
| `ss1:counters` | Local storage | Device | The last number used for each document series (for example INV/26-27/0007) | Gapless document numbering | Until clear site data |
| `solar-erp-<build>` | Cache storage (service worker) | Both | The App’s program files: the start page, scripts, styles, icon and manifest | Lets the App open without internet and load quickly | Replaced on every new release |

**Location and camera permission.** If you tap “Use my location” on a customer, or open the App’s camera for a site photo, the browser (or the Android app) asks whether the App may read your location and, for photos, use the camera. The browser, not the App, remembers your answer; you can change it in the browser’s site settings or Android’s app permissions. “Use my location” reads the location once and saves it as that customer’s site position; the camera reads it only while the camera screen is open, to stamp the photo.

The App does not use session storage, IndexedDB or cookies. In device mode it also asks the browser to keep its storage “persistent”, so the browser is less likely to clear it when the device is short of space.

## What the service worker does not store

The offline cache holds only the App’s own program files. It never stores database replies, uploaded files or records, and it does not cache anything from other websites.

## Links that leave the App

These open only when you tap them:

- **WhatsApp** buttons open `wa.me` with the contact’s number and a ready message.
- **Phone numbers** open your dialler (`tel:`). **Email addresses** open your email app (`mailto:`).
- **Open in Google Maps** sends the saved site coordinates to Google Maps.
- A **UPI QR code** on an invoice is drawn inside the App; scanning it opens the payer’s own UPI app.

Once you are on those services, their own cookie and privacy rules apply.

## How to remove stored data

- **Sign out** removes the sign-in session.
- **Clear site data** in your browser settings removes everything listed above. In device mode this **deletes all the Business’s data on that device**, so the admin should download a backup first (Settings → Download backup).
- Uninstalling the app icon may not clear the data, because the browser keeps it. Clear the site data as well.

Step-by-step instructions for each browser are on [website URL]/delete-account.html.

## Contact

[support email] · [phone]
