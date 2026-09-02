$ErrorActionPreference = 'Continue'
$outDir = 'D:\Develop\scribe-flow\docs\research\raw'
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$items = @(
  @{ name='coze-workflow-en';    url='https://www.coze.com/docs/guides/workflow' },
  @{ name='coze-open-workflow';  url='https://www.coze.cn/open/docs/guides/workflow' },
  @{ name='fastgpt-workflow2';   url='https://doc.fastgpt.in/docs/workflow' },
  @{ name='fastgpt-nodes';       url='https://doc.fastgpt.in/docs/guide/workflow/node' },
  @{ name='langflow-components2';url='https://docs.langflow.org/components-catalog' },
  @{ name='make-help-home';      url='https://www.make.com/en/help' },
  @{ name='make-iterator';       url='https://www.make.com/en/help/tools/flow-control/iterator' },
  @{ name='zapier-paths2';       url='https://docs.zapier.com/build/paths' },
  @{ name='zapier-build';        url='https://docs.zapier.com/build' },
  @{ name='dolphinscheduler-home';url='https://dolphinscheduler.apache.org/en-us' },
  @{ name='dolphinscheduler-zh'; url='https://dolphinscheduler.apache.org/zh-cn/docs/3.2.2/introduction' },
  @{ name='camunda-docs';        url='https://docs.camunda.org/manual/7.21/' },
  @{ name='feishu-minutes2';     url='https://www.feishu.cn/hc/zh-CN/articles/360049067374' }
)
foreach ($it in $items) {
  $out = Join-Path $outDir ($it.name + '.html')
  & curl.exe -sS -L --max-time 30 -A $ua -o $out $it.url 2>$null
  if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) {
    $len = (Get-Item $out).Length
    Write-Host ("OK   {0,-22} {1,8} bytes  {2}" -f $it.name, $len, $it.url)
  } else {
    Write-Host ("FAIL {0,-22} exit={1}  {2}" -f $it.name, $LASTEXITCODE, $it.url)
  }
}
Write-Host 'DONE'
