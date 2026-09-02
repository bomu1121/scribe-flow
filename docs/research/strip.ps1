$ErrorActionPreference = 'Continue'
$rawDir = 'D:\Develop\scribe-flow\docs\research\raw'
$txtDir = 'D:\Develop\scribe-flow\docs\research\txt'
New-Item -ItemType Directory -Force -Path $txtDir | Out-Null
Get-ChildItem -Path $rawDir -Filter *.html | ForEach-Object {
  try {
    $name = $_.BaseName
    $html = Get-Content -Path $_.FullName -Raw -Encoding UTF8
    if ($null -eq $html) { return }
    $html = $html -replace '(?is)<script.*?</script>', ' '
    $html = $html -replace '(?is)<style.*?</style>', ' '
    $html = $html -replace '(?is)<noscript.*?</noscript>', ' '
    $html = $html -replace '(?i)<br\s*/?>', "`n"
    $html = $html -replace '(?i)</(p|div|li|tr|h1|h2|h3|h4|h5|h6|section|article|table|ul|ol)>', "`n"
    $html = $html -replace '(?i)<(h1|h2|h3|h4|h5|h6)[^>]*>', "`n## "
    $html = $html -replace '(?i)<li[^>]*>', '- '
    $html = $html -replace '(?is)<[^>]+>', ' '
    $html = $html -replace '&amp;', '&'
    $html = $html -replace '&lt;', '<'
    $html = $html -replace '&gt;', '>'
    $html = $html -replace '&quot;', '"'
    $html = $html -replace '&#39;', "'"
    $html = $html -replace '&nbsp;', ' '
    $html = $html -replace '(?m)^[ \t]+', ''
    $html = $html -replace '(?m)[ \t]+$', ''
    $html = $html -replace '(\s*\n\s*){2,}', "`n`n"
    $out = Join-Path $txtDir ($name + '.txt')
    Set-Content -Path $out -Value $html -Encoding UTF8
    Write-Host ("OK   {0,-22} {1,8} chars" -f $name, $html.Length)
  } catch {
    Write-Host ("ERR  {0,-22} {1}" -f $_.Name, $_.Exception.Message)
  }
}
Write-Host 'DONE'
