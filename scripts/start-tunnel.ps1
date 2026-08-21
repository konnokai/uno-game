$ErrorActionPreference = "Stop"

$installedCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
$candidates = @(
  $env:CLOUDFLARED_PATH,
  $(if ($installedCommand) { $installedCommand.Source }),
  $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "cloudflared\cloudflared.exe" }),
  $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "cloudflared\cloudflared.exe" })
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$executable = $candidates | Select-Object -First 1
if (-not $executable) {
  throw "找不到 cloudflared，請先執行 winget install --id Cloudflare.cloudflared"
}

& $executable tunnel --no-autoupdate --url http://localhost:3001
exit $LASTEXITCODE
