param(
    [ValidateSet('amd64', 'arm64')]
    [string] $Arch = (go env GOHOSTARCH)
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$previousOS = $env:GOOS
$previousArch = $env:GOARCH
$previousCGO = $env:CGO_ENABLED

Push-Location -LiteralPath $root
try {
    $env:GOOS = go env GOHOSTOS
    $env:GOARCH = go env GOHOSTARCH
    $env:CGO_ENABLED = '0'

    go tool rsrc -arch $Arch -ico public/helios.ico -manifest desktop/helios.manifest -o "desktop/helios_windows_$Arch.syso"
    if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar os recursos do executável." }

    $env:GOOS = 'windows'
    $env:GOARCH = $Arch
    go build -tags production -ldflags '-s -w -H windowsgui' -o dist/helios.exe ./desktop
    if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o Helios." }
} finally {
    $env:GOOS = $previousOS
    $env:GOARCH = $previousArch
    $env:CGO_ENABLED = $previousCGO
    Pop-Location
}
