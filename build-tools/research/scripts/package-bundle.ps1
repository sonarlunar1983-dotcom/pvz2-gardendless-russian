param([ValidateSet('0.15.0','0.16.1','0.16.15','0.16.27','0.16.31')][string]$Version = '0.15.0')
$ErrorActionPreference = 'Stop'
$researchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$bundleRoot = Join-Path $researchRoot ('build\bundle-' + $Version)
$patchPath = Join-Path $researchRoot ('dist\PvZ2_Gardendless_Russian_' + $Version + '_preview.zip')
$fontPath = if ($Version -eq '0.16.31') { Join-Path $researchRoot 'dist\PvZ2_Gardendless_Font_Fixer_1.43.exe' } elseif ($Version -eq '0.16.27') { Join-Path $researchRoot 'dist\PvZ2_Gardendless_Font_Fixer_1.42.exe' } elseif ($Version -eq '0.16.15') { Join-Path $researchRoot 'dist\PvZ2_Gardendless_Font_Fixer_1.41.exe' } elseif ($Version -eq '0.16.1') { Join-Path $researchRoot 'dist\PvZ2_Gardendless_Font_Fixer_1.35.exe' } else { Join-Path $researchRoot 'vendor\font-fixer-1.0\PvZ2_Gardendless_Font_Fixer_1.0.exe' }
$archivePath = Join-Path $researchRoot ('dist\PvZ2_Gardendless_Russian_' + $Version + '_with_Font_Fixer_preview.zip')
$sevenZip = 'C:\Program Files\7-Zip\7z.exe'
$fontHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $fontPath).Hash.ToLowerInvariant()
$expectedFontHash = if ($Version -ne '0.15.0') { ((Get-Content -Raw -LiteralPath ($fontPath + '.sha256')).Trim() -split '\s+')[0] } else { '2cb544715cbd835af0faa4b407e3ae648792291725853eeee2cf28b48b3d0c78' }
if ($fontHash -ne $expectedFontHash) { throw 'Font Fixer digest mismatch.' }
$patchHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $patchPath).Hash.ToLowerInvariant()
$expectedPatchHash = ((Get-Content -Raw -LiteralPath ($patchPath + '.sha256')).Trim() -split '\s+')[0]
if ($patchHash -ne $expectedPatchHash) { throw 'Patch archive digest mismatch.' }
New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
Copy-Item -LiteralPath $patchPath -Destination $bundleRoot -Force
Copy-Item -LiteralPath $fontPath -Destination $bundleRoot -Force
$readmeName = if ($Version -eq '0.15.0') { 'assets\BUNDLE-README.txt' } else { 'assets\BUNDLE-README-' + $Version + '.txt' }
Copy-Item -LiteralPath (Join-Path $researchRoot $readmeName) -Destination (Join-Path $bundleRoot 'README.txt') -Force
@(
    $patchHash + '  ' + [IO.Path]::GetFileName($patchPath)
    $fontHash + '  ' + [IO.Path]::GetFileName($fontPath)
) | Set-Content -Encoding ASCII -LiteralPath (Join-Path $bundleRoot 'SHA256SUMS.txt')
if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath }
Push-Location $bundleRoot
try {
    & $sevenZip a -tzip $archivePath ([IO.Path]::GetFileName($patchPath)) ([IO.Path]::GetFileName($fontPath)) README.txt SHA256SUMS.txt -mx=9 -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) { throw 'Bundle creation failed.' }
    & $sevenZip t $archivePath -bso0 -bsp0
    if ($LASTEXITCODE -ne 0) { throw 'Bundle ZIP integrity check failed.' }
} finally { Pop-Location }
$bundleHash = Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath
($bundleHash.Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($archivePath)) | Set-Content -Encoding ASCII -LiteralPath ($archivePath + '.sha256')
Get-Item -LiteralPath $archivePath | Select-Object FullName, Length
$bundleHash | Format-List Hash
