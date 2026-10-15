// 正文抽取可抓性实测：与 Cherry Studio 同款的 fetch → jsdom → @mozilla/readability → turndown 链路
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SNIFFS = [
  ['反爬-安全验证', /安全验证|滑动验证|请完成验证|验证码/],
  ['反爬-JS必需', /请开启\s*JavaScript|Enable JavaScript|Just a moment|Checking your browser/i],
  ['墙-需登录', /登录后查看|请先登录|扫码登录|Sign in to continue/i],
  ['报错页', /页面不存在|404 Not Found|内容不存在|该内容已被发布者删除/],
  ['正常-文章正文', /<article|class="[^"]*(article|content|post|rich_media)[^"]*"/i],
]

// 中文源 9 条 + 英文对照 3 条（对照用来验证「测量工具本身没问题」）
const TARGETS = [
  ['zhihu-question', 'https://www.zhihu.com/question/629933428'],
  ['zhihu-article', 'https://www.zhihu.com/tardis/zm/art/675509396'],
  ['baike-baidu', 'https://baike.baidu.com/item/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD'],
  ['wiki-zh', 'https://zh.wikipedia.org/wiki/%E6%A3%80%E7%B4%A2%E5%A2%9E%E5%BC%BA%E7%94%9F%E6%88%90'],
  ['bilibili-video', 'https://www.bilibili.com/video/BV1nyJ66PEPQ'],
  ['tencent-cloud', 'https://cloud.tencent.com/developer/article/2754056'],
  ['aliyun-dev', 'https://developer.aliyun.com/article/1770352'],
  ['huawei-cloud', 'https://bbs.huaweicloud.com/blogs/497335'],
  ['wechat-mp', 'https://mp.weixin.qq.com/s/tVJ1u9v9oKunQuZExzsViw'],
  ['arxiv-abs', 'https://arxiv.org/abs/2402.14207'],
  ['github-repo', 'https://github.com/stanford-oval/storm'],
  ['wiki-en', 'https://en.wikipedia.org/wiki/Retrieval-augmented_generation'],
]

const td = new TurndownService({ headingStyle: 'atx' })
td.use(gfm)

function detectCharset(buf, contentType) {
  const head = buf.slice(0, 4096).toString('latin1')
  const meta = head.match(/charset\s*=\s*["']?([\w-]+)/i)
  const header = (contentType || '').match(/charset=([\w-]+)/i)
  return (header?.[1] || meta?.[1] || 'utf-8').toLowerCase()
}

function decode(buf, charset, contentType) {
  const cs = /gb2312|gbk|gb18030/.test(charset) ? 'gb18030' : charset
  try {
    return new TextDecoder(cs).decode(buf)
  } catch {
    return buf.toString('utf8')
  }
}

const rows = []
for (const [name, url] of TARGETS) {
  const t0 = Date.now()
  const row = { name, url, status: 0, htmlBytes: 0, charset: '', title: '', textChars: 0, ms: 0, sniff: [], head: '', err: '' }
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(20000),
    })
    row.status = res.status
    const buf = Buffer.from(await res.arrayBuffer())
    row.htmlBytes = buf.length
    row.charset = detectCharset(buf, res.headers.get('content-type'))
    const html = decode(buf, row.charset, res.headers.get('content-type'))
    for (const [label, re] of SNIFFS) if (re.test(html)) row.sniff.push(label)
    const dom = new JSDOM(html, { url })
    const doc = dom.window.document
    const rawTitle = (doc.title || '').trim()
    const art = new Readability(doc).parse() // 注意：parse 会改动 document
    row.title = (art?.title || rawTitle).slice(0, 40)
    if (art) {
      const md = td.turndown(art.content || '')
      row.textChars = md.length
      row.head = md.replace(/\s+/g, ' ').trim().slice(0, 110)
    }
  } catch (e) {
    row.err = String(e && e.message || e).slice(0, 80)
  }
  row.ms = Date.now() - t0
  rows.push(row)
  console.log(`${name.padEnd(16)} ${String(row.status).padEnd(4)} html=${String(row.htmlBytes).padStart(7)} charset=${row.charset.padEnd(8)} 正文=${String(row.textChars).padStart(6)}字 ${String(row.ms).padStart(6)}ms ${row.sniff.join('/')}${row.err ? ' ERR:' + row.err : ''}`)
  console.log(`    title: ${row.title}`)
  console.log(`    正文开头: ${row.head}`)
}

const cn = rows.filter((r) => /zhihu|baidu|wiki-zh|bilibili|tencent|aliyun|huawei|wechat|mp\./.test(r.name))
const ok = (r) => r.status === 200 && r.textChars >= 500
console.log(`\n[汇总] 中文/国内样本 ${cn.length} 条，正文≥500字且 HTTP200 的 ${cn.filter(ok).length} 条`)
console.log(`[汇总] 全部样本 ${rows.length} 条，成功 ${rows.filter(ok).length} 条`)
console.log(`[汇总] 命中反爬标记: ${rows.filter((r) => r.sniff.some((s) => s.startsWith('反爬'))).map((r) => r.name).join(',') || '无'}`)
import { writeFileSync } from 'node:fs'
writeFileSync(new URL('./result.json', import.meta.url), JSON.stringify(rows, null, 2))
