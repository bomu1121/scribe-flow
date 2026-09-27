param(
  [Parameter(Mandatory = $true)][string]$Pptx,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$Width = 1600,
  [int]$Height = 900
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}
$OutDir = (Resolve-Path $OutDir).Path

$app = New-Object -ComObject PowerPoint.Application
# PowerPoint must be visible, otherwise Presentations.Open returns null.
$app.Visible = $true
Start-Sleep -Seconds 2

$pres = $app.Presentations.Open($Pptx, -1, 0, 0)
if ($null -eq $pres) {
  $app.Quit()
  throw "Presentations.Open returned null"
}
Start-Sleep -Seconds 2

# Retry wrapper: PowerPoint rejects calls while it is still busy starting up.
function Invoke-WithRetry {
  param([scriptblock]$Action, [int]$Retries = 6, [int]$DelayMs = 700)
  for ($n = 1; $n -le $Retries; $n++) {
    try { return & $Action }
    catch {
      if ($n -eq $Retries) { throw }
      Start-Sleep -Milliseconds $DelayMs
    }
  }
}

try {
  # Enumerate by index: PowerShell's foreach over the COM Slides collection is unreliable here.
  $count = Invoke-WithRetry { $pres.Slides.Count }
  Write-Output ("slides: " + $count)

  for ($i = 1; $i -le $count; $i++) {
    $name = "slide-{0:D2}.png" -f $i
    $target = Join-Path $OutDir $name
    $idx = $i
    Invoke-WithRetry {
      $slide = $pres.Slides.Item($idx)
      $slide.Export($target, "PNG", $Width, $Height)
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($slide) | Out-Null
    } | Out-Null
    Start-Sleep -Milliseconds 200
  }
  Write-Output ("exported to " + $OutDir)
}
finally {
  $pres.Close()
  $app.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
}
