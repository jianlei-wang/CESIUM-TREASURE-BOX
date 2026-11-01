/**
 * 拼接 public 目录下的静态资源地址。
 *
 * 构建产物的 base 是 `./`（GitHub Pages 部署在仓库子路径下），因此不能直接写
 * `/images/foo.png` 这类以斜杠开头的绝对路径，否则会解析到域名根目录而 404。
 *
 * 这里用 `import.meta.env.BASE_URL` 前缀，并基于 `document.baseURI` 解析成绝对地址：
 * 相对地址在 `import()` 这类场景会按模块 URL 解析（落到 /assets/ 下），用绝对地址
 * 可以保证图片、模型、视频、模块脚本都指向正确的部署子路径。
 */
export function assetUrl(path: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path
  }
  const base = import.meta.env.BASE_URL || '/'
  const normalized = path.replace(/^\/+/, '')
  const relative = base.endsWith('/') ? `${base}${normalized}` : `${base}/${normalized}`
  if (typeof document === 'undefined') return relative
  return new URL(relative, document.baseURI).href
}
