// 第三轮：量化「B 站视频简介自带来源线索」的比例，并找真实专栏 URL 复测
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function j(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }, signal: AbortSignal.timeout(20000) })
  return res.json()
}

const LINK_RE = /https?:\/\/[^\s，。、）)】\]"']+/
const HINT_RE = /来源|参考|资料|文献|出处|原文|引用|报道|援引|数据来自|据.*报道|详见|阅读原文/

function analyze(list, label) {
  const rows = list.map((v) => {
    const desc = v.desc || ''
    const links = [...desc.matchAll(new RegExp(LINK_RE, 'g'))].map((m) => m[0])
    const bvRefs = [...desc.matchAll(/BV[0-9A-Za-z]{10}/g)].map((m) => m[0])
    return {
      bvid: v.bvid,
      title: (v.title || '').replace(/<[^>]+>/g, '').slice(0, 34),
      tname: v.tname,
      descLen: desc.length,
      nLinks: links.length,
      nBvRefs: bvRefs.length,
      hasHint: HINT_RE.test(desc),
      sampleLink: links[0] || '',
    }
  })
  const withAnything = rows.filter((r) => r.nLinks > 0 || r.hasHint || r.nBvRefs > 0)
  console.log(`\n===== ${label}（样本 ${rows.length} 条）=====`)
  console.log(`简介含外链的: ${rows.filter((r) => r.nLinks > 0).length} 条 (${((rows.filter((r) => r.nLinks > 0).length / rows.length) * 100).toFixed(0)}%)`)
  console.log(`简介含「来源/参考/文献/据…报道」类字样的: ${rows.filter((r) => r.hasHint).length} 条 (${((rows.filter((r) => r.hasHint).length / rows.length) * 100).toFixed(0)}%)`)
  console.log(`简介含 BV 号引用的: ${rows.filter((r) => r.nBvRefs > 0).length} 条`)
  console.log(`至少含一种来源线索的合计: ${withAnything.length} 条 (${((withAnything.length / rows.length) * 100).toFixed(0)}%)`)
  console.log(`简介为空的: ${rows.filter((r) => r.descLen === 0).length} 条`)
  const show = rows.filter((r) => r.nLinks > 0 || r.hasHint).slice(0, 8)
  for (const r of show) console.log(`  · [${r.tname}] ${r.title} | desc=${r.descLen}字 链${r.nLinks} hint=${r.hasHint} | ${r.sampleLink.slice(0, 60)}`)
  return rows
}

const pop = await j('https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1')
analyze(pop.data.list, '全站热门 Top50')

// 知识区排行（rid=36 科技 / 201 科学科普）—— 溯源需求最集中的区
for (const [rid, name] of [[36, '科技区排行'], [201, '科学科普区排行']]) {
  try {
    const r = await j(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`)
    if (r.code === 0 && r.data && r.data.list) analyze(r.data.list.slice(0, 50), `${name} Top${Math.min(50, r.data.list.length)}`)
    else console.log(`${name} code=${r.code} ${r.message}`)
  } catch (e) {
    console.log(`${name} ERR ${e.message}`)
  }
}

// 找真实专栏 cv 号：从视频页 HTML 里抓 /read/cv 链接
console.log('\n===== 找真实专栏 URL =====')
const page = await fetch('https://www.bilibili.com/video/BV1nyJ66PEPQ', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
const html = await page.text()
const cvs = [...new Set([...html.matchAll(/\/read\/cv(\d+)/g)].map((m) => m[1]))]
console.log('视频页内出现的 cv 号:', cvs.slice(0, 5))
for (const cv of cvs.slice(0, 2)) {
  const url = `https://www.bilibili.com/read/cv${cv}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  const body = await res.text()
  const m = body.match(/<title>([^<]*)<\/title>/)
  console.log(`  ${url} status=${res.status} html=${body.length}B title=${m ? m[1].slice(0, 40) : '(无)'} 含正文标记=${/opus-module-content|article-content|read-article-holder/.test(body)}`)
}
