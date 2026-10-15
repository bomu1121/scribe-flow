// 第四轮：实测免费无 key 的正文抽取服务（Jina Reader 全球站 / 国内镜像）对本机抓不到的站点的效果
const TARGETS = [
  ['zhihu-问题页(本机 403)', 'https://www.zhihu.com/question/629933428'],
  ['baike-百度百科(本机 403)', 'https://baike.baidu.com/item/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD'],
  ['wechat-微信文章(readability 失效)', 'https://mp.weixin.qq.com/s/fX-S3fKKDfR3NV4ISAHrZg'],
  ['bili-视频页(简介线索)', 'https://www.bilibili.com/video/BV1nyJ66PEPQ'],
  ['tencent-腾讯云(readability OK 对照)', 'https://cloud.tencent.com/developer/article/2754056'],
]

const HOSTS = [
  ['r.jina.ai(全球)', 'https://r.jina.ai/'],
  ['r.jinaai.cn(国内镜像)', 'https://r.jinaai.cn/'],
]

for (const [hostLabel, host] of HOSTS) {
  console.log(`\n########## ${hostLabel} ##########`)
  for (const [name, url] of TARGETS) {
    const t0 = Date.now()
    try {
      const res = await fetch(host + url, {
        headers: { Accept: 'application/json', 'X-Retain-Images': 'none' },
        signal: AbortSignal.timeout(45000),
      })
      const ms = Date.now() - t0
      const text = await res.text()
      let content = ''
      let title = ''
      try {
        const j = JSON.parse(text)
        const d = j.data || j
        content = (d.content || d.text || '').trim()
        title = (d.title || '').trim()
      } catch {
        content = text
      }
      const head = content.replace(/\s+/g, ' ').slice(0, 100)
      console.log(`  ${name}`)
      console.log(`    status=${res.status} ${ms}ms 正文=${content.length}字 title=${title.slice(0, 40)}`)
      console.log(`    head: ${head}`)
    } catch (e) {
      console.log(`  ${name}\n    ERR ${String(e.message).slice(0, 90)} (${Date.now() - t0}ms)`)
    }
  }
}
