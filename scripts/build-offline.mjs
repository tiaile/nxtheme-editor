// 一键构建离线单文件版：
// 1) 以 SINGLE_FILE=1 执行 `nuxt generate`（产生单 chunk 静态构建）
// 2) 执行 inline-single.mjs 内联为自包含 dist-offline/index.html
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

// 直接调 nuxt 二进制，避免 spawn npm.cmd（Windows 沙箱下会 EINVAL）
const generate = spawnSync(process.execPath, ["node_modules/nuxt/bin/nuxt.mjs", "generate"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SINGLE_FILE: "1",
    NODE_DISABLE_COMPILE_CACHE: "1",
  },
})
if (generate.status !== 0) {
  process.exit(generate.status ?? 1)
}

const inline = spawnSync(process.execPath, ["scripts/inline-single.mjs"], {
  cwd: root,
  stdio: "inherit",
})
process.exit(inline.status ?? 1)
