# Moneywashing V2 with Discord Authentication

Flat GitHub Pages package. Upload every file to the repository root.

## Before upload

In Firebase Authentication:

1. Open Authentication.
2. Click Get started if needed.
3. Open Settings → Authorized domains.
4. Add `lifeofwales.github.io`.

## Upload

Upload all files in this folder to the root of the Moneywashing repository.
Replace the current matching files and commit to `main`.

Then open:

https://lifeofwales.github.io/Moneywashing/?v=6

Press Ctrl + Shift + R.

## Rules

Publish the included `firestore.rules` after the website files are deployed.

The rules require:
- Discord/Firebase authentication to read and create records
- An `admin: true` token claim to edit/delete records or manage settings

## Admin claim

After adding your Discord ID to `ADMIN_DISCORD_IDS` in Cloudflare,
log out and sign in again. A previously issued token does not gain the
new admin claim automatically.
