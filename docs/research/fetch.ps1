$ErrorActionPreference = 'Continue'
$outDir = 'D:\Develop\scribe-flow\docs\research\raw'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$items = @(
  @{ name='n8n-node-types';      url='https://docs.n8n.io/integrations/builtin/node-types/' },
  @{ name='n8n-core-features';   url='https://docs.n8n.io/workflows/' },
  @{ name='n8n-ai';              url='https://docs.n8n.io/advanced-ai/' },
  @{ name='dify-workflow';       url='https://docs.dify.ai/en/guides/workflow' },
  @{ name='dify-nodes';          url='https://docs.dify.ai/en/guides/workflow/node' },
  @{ name='coze-workflow';       url='https://www.coze.cn/docs/guides/workflow' },
  @{ name='langflow-components'; url='https://docs.langflow.org/components' },
  @{ name='flowise-integrations';url='https://docs.flowiseai.com/integrations' },
  @{ name='fastgpt-workflow';    url='https://doc.fastgpt.in/docs/workflow/intro/' },
  @{ name='zapier-features';     url='https://docs.zapier.com/' },
  @{ name='zapier-paths';        url='https://docs.zapier.com/build/paths' },
  @{ name='make-flow-control';   url='https://www.make.com/en/help/tools/flow-control' },
  @{ name='power-automate';      url='https://learn.microsoft.com/en-us/power-automate/flow-types' },
  @{ name='ifttt';               url='https://ifttt.com/explore' },
  @{ name='hiflow';              url='https://hiflow.tencent.com/' },
  @{ name='jijyun';              url='https://www.jijyun.cn/' },
  @{ name='airflow-features';    url='https://airflow.apache.org/docs/apache-airflow/stable/index.html' },
  @{ name='prefect-docs';        url='https://docs.prefect.io/v3/get-started/quickstart' },
  @{ name='dagster-docs';        url='https://docs.dagster.io/' },
  @{ name='dolphinscheduler';    url='https://dolphinscheduler.apache.org/en-us/docs/3.2.2/introduction' },
  @{ name='bibigpt';             url='https://bibigpt.co/' },
  @{ name='tingwu';              url='https://tingwu.aliyun.com/' },
  @{ name='feishu-minutes';      url='https://www.feishu.cn/product/minutes' },
  @{ name='notebooklm';          url='https://notebooklm.google.com/' },
  @{ name='camunda';             url='https://camunda.com/platform-7/' },
  @{ name='aws-stepfunctions';   url='https://aws.amazon.com/step-functions/features/' },
  @{ name='github-actions';      url='https://docs.github.com/en/actions' },
  @{ name='comfyui';             url='https://docs.comfy.org/' }
)
foreach ($it in $items) {
  $out = Join-Path $outDir ($it.name + '.html')
  $url = $it.url
  try {
    & curl.exe -sS -L --max-time 30 -A $ua -o $out $url 2>$null
    if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) {
      $len = (Get-Item $out).Length
      Write-Host ("OK   {0,-22} {1,8} bytes  {2}" -f $it.name, $len, $url)
    } else {
      Write-Host ("FAIL {0,-22} exit={1}  {2}" -f $it.name, $LASTEXITCODE, $url)
    }
  } catch {
    Write-Host ("ERR  {0,-22} {1}" -f $it.name, $_.Exception.Message)
  }
}
Write-Host 'DONE'
