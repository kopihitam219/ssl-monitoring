# =====================================================================
#  Pasang SSL Monitoring
#
#  Expand-Archive "$HOME\Downloads\ssl-monitoring.zip" "$HOME\Downloads" -Force
#  powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\ssl-monitoring\pasang.ps1"
#
#  Opsi:
#    -Target "D:\Apps\ssl-monitoring"   salin ke folder lain (default: dipasang di folder ini sendiri)
#    -NoStart                           jangan langsung jalankan aplikasi setelah install
# =====================================================================
param(
  [string]$Target = $PSScriptRoot,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$Source = $PSScriptRoot

function Step($n, $text) { Write-Host ""; Write-Host "[$n/6] $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "      $text" -ForegroundColor Green }
function Info($text) { Write-Host "      $text" }
function Fail($text) {
  Write-Host ""
  Write-Host "GAGAL: $text" -ForegroundColor Red
  Write-Host ""
  Read-Host "Tekan Enter untuk keluar" | Out-Null
  exit 1
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Node-Ok {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  $v = (node -v).TrimStart('v').Split('.') | ForEach-Object { [int]$_ }
  return ($v[0] -gt 22) -or ($v[0] -eq 22 -and $v[1] -ge 13)
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Pasang SSL Monitoring"                    -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Info "Sumber : $Source"
Info "Tujuan : $Target"

# ---------- 1. Node.js ----------
Step 1 "Cek Node.js"
if (-not (Node-Ok)) {
  if (Get-Command node -ErrorAction SilentlyContinue) { Info "Node.js $(node -v) terlalu lama, butuh 22.13 atau lebih baru." }
  else { Info "Node.js belum terpasang." }
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Start-Process "https://nodejs.org"
    Fail "Install Node.js 22 LTS dari https://nodejs.org, lalu jalankan pasang.ps1 lagi."
  }
  Info "Menginstall Node.js LTS lewat winget..."
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  Refresh-Path
  if (-not (Node-Ok)) { Fail "Node.js sudah diinstall, tapi belum terbaca. Tutup PowerShell, buka lagi, lalu jalankan pasang.ps1 lagi." }
}
Ok "Node.js $(node -v) OK"

# ---------- 2. Cek isi paket ----------
Step 2 "Cek isi paket"
if (-not (Test-Path (Join-Path $Source 'package.json'))) { Fail "package.json tidak ada di $Source. Ekstrak zip dulu." }
Ok "Paket lengkap"

# ---------- 3. Salin ke folder tujuan ----------
Step 3 "Salin ke $Target"
$sameFolder = (Resolve-Path $Source).Path.TrimEnd('\') -ieq ([IO.Path]::GetFullPath($Target)).TrimEnd('\')
if ($sameFolder) {
  Info "Paket sudah berada di folder tujuan, dipasang di tempat."
} else {
  if (Test-Path $Target) {
    $old = "$Target-lama-$(Get-Date -Format yyyyMMdd-HHmmss)"
    try { Rename-Item $Target (Split-Path $old -Leaf) }
    catch { Fail "Folder lama $Target tidak bisa diganti nama. Tutup dulu aplikasi lama (jendela npm start / npm run dev), lalu ulangi." }
    Ok "Versi lama disimpan di $old"
  }
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
  Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force -Exclude 'node_modules', '.next'
  Ok "Disalin"
}
Set-Location $Target

# ---------- 4. npm install ----------
Step 4 "Install dependensi (npm install)"
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Fail "npm install gagal. Kalau kantor memakai proxy: npm config set proxy http://proxy.kantor:8080 dan npm config set https-proxy http://proxy.kantor:8080" }
try { npx next telemetry disable *> $null } catch {}
Ok "Selesai"

# ---------- 5. Build ----------
Step 5 "Build aplikasi (npm run build)"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build gagal." }
Ok "Selesai"

# ---------- 6. Shortcut + jalankan ----------
Step 6 "Buat shortcut Desktop"
try {
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\SSL Monitoring.lnk')
  $lnk.TargetPath = Join-Path $Target 'jalankan.bat'
  $lnk.WorkingDirectory = $Target
  $lnk.Save()
  Ok "Shortcut 'SSL Monitoring' dibuat di Desktop"
} catch { Info "Shortcut tidak bisa dibuat (tidak apa-apa). Jalankan lewat $Target\jalankan.bat" }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Pemasangan selesai"                        -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Info "Folder        : $Target"
Info "Menjalankan   : klik dua kali 'SSL Monitoring' di Desktop"
Info "Alamat        : http://127.0.0.1:3000"

if ($NoStart) { exit 0 }

Write-Host ""
Info "Aplikasi dijalankan sekarang. Jangan tutup jendela ini selama aplikasi dipakai."
Start-Job { Start-Sleep 8; Start-Process 'http://127.0.0.1:3000' } | Out-Null
npm start
