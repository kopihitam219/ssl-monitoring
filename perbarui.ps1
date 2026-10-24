# =====================================================================
#  Perbarui SSL Monitoring + kirim ke GitHub (Vercel deploy otomatis)
#
#  Expand-Archive "$HOME\Downloads\ssl-monitoring.zip" "$HOME\Downloads" -Force
#  powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\ssl-monitoring\perbarui.ps1"
#
#  Skrip ini:
#    1. mencari folder project yang sudah tersambung ke GitHub
#    2. menyalin file versi baru ke sana (.env.local, data\, dan .git\ TIDAK disentuh)
#    3. npm install + build, supaya scanner kantor langsung bisa dipakai
#    4. commit + push ke GitHub  ->  Vercel otomatis deploy ulang
#
#  Opsi:
#    -Project "C:\path\ke\ssl-monitoring"   tunjuk folder project langsung
#    -NoPush                                 jangan push (hanya salin + build)
#    -NoBuild                                jangan build di komputer ini
# =====================================================================
param(
  [string]$Project = '',
  [switch]$NoPush,
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$Source = $PSScriptRoot

function Step($n, $text) { Write-Host ""; Write-Host "[$n/5] $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "      $text" -ForegroundColor Green }
function Info($text) { Write-Host "      $text" }
function Warn($text) { Write-Host "      $text" -ForegroundColor Yellow }
function Fail($text) {
  Write-Host ""
  Write-Host "GAGAL: $text" -ForegroundColor Red
  Write-Host ""
  Read-Host "Tekan Enter untuk keluar" | Out-Null
  exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Perbarui SSL Monitoring"                  -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# ---------- 1. Cari folder project ----------
Step 1 "Cari folder project yang tersambung ke GitHub"
if (-not $Project) {
  $kandidat = @()
  foreach ($akar in @("$HOME\Downloads", "$HOME\Documents", "$HOME\Desktop", 'C:\Projects', $HOME)) {
    if (-not (Test-Path $akar)) { continue }
    $kandidat += Get-ChildItem $akar -Directory -Recurse -Depth 2 -ErrorAction SilentlyContinue |
      Where-Object { (Test-Path "$($_.FullName)\.git") -and (Test-Path "$($_.FullName)\package.json") -and (Test-Path "$($_.FullName)\lib\pg.js") }
  }
  $kandidat = $kandidat | Where-Object { $_.FullName -ne $Source } | Sort-Object FullName -Unique
  if ($kandidat.Count -eq 0) {
    Fail "Folder project belum ketemu. Jalankan lagi dengan alamat folder-nya, contoh:`n  powershell -ExecutionPolicy Bypass -File `"$Source\perbarui.ps1`" -Project `"$HOME\Downloads\ssl-monitoring-v5\ssl-monitoring`""
  }
  if ($kandidat.Count -gt 1) {
    Info "Ketemu beberapa folder:"
    for ($i = 0; $i -lt $kandidat.Count; $i++) {
      $r = (git -C $($kandidat[$i].FullName) remote get-url origin 2>$null)
      Write-Host ("        [{0}] {1}  ->  {2}" -f ($i + 1), $kandidat[$i].FullName, $r)
    }
    $pilih = Read-Host "      Pilih nomor"
    $Project = $kandidat[[int]$pilih - 1].FullName
  } else {
    $Project = $kandidat[0].FullName
  }
}
if (-not (Test-Path "$Project\package.json")) { Fail "$Project bukan folder project SSL Monitoring." }
$samaFolder = ((Resolve-Path $Project).Path.TrimEnd('\') -eq (Resolve-Path $Source).Path.TrimEnd('\'))
$remote = (git -C $Project remote get-url origin 2>$null)
Info "Project : $Project"
Info "GitHub  : $(if ($remote) { $remote } else { '(belum ada remote)' })"
Ok "Folder ketemu"

# ---------- 2. Salin file versi baru ----------
Step 2 "Salin file versi baru"
$versiBaru = (Get-Content "$Source\package.json" -Raw | ConvertFrom-Json).version
$versiLama = (Get-Content "$Project\package.json" -Raw | ConvertFrom-Json).version
Info "Versi $versiLama  ->  $versiBaru"

# Hentikan aplikasi yang mungkin masih jalan supaya file tidak terkunci
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Project*" } |
  ForEach-Object { Info "Menutup aplikasi yang masih jalan (PID $($_.ProcessId))"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if ($samaFolder) {
  Info "Folder sumber dan tujuan sama, penyalinan dilewati."
} else {
  $jangan = @('.git', '.env.local', 'data', 'node_modules', '.next', '.vercel')
  foreach ($item in Get-ChildItem $Source -Force) {
    if ($jangan -contains $item.Name) { continue }
    $tujuan = Join-Path $Project $item.Name
    if ($item.PSIsContainer) {
      if (Test-Path $tujuan) { Remove-Item $tujuan -Recurse -Force }
      Copy-Item $item.FullName $tujuan -Recurse -Force
    } else {
      Copy-Item $item.FullName $tujuan -Force
    }
  }
}
Ok "File versi $versiBaru tersalin ($(if (Test-Path "$Project\.env.local") { '.env.local dipertahankan' } else { 'tidak ada .env.local' }))"

# ---------- 3. npm install ----------
Step 3 "Siapkan dependensi"
Push-Location $Project
try {
  npm install --no-audit --no-fund 2>&1 | Select-Object -Last 3 | ForEach-Object { Info $_ }
  if ($LASTEXITCODE -ne 0) { Fail "npm install gagal." }
  Ok "Dependensi siap"

  # ---------- 4. Build ----------
  Step 4 "Build aplikasi"
  if ($NoBuild) {
    Warn "Dilewati (-NoBuild). Vercel tetap build sendiri setelah push."
  } else {
    $log = npm run build 2>&1
    if ($LASTEXITCODE -ne 0) {
      $log | Select-Object -Last 25 | ForEach-Object { Info $_ }
      Fail "Build gagal. Isi pesan di atas, kirim ke saya."
    }
    Ok "Build berhasil"
  }

  # ---------- 5. Push ke GitHub ----------
  Step 5 "Kirim ke GitHub"
  if ($NoPush) {
    Warn "Dilewati (-NoPush)."
  } elseif (-not $remote) {
    Warn "Belum ada remote GitHub di folder ini, push dilewati."
  } else {
    git add -A
    $adaUbahan = (git status --porcelain)
    if (-not $adaUbahan) {
      Info "Tidak ada perubahan untuk dikirim (versi di GitHub sudah sama)."
    } else {
      git commit -q -m "Perbaiki scan gagal di Vercel karena zona waktu :UTC + tampilan HP (v$versiBaru)"
      git push origin HEAD 2>&1 | ForEach-Object { Info $_ }
      if ($LASTEXITCODE -ne 0) { Fail "Push ke GitHub gagal. Pesan di atas biasanya menjelaskan sebabnya (login GitHub / nama repo)." }
      Ok "Terkirim ke GitHub. Vercel akan deploy ulang sendiri dalam 1-3 menit."
    }
  }
} finally { Pop-Location }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Selesai - versi $versiBaru"               -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Info "Cek hasil deploy  : https://vercel.com/dashboard  (tab Deployments)"
Info "Jalankan di sini  : cd `"$Project`"  lalu  npm start"
Write-Host ""
Read-Host "Tekan Enter untuk menutup" | Out-Null
