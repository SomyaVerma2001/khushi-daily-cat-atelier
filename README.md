# Khushi's Daily CAT Atelier

A clean standalone daily CAT-practice app.

## What It Does

- Generates one daily practice set:
  - 1 VARC set, 4 questions
  - 1 DILR set, 4 questions
  - 15 Quant questions
- Uses a deterministic source bank with more than 700 generated items.
- Saves daily deck, responses, pause state, completion history, and reports in local storage.
- Hides answers while solving.
- Unlocks detailed solutions after finishing.
- Has a CAT-style interface and Atelier visual language.
- Includes hooks for Firebase Google login and EmailJS reports.

## Run Locally

Open `index.html` in a browser.

## Enable Google Login / Email Reports

1. Copy `config.example.js` to `config.js`.
2. Fill Firebase Web App config and enable Google provider in Firebase Auth.
3. Fill EmailJS public key, service ID, template ID, and recipient email.
4. Add this script line before `app.js` in `index.html`:

```html
<script src="config.js"></script>
```

Without `config.js`, the app uses a local Khushi profile.

## GitHub Pages

After pushing the repo, enable GitHub Pages from repository settings:

- Source: deploy from branch
- Branch: `main`
- Folder: `/`

The app is static and needs no build step.
