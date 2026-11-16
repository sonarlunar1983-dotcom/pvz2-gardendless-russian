# Русификатор PvZ2 Gardendless для Windows

- Оригинальная игра и загрузка Gardendless 0.16.27 — [официальный релиз](https://github.com/Gzh0821/pvzg_site/releases/tag/0.16.27).
- Исходный русификатор для 0.14.0 и Font Fixer 1.0 — [KRUTONIK/pvz2-gardendless-russian](https://github.com/KRUTONIK/pvz2-gardendless-russian).

В ветке `localization/0.16.27` подготовлена адаптация для Gardendless **0.16.27**: мод **1.3.1**, Font Fixer **1.42**. Обновлены игровые тексты и перевод новых окон «Об игре», «Обновления», уровней сообщества и музыкальных наборов. Сохраняются прежние исправления интерфейса и кириллические шрифты.

**Выпуск 0.16.27 пока не опубликован. Тег и GitHub Release создаются только после отдельного одобрения владельца.** Подробности подготовки и установки — [RELEASE-0.16.27.md](docs/RELEASE-0.16.27.md).

Предыдущие готовые архивы доступны в [выпуске для Gardendless 0.16.15](https://github.com/sonarlunar1983-dotcom/pvz2-gardendless-russian/releases/tag/v1.3.0-gardendless-0.16.15). Они предназначены для 0.16.15.

## Установка

1. Скачайте Gardendless 0.16.27 из официального релиза игры.
2. В подготовленном комплекте нужны `PvZ2_Gardendless_Russian_0.16.27_preview.zip` и `PvZ2_Gardendless_Font_Fixer_1.42.exe`. Внешний архив `with_Font_Fixer` сначала распакуйте.
3. Запустите Font Fixer, выберите `pvzge-0.16.27.exe` и запустите игру через помощник.
4. Откройте **F9 → Mods → Import ZIP**, выберите архив `preview.zip`, примените мод и выберите русский язык в настройках игры.

## Исходники и сборка

Исходники Windows-помощника и встроенные ресурсы находятся в `font-fixer/`. Для сборки проверен Go 1.27.3. Из корня репозитория выполните в PowerShell:

```powershell
Set-Location font-fixer
go test ./...
go vet ./...
go build -trimpath '-ldflags=-H windowsgui -s -w' -o PvZ2_Gardendless_Font_Fixer_1.42.exe .
```

Редакторские переводы находятся в `localization/0.16.27/`. Снимок обновлённых сборщиков и проверок — `build-tools/research/`. Для сборки пакета отдельно нужны оригинальные данные и рабочий проект исследования; команды и ограничения приведены в [документации 0.16.27](docs/RELEASE-0.16.27.md). [Предыдущий выпуск](docs/RELEASE-0.16.15.md) сохранён отдельно.

## Авторство и условия использования

Базовый перевод и первый Font Fixer созданы KRUTONIK. История исходного проекта сохранена. См. [сведения о лицензировании](LICENSING.md).
