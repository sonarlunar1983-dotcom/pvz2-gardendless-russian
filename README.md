# Русификатор PvZ2 Gardendless для Windows

- Оригинальная игра и загрузка Gardendless 0.16.31 — [официальный релиз](https://github.com/Gzh0821/pvzg_site/releases/tag/0.16.31).
- Исходный русификатор для 0.14.0 и Font Fixer 1.0 — [KRUTONIK/pvz2-gardendless-russian](https://github.com/KRUTONIK/pvz2-gardendless-russian).

В ветке `localization/0.16.31` подготовлена адаптация для Gardendless **0.16.31**: мод **1.3.2**, Font Fixer **1.43**. Добавлены Масляный салат, тексты ежедневных уровней и новые названия колод Водной лозы. Обновлён перевод документов и переработанного окна уровней GitHub. Прежние исправления интерфейса и кириллические шрифты сохранены.

**Выпуск 0.16.31 пока не опубликован. Тег и GitHub Release — только после отдельного одобрения владельца.** Подробности подготовки и установки — [RELEASE-0.16.31.md](docs/RELEASE-0.16.31.md).

Предыдущие готовые архивы — [выпуск для Gardendless 0.16.27](https://github.com/sonarlunar1983-dotcom/pvz2-gardendless-russian/releases/tag/v1.3.1-gardendless-0.16.27). Они предназначены для 0.16.27.

Предыдущие готовые архивы доступны в [выпуске для Gardendless 0.16.15](https://github.com/sonarlunar1983-dotcom/pvz2-gardendless-russian/releases/tag/v1.3.0-gardendless-0.16.15). Они предназначены для 0.16.15.

## Установка

1. Скачайте Gardendless 0.16.31 из официального релиза игры.
2. В подготовленном комплекте нужны `PvZ2_Gardendless_Russian_0.16.31_preview.zip` и `PvZ2_Gardendless_Font_Fixer_1.43.exe`. Внешний архив `with_Font_Fixer` сначала распакуйте.
3. Запустите Font Fixer, выберите `pvzge-0.16.31.exe` и запустите игру через помощник.
4. Откройте **F9 → Mods → Import ZIP**, выберите архив `preview.zip`, примените мод и выберите русский язык в настройках игры.

## Исходники и сборка

Исходники Windows-помощника и встроенные ресурсы находятся в `font-fixer/`. Для сборки проверен Go 1.27.3. Из корня репозитория выполните в PowerShell:

```powershell
Set-Location font-fixer
go test ./...
go vet ./...
go build -trimpath '-ldflags=-H windowsgui -s -w' -o PvZ2_Gardendless_Font_Fixer_1.43.exe .
```

Редакторские переводы находятся в `localization/0.16.31/`. Снимок обновлённых сборщиков и проверок — `build-tools/research/`. Для сборки пакета отдельно нужны оригинальные данные и рабочий проект исследования; команды и ограничения приведены в [документации 0.16.31](docs/RELEASE-0.16.31.md). Документация предыдущих версий сохранена отдельно.

## Авторство и условия использования

Базовый перевод и первый Font Fixer созданы KRUTONIK. История исходного проекта сохранена. См. [сведения о лицензировании](LICENSING.md).
