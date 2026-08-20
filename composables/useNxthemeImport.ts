import {
  getNxthemeImportedAuthor,
  parseNxthemeArchive,
  NXTHEME_ASSET_FILENAMES,
  NXTHEME_FILENAMES,
  type NxthemeAssetKey,
  type ParsedNxthemeEntries,
} from "@themezernx/nxtheme-builder"
import { normalizeToInfoTarget, type SwitchThemeFormData, type ThemeAssets } from "~/types/switch-theme"
const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
    const out = new Uint8Array(bytes.byteLength)
    out.set(bytes)
    return out.buffer
}

const toAssetFile = (assetKey: NxthemeAssetKey, data: Uint8Array): File => {
  const fileName = NXTHEME_ASSET_FILENAMES[assetKey]
  const mimeType = fileName.endsWith(".jpg") ? "image/jpeg" : "image/png"
  return new File([bytesToArrayBuffer(data)], fileName, { type: mimeType })
}

// 最近一次导入的解析结果，供「提取元素」使用
const lastImported = ref<ParsedNxthemeEntries | null>(null)

const textEncoder = new TextEncoder()

// 把导入主题里的原始元素文件（info/layout/common/各图片）收集成 {name, data} 列表
const collectImportedFiles = (): { name: string; data: Uint8Array }[] => {
    const parsed = lastImported.value
    if (!parsed) return []
    const files: { name: string; data: Uint8Array }[] = []
    if (parsed.info) {
        files.push({ name: NXTHEME_FILENAMES.manifest, data: textEncoder.encode(JSON.stringify(parsed.info, null, 2)) })
    }
    if (parsed.layoutJson) {
        files.push({ name: NXTHEME_FILENAMES.layout, data: textEncoder.encode(parsed.layoutJson) })
    }
    if (parsed.commonJson) {
        files.push({ name: NXTHEME_FILENAMES.common, data: textEncoder.encode(parsed.commonJson) })
    }
    for (const [key, data] of Object.entries(parsed.assets) as [NxthemeAssetKey, Uint8Array][]) {
        files.push({ name: NXTHEME_ASSET_FILENAMES[key], data })
    }
    return files
}

export const useNxthemeImport = () => {
  const importNxtheme = async (
    file: File,
    currentForm: SwitchThemeFormData,
  ): Promise<{ nextForm: SwitchThemeFormData; warning?: string }> => {
    const parsed = parseNxthemeArchive(new Uint8Array(await file.arrayBuffer()))
    lastImported.value = parsed
    if (!parsed.info) {
      throw new Error("无效的 NXTheme：缺少 info.json")
    }

    const assets: ThemeAssets = {}
    for (const [key, value] of Object.entries(parsed.assets) as [NxthemeAssetKey, Uint8Array][]) {
      assets[key] = toAssetFile(key, value)
    }

    const infoTarget = normalizeToInfoTarget(parsed.info.Target)
    if (!infoTarget) {
      throw new Error(`info.json 中的目标无效或不支持：'${parsed.info.Target}'`)
    }
    const warning = parsed.unsupportedFiles.length > 0
      ? `已忽略不支持的（多余）文件：${parsed.unsupportedFiles.join(", ")}`
      : undefined

    return {
      nextForm: {
        ...currentForm,
        name: parsed.info.ThemeName || currentForm.name,
        author: getNxthemeImportedAuthor(parsed.info) ?? parsed.info.Author ?? currentForm.author,
        target: infoTarget,
        layoutJson: parsed.layoutJson || "",
        commonJson: parsed.commonJson || "",
        assets: {
          ...currentForm.assets,
          ...assets,
        },
      },
      warning,
    }
  }

  return {
    importNxtheme,
    collectImportedFiles,
  }
}


