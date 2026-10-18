#Requires -Version 7
<#
  Deploy one or more core-api modules to prod (ap-south-1).

  Works around Serverless Framework v3's inability to parse the AWS `[sso-session]`
  profile format in ~/.aws/config. SF v3's bundled AWS SDK errors with
  "AWS profile ... doesn't seem to be configured" even when the SSO token is valid
  (the AWS CLI v2 and Terraform read it fine — only SF v3 can't). The fix: export the
  SSO session into TEMPORARY env-var credentials, which every SDK understands, and run
  serverless with NO profile set.

  Usage:
    pwsh scripts/deploy-prod.ps1 communication
    pwsh scripts/deploy-prod.ps1 communication assembly leave feedback syllabus
#>
param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$Modules
)
$ErrorActionPreference = 'Stop'
$ProfileName = 'prod-itsmyskool-nikhil.agrawal'
$SsoSession  = 'itsmyskool'
$Region      = 'ap-south-1'
$Root = Split-Path $PSScriptRoot -Parent
$Sls  = Join-Path $Root 'node_modules\.bin\serverless.cmd'

# 1. Ensure the SSO token is valid, then export temp creds into the environment.
Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
aws sts get-caller-identity --profile $ProfileName *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "SSO token invalid/expired. Run:  aws sso login --sso-session $SsoSession" -ForegroundColor Yellow
  exit 1
}
aws configure export-credentials --profile $ProfileName --format env-no-export |
  ForEach-Object { if ($_ -match '^(AWS_[^=]+)=(.*)$') { Set-Item "Env:$($matches[1])" $matches[2] } }

# 2. Deploy each module from its own directory.
foreach ($m in $Modules) {
  $dir = Join-Path $Root "modules\$m"
  if (-not (Test-Path $dir)) { Write-Host "No such module: $m" -ForegroundColor Red; exit 1 }
  Write-Host "=== deploying $m ===" -ForegroundColor Cyan
  Set-Location $dir
  & $Sls deploy --stage prod --region $Region
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED on $m" -ForegroundColor Red; exit 1 }
}
Write-Host "All modules deployed." -ForegroundColor Green
