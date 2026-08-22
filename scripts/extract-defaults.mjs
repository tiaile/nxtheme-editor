// 从 systemData/<applet>/blyt/*.bflyt 提取每个 Pane 的官方默认属性，
// 生成 dist-offline/applets/dll/defaults.json（复合键：blyt/<文件>.bflyt::<Pane>）。
// 用法：node scripts/extract-defaults.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(fileURLToPath(import.meta.url))
const proj = join(root, "..")
const SYSTEM = join(proj, "systemData")
const OUT = join(proj, "dist-offline", "applets", "dll", "defaults.json")

// 启动 bflyt 解析。这些 section 都以 pan1 的 84 字节 Pane 头开头。
const PANE_MAGICS = new Set(["pan1", "pic1", "txt1", "wnd1", "bnd1", "prt1"])

function parseBflyt(buf) {
  if (buf.length < 0x14) return []
  if (buf.toString("ascii", 0, 4) !== "FLYT") return []
  const headerSize = buf.readUInt16LE(6)
  const paneNames = (o) => {
    let s = ""
    for (let i = o; i < o + 24; i++) {
      const c = buf[i]
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s
  }
  let off = headerSize
  const out = []
  while (off + 8 <= buf.length) {
    const magic = buf.toString("ascii", off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (size <= 0) break
    if (PANE_MAGICS.has(magic) && off + 0x54 <= buf.length) {
      const name = paneNames(off + 0x0c)
      if (name) {
        const f32 = (o) => buf.readFloatLE(o)
        out.push({
          pane: name,
          visible: (buf[off + 0x08] & 1) === 1,
          alpha: buf[off + 0x0a],
          posX: f32(off + 0x2c),
          posY: f32(off + 0x30),
          scaleX: f32(off + 0x44),
          scaleY: f32(off + 0x48),
          width: f32(off + 0x4c),
          height: f32(off + 0x50),
        })
      }
    }
    off += size
  }
  return out
}

const froat = (v) => (Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1e4) / 1e4)

// 收集所有 applet 的 blyt 文件
const applets = readdirSync(SYSTEM, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
// ResidentMenu 优先（主页为默认补丁目标），同一文件名的默认值以它为准
applets.sort((a, b) => (a === "ResidentMenu" ? -1 : b === "ResidentMenu" ? 1 : a.localeCompare(b)))

const defaults = {} // key -> pane default
let fileCount = 0
let paneCount = 0

for (const applet of applets) {
  const blytDir = join(SYSTEM, applet, "blyt")
  if (!existsSync(blytDir)) continue
  for (const f of readdirSync(blytDir)) {
    if (!f.toLowerCase().endsWith(".bflyt")) continue
    const buf = readFileSync(join(blytDir, f))
    const panes = parseBflyt(buf)
    const base = `blyt/${f}`
    for (const p of panes) {
      // 复合键：文件::Pane。同名文件/同 Pane 时，ResidentMenu 优先（已排到最前，用覆盖保证）
      defaults[`${base}::${p.pane}`] = {
        Position: { X: froat(p.posX), Y: froat(p.posY) },
        Scale: { X: froat(p.scaleX), Y: froat(p.scaleY) },
        Size: { X: froat(p.width), Y: froat(p.height) },
        Visible: p.visible,
      }
      paneCount++
    }
    fileCount++
  }
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(defaults, null, "\t"))
console.log(`扫描 ${applets.length} 个 applet，${fileCount} 个 bflyt，提取 ${paneCount} 个 Pane；写入 ${OUT}（${Object.keys(defaults).length} 键）`)