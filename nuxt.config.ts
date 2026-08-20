import { defineNuxtConfig } from "nuxt/config"
import { viteSingleFile } from "vite-plugin-singlefile"

// SINGLE_FILE=1 时启用单文件构建（所有 JS/CSS 内联进 index.html，双击即开、零端口）
const singleFile = process.env.SINGLE_FILE === "1"

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  ssr: false,
  modules: ["@nuxt/icon", "@unocss/nuxt", "@una-ui/nuxt"],
  una: {
    prefix: "N",
    themeable: true,
    global: true,
  },
  devtools: {
    enabled: false,
  },
  vite: {
    plugins: singleFile ? [viteSingleFile()] : [],
    build: {
      // 单文件版不压缩：提高内联 JS/CSS 的可读性，方便直接查看与修改
      ...(singleFile
        ? { minify: false, cssMinify: false }
        : {
          // 使用 esbuild 压缩 CSS：lightningcss 会因 Una UI 生成的
          // `::file-selector-button:target` 伪类/伪元素顺序不合法而构建失败，
          // esbuild 解析更宽松，浏览器会安全忽略该规则。
          cssMinify: "esbuild",
        }),
    },
  },
  app: {
    baseURL: singleFile ? "./" : "/",
    // 禁用运行时构建清单（builds/latest.json）：单文件版在 file:// 下无法 fetch
    appManifest: false,
    head: {
      // 强制深色主题：页面整体为深色背景，una-ui 组件变量需跟随深色，
      // 否则输入框等组件文字会用浅色主题的黑色前景
      htmlAttrs: { class: "dark" },
      title: "NXTheme Builder",
      meta: [
        {
          name: "description",
          content: "在本地构建 Nintendo Switch 的 .nxtheme 自定义主菜单主题",
        },
      ],
    },
  },
  nitro: {
    prerender: {
      crawlLinks: true,
      routes: ["/"],
    },
  },
})

