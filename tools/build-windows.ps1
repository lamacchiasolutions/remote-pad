# Builds the x64 portable ZIP. -CheckInput also starts the extracted copy on a Windows desktop.
[CmdletBinding()]
param([switch]$CheckInput)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $projectRoot 'dist'
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('remote-pad-build-' + [Guid]::NewGuid().ToString('N'))
$compiled = Join-Path $stage 'compiled'
$package = Join-Path $stage 'package'
$archiveName = 'Remote-Pad-Windows-x64.zip'
$archive = Join-Path $stage $archiveName

try {
    $null = New-Item -ItemType Directory -Path $compiled, $package
    dotnet build (Join-Path $projectRoot 'windows/RemotePad.csproj') -c Release -p:Platform=x64 --output $compiled
    if ($LASTEXITCODE -ne 0) { throw 'Windows compilation failed.' }

    $runtimeFiles = @(
        'RemotePad.exe', 'RemotePad.exe.config',
        'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll',
        'runtimes/win-x64/native/WebView2Loader.dll',
        'PS5/compose.yaml', 'PS5/Start PS5 Player.cmd'
    )
    $assets = Get-ChildItem (Join-Path $projectRoot 'app') -File |
        Where-Object { $_.Extension -in '.css', '.html', '.js' }
    $documents = 'EULA.md', 'LICENSE', 'PRIVACY.md', 'SUPPORT.md', 'PS5.md', 'WebView2-LICENSE.txt', 'WebView2-NOTICE.txt'
    $packageFiles = $runtimeFiles + @($assets | ForEach-Object { "app/$($_.Name)" }) +
        @($documents | ForEach-Object { "Documentation/$_" })
    foreach ($file in $packageFiles) {
        $destination = Join-Path $package $file
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination)
        Copy-Item -LiteralPath (Join-Path $compiled $file) -Destination $destination
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($package, $archive)
    if ($CheckInput) {
        $extracted = Join-Path $stage 'extracted'
        [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $extracted)
        $log = Join-Path $stage 'input-check.log'
        $process = Start-Process -FilePath (Join-Path $extracted 'RemotePad.exe') -WorkingDirectory $extracted `
            -ArgumentList "--check-input --log `"$log`"" -PassThru
        try {
            if (-not $process.WaitForExit(120000)) {
                $process.Kill()
                throw 'The packaged Windows input check timed out.'
            }
            if ($process.ExitCode -ne 0) { throw "The packaged Windows input check exited with $($process.ExitCode)." }
            if (-not (Test-Path $log) -or (Get-Content -Raw -LiteralPath $log) -notmatch '^PASS:') {
                throw 'The packaged app did not report a completed input check.'
            }
        } finally {
            if (Test-Path $log) { Get-Content -LiteralPath $log }
            $process.Dispose()
        }
    }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    $checksum = "$archive.sha256"
    [System.IO.File]::WriteAllText($checksum, "$hash  $archiveName`n", [System.Text.Encoding]::ASCII)
    $null = New-Item -ItemType Directory -Path $dist -Force
    Move-Item -LiteralPath $archive, $checksum -Destination $dist -Force
    Write-Output "Created $(Join-Path $dist $archiveName)"
} finally {
    if (Test-Path $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
