param(
    [Parameter(Mandatory)][uri]$WorkspaceUrl,
    [string]$Sdk = $env:ANDROID_HOME,
    [string]$Output = 'artifacts/StockPact.apk'
)

$ErrorActionPreference = 'Stop'
if ($WorkspaceUrl.Scheme -ne 'https' -or $WorkspaceUrl.Port -ne 443 -or $WorkspaceUrl.UserInfo -or
    $WorkspaceUrl.AbsolutePath -ne '/' -or $WorkspaceUrl.Query -or $WorkspaceUrl.Fragment) {
    throw 'WorkspaceUrl must be an HTTPS origin without a path, query, or fragment.'
}
if (-not $Sdk) { $Sdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$tools = Join-Path $Sdk 'build-tools/35.0.0'
$platform = Join-Path $Sdk 'platforms/android-35/android.jar'
$repo = Split-Path $PSScriptRoot -Parent
$build = Join-Path $repo ('.stockpact/android/' + [guid]::NewGuid())
$key = Join-Path $repo '.stockpact/android/stockpact-demo-signing.p12'
$absoluteOutput = [IO.Path]::GetFullPath($Output, $repo)

function Run-Native([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE." }
}

foreach ($directory in @('assets', 'classes', 'dex', 'res/drawable-nodpi', 'res/values')) {
    New-Item -ItemType Directory -Path (Join-Path $build $directory) -Force | Out-Null
}
New-Item -ItemType Directory -Path (Split-Path $absoluteOutput -Parent) -Force | Out-Null
Set-Content -LiteralPath (Join-Path $build 'assets/workspace-url.txt') -Value $WorkspaceUrl.AbsoluteUri -Encoding ascii
Copy-Item -LiteralPath (Join-Path $repo 'public/icon-192.png') -Destination (Join-Path $build 'res/drawable-nodpi/stockpact_icon.png')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'res/values/styles.xml') -Destination (Join-Path $build 'res/values/styles.xml')

$compiled = Join-Path $build 'resources.zip'
$unsigned = Join-Path $build 'unsigned.apk'
$aligned = Join-Path $build 'aligned.apk'
Run-Native (Join-Path $tools 'aapt2.exe') @('compile', '--dir', (Join-Path $build 'res'), '-o', $compiled)
Run-Native (Join-Path $tools 'aapt2.exe') @('link', '-I', $platform, '--manifest', (Join-Path $PSScriptRoot 'AndroidManifest.xml'),
    '-A', (Join-Path $build 'assets'), '-o', $unsigned, $compiled)
$java = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src') -Filter '*.java' -Recurse | ForEach-Object FullName)
Run-Native 'javac.exe' (@('--release', '8', '-classpath', $platform, '-d', (Join-Path $build 'classes')) + $java)
$classes = @(Get-ChildItem -LiteralPath (Join-Path $build 'classes') -Filter '*.class' -Recurse | ForEach-Object FullName)
Run-Native (Join-Path $tools 'd8.bat') (@('--min-api', '26', '--lib', $platform, '--output', (Join-Path $build 'dex')) + $classes)
Push-Location -LiteralPath (Join-Path $build 'dex')
try { Run-Native (Join-Path $tools 'aapt.exe') @('add', $unsigned, 'classes.dex') }
finally { Pop-Location }
Run-Native (Join-Path $tools 'zipalign.exe') @('-f', '-p', '4', $unsigned, $aligned)

# This local demo key signs updates to the same sideloaded package. Use a managed release key for distribution.
if (-not (Test-Path -LiteralPath $key)) {
    Run-Native 'keytool.exe' @('-genkeypair', '-keystore', $key, '-storetype', 'PKCS12', '-alias', 'stockpact-demo',
        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650', '-dname', 'CN=StockPact Demo',
        '-storepass', 'android')
}
Run-Native (Join-Path $tools 'apksigner.bat') @('sign', '--ks', $key, '--ks-key-alias', 'stockpact-demo',
    '--ks-pass', 'pass:android', '--out', $absoluteOutput, $aligned)
Run-Native (Join-Path $tools 'apksigner.bat') @('verify', '--verbose', $absoluteOutput)
Write-Output $absoluteOutput
