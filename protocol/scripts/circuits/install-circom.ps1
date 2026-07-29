Param(
  [string]$Repo = "iden3/circom",
  [string]$DownloadDir = (Resolve-Path ".").Path
)

function Get-LatestReleaseAssetUrl {
  param(
    [string]$Repository
  )
  $api = "https://api.github.com/repos/$Repository/releases/latest"
  $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'Aegis-Installer' }
  foreach ($asset in $release.assets) {
    if ($asset.name -match "win" -and $asset.name -match "zip") {
      return $asset.browser_download_url
    }
  }
  throw "Windows asset not found in latest release"
}

function Install-Circom {
  param(
    [string]$Url,
    [string]$TargetDir
  )
  $zipPath = Join-Path $TargetDir "circom-win.zip"
  Invoke-WebRequest -Uri $Url -OutFile $zipPath
  $extractDir = Join-Path $TargetDir "circom-bin"
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir
  $exe = Get-ChildItem -Path $extractDir -Recurse -Filter "circom.exe" | Select-Object -First 1
  if (-not $exe) { throw "circom.exe not found after extraction" }
  $binDir = Join-Path $TargetDir "bin"
  New-Item -ItemType Directory -Force -Path $binDir | Out-Null
  Copy-Item -Path $exe.FullName -Destination (Join-Path $binDir "circom.exe") -Force
  return (Join-Path $binDir "circom.exe")
}

try {
  Write-Host "Resolving latest Circom release asset..."
  $url = Get-LatestReleaseAssetUrl -Repository $Repo
  Write-Host "Downloading: $url"
  $exePath = Install-Circom -Url $url -TargetDir $DownloadDir
  Write-Host "Installed circom at: $exePath"
  Write-Output $exePath
} catch {
  Write-Error $_
  exit 1
}