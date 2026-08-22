// 离线预览服务：把 dist-offline 通过本地 HTTP 服务提供，自动打开浏览器。
// 用法：node scripts/preview-server.mjs （或双击 启动预览.cmd）
import { createServer } from "node:http"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, extname, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { exec } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist-offline")
const PORT = Number(process.env.PORT) || 8123

// 方法集合自动落盘目录：dist-offline/applets/dll/nxtheme-methods.json
const METHODS_FILE = join(root, "applets", "dll", "nxtheme-methods.json")
// 用户自定义标注配置文件：dist-offline/applets/dll/pane-labels.json（构建不会覆盖该文件，可跨构建保留）
const PANE_LABELS_FILE = join(root, "applets", "dll", "pane-labels.json")
// 官方默认值配置文件：dist-offline/applets/dll/defaults.json（构建时也内联进 index.html，可在 localhost 下自行改）
const DEFAULTS_FILE = join(root, "applets", "dll", "defaults.json")

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
})

const server = createServer(async (req, res) => {
    try {
        // 禁止缓存，确保刷新总是拿到最新构建（避免旧页面/旧 JS）
        res.setHeader("Cache-Control", "no-store")
        const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname)
        // 方法集合的读写：保存方法时自动写入本机文件夹，下次打开直接读取
        if (pathname === "/api/methods") {
            if (req.method === "POST") {
                const body = await readBody(req)
                JSON.parse(body.toString("utf8")) // 校验是合法 JSON
                await mkdir(dirname(METHODS_FILE), { recursive: true })
                await writeFile(METHODS_FILE, body)
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                res.end('{"ok":true}')
                return
            }
            if (req.method === "GET") {
                const data = await readFile(METHODS_FILE)
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                res.end(data)
                return
            }
        }
        // 用户自定义标注的读写
        if (pathname === "/api/pane-labels") {
            if (req.method === "POST") {
                const body = await readBody(req)
                const { labels } = JSON.parse(body.toString("utf8"))
                await mkdir(dirname(PANE_LABELS_FILE), { recursive: true })
                await writeFile(PANE_LABELS_FILE, JSON.stringify({ labels: labels ?? {} }, null, 2))
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                res.end('{"ok":true}')
                return
            }
            if (req.method === "GET") {
                let data = "{}"
                try {
                    data = await readFile(PANE_LABELS_FILE, "utf8")
                } catch {
                    // 文件不存在时返回空对象
                }
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                res.end(data)
                return
            }
        }
        // 官方默认值配置的读写（localhost 下可自行修改，用于「默认」按钮还原）
        if (pathname === "/api/defaults") {
            if (req.method === "POST") {
                const body = await readBody(req)
                JSON.parse(body.toString("utf8")) // 校验是合法 JSON
                await mkdir(dirname(DEFAULTS_FILE), { recursive: true })
                await writeFile(DEFAULTS_FILE, body)
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                res.end('{"ok":true}')
                return
            }
            if (req.method === "GET") {
                let data = "{}"
                try {
                    data = await readFile(DEFAULTS_FILE, "utf8")
                } catch {
                    // 文件不存在时返回空对象
                }
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                res.end(data)
                return
            }
        }
        // 提取元素的落盘：前端「提取元素」把导入主题的原始元素文件平铺写入 out/
        if (pathname === "/api/extract") {
            if (req.method === "POST") {
                const body = await readBody(req)
                const { files } = JSON.parse(body.toString("utf8"))
                if (!Array.isArray(files) || files.length === 0) {
                    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" })
                    res.end('{"ok":false,"error":"没有可提取的文件"}')
                    return
                }
                const outDir = join(root, "out")
                await mkdir(outDir, { recursive: true })
                for (const f of files) {
                    const name = typeof f?.name === "string" ? f.name : ""
                    const base64 = typeof f?.base64 === "string" ? f.base64 : ""
                    if (!name || !base64) continue
                    // 防目录穿越：只允许平铺的单文件名
                    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
                        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" })
                        res.end(JSON.stringify({ ok: false, error: `非法文件名: ${name}` }))
                        return
                    }
                    await writeFile(join(outDir, name), Buffer.from(base64, "base64"))
                }
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
                res.end(JSON.stringify({ ok: true, count: files.length }))
                return
            }
        }
        const filePath = join(root, pathname === "/" ? "index.html" : pathname)
        // 防目录穿越
        if (filePath !== root && !filePath.startsWith(root + "\\") && !filePath.startsWith(root + "/")) {
            res.writeHead(403)
            res.end("Forbidden")
            return
        }
        const data = await readFile(filePath)
        res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" })
        res.end(data)
    } catch (err) {
        if (err?.code === "ENOENT") {
            res.writeHead(404)
            res.end("404 Not Found")
            return
        }
        res.writeHead(500)
        res.end("500 Internal Server Error")
    }
})

server.on("error", (err) => {
    console.error(`[错误] 端口 ${PORT} 无法使用：${err.code === "EADDRINUSE" ? "端口被占用" : err.message}`)
    console.error("可设置环境变量 PORT=其他端口后重试，例如：set PORT=9000 && node scripts/preview-server.mjs")
    process.exit(1)
})

server.listen(PORT, () => {
    const url = `http://localhost:${PORT}/`
    console.log("")
    console.log("  NXTheme 编辑器 - 离线预览服务已启动")
    console.log(`  ${url}`)
    console.log("  关闭本窗口（Ctrl+C）即可停止服务。")
    console.log("")
    if (process.platform === "win32") {
        exec(`start "" "${url}"`, { windowsHide: true })
    }
})
