# Export every slide of the generated deck to PNG.
#
# Notes:
#   * No non-ASCII literals in this file on purpose: PowerShell reads .ps1 as GBK
#     on this machine, so Chinese text in the script gets mangled.
#   * The deck file name contains non-ASCII characters, so it is discovered by
#     wildcard instead of being written out here.
#   * PowerPoint COM returns a null document if the app is not visible first;
#     WPS Presentation answers the same ProgID, and needs the same warm-up.

$ErrorActionPreference = 'Stop'

$outDir = Join-Path $PSScriptRoot '..\out'
$pngDir = Join-Path $outDir 'slides'
$deck = Get-ChildItem -Path $outDir -Filter '*.pptx' | Select-Object -First 1
if (-not $deck) { throw ('no pptx found in ' + $outDir) }

New-Item -ItemType Directory -Force -Path $pngDir | Out-Null
Get-ChildItem -Path $pngDir -Filter '*.png' | Remove-Item -Force

Write-Output ('deck  : ' + $deck.FullName)
Write-Output ('outdir: ' + $pngDir)

$app = New-Object -ComObject PowerPoint.Application
$app.Visible = $true

try {
  $pres = $app.Presentations.Open($deck.FullName, $true, $false, $false)
  if (-not $pres) { throw 'Presentations.Open returned null' }

  $count = $pres.Slides.Count
  Write-Output ('slides: ' + $count)

  for ($i = 1; $i -le $count; $i++) {
    $name = 'slide-{0:D2}.png' -f $i
    $file = Join-Path $pngDir $name
    $pres.Slides.Item($i).Export($file, 'PNG', 1920, 1080)
    Write-Output ('  wrote ' + $name)
  }

  $pres.Close()
} finally {
  $app.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}

$png = Get-ChildItem -Path $pngDir -Filter '*.png'
Write-Output ('done, ' + $png.Count + ' png files')
