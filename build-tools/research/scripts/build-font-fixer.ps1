param([ValidateSet('0.16.1','0.16.15','0.16.27','0.16.31')][string]$Version = '0.16.31')
$ErrorActionPreference = 'Stop'
$researchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$go = Join-Path $researchRoot 'tools\go\bin\go.exe'
$sourceRoot = Join-Path $researchRoot 'src\font-fixer'
$output = Join-Path $researchRoot 'dist\PvZ2_Gardendless_Font_Fixer_1.43.exe'
if (-not (Test-Path -LiteralPath $go)) { throw 'Expected verified portable Go 1.27.3 in tools\go.' }
$env:GOCACHE = Join-Path $researchRoot 'tools\go-cache'
$env:GOPATH = Join-Path $researchRoot 'tools\go-work'
$env:GOTOOLCHAIN = 'local'
$env:CGO_ENABLED = '0'
Push-Location $researchRoot
try {
    & node scripts\bundle-prototype-fonts.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Prototype font bundling failed.' }
    & node scripts\extract-native-ui-fixture.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Native UI extraction failed.' }
    & node scripts\bundle-game-documents.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Game document bundling failed.' }
    & node scripts\sync-event-ui.cjs $Version
    if ($LASTEXITCODE -ne 0) { throw 'Event UI dictionary generation failed.' }
    & node scripts\sync-info-ui.cjs $Version
    if ($LASTEXITCODE -ne 0) { throw 'Info UI dictionary generation failed.' }
    & node scripts\sync-objective-ui.cjs $Version
    if ($LASTEXITCODE -ne 0) { throw 'Objective dictionary generation failed.' }
    Copy-Item -LiteralPath (Join-Path $researchRoot ('assets\ui-translations-compiled-' + $Version + '.json')) -Destination (Join-Path $sourceRoot 'ui-translations.json') -Force
    $env:FONT_FIXER_GAME_VERSION = $Version
    & node --test tests\font-fix.test.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Font Fixer JavaScript regression checks failed.' }
    Push-Location $sourceRoot
    try {
        & $go test ./...
        if ($LASTEXITCODE -ne 0) { throw 'Font Fixer Go checks failed.' }
        & $go vet ./...
        if ($LASTEXITCODE -ne 0) { throw 'Font Fixer Go vet failed.' }
        & $go build -trimpath '-ldflags=-H windowsgui -s -w' -o $output .
        if ($LASTEXITCODE -ne 0) { throw 'Font Fixer build failed.' }
    } finally { Pop-Location }
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $output
    ($hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($output)) | Set-Content -Encoding ASCII -LiteralPath ($output + '.sha256')
    Get-Item -LiteralPath $output | Select-Object Name,Length
    $hash | Format-List Hash
} finally { Pop-Location }
