param(
  [string]$Arch = 'x64'
)

$ErrorActionPreference = 'SilentlyContinue'

$roots = @(
  "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
  "${env:ProgramFiles(x86)}\Windows Kits\8.1\bin",
  "${env:ProgramFiles}\Windows Kits\10\bin",
  "${env:ProgramFiles}\Windows Kits\8.1\bin"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$matches = @()
foreach ($root in $roots) {
  $matches += Get-ChildItem -LiteralPath $root -Recurse -Filter rc.exe |
    Where-Object { $_.FullName -match "\\$([Regex]::Escape($Arch))\\rc\.exe$" }
}

if ($matches.Count -eq 0) {
  foreach ($root in $roots) {
    $matches += Get-ChildItem -LiteralPath $root -Recurse -Filter rc.exe
  }
}

$best = $matches |
  Sort-Object @{ Expression = {
    $version = $_.Directory.Parent.Name
    try { [Version]$version } catch { [Version]'0.0.0.0' }
  }; Descending = $true }, FullName |
  Select-Object -First 1

if ($best) {
  Write-Output $best.FullName
  exit 0
}

exit 1
