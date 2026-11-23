param([ValidateSet('0.15.0','0.16.1','0.16.15','0.16.27','0.16.31')][string]$Version = '0.15.0')
$ErrorActionPreference = 'Stop'
$researchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packRoot = Join-Path $researchRoot ('build\pack-' + $Version)
$archivePath = Join-Path $researchRoot ('dist\PvZ2_Gardendless_Russian_' + $Version + '_preview.zip')
$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
Push-Location $researchRoot
try {
    & node scripts\build-patch.cjs $Version
    if ($LASTEXITCODE -ne 0) { throw 'Patch build failed.' }
    $env:PATCH_VERSION = $Version
    & node --test tests\patch.test.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Patch checks failed.' }
    if (-not (Test-Path -LiteralPath $sevenZip)) { throw '7-Zip 24.05 is required at C:\Program Files\7-Zip\7z.exe.' }
    New-Item -ItemType Directory -Path (Join-Path $researchRoot 'dist') -Force | Out-Null
    # Remove only the exact generated archive to prevent stale ZIP entries.
    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
    Push-Location $packRoot
    try {
        & $sevenZip a -tzip $archivePath pack.json jsons -mx=9 -bso0 -bsp0
        if ($LASTEXITCODE -ne 0) { throw 'ZIP creation failed.' }
    } finally { Pop-Location }
    & $sevenZip t $archivePath -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) { throw 'ZIP integrity check failed.' }
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath
    ($hash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($archivePath)) | Set-Content -Encoding ASCII -LiteralPath ($archivePath + '.sha256')
    Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
    $hash | Format-List Hash
} finally { Pop-Location }
