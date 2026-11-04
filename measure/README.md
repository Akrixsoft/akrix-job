# Measure (Замер Akrix) — папка приложения

Приложение «Замер» переименовано в **Measure**. Здесь собираются все его данные в akrix-job.

## Сейчас (v43)
- `logo/` — утверждённый логотип: `measure_logo.svg` (значок), `measure_wordmark.svg` (значок + Measure), `icon-192.png`, `icon-512.png`.
- `design/measure_mockups.html` — утверждённый макет интерфейса (артефакт: https://claude.ai/artifact/JAxzAH9cPPVw79V4nj6JWo).

## Пока на старых местах (переезд — в первом релизе Measure, вместе с пересборкой APK)
- сайт: `zamer/` (index.html, sw.js, manifest, иконки) — APK открывает `https://akrixsoft.github.io/akrix-job/zamer/`;
- исходники APK: `android-zamer/` (MainActivity.URL);
- APK и версия: `apk/akrix-zamer.apk`, `apk/zamer-version.json`;
- сборка: `.github/workflows/zamer-apk.yml`.

## План переезда (утвердить)
1. `zamer/` → `measure/app/`; в `zamer/index.html` — переход на `../measure/app/` (старые APK продолжают работать).
2. `android-zamer/` → `measure/android/`, URL в MainActivity → `.../measure/app/`, иконка и имя — Measure.
3. APK → `measure/apk/measure.apk`, версия → `measure/apk/version.json`; workflow — новые пути.
