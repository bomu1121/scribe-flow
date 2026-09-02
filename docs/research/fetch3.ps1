$ErrorActionPreference = 'Continue'
$outDir = 'D:\Develop\scribe-flow\docs\research\raw'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$items = @(
  @{ name='fastgpt-jina';    url='https://r.jina.ai/https://doc.fastgpt.in/docs/workflow/intro/' },
  @{ name='coze-jina';       url='https://r.jina.ai/https://www.coze.cn/docs/guides/workflow' },
  @{ name='langflow-jina';   url='https://r.jina.ai/https://docs.langflow.org/components' },
  @{ name='make-jina';       url='https://r.jina.ai/https://www.make.com/en/help/tools/flow-control' },
  @{ name='zapier-paths-jina';url='https://r.jina.ai/https://docs.zapier.com/build/paths' },
  @{ name='dolphin-jina';    url='https://r.jina.ai/https://dolphinscheduler.apache.org/en-us/docs/3.2.2/introduction' }
)
foreach ($it in $items) {
  $out = Join-Path $outDir ($it.name + '.html')
  & curl.exe -sS -L --max-time 45 -A $ua -o $out $it.url 2>$null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) {
    $len = (Get-Item $out).Length
    Write-Host ("OK   {0,-22} {1,8} bytes  {2}" -f $it.name, $len, $it.url)
  } else {
    Write-Host ("FAIL {0,-22} exit={1}  {2}" -f $it.name, $LASTEXITCODE, $it.url)
  }
}
Write-Host 'DONE'
