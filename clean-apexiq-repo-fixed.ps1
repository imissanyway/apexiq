<#
.SYNOPSIS
  Safely cleans the ApexIQ GitHub repository root without deleting frozen product files.

.DESCRIPTION
  Default behavior is PREVIEW ONLY. Nothing is moved until you run with -Apply.

  The script:
  - Verifies it is being run inside the ApexIQ Git repository.
  - Refuses to continue with uncommitted changes unless -AllowDirty is supplied.
  - Creates a timestamped safety branch and tag before applying changes.
  - Keeps the current production files in the repository root.
  - Moves legacy workers, old setup notes, duplicate app.html, and old root manifests
    into backups/repo-archive/<timestamp>/ instead of deleting them.
  - Keeps assets/, index.html, admin PWA files, current manifests, and the v4.9.9.127 Worker.
  - Adds a concise README.md and .gitignore when missing.
  - Shows git status and an exact rollback command at the end.

.USAGE
  Preview:
    powershell -ExecutionPolicy Bypass -File .\clean-apexiq-repo.ps1

  Apply:
    powershell -ExecutionPolicy Bypass -File .\clean-apexiq-repo.ps1 -Apply

  Apply and commit:
    powershell -ExecutionPolicy Bypass -File .\clean-apexiq-repo.ps1 -Apply -Commit

  Roll back the cleanup commit:
    git reset --hard <safety-tag-shown-by-script>
#>

[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Commit,
    [switch]$AllowDirty
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProductionWorker = "apexiq-worker-v4.9.9.127-founder-request-cache.js"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ArchiveRoot = Join-Path "backups" (Join-Path "repo-archive" $Timestamp)
$SafetyBranch = "backup/pre-clean-$Timestamp"
$SafetyTag = "pre-clean-$Timestamp"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Preview([string]$Message) {
    Write-Host "PREVIEW: $Message" -ForegroundColor Yellow
}

function Assert-GitRepository {
    $inside = git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0 -or $inside.Trim() -ne "true") {
        throw "Run this script from the root of the cloned ApexIQ Git repository."
    }

    $root = (git rev-parse --show-toplevel).Trim()
    Set-Location $root

    if (-not (Test-Path "index.html")) {
        throw "index.html was not found in the repository root."
    }

    if (-not (Test-Path $ProductionWorker)) {
        throw "Current production Worker '$ProductionWorker' was not found. Stopping to avoid archiving the wrong Worker."
    }
}

function Assert-CleanWorkingTree {
    $status = @(git status --porcelain)
    if ($status.Count -gt 0 -and -not $AllowDirty) {
        $status | ForEach-Object { Write-Host $_ }
        throw "The repository has uncommitted changes. Commit/stash them first, or rerun with -AllowDirty."
    }
}

function Move-Safely([string]$Source, [string]$DestinationDirectory) {
    if (-not (Test-Path -LiteralPath $Source)) {
        return
    }

    $destination = Join-Path $DestinationDirectory (Split-Path $Source -Leaf)

    if (-not $Apply) {
        Write-Preview "move '$Source' -> '$destination'"
        return
    }

    New-Item -ItemType Directory -Force -Path $DestinationDirectory | Out-Null

    $tracked = git ls-files --error-unmatch -- "$Source" 2>$null
    if ($LASTEXITCODE -eq 0) {
        git mv -- "$Source" "$destination"
        if ($LASTEXITCODE -ne 0) {
            throw "git mv failed for '$Source'."
        }
    }
    else {
        Move-Item -LiteralPath $Source -Destination $destination -Force
    }
}

function Ensure-TextFile([string]$Path, [string]$Content) {
    if (Test-Path -LiteralPath $Path) {
        return
    }

    if (-not $Apply) {
        Write-Preview "create '$Path'"
        return
    }

    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

Assert-GitRepository
Assert-CleanWorkingTree

Write-Step "ApexIQ repository cleanup plan"
Write-Host "Repository: $((git rev-parse --show-toplevel).Trim())"
Write-Host "Production Worker kept: $ProductionWorker"
Write-Host "Archive directory: $ArchiveRoot"
Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'PREVIEW ONLY' })"

# Files intentionally kept in repository root:
$KeepRoot = @(
    "index.html",
    "admin.html",
    "admin-sw.js",
    "admin-manifest.webmanifest",
    "admin-icon-192.png",
    "admin-icon-512.png",
    "badge-manifest.json",
    "apexiq-all-badges-asset-manifest-v4.9.9.11.json",
    $ProductionWorker,
    "BADGE-RULES.md",
    "README.md",
    ".gitignore"
)

