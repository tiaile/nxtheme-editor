import {
  type NxthemeAssetKey,
  NXTHEME_ASSET_KEYS,
} from "@themezernx/nxtheme-builder"
import { isTheme, toTheme } from "@themezernx/target-parser"

export type NxthemeInfoTarget =
  | "home"
  | "lock"
  | "apps"
  | "set"
  | "news"
  | "user"
  | "psl"

export const INFO_TARGETS: readonly NxthemeInfoTarget[] = [
  "home",
  "lock",
  "apps",
  "set",
  "news",
  "user",
  "psl",
] as const

export const INFO_TARGET_LABELS: Record<NxthemeInfoTarget, { title: string; icon: string }> = {
  home: { title: "主界面", icon: "i-mdi-home" },
  lock: { title: "锁屏", icon: "i-mdi-lock" },
  apps: { title: "全部应用", icon: "i-mdi-apps" },
  set: { title: "设置", icon: "i-mdi-cog" },
  news: { title: "资讯", icon: "i-mdi-newspaper-variant" },
  user: { title: "用户页", icon: "i-mdi-account" },
  psl: { title: "选择玩家", icon: "i-mdi-account-multiple" },
}

export const normalizeToInfoTarget = (value: string | null | undefined): NxthemeInfoTarget | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (isTheme(trimmed)) {
    return trimmed as NxthemeInfoTarget
  }
  const converted = toTheme(trimmed)
  if (converted && isTheme(converted)) {
    return converted as NxthemeInfoTarget
  }
  return null
}
export type ThemeAssets = Partial<Record<NxthemeAssetKey, File | null>>

export type SwitchThemeFormData = {
  name: string
  author: string
  target: NxthemeInfoTarget
  layoutJson: string
  commonJson: string
  assets: ThemeAssets
}

export type AssetSizingRule = {
  width: number
  height: number
  mimeType: "image/jpeg" | "image/png"
  fileName: string
}

export const ASSET_SIZING_RULES: Record<NxthemeAssetKey, AssetSizingRule> = {
  backgroundImage: {
    width: 1280,
    height: 720,
    mimeType: "image/jpeg",
    fileName: "image.jpg",
  },
  albumIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "album.png" },
  newsIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "news.png" },
  shopIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "shop.png" },
  controllerIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "controller.png" },
  settingsIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "settings.png" },
  powerIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "power.png" },
  nsoIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "nso.png" },
  cardIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "card.png" },
  shareIcon: { width: 64, height: 56, mimeType: "image/png", fileName: "share.png" },
  homeIcon: { width: 184, height: 168, mimeType: "image/png", fileName: "lock.png" },
}

export const ASSET_DISPLAY_NAMES: Record<NxthemeAssetKey, string> = {
  backgroundImage: "背景",
  albumIcon: "相册",
  newsIcon: "资讯",
  shopIcon: "eShop",
  controllerIcon: "手柄",
  settingsIcon: "设置",
  powerIcon: "电源",
  nsoIcon: "NSO",
  cardIcon: "游戏卡带",
  shareIcon: "分享",
  homeIcon: "主页",
}

export const ASSET_ICON_PRESETS: Partial<Record<NxthemeAssetKey, string>> = {
  albumIcon: "applets/album.png",
  newsIcon: "applets/news.png",
  shopIcon: "applets/shop.png",
  controllerIcon: "applets/controller.png",
  settingsIcon: "applets/settings.png",
  powerIcon: "applets/power.png",
  nsoIcon: "applets/online.png",
  cardIcon: "applets/card.png",
  shareIcon: "applets/share.png",
  homeIcon: "applets/home.png",
}

const INFO_TARGET_ALLOWED_ICONS: Record<NxthemeInfoTarget, NxthemeAssetKey[]> = {
  home: ["nsoIcon", "newsIcon", "shopIcon", "albumIcon", "shareIcon", "controllerIcon", "cardIcon", "settingsIcon", "powerIcon"],
  lock: ["homeIcon"],
  apps: [],
  set: [],
  news: [],
  user: [],
  psl: [],
}

export const getAllowedAssetKeysByTarget = (infoTarget: NxthemeInfoTarget): NxthemeAssetKey[] => {
  const allowed = new Set<NxthemeAssetKey>([
    ...(INFO_TARGET_ALLOWED_ICONS[infoTarget] || []),
    "backgroundImage",
  ])
  return NXTHEME_ASSET_KEYS.filter((key) => allowed.has(key))
}

