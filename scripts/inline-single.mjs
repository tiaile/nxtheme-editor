// 将 .output/public（SINGLE_FILE=1 生成的静态构建）后处理为自包含单文件：
// - 入口 JS 内联为 <script type="module">
// - CSS 内联为 <style>
// - 移除 importmap / modulepreload / 外部脚本引用
// - 修正 runtime baseURL 为相对路径（兼容 file:// 双击打开）
// 输出到 dist-offline/
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs"
import { dirname, join, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"

// 将压缩后的 CSS 美化为多行可读格式。
// 只插入换行/缩进，不删除任何字符，且感知字符串/括号，不会破坏 content:"..."、url(data:...) 等内容。
const formatCss = (css) => {
  let out = ""
  let brace = 0
  let paren = 0
  let quote = null
  let lastNonSpace = ""
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      out += ch
      if (ch === "\\") { out += css[++i] ?? "" } // 字符串内转义
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue }
    if (ch === "(") { paren++; out += ch; continue }
    if (ch === ")") { paren = Math.max(0, paren - 1); out += ch; continue }
    if (ch === "{") { brace++; out += "{\n" + "  ".repeat(brace); continue }
    if (ch === "}") { brace = Math.max(0, brace - 1); out = out.replace(/\s*$/, "") + "\n" + "  ".repeat(brace) + "}\n"; lastNonSpace = ""; continue }
    if (ch === ";" && brace > 0 && paren === 0) { out = out.replace(/\s*$/, "") + ";\n" + "  ".repeat(brace); continue }
    if (ch === "\n" || ch === "\r") continue // 丢弃原有换行（压缩产物无换行，保留防御）
    if (ch === " " || ch === "\t") {
      if (out.endsWith(" ") || out.endsWith("\n") || out.endsWith("  ")) continue
      if (lastNonSpace === "{" || lastNonSpace === "}" || lastNonSpace === ";") continue
    }
    if (ch !== " ") lastNonSpace = ch
    out += ch
  }
  return out
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const publicDir = join(root, ".output", "public")
const nuxtDir = join(publicDir, "_nuxt")
const outDir = join(root, "dist-offline")

if (!existsSync(join(publicDir, "index.html"))) {
  console.error("[inline-single] 未找到 .output/public/index.html，请先执行 SINGLE_FILE=1 的 nuxt generate")
  process.exit(1)
}

let html = readFileSync(join(publicDir, "index.html"), "utf8")

// 1) 找出入口 JS 文件名（从 module 脚本 src 或 importmap 解析）
let entrySrc = html.match(/<script type="module" src="([^"]+)"/)?.[1]
if (!entrySrc) entrySrc = html.match(/"#entry":"([^"]+)"/)?.[1]
if (!entrySrc) {
  console.error("[inline-single] 无法定位入口 JS")
  process.exit(1)
}
const entryName = basename(entrySrc)
const entryPath = join(nuxtDir, entryName)
if (!existsSync(entryPath)) {
  console.error(`[inline-single] 入口 JS 不存在: ${entryPath}`)
  process.exit(1)
}
const js = readFileSync(entryPath, "utf8")

// 2) 找出 CSS 文件（单文件构建下应只有一个 style.*.css）
const cssFile = readdirSync(nuxtDir).find((f) => f.endsWith(".css"))
const css = cssFile ? readFileSync(join(nuxtDir, cssFile), "utf8") : ""

// 3) 移除 importmap
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/g, "")
// 4) 移除 modulepreload
html = html.replace(/<link rel="modulepreload"[^>]*>/g, "")
// 5) 外部 module 脚本替换为内联脚本
html = html.replace(
  /<script type="module" src="[^"]*"[^>]*><\/script>/g,
  () => `<script type="module">\n${js}\n</script>`,
)
// 6) CSS 拆分为独立 style.css（file:// 下 CSS 无跨域限制，可正常加载），
//    HTML 内用相对路径 <link> 引用，便于直接阅读/修改样式；
//    UnoCSS 构建时强制压缩，这里再美化为多行可读格式
if (css) {
  mkdirSync(join(outDir, "applets", "dll"), { recursive: true })
  writeFileSync(join(outDir, "applets", "dll", "style.css"), formatCss(css))
  html = html.replace("</head>", () => `<link rel="stylesheet" href="applets/dll/style.css">\n</head>`)
}
// 7) 修正 runtime baseURL 为相对路径（file:// 下图标等资源按相对路径解析）
html = html.replaceAll('baseURL:"/"', 'baseURL:"./"')

// 写出
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "index.html"), html)

// 复制静态资源（应用内以相对路径引用）
mkdirSync(join(outDir, "applets"), { recursive: true })
const appletsSrc = join(publicDir, "applets")
for (const f of readdirSync(appletsSrc)) {
  copyFileSync(join(appletsSrc, f), join(outDir, "applets", f))
}
const iconSrc = join(publicDir, "themezer-icon.png")
if (existsSync(iconSrc)) {
  mkdirSync(join(outDir, "applets", "dll"), { recursive: true })
  copyFileSync(iconSrc, join(outDir, "applets", "dll", "themezer-icon.png"))
}

console.log(`[inline-single] 完成 -> ${join(outDir, "index.html")}`)
console.log(`  入口: ${entryName} (${(js.length / 1024).toFixed(0)} KB), CSS: ${(css.length / 1024).toFixed(0)} KB`)
