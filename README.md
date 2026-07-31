# Moneywashing V2 — Flat GitHub Version

Every file in this folder belongs in the root of the GitHub repository.
There are no subfolders.

## Upload

1. Open the Moneywashing repository on GitHub.
2. Delete the current website files, or upload these files and replace matching files.
3. Click Add file → Upload files.
4. Drag every file from this extracted folder into the upload area.
5. Confirm GitHub lists these exact root files:
   - index.html
   - style.css
   - firebase-config.js
   - firestore.rules
   - main.js
   - admin.js
   - firebase.js
   - state.js
   - transactions.js
   - ui.js
6. Commit directly to the main branch.
7. Wait for GitHub Pages deployment.
8. Open https://lifeofwales.github.io/Moneywashing/?v=5
9. Press Ctrl + Shift + R.

## Firebase

The package uses the existing Moneywashing Firebase configuration and reads the
existing rp_transactions collection.

Firestore rules must allow both:
- rp_transactions
- app_settings

The included firestore.rules file contains the temporary rules needed before
Discord authentication is added.
