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
- Includes Firebase Google login and EmailJS-ready report hooks.

## Run Locally

Open `index.html` in a browser.

## Enable Google Login / Email Reports

Firebase config is stored in `config.js`. To make login work:

1. Firebase Console -> Authentication -> Get started.
2. Sign-in method -> Google -> Enable -> Save.
3. Authentication -> Settings -> Authorized domains.
4. Add `somyaverma2001.github.io`.

Local profile mode remains available as a fallback.

## GitHub Pages

After pushing the repo, enable GitHub Pages from repository settings:

- Source: deploy from branch
- Branch: `main`
- Folder: `/`

The app is static and needs no build step.
