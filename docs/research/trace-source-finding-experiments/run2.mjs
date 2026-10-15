// 第二轮：针对第一轮的疑点做受控复测
// 1) 微信文章抽不出正文 —— 是通用算法失效还是个别文章？多样本 + 直接看 #js_content
// 2) 百度百科 403 —— 是 UA 问题还是 IP/风控问题？
// 3) B 站视频页/专栏文章是否稳定可抓
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const td = new TurndownService({ headingStyle: 'atx' })
td.use(gfm)

const WECHAT = [
  'https://mp.weixin.qq.com/s/tVJ1u9v9oKunQuZExzsViw',
  'https://mp.weixin.qq.com/s/LqDnzCq_WMQcBCjSETwvBQ',
  'https://mp.weixin.qq.com/s/fX-S3fKKDfR3NV4ISAHrZg',
]

async function get(url, headers = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
    signal: AbortSignal.timeout(20000),
  })
  const buf = Buffer.from(await res.arrayBuffer())
  const html = buf.toString('utf8')
  return { status: res.status, bytes: buf.length, html }
}

console.log('===== A. 微信文章多样本 =====')
for (const url of WECHAT) {
  try {
    const { status, bytes, html } = await get(url)
    const dom = new JSDOM(html, { url })
    const doc = dom.window.document
    const node = doc.querySelector('#js_content')
    const nodeText = node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : ''
    // 复制一份给 readability，避免与上面的 DOM 复用互相影响
    const dom2 = new JSDOM(html, { url })
    const art = new Readability(dom2.window.document).parse()
    const artMd = art ? td.turndown(art.content || '') : ''
    console.log(`${url}`)
    console.log(`  status=${status} html=${bytes}B  title=${(doc.title || '').slice(0, 30)}`)
    console.log(`  readability 正文=${artMd.length}字 | #js_content 文本=${nodeText.length}字`)
    console.log(`  #js_content 开头: ${nodeText.slice(0, 90)}`)
  } catch (e) {
    console.log(`${url}  ERR ${e.message}`)
  }
}

console.log('\n===== B. 百度百科：换更完整的请求头 =====')
const baike = 'https://baike.baidu.com/item/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD'
for (const [label, headers] of [
  ['仅 UA', {}],
  ['UA+Referer+Accept', { Referer: 'https://www.baidu.com/', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }],
]) {
  try {
    const { status, bytes, html } = await get(baike, headers)
    const dom = new JSDOM(html, { url: baike })
    const art = new Readability(dom.window.document).parse()
    console.log(`  [${label}] status=${status} html=${bytes}B 正文=${art ? td.turndown(art.content).length : 0}字 sniff=${/百度安全验证/.test(html) ? '安全验证' : '无'}`)
  } catch (e) {
    console.log(`  [${label}] ERR ${e.message}`)
  }
}

console.log('\n===== C. B 站：视频页 + 专栏文章 =====')
const BILI = [
  'https://www.bilibili.com/video/BV19ZJ66sEYZ',
  'https://www.bilibili.com/video/BV1d4p26SExE',
  'https://www.bilibili.com/read/cv28000000',
]
for (const url of BILI) {
  try {
    const { status, bytes, html } = await get(url, { Referer: 'https://www.bilibili.com/' })
    const dom = new JSDOM(html, { url })
    const doc = dom.window.document
    const desc = doc.querySelector('.desc-info-text, .basic-desc-info, [class*="desc"]')
    const descText = desc ? (desc.textContent || '').replace(/\s+/g, ' ').trim() : ''
    const art = new Readability(new JSDOM(html, { url }).window.document).parse()
    const artMd = art ? td.turndown(art.content || '') : ''
    console.log(`${url}`)
    console.log(`  status=${status} html=${bytes}B title=${(doc.title || '').slice(0, 40)}`)
    console.log(`  readability=${artMd.length}字  desc节点=${descText.length}字`)
    console.log(`  desc: ${descText.slice(0, 140)}`)
  } catch (e) {
    console.log(`${url}  ERR ${e.message}`)
  }
}
