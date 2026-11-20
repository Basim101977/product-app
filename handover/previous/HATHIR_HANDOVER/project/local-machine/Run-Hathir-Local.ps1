param([ValidateSet('check', 'test', 'preview')][string]$Action = 'check')
$ErrorActionPreference = 'Stop'
$bundle = Join-Path $PSScriptRoot 'development'
$nodeDir = 'C:\Users\USER\AppData\Local\HathirDevTools\node-v22.20.0-win-x64'
$javaExe = 'C:\Users\USER\AppData\Local\HathirDevTools\java21\jdk-21.0.12.1+1-jre\bin\java.exe'
$previousPath = $env:PATH
$previousJava = $env:PERSONAL_TEST_JAVA
$previousChrome = $env:CHROME_PATH
try {
    $env:PATH = $nodeDir + ';' + $env:PATH
    $env:PERSONAL_TEST_JAVA = $javaExe
    $env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    Push-Location (Join-Path $bundle 'support')
    try {
        & (Join-Path $nodeDir 'npm.cmd') run $Action
        if ($LASTEXITCODE -ne 0) { throw "Local $Action failed: exit code $LASTEXITCODE" }
    } finally { Pop-Location }
} finally {
    $env:PATH = $previousPath
    $env:PERSONAL_TEST_JAVA = $previousJava
    $env:CHROME_PATH = $previousChrome
}