# Old/versioned files are archived, never permanently deleted.
$LegacyRootFiles = @(
    "ApexIQ-v4.9.9.89-BETA-WELCOME-ADMIN-KV-summary.txt",
    "ApexIQ-v4.9.9.89-SETUP.txt",
    "ApexIQ-v4.9.9.127-FOUNDER-PACK-SPEED-REQUEST-SETUP.txt",
    "SHA256.txt",
    "README.txt",
    "app.html",
    "apexiq-api-worker-v4.9.9.30-clean-meta-percent-restore.js",
    "apexiq-api-worker-v4.9.9.82-worker-meta-28-row-parser.js",
    "apexiq-api-worker-v4.9.9.85-before-beta-admin.js",
    "apexiq-api-worker-v4.9.9.89-beta-admin-kv.js",
    "apexiq-worker-v4.9.9.97-admin-mobile-security.txt"
)

Write-Step "Files that will remain at the repository root"
$KeepRoot | ForEach-Object { Write-Host "KEEP    $_" -ForegroundColor Green }
Write-Host "KEEP    assets/" -ForegroundColor Green
Write-Host "KEEP    backups/" -ForegroundColor Green

Write-Step "Legacy files that will be archived"
foreach ($file in $LegacyRootFiles) {
    if (Test-Path -LiteralPath $file) {
        Move-Safely -Source $file -DestinationDirectory $ArchiveRoot
    }
}

# Move any other versioned Worker files that are not the production Worker.
$OtherWorkers = Get-ChildItem -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -ne $ProductionWorker -and
        (
            $_.Name -match '^apexiq-(api-)?worker-v.*\.(js|txt)$' -or
            $_.Name -match '^worker.*\.(js|txt)$'
        )
    }

foreach ($worker in $OtherWorkers) {
    Move-Safely -Source $worker.Name -DestinationDirectory $ArchiveRoot
}

$Readme = @"
# ApexIQ

Mobile-first Apex Legends profile hub.

## Production entry points

- `index.html` — main ApexIQ web application
- `admin.html` — mobile admin console
- `$ProductionWorker` — current Cloudflare Worker
- `assets/` — approved badges, stickers, logos, and application assets
- `badge-manifest.json` — active badge manifest

## Deployment

GitHub Pages serves `index.html` from the repository root.

Deploy the current Worker separately in Cloudflare Workers:

`$ProductionWorker`

Historical builds and retired Workers are stored under `backups/repo-archive/`.
"@

$GitIgnore = @"
# Local/editor files
.DS_Store
Thumbs.db
desktop.ini
.vscode/
.idea/

# Temporary files
*.tmp
*.temp
*.bak
*.log
*~

# Local archives and generated packages
*.zip
dist/
build/
"@

Ensure-TextFile -Path "README.md" -Content $Readme
Ensure-TextFile -Path ".gitignore" -Content $GitIgnore

if (-not $Apply) {
    Write-Step "Preview complete"
    Write-Host "Nothing was changed." -ForegroundColor Green
    Write-Host ""
    Write-Host "Review the list above, then run:" -ForegroundColor White
    Write-Host "powershell -ExecutionPolicy Bypass -File .\clean-apexiq-repo.ps1 -Apply -Commit" -ForegroundColor Yellow
    exit 0
}

Write-Step "Creating restore points"
$currentBranch = (git branch --show-current).Trim()
$currentCommit = (git rev-parse HEAD).Trim()

git branch $SafetyBranch $currentCommit
if ($LASTEXITCODE -ne 0) {
    throw "Could not create safety branch '$SafetyBranch'."
}

git tag -a $SafetyTag $currentCommit -m "ApexIQ repository state before cleanup $Timestamp"
if ($LASTEXITCODE -ne 0) {
    throw "Could not create safety tag '$SafetyTag'."
}

Write-Step "Validating production files"
$Required = @(
    "index.html",
    "admin.html",
    "admin-sw.js",
    "admin-manifest.webmanifest",
    "admin-icon-192.png",
    "admin-icon-512.png",
    "assets",
    "badge-manifest.json",
    $ProductionWorker
)

$Missing = @($Required | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($Missing.Count -gt 0) {
    throw "Required production files are missing after cleanup: $($Missing -join ', ')"
}

Write-Step "Repository status"
git status --short

if ($Commit) {
    Write-Step "Creating cleanup commit"
    git add -A
    git commit -m "chore: clean ApexIQ repository root and archive legacy builds"
    if ($LASTEXITCODE -ne 0) {
        throw "Git commit failed. Your files are still present; inspect git status."
    }
}

Write-Step "Cleanup finished"
Write-Host "Current branch: $currentBranch" -ForegroundColor Green
Write-Host "Safety branch: $SafetyBranch" -ForegroundColor Green
Write-Host "Safety tag:    $SafetyTag" -ForegroundColor Green
Write-Host "Archive:       $ArchiveRoot" -ForegroundColor Green
Write-Host ""
Write-Host "Rollback command:" -ForegroundColor White
Write-Host "git reset --hard $SafetyTag" -ForegroundColor Yellow
Write-Host ""
Write-Host "After reviewing the site, push with:" -ForegroundColor White
Write-Host "git push origin $currentBranch --follow-tags" -ForegroundColor Yellow
