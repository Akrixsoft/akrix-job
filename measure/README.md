# Measure (бывш. «Замер Akrix») — всё приложение в одной папке

- `app/` — сайт приложения: https://akrixsoft.github.io/akrix-job/measure/app/ (index.html, sw.js, manifest, иконки, лист маркеров).
- `android/` — исходники APK (WebView-оболочка + Bluetooth GLM): URL — `.../measure/app/`, имя Measure, applicationId `ge.akrix.measure`.
- `apk/` — собранный APK `measure.apk` и `version.json` (собирает `.github/workflows/measure-apk.yml` при изменениях в `measure/android/`).
- `logo/` — логотип (svg, иконки 192/512); `design/` — утверждённый макет интерфейса (артефакт https://claude.ai/artifact/JAxzAH9cPPVw79V4nj6JWo).

Исходники страницы, тесты и история версий — akrix-soft/zamer-dev (сборка: eNN.py → build.py → pub_measure.py).
Старые места (`zamer/`, `android-zamer/`, `apk/akrix-zamer.apk`) убраны: приложением ещё не пользовались.
