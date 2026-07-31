# Shared RP Transaction Tracker

This website was built from the uploaded spreadsheet layout. It includes:

- BV and Dreaded group tracking
- Buyer, amount, unit price, calculated total, account used, date, and notes
- Shared live records through Firebase Firestore
- Dashboard totals and group breakdown
- Search, filter, edit, and delete
- Mobile-friendly layout
- A separate `customize.js` file for easy branding changes
- Local demo mode until Firebase is connected

## 1. Preview it

Open `index.html` with a local web server. VS Code's **Live Server** extension works well. Because the project uses JavaScript modules, double-clicking the HTML file may not load Firebase correctly.

## 2. Connect Firebase for shared saving

1. Create a project in Firebase Console.
2. Add a Web App to the project.
3. Open **Firestore Database** and create a database.
4. Copy your Web App's configuration into `firebase-config.js`.
5. In Firestore Rules, paste the contents of `firestore.rules`, then publish.

The included rules are intentionally simple so the shared site works immediately. Anyone who can access the site can edit or delete entries. For private records, add Firebase Authentication and stricter rules.

## 3. Customize it

Open `customize.js` to change:

- Website title and subtitle
- Default unit price
- Group names
- Group colors
- Main website colors

## 4. Put it online

You can upload the folder to GitHub Pages. Keep all files in the same folder. Once Firebase is configured, visitors using the GitHub Pages link will share the same database.

## Important

This site is intended for fictional roleplay tracking. Do not store real financial account information, passwords, identification numbers, or other sensitive data.
