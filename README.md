# Русификатор PvZ2 Gardendless для Windows

- Оригинальная игра и загрузка Gardendless 0.16.15 — [официальный релиз](https://github.com/Gzh0821/pvzg_site/releases/tag/0.16.15).
- Исходный русификатор для 0.14.0 и Font Fixer 1.0 — [KRUTONIK/pvz2-gardendless-russian](https://github.com/KRUTONIK/pvz2-gardendless-russian).

Это адаптация перевода KRUTONIK для Gardendless **0.16.15**. Версия мода — **1.3.0**, Font Fixer — **1.41**. Переведены интерфейс, Альманах, диалоги, названия колод и новые окна «Об игре» и «Обновления». Font Fixer добавляет кириллические шрифты и подгоняет текст под интерфейс.

Готовые архивы, Windows-помощник и контрольные суммы доступны в [выпуске для Gardendless 0.16.15](https://github.com/sonarlunar1983-dotcom/pvz2-gardendless-russian/releases/tag/v1.3.0-gardendless-0.16.15).

## Установка

1. Скачайте Gardendless 0.16.15 из официального релиза игры.
2. В выпуске русификатора выберите `PvZ2_Gardendless_Russian_0.16.15_preview.zip` и `PvZ2_Gardendless_Font_Fixer_1.41.exe`. Внешний архив `with_Font_Fixer` сначала распакуйте.
3. Запустите Font Fixer, выберите `pvzge-0.16.15.exe` и запустите игру через помощник.
4. Откройте **F9 → Mods → Import ZIP**, выберите архив `preview.zip`, примените мод и выберите русский язык в настройках игры.

## Исходники и сборка

Исходники Windows-помощника и встроенные ресурсы находятся в `font-fixer/`. Для сборки проверен Go 1.27.3. Из корня репозитория выполните в PowerShell:

```powershell
Set-Location font-fixer
go test ./...
go vet ./...
go build -trimpath '-ldflags=-H windowsgui -s -w' -o PvZ2_Gardendless_Font_Fixer_1.41.exe .
```

Редакторские переводы для 0.16.15 находятся в `localization/0.16.15/`. Для воспроизводимой сборки пакета перевода отдельно нужны оригинальные данные целевой версии и сборщик из рабочего проекта адаптации. Подробности выпуска и история правок описаны в [документации](docs/RELEASE-0.16.15.md).

## Авторство и условия использования

Базовый перевод и первый Font Fixer созданы KRUTONIK. История исходного проекта сохранена. См. [сведения о лицензировании](LICENSING.md).
