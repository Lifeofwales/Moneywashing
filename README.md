# Moneywashing V2

This version keeps the existing Firebase project and the existing
`rp_transactions` collection, so previously saved transaction records remain available.

## New features

- Firebase-backed Admin Panel
- Add, edit, and remove gangs from the website
- Gang-specific unit prices
- Gang-specific badge and dashboard colors
- Editable website title, subtitle, accent color, and default price
- Live updates for every connected user
- Existing transaction editing, deletion, search, and dashboard totals
- LSSR included as a starter gang

## Uploading to GitHub Pages

1. Back up the current repository files.
2. Upload the contents of this folder to the root of the `Moneywashing` repository.
3. Replace the old files when GitHub asks.
4. Commit directly to the main branch.
5. Wait about one minute.
6. Open:
   `https://lifeofwales.github.io/Moneywashing/?v=2`
7. Press `Ctrl + Shift + R`.

## Required Firestore rules

Publish the included `firestore.rules` file in:

Firebase Console → Firestore → Rules

The rules are temporarily open because Discord authentication has not been added yet.
Anyone with the website link can currently change Admin Panel settings.

## First launch

The site checks for:

`app_settings/config`

If it does not exist, it automatically creates it with:

- BV
- Dreaded
- LSSR

All three initially use a $60 unit price, which can be changed in the Admin Panel.

## Existing records

The V2 site reads the same collection as the previous site:

`rp_transactions`

Do not delete this collection if you want to preserve old records.

## Next security upgrade

Add Discord authentication, then change Firestore rules so:

- Signed-in members can view and add records
- Managers can edit records
- Admins can delete records and change `app_settings`
