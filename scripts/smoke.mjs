import { buildNxthemeArchive, parseNxthemeArchive } from "@themezernx/nxtheme-builder"

import { isTheme, toTheme } from "@themezernx/target-parser"

const normalizeToInfoTarget = (value) => {
  if (!value) return null
  const trimmed = String(value).trim()
  if (isTheme(trimmed)) return trimmed
  const converted = toTheme(trimmed)
  if (converted && isTheme(converted)) return converted
  return null
}

const expectedCanonicalTargets = ["home", "lock", "apps", "set", "news", "user", "psl"]
const legacyMappings = {
  ResidentMenu: "home",
  Entrance: "lock",
  Flaunch: "apps",
  Set: "set",
  Notification: "news",
  MyPage: "user",
  Psl: "psl",
}

for (const [legacy, expected] of Object.entries(legacyMappings)) {
  const resolved = normalizeToInfoTarget(legacy)
  if (resolved !== expected) {
    throw new Error(`Normalization failed for legacy '${legacy}': expected '${expected}', got '${resolved}'`)
  }
}

for (const target of expectedCanonicalTargets) {
  const resolved = normalizeToInfoTarget(target)
  if (resolved !== target) {
    throw new Error(`Normalization failed for canonical '${target}': expected '${target}', got '${resolved}'`)
  }
}

if (normalizeToInfoTarget("invalid-target") !== null) {
  throw new Error("Normalization failed: expected invalid target to return null")
}

const built = buildNxthemeArchive({
  name: "Smoke Theme",
  author: "Smoke Test",
  targetThemeValue: "home",
  assets: {},
})

const parsed = parseNxthemeArchive(built)

if (!parsed.info) {
  throw new Error("Smoke test failed: missing manifest info")
}

if (parsed.info.ThemeName !== "Smoke Theme") {
  throw new Error(`Smoke test failed: unexpected ThemeName '${parsed.info.ThemeName}'`)
}

if (parsed.info.Author !== "Smoke Test") {
  throw new Error(`Smoke test failed: unexpected Author '${parsed.info.Author}'`)
}

if (parsed.info.Target !== "home") {
  throw new Error(`Smoke test failed: unexpected Target '${parsed.info.Target}'`)
}

console.log("Smoke test passed: build + parse round trip with canonical info target works.")

