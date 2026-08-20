<script setup lang="ts">
import { NXTHEME_ASSET_FILENAMES, type NxthemeAssetKey } from "@themezernx/nxtheme-builder"
import { useNxthemeBuilder } from "~/composables/useNxthemeBuilder"
import { useNxthemeImport } from "~/composables/useNxthemeImport"
import {
    ASSET_DISPLAY_NAMES,
    ASSET_ICON_PRESETS,
    ASSET_SIZING_RULES,
    getAllowedAssetKeysByTarget,
    INFO_TARGETS,
    INFO_TARGET_LABELS,
    type SwitchThemeFormData,
} from "~/types/switch-theme"

const createInitialForm = (): SwitchThemeFormData => ({
    name: "",
    author: "",
    target: "home",
    layoutJson: "",
    commonJson: "",
    assets: {},
})

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)
const ASPECT_EPSILON = 0.0001

const form = ref<SwitchThemeFormData>(createInitialForm())
const loading = ref(false)
const error = ref("")
const warning = ref("")
const { toast } = useToast()
const importInput = ref<HTMLInputElement | null>(null)
const layoutJsonInput = ref<HTMLInputElement | null>(null)
const commonJsonInput = ref<HTMLInputElement | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)
const authorInputRef = ref<HTMLInputElement | null>(null)
const nameInputTouched = ref(false)
const authorInputTouched = ref(false)
const previewUrls = ref<Partial<Record<NxthemeAssetKey, string>>>({})
const assetInputRefs = ref<Partial<Record<NxthemeAssetKey, HTMLInputElement | null>>>({})
const dragActive = ref<Partial<Record<NxthemeAssetKey, boolean>>>({})

const cropCanvas = ref<HTMLCanvasElement | null>(null)
const cropSource = ref("")
const cropImage = ref<HTMLImageElement | null>(null)
const cropAssetKey = ref<NxthemeAssetKey | null>(null)
const cropFileName = ref("")
const cropState = reactive({
    zoom: 1,
    minZoom: 1,
    x: 50,
    y: 50,
})

const cropDrag = reactive({
    active: false,
    pointerId: -1,
    startPointerX: 0,
    startPointerY: 0,
    startCropX: 0,
    startCropY: 0,
})

const { buildAndDownload } = useNxthemeBuilder()
const { importNxtheme, collectImportedFiles } = useNxthemeImport()
const runtimeConfig = useRuntimeConfig()

const allowedAssetKeys = computed(() => getAllowedAssetKeysByTarget(form.value.target))
const backgroundAssetKey = computed<NxthemeAssetKey | null>(() => (
    allowedAssetKeys.value.includes("backgroundImage") ? "backgroundImage" : null
))
const iconAssetKeys = computed(() => allowedAssetKeys.value.filter((key) => key !== "backgroundImage"))

const presetIconUrl = (assetKey: NxthemeAssetKey): string | null => {
    const path = ASSET_ICON_PRESETS[assetKey]
    if (!path) return null
    const base = runtimeConfig.app.baseURL || "/"
    return `${base.replace(/\/$/, "")}/${path}`
}

const themezerIconUrl = computed(() => {
    const base = runtimeConfig.app.baseURL || "/"
    return `${base.replace(/\/$/, "")}/applets/dll/themezer-icon.png`
})

const clearPreview = (assetKey: NxthemeAssetKey) => {
    const url = previewUrls.value[assetKey]
    if (url) {
        URL.revokeObjectURL(url)
    }
    delete previewUrls.value[assetKey]
}

const setPreviewFromFile = (assetKey: NxthemeAssetKey, file: File) => {
    clearPreview(assetKey)
    previewUrls.value[assetKey] = URL.createObjectURL(file)
}

const closeCropEditor = () => {
    cropDrag.active = false
    cropDrag.pointerId = -1
    if (cropSource.value) {
        URL.revokeObjectURL(cropSource.value)
    }
    cropSource.value = ""
    cropImage.value = null
    cropAssetKey.value = null
    cropFileName.value = ""
}

const getCropRegion = () => {
    const assetKey = cropAssetKey.value
    const image = cropImage.value
    if (!assetKey || !image) return null

    const rule = ASSET_SIZING_RULES[assetKey]
    const cropWidth = rule.width / cropState.zoom
    const cropHeight = rule.height / cropState.zoom
    const maxX = Math.max(0, image.width - cropWidth)
    const maxY = Math.max(0, image.height - cropHeight)
    const cropX = clamp((cropState.x / 100) * maxX, 0, maxX)
    const cropY = clamp((cropState.y / 100) * maxY, 0, maxY)

    return {
        rule,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        maxX,
        maxY,
    }
}

const cropEditorMetrics = computed(() => {
    const image = cropImage.value
    const region = getCropRegion()
    if (!image || !region) return null

    const maxPreviewWidth = 560
    const maxPreviewHeight = 360
    const scale = Math.min(maxPreviewWidth / image.width, maxPreviewHeight / image.height, 1)

    return {
        scale,
        displayWidth: Math.max(1, Math.round(image.width * scale)),
        displayHeight: Math.max(1, Math.round(image.height * scale)),
        frameLeft: region.cropX * scale,
        frameTop: region.cropY * scale,
        frameWidth: region.cropWidth * scale,
        frameHeight: region.cropHeight * scale,
        maxX: region.maxX,
        maxY: region.maxY,
        cropX: region.cropX,
        cropY: region.cropY,
    }
})

const setCropPositionFromPixels = (cropX: number, cropY: number, maxX: number, maxY: number) => {
    const nextX = clamp(cropX, 0, maxX)
    const nextY = clamp(cropY, 0, maxY)
    cropState.x = maxX === 0 ? 50 : (nextX / maxX) * 100
    cropState.y = maxY === 0 ? 50 : (nextY / maxY) * 100
}

const startCropDrag = (event: PointerEvent) => {
    const metrics = cropEditorMetrics.value
    if (!metrics) return

    const target = event.currentTarget as HTMLElement | null
    target?.setPointerCapture(event.pointerId)

    cropDrag.active = true
    cropDrag.pointerId = event.pointerId
    cropDrag.startPointerX = event.clientX
    cropDrag.startPointerY = event.clientY
    cropDrag.startCropX = metrics.cropX
    cropDrag.startCropY = metrics.cropY
}

const onCropDragMove = (event: PointerEvent) => {
    if (!cropDrag.active || cropDrag.pointerId !== event.pointerId) return
    const metrics = cropEditorMetrics.value
    if (!metrics) return

    const deltaX = (event.clientX - cropDrag.startPointerX) / metrics.scale
    const deltaY = (event.clientY - cropDrag.startPointerY) / metrics.scale
    setCropPositionFromPixels(cropDrag.startCropX + deltaX, cropDrag.startCropY + deltaY, metrics.maxX, metrics.maxY)
}

const stopCropDrag = (event?: PointerEvent) => {
    if (event) {
        const target = event.currentTarget as HTMLElement | null
        if (cropDrag.pointerId !== -1) {
            target?.releasePointerCapture(cropDrag.pointerId)
        }
    }
    cropDrag.active = false
    cropDrag.pointerId = -1
}

const loadImageFromFile = async (file: File): Promise<HTMLImageElement> => {
    const source = URL.createObjectURL(file)
    try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve(image)
            image.onerror = () => reject(new Error("无法读取图片文件。"))
            image.src = source
        })
    } finally {
        URL.revokeObjectURL(source)
    }
}

const canvasToAssetFile = async (canvas: HTMLCanvasElement, assetKey: NxthemeAssetKey): Promise<File> => {
    const rule = ASSET_SIZING_RULES[assetKey]
    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, rule.mimeType, rule.mimeType === "image/jpeg" ? 1 : undefined)
    })
    if (!blob) {
        throw new Error("无法编码缩放后的图片。")
    }
    return new File([blob], rule.fileName, { type: rule.mimeType })
}

const autoResizeAsset = async (assetKey: NxthemeAssetKey, image: HTMLImageElement): Promise<File> => {
    const rule = ASSET_SIZING_RULES[assetKey]
    const canvas = document.createElement("canvas")
    canvas.width = rule.width
    canvas.height = rule.height
    const context = canvas.getContext("2d")
    if (!context) {
        throw new Error("无法初始化缩放画布。")
    }

    context.drawImage(image, 0, 0, image.width, image.height, 0, 0, rule.width, rule.height)
    return await canvasToAssetFile(canvas, assetKey)
}

const drawCropPreview = () => {
    const region = getCropRegion()
    const canvas = cropCanvas.value
    const image = cropImage.value
    if (!region || !canvas || !image) return

    const previewMaxWidth = 420
    const ratio = region.rule.width / region.rule.height
    const width = Math.min(previewMaxWidth, region.rule.width)
    const height = width / ratio
    canvas.width = Math.round(width)
    canvas.height = Math.round(height)

    const context = canvas.getContext("2d")
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(
        image,
        region.cropX,
        region.cropY,
        region.cropWidth,
        region.cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
    )
}

watch(() => [cropState.zoom, cropState.x, cropState.y, cropAssetKey.value], drawCropPreview)

watch(
    () => form.value.target,
    (target) => {
        const allowed = new Set(getAllowedAssetKeysByTarget(target))
        for (const key of Object.keys(form.value.assets) as NxthemeAssetKey[]) {
            if (!allowed.has(key)) {
                form.value.assets[key] = null
                clearPreview(key)
            }
        }
        if (target !== "home") {
            form.value.commonJson = ""
        }
    },
)

onBeforeUnmount(() => {
    for (const key of Object.keys(previewUrls.value) as NxthemeAssetKey[]) {
        clearPreview(key)
    }
    closeCropEditor()
})

const openCropEditor = async (assetKey: NxthemeAssetKey, file: File) => {
    closeCropEditor()
    cropAssetKey.value = assetKey
    cropFileName.value = file.name
    cropSource.value = URL.createObjectURL(file)

    cropImage.value = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error("无法读取用于裁剪的图片。"))
        image.src = cropSource.value
    })

    const rule = ASSET_SIZING_RULES[assetKey]
    cropState.minZoom = Math.max(rule.width / cropImage.value.width, rule.height / cropImage.value.height)
    cropState.zoom = Math.max(1, cropState.minZoom)
    cropState.x = 50
    cropState.y = 50
    drawCropPreview()
}

const applyCrop = async () => {
    const region = getCropRegion()
    const image = cropImage.value
    const assetKey = cropAssetKey.value
    if (!region || !image || !assetKey) return

    const canvas = document.createElement("canvas")
    canvas.width = region.rule.width
    canvas.height = region.rule.height
    const context = canvas.getContext("2d")
    if (!context) {
        throw new Error("无法初始化导出画布。")
    }

    context.drawImage(
        image,
        region.cropX,
        region.cropY,
        region.cropWidth,
        region.cropHeight,
        0,
        0,
        region.rule.width,
        region.rule.height,
    )

    const nextFile = await canvasToAssetFile(canvas, assetKey)
    form.value.assets[assetKey] = nextFile
    setPreviewFromFile(assetKey, nextFile)
    closeCropEditor()
    toast({
        toast: "solid-success",
        title: "成功",
        description: `已更新 ${ASSET_DISPLAY_NAMES[assetKey]}（${region.rule.width}x${region.rule.height}）`,
    })
}

const removeAsset = (assetKey: NxthemeAssetKey) => {
    form.value.assets[assetKey] = null
    clearPreview(assetKey)
}

const setAssetInputRef = (assetKey: NxthemeAssetKey, element: HTMLInputElement | null) => {
    assetInputRefs.value[assetKey] = element
}

const openAssetPicker = (assetKey: NxthemeAssetKey) => {
    assetInputRefs.value[assetKey]?.click()
}

const handleAssetFile = async (assetKey: NxthemeAssetKey, file: File) => {
    error.value = ""
    warning.value = ""
    try {
        const image = await loadImageFromFile(file)
        const rule = ASSET_SIZING_RULES[assetKey]
        const sourceRatio = image.width / image.height
        const targetRatio = rule.width / rule.height
        const aspectMatches = Math.abs(sourceRatio - targetRatio) <= ASPECT_EPSILON

        if (aspectMatches) {
            const nextFile = await autoResizeAsset(assetKey, image)
            form.value.assets[assetKey] = nextFile
            setPreviewFromFile(assetKey, nextFile)

            if (image.width > rule.width || image.height > rule.height) {
                const message = `${ASSET_DISPLAY_NAMES[assetKey]} 大于推荐尺寸 ${rule.width}x${rule.height}，已自动缩放。`
                warning.value = message
                toast({
                    toast: "solid-warning",
                    title: "图片已自动缩放",
                    description: message,
                })
            } else {
                toast({
                    toast: "solid-success",
                    title: "成功",
                    description: `${ASSET_DISPLAY_NAMES[assetKey]} 已调整为 ${rule.width}x${rule.height}`,
                })
            }
            return
        }

        await openCropEditor(assetKey, file)
    } catch (nextError) {
        error.value = nextError instanceof Error ? nextError.message : "无法打开裁剪编辑器。"
    }
}

const onAssetSelected = async (assetKey: NxthemeAssetKey, event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    await handleAssetFile(assetKey, file)
    input.value = ""
}

const onAssetDragEnter = (assetKey: NxthemeAssetKey) => {
    dragActive.value[assetKey] = true
}

const onAssetDragLeave = (assetKey: NxthemeAssetKey) => {
    dragActive.value[assetKey] = false
}

const onAssetDrop = async (assetKey: NxthemeAssetKey, event: DragEvent) => {
    dragActive.value[assetKey] = false
    const file = event.dataTransfer?.files?.[0]
    if (!file) return
    await handleAssetFile(assetKey, file)
}

const onImportClick = () => {
    importInput.value?.click()
}

const onSelectLayoutJson = () => {
    layoutJsonInput.value?.click()
}

const onSelectCommonJson = () => {
    commonJsonInput.value?.click()
}

const readTextFile = async (file: File): Promise<string> => {
    return await file.text()
}

const onLayoutJsonSelected = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    try {
        form.value.layoutJson = await readTextFile(file)
        error.value = ""
        toast({
            toast: "solid-success",
            title: "成功",
            description: `已加载 ${file.name}`,
        })
    } catch (nextError) {
        error.value = nextError instanceof Error ? nextError.message : "无法读取 layout.json 文件。"
    } finally {
        input.value = ""
    }
}

const onCommonJsonSelected = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    try {
        form.value.commonJson = await readTextFile(file)
        error.value = ""
        toast({
            toast: "solid-success",
            title: "成功",
            description: `已加载 ${file.name}`,
        })
    } catch (nextError) {
        error.value = nextError instanceof Error ? nextError.message : "无法读取 common.json 文件。"
    } finally {
        input.value = ""
    }
}

const clearLayoutJson = () => {
    form.value.layoutJson = ""
}

const clearCommonJson = () => {
    form.value.commonJson = ""
}

const onImportSelected = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    warning.value = ""
    error.value = ""

    try {
        const result = await importNxtheme(file, form.value)
        form.value = result.nextForm
        for (const key of Object.keys(result.nextForm.assets) as NxthemeAssetKey[]) {
            const asset = result.nextForm.assets[key]
            if (asset) setPreviewFromFile(key, asset)
        }
        warning.value = result.warning || ""
        toast({
            toast: "solid-success",
            title: "成功",
            description: `已导入 ${file.name}`,
        })
    } catch (nextError) {
        error.value = nextError instanceof Error ? nextError.message : "导入 NXTheme 失败。"
    } finally {
        input.value = ""
    }
}

const extracting = ref(false)

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = ""
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}

// ---- 离线（file://）模式下的提取：文件夹写入或 ZIP 下载 ----

const crc32Table = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

const crc32 = (bytes: Uint8Array): number => {
    let crc = 0xffffffff
    for (let i = 0; i < bytes.length; i++) {
        crc = crc32Table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

const u16 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >>> 8) & 0xff])
const u32 = (v: number): Uint8Array => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])

// 生成 ZIP（仅存储、不压缩，所有系统均可解压）
const buildZip = (files: { name: string; data: Uint8Array }[]): Blob => {
    const enc = new TextEncoder()
    const chunks: Uint8Array[] = []
    const central: Uint8Array[] = []
    let offset = 0

    for (const f of files) {
        const nameBytes = enc.encode(f.name)
        const data = f.data
        const crc = crc32(data)
        const local = new Uint8Array(30 + nameBytes.length)
        local.set(u32(0x04034b50), 0)
        local.set(u16(20), 4)
        local.set(u16(0x0800), 6) // UTF-8 文件名标志
        local.set(u16(0), 8)
        local.set(u16(0), 10)
        local.set(u16(0), 12)
        local.set(u32(crc), 14)
        local.set(u32(data.length), 18)
        local.set(u32(data.length), 22)
        local.set(u16(nameBytes.length), 26)
        local.set(u16(0), 28)
        local.set(nameBytes, 30)
        chunks.push(local, data)

        const cd = new Uint8Array(46 + nameBytes.length)
        cd.set(u32(0x02014b50), 0)
        cd.set(u16(20), 4)
        cd.set(u16(20), 6)
        cd.set(u16(0x0800), 8)
        cd.set(u16(0), 10)
        cd.set(u16(0), 12)
        cd.set(u16(0), 14)
        cd.set(u32(crc), 16)
        cd.set(u32(data.length), 20)
        cd.set(u32(data.length), 24)
        cd.set(u16(nameBytes.length), 28)
        cd.set(u16(0), 30)
        cd.set(u16(0), 32)
        cd.set(u16(0), 34)
        cd.set(u32(0), 36)
        cd.set(u32(0), 40)
        cd.set(u32(offset), 42)
        cd.set(nameBytes, 46)
        central.push(cd)
        offset += local.length + data.length
    }

    const centralSize = central.reduce((s, c) => s + c.length, 0)
    const eocd = new Uint8Array(22)
    eocd.set(u32(0x06054b50), 0)
    eocd.set(u16(0), 4)
    eocd.set(u16(0), 6)
    eocd.set(u16(files.length), 8)
    eocd.set(u16(files.length), 10)
    eocd.set(u32(centralSize), 12)
    eocd.set(u32(offset), 16)
    eocd.set(u16(0), 20)

    return new Blob([...chunks, ...central, eocd], { type: "application/zip" })
}

const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}

// 提取导入主题的原始元素文件：
// - 预览服务下：写入 dist-offline/out/（无感落盘）
// - 离线成品（file://）下：打包 ZIP 自动下载（无弹窗，保存到浏览器下载目录）
const onExtract = async () => {
    const files = collectImportedFiles()
    if (files.length === 0) {
        toast({
            toast: "solid-warning",
            title: "提示",
            description: "请先点击「导入 .nxtheme」导入一个主题，再提取其元素。",
        })
        return
    }
    extracting.value = true
    try {
        if (!isServerMode) {
            downloadBlob(buildZip(files), `nxtheme-元素-${new Date().toISOString().slice(0, 10)}.zip`)
            toast({
                toast: "solid-success",
                title: "提取成功",
                description: `已下载包含 ${files.length} 个元素文件的 ZIP 压缩包（保存到下载目录）`,
            })
            return
        }
        const res = await fetch("/api/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: files.map((f) => ({ name: f.name, base64: bytesToBase64(f.data) })) }),
        })
        if (!res.ok) {
            const text = await res.text()
            throw new Error(text || `服务器返回 ${res.status}`)
        }
        const data = await res.json()
        toast({
            toast: "solid-success",
            title: "提取成功",
            description: `已保存 ${data?.count ?? files.length} 个元素文件到 out/`,
        })
    } catch (nextError) {
        toast({
            toast: "solid-error",
            title: "提取失败",
            description: nextError instanceof Error ? nextError.message : "未知错误",
        })
    } finally {
        extracting.value = false
    }
}

const onReset = () => {
    for (const key of Object.keys(previewUrls.value) as NxthemeAssetKey[]) {
        clearPreview(key)
    }
    form.value = createInitialForm()
    closeCropEditor()
    warning.value = ""
    error.value = ""
    nameInputTouched.value = false
    authorInputTouched.value = false
}

const onBuild = async () => {
    warning.value = ""
    error.value = ""

    nameInputTouched.value = true
    authorInputTouched.value = true

    let hasNameError = false
    let hasAuthorError = false

    if (!form.value.name.trim()) {
        hasNameError = true
    }
    if (!form.value.author.trim()) {
        hasAuthorError = true
    }

    if (hasNameError || hasAuthorError) {
        await nextTick()
        if (hasNameError) {
            const inputElement = nameInputRef.value?.$el?.querySelector('input') || nameInputRef.value?.$el
            inputElement?.scrollIntoView({ behavior: "smooth", block: "center" })
            inputElement?.focus()
        } else if (hasAuthorError) {
            const inputElement = authorInputRef.value?.$el?.querySelector('input') || authorInputRef.value?.$el
            inputElement?.scrollIntoView({ behavior: "smooth", block: "center" })
            inputElement?.focus()
        }
        return
    }

    loading.value = true
    try {
        const fileName = await buildAndDownload(form.value)
        toast({
            toast: "solid-success",
            title: "成功",
            description: `已下载 ${fileName}`,
        })
    } catch (nextError) {
        error.value = nextError instanceof Error ? nextError.message : "构建 NXTheme 失败。"
    } finally {
        loading.value = false
    }
}

// ===================== 布局叠加预览 =====================
const LAYOUT_CANVAS_W = 1280
const LAYOUT_CANVAS_H = 720

type LayoutEntryNode = {
    kind: "box" | "patch" // box=HomeMenu 布局数组格式；patch=NXThemesInstaller 补丁格式
    id: string
    visible: boolean
    x: number // 原始 X（编辑/回写用）
    y: number // 原始 Y
    width: number
    height: number
    zIndex: number
    displayX: number // 叠加父级坐标后的屏幕位置（渲染用）
    displayY: number
    sizeX: number // patch 的 Size（渲染形状用），0 表示无
    sizeY: number
    hasPosition: boolean
    visibleKey: string // 写回时用的可见性字段名（visible / Visible）
    ref: Record<string, unknown> // 指向 layoutJson 中对应的原始对象，用于回写
    posRef: Record<string, unknown> | null // patch 格式的 Position 对象
    fileIdx?: number // patch：在 Files 数组中的下标（定位 layout.json 行用）
    patchIdx?: number // patch：在该文件 Patches 数组中的下标（定位 layout.json 行用）
    fileName?: string // patch：完整文件路径（如 blyt/RdtBase.bflyt，定位用）
}

const layoutNodes = ref<LayoutEntryNode[]>([])
const layoutParsed = ref<unknown>(null)
const selectedLayoutIndex = ref<number | null>(null)
let layoutWriteBack = false
let layoutRebuildTimer: ReturnType<typeof setTimeout> | null = null

const collectLayoutNodes = (root: unknown): LayoutEntryNode[] => {
    const nodes: LayoutEntryNode[] = []
    // 1) HomeMenu 布局数组格式：{ id, x, y, width, height, "z-index", visible }
    const collectBox = (value: unknown) => {
        if (!Array.isArray(value)) return
        for (const item of value) {
            if (!item || typeof item !== "object") continue
            const obj = item as Record<string, unknown>
            const x = Number(obj.x)
            const y = Number(obj.y)
            const width = Number(obj.width)
            const height = Number(obj.height)
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
                const visibleKey = "Visible" in obj ? "Visible" : "visible"
                nodes.push({
                    kind: "box",
                    id: typeof obj.id === "string" && obj.id ? obj.id : `元素 #${nodes.length + 1}`,
                    visible: obj[visibleKey] !== false && obj[visibleKey] !== 0,
                    x,
                    y,
                    width,
                    height,
                    zIndex: Number(obj["z-index"]) || 0,
                    displayX: x,
                    displayY: y,
                    sizeX: 0,
                    sizeY: 0,
                    hasPosition: true,
                    visibleKey,
                    ref: obj,
                    posRef: null,
                })
            }
            for (const child of Object.values(obj)) collectBox(child)
        }
    }
    // 2) NXThemesInstaller 补丁格式：{ Files: [{ FileName, Patches: [{ PaneName, Position:{X,Y}, Visible }] }] }
    let patchFileCounter = 0
    const collectPatch = (value: unknown) => {
        if (Array.isArray(value)) {
            for (const item of value) {
                if (!item || typeof item !== "object") continue
                const obj = item as Record<string, unknown>
                if (typeof obj.FileName === "string" && Array.isArray(obj.Patches)) {
                    const fileBase = (obj.FileName as string).split("/").pop() ?? ""
                    const fileIdx = patchFileCounter++
                    for (const [patchIdx, patch] of (obj.Patches as unknown[]).entries()) {
                        if (!patch || typeof patch !== "object") continue
                        const p = patch as Record<string, unknown>
                        const paneName = typeof p.PaneName === "string" ? p.PaneName : `补丁 #${nodes.length + 1}`
                        const pos = p.Position as Record<string, unknown> | undefined
                        const hasPos = !!pos && Number.isFinite(Number(pos.X)) && Number.isFinite(Number(pos.Y))
                        const size = p.Size as Record<string, unknown> | undefined
                        const sizeX = size && Number.isFinite(Number(size.X)) ? Number(size.X) : 0
                        const sizeY = size && Number.isFinite(Number(size.Y)) ? Number(size.Y) : 0
                        const visibleKey = "Visible" in p ? "Visible" : "visible"
                        const rawX = hasPos ? Number(pos.X) : 0
                        const rawY = hasPos ? Number(pos.Y) : 0
                        nodes.push({
                            kind: "patch",
                            id: fileBase ? `${fileBase} · ${paneName}` : paneName,
                            visible: p[visibleKey] !== false && p[visibleKey] !== 0,
                            x: rawX,
                            y: rawY,
                            width: 0,
                            height: 0,
                            zIndex: 0,
                            displayX: rawX,
                            displayY: rawY,
                            sizeX,
                            sizeY,
                            hasPosition: hasPos,
                            visibleKey,
                            ref: p,
                            posRef: hasPos ? pos : null,
                            fileIdx,
                            patchIdx,
                            fileName: obj.FileName as string,
                        })
                    }
                }
                for (const child of Object.values(obj)) collectPatch(child)
            }
        } else if (value && typeof value === "object") {
            for (const child of Object.values(value)) collectPatch(child)
        }
    }
    collectBox(root)
    collectPatch(root)
    return nodes
}

// HomeMenu(RdtBase.bflyt) 的父级-子级关系：patch 坐标是相对父级的，
// 渲染时需把父级坐标叠加进来才能得到真实屏幕位置。
// 依据：多个布局（如 Flow Layout）把 N_ScrollArea 与 N_GameRoot 设为相同坐标，
// 说明它们是兄弟节点（而非父子，否则会双倍叠加）。
const PATCH_PARENT_MAP: Record<string, string[]> = {
    N_ScrollArea: ["N_ScrollWindow"],
    N_GameRoot: [
        "N_Icon_00", "N_Icon_01", "N_Icon_02", "N_Icon_03", "N_Icon_04", "N_Icon_05",
        "N_Icon_06", "N_Icon_07", "N_Icon_08", "N_Icon_09", "N_Icon_10", "N_Icon_11", "N_Icon_12",
        "N_Game", "L_BtnFlc",
    ],
    N_System: ["L_BtnNoti", "L_BtnShop", "L_BtnPvr", "L_BtnCtrl", "L_BtnSet", "L_BtnPow"],
    N_MyPage: [
        "L_BtnAccount_00", "L_BtnAccount_01", "L_BtnAccount_02", "L_BtnAccount_03",
        "L_BtnAccount_04", "L_BtnAccount_05", "L_BtnAccount_06", "L_BtnAccount_07",
    ],
}

// 把子元素的相对坐标叠加父级坐标，得到 displayX/displayY（仅用于渲染，不修改原始值）
const resolvePatchPositions = (nodes: LayoutEntryNode[]) => {
    const byPane = new Map<string, LayoutEntryNode>()
    for (const n of nodes) {
        if (n.kind !== "patch") continue
        const pane = (n.ref.PaneName as string) ?? ""
        if (pane && !byPane.has(pane)) byPane.set(pane, n)
    }
    for (let pass = 0; pass < 5; pass++) {
        let changed = false
        for (const n of nodes) {
            if (n.kind !== "patch") continue
            const pane = (n.ref.PaneName as string) ?? ""
            for (const [parent, children] of Object.entries(PATCH_PARENT_MAP)) {
                if (!children.includes(pane)) continue
                const p = byPane.get(parent)
                if (p) {
                    const nx = n.x + p.displayX
                    const ny = n.y + p.displayY
                    if (nx !== n.displayX || ny !== n.displayY) {
                        n.displayX = nx
                        n.displayY = ny
                        changed = true
                    }
                }
            }
        }
        if (!changed) break
    }
}

const rebuildLayoutPreview = () => {
    layoutNodes.value = []
    layoutParsed.value = null
    selectedLayoutIndex.value = null
    const json = form.value.layoutJson
    if (!json.trim()) return
    try {
        const parsed = JSON.parse(json)
        layoutParsed.value = parsed
        const nodes = collectLayoutNodes(parsed)
        resolvePatchPositions(nodes)
        layoutNodes.value = nodes
    } catch {
        // JSON 无效时不展示预览，保留原文编辑
    }
}

watch(() => form.value.layoutJson, () => {
    if (layoutWriteBack) return
    if (layoutRebuildTimer) clearTimeout(layoutRebuildTimer)
    layoutRebuildTimer = setTimeout(rebuildLayoutPreview, 250)
})
rebuildLayoutPreview()

const selectedLayoutNode = computed<LayoutEntryNode | null>(() => {
    if (selectedLayoutIndex.value == null) return null
    return layoutNodes.value[selectedLayoutIndex.value] ?? null
})

const layoutBoxStyle = (node: LayoutEntryNode) => {
    const x = Number(node.x) || 0
    const y = Number(node.y) || 0
    const width = Math.max(0, Number(node.width) || 0)
    const height = Math.max(0, Number(node.height) || 0)
    return {
        left: `${(x / LAYOUT_CANVAS_W) * 100}%`,
        top: `${(y / LAYOUT_CANVAS_H) * 100}%`,
        width: `${(width / LAYOUT_CANVAS_W) * 100}%`,
        height: `${(height / LAYOUT_CANVAS_H) * 100}%`,
        zIndex: Number(node.zIndex) || 0,
    }
}

// patch 格式：坐标是"屏幕中心原点、+Y 朝上"，需换算成左上角原点再渲染
// 屏幕X = 640 + x；屏幕Y = 360 - y
const layoutPatchBoxStyle = (node: LayoutEntryNode) => {
    const sx = LAYOUT_CANVAS_W / 2 + node.displayX
    const sy = LAYOUT_CANVAS_H / 2 - node.displayY
    const w = node.sizeX > 0 ? node.sizeX : 64
    const h = node.sizeY > 0 ? node.sizeY : 56
    return {
        left: `${(sx / LAYOUT_CANVAS_W) * 100}%`,
        top: `${(sy / LAYOUT_CANVAS_H) * 100}%`,
        width: `${(w / LAYOUT_CANVAS_W) * 100}%`,
        height: `${(h / LAYOUT_CANVAS_H) * 100}%`,
    }
}

// 叠加层显示用的短名称（patch 只显示 PaneName，带中文标注）
const layoutShortName = (node: LayoutEntryNode): string => {
    const base = node.kind === "patch" ? node.id.split(" · ")[1] ?? node.id : node.id
    const label = paneDisplayLabel(node)
    return label ? `${base}（${label}）` : base
}

// ===================== Pane 名中文标注 =====================
// 已知的 Pane 名 -> 中文标注（元素表格里以括号显示）
const PANE_NAME_LABELS: Record<string, string> = {
    L_BtnShop: "商店",
    L_BtnSet: "设置",
    L_BtnPow: "电源",
    L_BtnCtrl: "手柄",
    L_BtnPvr: "相册",
    L_BtnNoti: "通知",
    L_BtnNtf: "新闻",
    L_BtnMyPage: "用户页面",
    L_BtnIconGame: "游戏图标按钮",
    L_BtnFullLauncher: "全屏启动器",
    L_BtnFlc: "全屏启动器",
    L_BtnChildLock: "家长锁按钮",
    N_System: "系统图标栏",
    N_MyPage: "用户图标",
    L_BtnAccount_00: "用户1",
    L_BtnAccount_01: "用户2",
    L_BtnAccount_02: "用户3",
    L_BtnAccount_03: "用户4",
    L_BtnAccount_04: "用户5",
    L_BtnAccount_05: "用户6",
    L_BtnAccount_06: "用户7",
    L_BtnAccount_07: "用户8",
    N_Icon_00: "游戏槽1",
    N_Icon_01: "游戏槽2",
    N_Icon_02: "游戏槽3",
    N_Icon_03: "游戏槽4",
    N_Icon_04: "游戏槽5",
    N_Icon_05: "游戏槽6",
    N_Icon_06: "游戏槽7",
    N_Icon_07: "游戏槽8",
    N_Icon_08: "游戏槽9",
    N_Icon_09: "游戏槽10",
    N_Icon_10: "游戏槽11",
    N_Icon_11: "游戏槽12",
    N_Icon_12: "全部软件",
    N_Game: "游戏区",
    N_GameRoot: "游戏区",
    N_ScrollArea: "游戏滚动区",
    N_ScrollWindow: "游戏视窗",
    L_Hud: "顶部信息",
    N_Time: "时间",
    L_Time: "时间",
    N_AMPM: "AM/PM",
    L_ChildLock: "家长锁",
    L_Balloon: "气泡",
    L_BalloonCtrl: "手柄气泡",
    L_BalloonSystemApplet: "系统气泡",
    L_BgNml: "默认背景",
    P_Bg_00: "背景",
    P_PictBase: "图标底图",
    P_Stick: "摇杆",
    P_A: "A键",
    P_B: "B键",
    P_X: "X键",
    P_Y: "Y键",
    P_Main: "光标主体",
    P_Grow: "光标放大",
    B_Hit: "点击区",
    N_Tip: "提示文字",
    T_Main: "主要文字",
    L_BtnChangeUser: "切换用户",
    L_New: "新内容标记",
}

const PANE_LABELS_KEY = "nxtheme-pane-labels"
// 用户自定义标注（localStorage，可覆盖内置）
const paneLabels = ref<Record<string, string>>({})
try {
    const raw = localStorage.getItem(PANE_LABELS_KEY)
    if (raw) paneLabels.value = JSON.parse(raw)
} catch {
    paneLabels.value = {}
}

const nodePaneName = (node: LayoutEntryNode): string =>
    node.kind === "patch" ? (node.ref.PaneName as string) ?? "" : node.id

// 元素的标注：优先用户自定义，否则内置
const paneDisplayLabel = (node: LayoutEntryNode): string | null => {
    const name = nodePaneName(node)
    if (paneLabels.value[name]) return paneLabels.value[name]
    return PANE_NAME_LABELS[name] ?? null
}

// 标注 / 修改标注（未知的由用户自己填写；留空则清除）
const annotatePane = (node: LayoutEntryNode) => {
    const name = nodePaneName(node)
    if (!name) return
    const current = paneLabels.value[name] ?? PANE_NAME_LABELS[name] ?? ""
    const label = window.prompt(`为「${name}」填写中文标注（留空则清除）：`, current)
    if (label === null) return
    if (label.trim()) paneLabels.value[name] = label.trim()
    else delete paneLabels.value[name]
    try {
        localStorage.setItem(PANE_LABELS_KEY, JSON.stringify(paneLabels.value))
    } catch {
        // 存储失败不影响使用
    }
}

// ===================== 元素 <-> layout.json 双向定位 =====================
const layoutTextareaRef = ref<HTMLTextAreaElement | null>(null)

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// 在文本中从指定位置向后找第一个匹配，返回字符偏移
const findAfter = (text: string, re: RegExp, from: number): number => {
    re.lastIndex = Math.max(0, from)
    const m = re.exec(text)
    return m ? m.index : -1
}

// 计算节点在 layout.json 文本中的起始行号（1 起）
const layoutLineOfNode = (node: LayoutEntryNode): number => {
    const text = form.value.layoutJson
    if (!text) return -1
    if (node.kind === "patch") {
        const fileFull = node.fileName ?? (node.id.split(" · ")[0] || "").trim()
        const pane = (node.ref.PaneName as string) ?? ""
        if (!fileFull || !pane) return -1
        // 找到该文件在文本中的位置（FileName 通常唯一；重复时取第一个）
        const fileRe = new RegExp(`"FileName"\\s*:\\s*${JSON.stringify(fileFull)}`)
        const pos = findAfter(text, fileRe, 0)
        if (pos < 0) return -1
        // 从该文件位置向后数第 patchIdx 个该 PaneName
        const paneRe = new RegExp(`"PaneName"\\s*:\\s*"${escapeRegExp(pane)}"`)
        let p = pos
        let pc = -1
        while (true) {
            p = findAfter(text, paneRe, p + 1)
            if (p < 0) break
            pc++
            if (pc === (node.patchIdx ?? 0)) break
        }
        if (p < 0) return -1
        return text.slice(0, p).split("\n").length
    }
    // HomeMenu 数组格式：按 id 定位
    const idPos = text.indexOf(`"id": ${JSON.stringify(node.id)}`)
    if (idPos < 0) return -1
    return text.slice(0, idPos).split("\n").length
}

const lineStartOffset = (text: string, line: number): number => {
    let offset = 0
    for (let i = 1; i < line; i++) {
        const nl = text.indexOf("\n", offset)
        if (nl < 0) return text.length
        offset = nl + 1
    }
    return offset
}

// 点元素表格行 -> layout.json 定位到该行并精确滚动到视野中央（F3 式）
const onSelectLayoutNode = (index: number, node: LayoutEntryNode) => {
    selectedLayoutIndex.value = index
    const ta = layoutTextareaRef.value
    const text = form.value.layoutJson
    if (!ta || !text) return
    const line = layoutLineOfNode(node)
    if (line < 1) return
    const start = lineStartOffset(text, line)
    const nl = text.indexOf("\n", start)
    const end = nl < 0 ? text.length : nl // 只选中该行，不带到下一个参数
    ta.focus()
    ta.setSelectionRange(start, end)
    nextTick(() => {
        // 用选中文本的边界框精确计算滚动位置，不依赖行高估算
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && ta.clientHeight > 0) {
            const rect = sel.getRangeAt(0).getBoundingClientRect()
            if (rect.height > 0) {
                const taRect = ta.getBoundingClientRect()
                const targetTop = rect.top - taRect.top + ta.scrollTop
                ta.scrollTop = Math.max(0, targetTop - ta.clientHeight / 3)
                return
            }
        }
        ta.scrollTop = Math.max(0, (line - 4) * 18) // 兜底：估算行高
    })
}

// 点预览图上的元素 -> 元素表格滚动聚焦到对应行
const onOverlaySelect = (index: number) => {
    selectedLayoutIndex.value = index
    nextTick(() => {
        document.getElementById(`layout-row-${index}`)?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
}

// layout 元素 id / Pane 名 -> 图标资源 key 的映射（严格随 layout：只显示 layout 中带位置的图标）
const ICON_ID_MAP: Record<string, NxthemeAssetKey> = {
    album: "albumIcon",
    albumicon: "albumIcon",
    news: "newsIcon",
    newsicon: "newsIcon",
    shop: "shopIcon",
    eshop: "shopIcon",
    shopicon: "shopIcon",
    controller: "controllerIcon",
    controllers: "controllerIcon",
    controllericon: "controllerIcon",
    settings: "settingsIcon",
    settingsicon: "settingsIcon",
    power: "powerIcon",
    powericon: "powerIcon",
    nso: "nsoIcon",
    online: "nsoIcon",
    nsoicon: "nsoIcon",
    card: "cardIcon",
    gamecard: "cardIcon",
    cardicon: "cardIcon",
    share: "shareIcon",
    shareicon: "shareIcon",
    home: "homeIcon",
    homeicon: "homeIcon",
    // NXThemesInstaller 补丁格式的常见 Pane 名
    lbtnnoti: "newsIcon",
    lbtnshop: "shopIcon",
    lbtnpvr: "albumIcon",
    lbtnctrl: "controllerIcon",
    lbtnset: "settingsIcon",
    lbtnpow: "powerIcon",
    nicon12: "nsoIcon",
}

// 该 layout 元素对应的图标图片地址（优先用户上传，否则用默认图标）
const layoutIconUrl = (node: LayoutEntryNode): string | null => {
    const rawId = node.kind === "patch"
        ? (node.ref.PaneName as string) ?? ""
        : node.id
    const key = ICON_ID_MAP[rawId.toLowerCase().replace(/[^a-z0-9]/g, "")]
    if (!key) return null
    const userPreview = previewUrls.value[key]
    if (userPreview) return userPreview
    return presetIconUrl(key)
}

// 叠加层的样式类（icon 有图时不画底色；无图元素只保留半透明底色，不加外边框）
const layoutOverlayClasses = (node: LayoutEntryNode, i: number): string => {
    const isIcon = !!layoutIconUrl(node)
    const base = isIcon
        ? "pointer-events-auto absolute cursor-pointer rounded-md transition-opacity"
        : "pointer-events-auto absolute cursor-pointer rounded-md transition-colors"
    if (i === selectedLayoutIndex.value) {
        return isIcon ? `${base} ring-2 ring-primary-400` : `${base} bg-primary-400/25 ring-1 ring-primary-400`
    }
    if (!node.visible) return `${base} opacity-70`
    return isIcon ? base : `${base} bg-sky-400/10 hover:bg-sky-400/20`
}

// 布局元素列表的搜索与过滤
const layoutSearch = ref("")
const layoutShowPositionedOnly = ref(false)

const filteredLayoutNodes = computed<{ node: LayoutEntryNode; index: number }[]>(() => {
    const keyword = layoutSearch.value.trim().toLowerCase()
    return layoutNodes.value
        .map((node, index) => ({ node, index }))
        .filter(({ node }) => {
            if (layoutShowPositionedOnly.value && !node.hasPosition && node.kind !== "box") return false
            if (keyword && !node.id.toLowerCase().includes(keyword)) return false
            return true
        })
})

// 布局元信息（顶层标量字段：PatchName / AuthorName 等）的填空编辑
const layoutInfoOpen = ref(false)

// 布局面板的帮助说明开关（? 按钮）
const layoutHelpOpen = ref(false)

// 叠加层开关：默认关闭，打开后才在背景图上叠加布局元素
const layoutOverlayOn = ref(false)

// ===================== 背景图片显示区域（叠加层对齐用） =====================
// 图片容器固定 16:9，但用户上传的图未必是 16:9，object-contain 后图片会留边/偏移。
// 这里计算图片实际显示的区域，把叠加层限制在该区域内，保证坐标一一对应。
const bgImgNatural = ref<{ w: number; h: number } | null>(null)
const bgImgRect = ref<{ x: number; y: number; w: number; h: number; cw: number; ch: number } | null>(null)
const bgPreviewRef = ref<HTMLElement | null>(null)

const computeBgImgRect = () => {
    const el = bgPreviewRef.value
    const nat = bgImgNatural.value
    if (!el || !nat) return
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (!cw || !ch) return
    const scale = Math.min(cw / nat.w, ch / nat.h)
    const w = nat.w * scale
    const h = nat.h * scale
    bgImgRect.value = { x: (cw - w) / 2, y: (ch - h) / 2, w, h, cw, ch }
}

const onBgImgLoad = (e: Event) => {
    const img = e.target as HTMLImageElement
    bgImgNatural.value = { w: img.naturalWidth || 16, h: img.naturalHeight || 9 }
    computeBgImgRect()
}

const bgImgRectStyle = computed(() => {
    const r = bgImgRect.value
    if (!r) return {}
    return {
        left: `${(r.x / r.cw) * 100}%`,
        top: `${(r.y / r.ch) * 100}%`,
        width: `${(r.w / r.cw) * 100}%`,
        height: `${(r.h / r.ch) * 100}%`,
    }
})

onMounted(() => {
    computeBgImgRect()
    const el = bgPreviewRef.value
    if (el && typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => computeBgImgRect()).observe(el)
    }
})

const LAYOUT_META_LABELS: Record<string, string> = {
    PatchName: "补丁名称",
    AuthorName: "作者",
    TargetName: "目标文件",
    TargetFirmware: "目标固件版本",
    HideOnlineBtn: "隐藏在线按钮",
}

const layoutMetaFields = computed<{ key: string; type: string; label: string }[]>(() => {
    if (!layoutParsed.value || typeof layoutParsed.value !== "object" || Array.isArray(layoutParsed.value)) return []
    const root = layoutParsed.value as Record<string, unknown>
    return Object.entries(root)
        .filter(([, value]) => value === null || typeof value !== "object")
        .map(([key, value]) => ({
            key,
            type: value === null ? "string" : typeof value,
            label: LAYOUT_META_LABELS[key] ?? key,
        }))
})

const layoutMetaWriteBack = () => {
    if (layoutParsed.value == null) return
    layoutWriteBack = true
    form.value.layoutJson = JSON.stringify(layoutParsed.value, null, 2)
    layoutWriteBack = false
}

// ===================== 方法（可复用的布局积木） =====================
type LayoutMethod = {
    name: string
    savedAt: number
    data: unknown // 保存的布局片段（补丁格式的 Files/Anims，或数组格式的元素）
}

// 深度克隆（兼容旧浏览器：structuredClone 不可用时回退 JSON 序列化）
const safeClone = <T>(v: T): T => {
    try {
        return structuredClone(v)
    } catch {
        return JSON.parse(JSON.stringify(v)) as T
    }
}

const methodPanelOpen = ref(false)
const methodSaveOpen = ref(false)
const methodName = ref("")
const methodFileSelections = ref<Record<string, boolean>>({})
const methodAnimsSelections = ref<Record<string, boolean>>({})
const layoutMethods = ref<LayoutMethod[]>([])

const METHODS_STORAGE_KEY = "nxtheme-layout-methods"

// 是否运行在预览服务下（http://localhost:8123）——此时方法可直接落盘到文件夹
const isServerMode = typeof window !== "undefined" && window.location.protocol.startsWith("http")

// 保存方法集合：预览服务下自动写入本机文件夹 dist-offline/methods/，否则存浏览器 localStorage
const persistMethods = async () => {
    const payload = JSON.stringify(layoutMethods.value)
    if (isServerMode) {
        try {
            const res = await fetch("/api/methods", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: payload,
            })
            if (res.ok) return
        } catch {
            // 服务不可用时回退 localStorage
        }
    }
    try {
        localStorage.setItem(METHODS_STORAGE_KEY, payload)
    } catch {
        // 存储失败不影响使用
    }
}

// 启动时加载方法：优先读文件夹（服务模式），否则读 localStorage
const loadMethods = async () => {
    let loaded = false
    if (isServerMode) {
        try {
            const res = await fetch("/api/methods")
            if (res.ok) {
                const data = await res.json()
                if (Array.isArray(data)) {
                    layoutMethods.value = data
                    loaded = true
                }
            }
        } catch {
            // 忽略，回退 localStorage
        }
    }
    if (!loaded) {
        try {
            const raw = localStorage.getItem(METHODS_STORAGE_KEY)
            if (raw) layoutMethods.value = JSON.parse(raw)
        } catch {
            layoutMethods.value = []
        }
    }
}
loadMethods()

// 打开"保存方法"面板：列出当前布局的 Files（默认全选）与 Anims（默认不选）
const openMethodSave = () => {
    methodName.value = ""
    methodSaveError.value = ""
    methodFileSelections.value = {}
    methodAnimsSelections.value = {}
    methodDetailIndex.value = null
    const parsed = layoutParsed.value
    if (!parsed || Array.isArray(parsed)) return
    const obj = parsed as Record<string, unknown>
    if (Array.isArray(obj.Files)) {
        for (const f of obj.Files as Record<string, unknown>[]) {
            const fn = typeof f?.FileName === "string" ? (f.FileName as string) : ""
            if (fn) methodFileSelections.value[fn] = true
        }
    }
    if (Array.isArray(obj.Anims)) {
        for (const a of obj.Anims as Record<string, unknown>[]) {
            const an = typeof a?.FileName === "string" ? (a.FileName as string) : ""
            if (an) methodAnimsSelections.value[an] = false // 动画通常随主题，默认不带走
        }
    }
    methodSaveOpen.value = true
}

// 保存当前布局（或勾选的文件/动画）为方法
const saveMethod = () => {
    try {
        const name = methodName.value.trim()
        if (!name) {
            methodSaveError.value = "请先填写方法名称"
            methodSaveToast.value = ""
            return
        }
        methodSaveError.value = ""
        const parsed = layoutParsed.value
        if (!parsed) {
            methodSaveError.value = "当前没有可保存的布局"
            return
        }
        let data: unknown
        if (Array.isArray(parsed)) {
            data = safeClone(parsed) // HomeMenu 数组格式：保存全部元素
        } else {
            const obj = parsed as Record<string, unknown>
            const files = Array.isArray(obj.Files)
                ? safeClone((obj.Files as unknown[]).filter((f) => methodFileSelections.value[(f as Record<string, unknown>).FileName as string]))
                : []
            const anims = Array.isArray(obj.Anims)
                ? safeClone((obj.Anims as unknown[]).filter((a) => methodAnimsSelections.value[(a as Record<string, unknown>).FileName as string]))
                : []
            const out: Record<string, unknown> = {}
            if (files.length) out.Files = files
            if (anims.length) out.Anims = anims
            data = out
        }
        layoutMethods.value.push({ name, savedAt: Date.now(), data })
        persistMethods()
        methodSaveOpen.value = false
        showMethodToast(`✓ 已保存方法「${name}」`)
    } catch (err) {
        methodSaveOpen.value = false
        showMethodToast(`⚠ 保存失败：${err instanceof Error ? err.message : String(err)}`)
    }
}

const renameMethod = (m: LayoutMethod) => {
    const name = window.prompt("方法名称：", m.name)
    if (name && name.trim()) {
        m.name = name.trim()
        persistMethods()
    }
}

const deleteMethod = (i: number) => {
    layoutMethods.value.splice(i, 1)
    persistMethods()
}

// 保存方法的反馈提示（避免"点了没反应"）
const methodSaveError = ref("")
const methodSaveToast = ref("")
let methodToastTimer: ReturnType<typeof setTimeout> | null = null
const showMethodToast = (msg: string) => {
    methodSaveToast.value = msg
    if (methodToastTimer) clearTimeout(methodToastTimer)
    methodToastTimer = setTimeout(() => { methodSaveToast.value = "" }, 3000)
}

// 导出全部方法为 .json 文件（备份 / 换浏览器 / 分享）
const exportMethods = () => {
    if (!layoutMethods.value.length) {
        showMethodToast("⚠ 还没有可导出的方法")
        return
    }
    const blob = new Blob([JSON.stringify(layoutMethods.value, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `nxtheme-方法-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showMethodToast(`✓ 已导出 ${layoutMethods.value.length} 个方法`)
}

const methodImportInput = ref<HTMLInputElement | null>(null)
// 从 .json 文件导入方法（同名跳过，避免覆盖）
const onMethodImportFile = (e: Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
        try {
            const data = JSON.parse(String(reader.result))
            const list = Array.isArray(data) ? data : [data]
            let added = 0
            let skipped = 0
            for (const item of list) {
                if (!item || typeof item.name !== "string" || !item.data) {
                    skipped++
                    continue
                }
                const exists = layoutMethods.value.some((m) => m.name === item.name)
                if (exists) skipped++
                else {
                    layoutMethods.value.push({
                        name: item.name,
                        savedAt: typeof item.savedAt === "number" ? item.savedAt : Date.now(),
                        data: item.data,
                    })
                    added++
                }
            }
            persistMethods()
            if (added) showMethodToast(`✓ 已导入 ${added} 个方法${skipped ? `，跳过 ${skipped} 个同名` : ""}`)
            else showMethodToast(skipped ? `⚠ 全部同名已跳过（${skipped} 个），可先重命名再导入` : "⚠ 文件里没有有效的方法")
        } catch {
            showMethodToast("⚠ 导入失败：不是有效的方法文件")
        }
        input.value = ""
    }
    reader.readAsText(file)
}

// ===================== 方法的分类与冲突识别 =====================
const FILE_CATEGORY_RULES: { test: RegExp; label: string; cls: string }[] = [
    { test: /bgnml|bgbusy|bgpromo|^bg/i, label: "背景", cls: "text-sky-300" },
    { test: /rdtbtn/i, label: "按钮", cls: "text-violet-300" },
    { test: /rdtbase|rdtscroll|cursor/i, label: "布局", cls: "text-amber-300" },
    { test: /hud/i, label: "顶部", cls: "text-emerald-300" },
    { test: /balloon/i, label: "气泡", cls: "text-rose-300" },
]
const fileCategory = (name: string): { label: string; cls: string } => {
    for (const c of FILE_CATEGORY_RULES) if (c.test.test(name)) return { label: c.label, cls: c.cls }
    return { label: "其他", cls: "text-slate-400" }
}

// 方法包含的文件分类汇总（用于列表上的彩色标签）
const methodCategorySummary = (m: LayoutMethod): { label: string; count: number; cls: string }[] => {
    const data = m.data as Record<string, unknown> | undefined
    const files = data && !Array.isArray(data) && Array.isArray(data.Files) ? (data.Files as Record<string, unknown>[]) : []
    const counts = new Map<string, { count: number; cls: string }>()
    for (const f of files) {
        const cat = fileCategory(typeof f?.FileName === "string" ? (f.FileName as string) : "")
        const cur = counts.get(cat.label) ?? { count: 0, cls: cat.cls }
        cur.count++
        counts.set(cat.label, cur)
    }
    return [...counts.entries()].map(([label, v]) => ({ label, count: v.count, cls: v.cls }))
}

type MethodConflictFile = { file: string; status: "new" | "overwrite"; cls: string }
// 方法应用后，各文件相对当前布局是"新增"还是"覆盖"（用于冲突检查）
const methodConflictInfo = (m: LayoutMethod): { files: MethodConflictFile[]; anims: MethodConflictFile[] } => {
    const out: { files: MethodConflictFile[]; anims: MethodConflictFile[] } = { files: [], anims: [] }
    const parsed = layoutParsed.value
    if (!parsed || Array.isArray(parsed)) return out
    const target = parsed as Record<string, unknown>
    const data = m.data as Record<string, unknown> | undefined
    if (!data || Array.isArray(data)) return out
    const targetFiles = new Set((Array.isArray(target.Files) ? (target.Files as Record<string, unknown>[]) : []).map((f) => f.FileName).filter((v): v is string => typeof v === "string"))
    for (const f of Array.isArray(data.Files) ? (data.Files as Record<string, unknown>[]) : []) {
        const fn = typeof f?.FileName === "string" ? (f.FileName as string) : ""
        if (!fn) continue
        out.files.push({
            file: fn,
            status: targetFiles.has(fn) ? "overwrite" : "new",
            cls: fileCategory(fn).cls,
        })
    }
    const targetAnims = new Set((Array.isArray(target.Anims) ? (target.Anims as Record<string, unknown>[]) : []).map((a) => a.FileName).filter((v): v is string => typeof v === "string"))
    for (const a of Array.isArray(data.Anims) ? (data.Anims as Record<string, unknown>[]) : []) {
        const an = typeof a?.FileName === "string" ? (a.FileName as string) : ""
        if (!an) continue
        out.anims.push({
            file: an,
            status: targetAnims.has(an) ? "overwrite" : "new",
            cls: "text-violet-300",
        })
    }
    return out
}

const methodConflictSummary = (m: LayoutMethod): { news: number; overwrites: number } => {
    const info = methodConflictInfo(m)
    return {
        news: info.files.filter((f) => f.status === "new").length + info.anims.filter((a) => a.status === "new").length,
        overwrites: info.files.filter((f) => f.status === "overwrite").length + info.anims.filter((a) => a.status === "overwrite").length,
    }
}

// 应用前的冲突预览展开控制
const methodDetailIndex = ref<number | null>(null)
const toggleMethodDetail = (i: number) => {
    methodDetailIndex.value = methodDetailIndex.value === i ? null : i
}

// 按 FileName 合并补丁格式的 Files（同文件覆盖补丁，新文件追加）
const mergePatchFiles = (targetFiles: unknown[], sourceFiles: unknown[]) => {
    const byFile = new Map<string, Record<string, unknown>>()
    for (const f of targetFiles) {
        const obj = f as Record<string, unknown>
        if (typeof obj.FileName === "string") byFile.set(obj.FileName, obj)
    }
    for (const sf of sourceFiles) {
        const s = sf as Record<string, unknown>
        const fn = typeof s.FileName === "string" ? (s.FileName as string) : ""
        if (!fn) continue
        const tf = byFile.get(fn)
        if (!tf) {
            targetFiles.push(safeClone(s))
            byFile.set(fn, safeClone(s) as Record<string, unknown>)
            continue
        }
        // 合并 Patches（按 PaneName 覆盖）
        const tp = Array.isArray(tf.Patches) ? (tf.Patches as unknown[]) : (tf.Patches = [])
        const tpByPane = new Map<string, unknown>()
        for (const p of tp) tpByPane.set((p as Record<string, unknown>).PaneName as string, p)
        for (const sp of Array.isArray(s.Patches) ? (s.Patches as unknown[]) : []) {
            const spn = (sp as Record<string, unknown>).PaneName as string
            if (typeof spn === "string") tpByPane.set(spn, safeClone(sp))
            else tp.push(safeClone(sp))
        }
        tf.Patches = [...tpByPane.values()]
        // 合并 AddGroups（按 GroupName 覆盖）
        const tg = Array.isArray(tf.AddGroups) ? (tf.AddGroups as unknown[]) : (tf.AddGroups = [])
        const tgBy = new Map<string, unknown>()
        for (const g of tg) tgBy.set((g as Record<string, unknown>).GroupName as string, g)
        for (const sg of Array.isArray(s.AddGroups) ? (s.AddGroups as unknown[]) : []) {
            const gname = (sg as Record<string, unknown>).GroupName as string
            if (typeof gname === "string") tgBy.set(gname, safeClone(sg))
        }
        tf.AddGroups = [...tgBy.values()]
        // 合并 Materials（按 MaterialName 整体覆盖）
        const tm = Array.isArray(tf.Materials) ? (tf.Materials as unknown[]) : (tf.Materials = [])
        const tmBy = new Map<string, unknown>()
        for (const m of tm) tmBy.set((m as Record<string, unknown>).MaterialName as string, m)
        for (const sm of Array.isArray(s.Materials) ? (s.Materials as unknown[]) : []) {
            const mname = (sm as Record<string, unknown>).MaterialName as string
            if (typeof mname === "string") tmBy.set(mname, safeClone(sm))
        }
        tf.Materials = [...tmBy.values()]
    }
}

// 把方法应用到当前布局（就地合并，然后回写 layout.json 并重建预览）
const applyMethod = (m: LayoutMethod) => {
    if (!layoutParsed.value) return
    const parsed = layoutParsed.value as Record<string, unknown>
    const data = m.data as Record<string, unknown>
    if (Array.isArray(parsed)) {
        if (!Array.isArray(data)) return
        const existing = new Set((parsed as unknown[]).map((it) => (it as Record<string, unknown>).id))
        for (const it of data as unknown[]) {
            const id = (it as Record<string, unknown>).id
            if (id !== undefined && existing.has(id)) continue
            ;(parsed as unknown[]).push(safeClone(it))
        }
    } else {
        if (Array.isArray(data)) return
        if (Array.isArray(data.Files)) {
            if (!Array.isArray(parsed.Files)) parsed.Files = []
            mergePatchFiles(parsed.Files as unknown[], data.Files as unknown[])
        }
        if (Array.isArray(data.Anims) && Array.isArray(parsed.Anims)) {
            const byName = new Map((parsed.Anims as unknown[]).map((a) => [(a as Record<string, unknown>).FileName as string, a]))
            for (const sa of data.Anims as unknown[]) {
                const an = (sa as Record<string, unknown>).FileName as string
                if (typeof an === "string") byName.set(an, safeClone(sa))
            }
            parsed.Anims = [...byName.values()]
        }
    }
    layoutWriteBack = true
    form.value.layoutJson = JSON.stringify(layoutParsed.value, null, 2)
    layoutWriteBack = false
    rebuildLayoutPreview()
    methodDetailIndex.value = null
    showMethodToast(`✓ 已应用方法「${m.name}」`)
}

// 当前布局的 Files 清单（保存方法时勾选用）
const layoutFilesForMethod = computed<{ name: string; count: number }[]>(() => {
    const parsed = layoutParsed.value
    if (!parsed || Array.isArray(parsed)) return []
    const files = (parsed as Record<string, unknown>).Files
    if (!Array.isArray(files)) return []
    return files.map((f) => {
        const obj = f as Record<string, unknown>
        return {
            name: typeof obj.FileName === "string" ? (obj.FileName as string) : "未知文件",
            count: Array.isArray(obj.Patches) ? (obj.Patches as unknown[]).length : 0,
        }
    })
})

// 当前布局的 Anims 清单（保存方法时勾选用）
const layoutAnimsForMethod = computed<string[]>(() => {
    const parsed = layoutParsed.value
    if (!parsed || Array.isArray(parsed)) return []
    const anims = (parsed as Record<string, unknown>).Anims
    if (!Array.isArray(anims)) return []
    return anims
        .map((a) => (a as Record<string, unknown>).FileName)
        .filter((v): v is string => typeof v === "string")
})

// 将选中的元素属性回写到 layoutJson
const writeBackLayout = () => {
    const node = selectedLayoutNode.value
    if (!node || layoutParsed.value == null) return
    if (node.kind === "patch") {
        if (!node.posRef) {
            // 原 JSON 里没有 Position，编辑时新建
            node.posRef = { X: node.x, Y: node.y }
            node.ref.Position = node.posRef
            node.hasPosition = true
        } else {
            node.posRef.X = node.x
            node.posRef.Y = node.y
        }
        node.ref[node.visibleKey] = node.visible
    } else {
        node.ref.x = node.x
        node.ref.y = node.y
        node.ref.width = node.width
        node.ref.height = node.height
        node.ref["z-index"] = node.zIndex
        node.ref[node.visibleKey] = node.visible
    }
    layoutWriteBack = true
    form.value.layoutJson = JSON.stringify(layoutParsed.value, null, 2)
    layoutWriteBack = false
}
</script>

<template>
    <main class="relative mx-auto max-w-7xl px-4 pb-20 pt-6 text-slate-100">
        <div class="pointer-events-none fixed inset-0 z-0 bg-[#090d16]" />
        <div
            class="pointer-events-none fixed z-0"
            style="
        inset: -20vmax;
        background:
          radial-gradient(circle at 22% 50%, rgba(10, 179, 121, 0.34) 0%, rgba(10, 179, 121, 0) 44%),
          radial-gradient(circle at 78% 50%, rgba(255, 50, 204, 0.34) 0%, rgba(255, 50, 204, 0) 44%),
          radial-gradient(circle at 50% 52%, rgba(95, 94, 255, 0.18) 0%, rgba(95, 94, 255, 0) 40%);
        filter: blur(48px) saturate(115%);
      "
        />

        <div class="relative z-10">

            <header
                class="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl lg:flex-row lg:items-start lg:justify-between">
                <div class="grid gap-2">
                    <div class="flex items-center gap-2 text-2xl leading-none">
                        <n-icon name="i-lucide-sparkles" class="text-slate-200" />
                        <h1 class="text-2xl font-black">NXTheme Builder</h1>
                    </div>
                    <p class="text-sm text-slate-300">
                        在本地构建 Nintendo Switch <code class="rounded border border-slate-800 bg-slate-900/60 px-1.5 py-0.5 font-mono text-xs">.nxtheme</code> 主题文件。
                    </p>
                </div>
                <div class="flex flex-wrap items-center content-start gap-2 self-start">
                  <a
                      class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-950/70 hover:text-white transition-all duration-200"
                      href="https://github.com/tiaile/nxtheme-editor"
                      target="_blank"
                  >
                    <span class="i-lucide-github shrink-0 text-[1em] leading-none" />
                    <span>源代码</span>
                  </a>
                    <a
                        class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-950/70 hover:text-white transition-all duration-200"
                        href="https://themezer.net"
                        target="_blank"
                        rel="noreferrer"
                    >
                        <img :src="themezerIconUrl" alt="Themezer" class="h-[1em] w-auto shrink-0 object-contain" />
                        <span>Themezer</span>
                    </a>
                    <a
                        class="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-950/70 hover:text-white transition-all duration-200"
                        href="https://hb-app.store/switch/NXthemes_Installer"
                        target="_blank"
                    >
                        <span class="i-lucide-github shrink-0 text-[1em] leading-none" />
                        <span>NXThemesInjector</span>
                    </a>
                    <n-button btn="soft" :disabled="loading" leading="i-lucide-file-up" @click="onImportClick">
                      导入 .nxtheme
                    </n-button>
                    <n-button btn="soft" :disabled="loading || extracting" leading="i-lucide-package-open" @click="onExtract">
                        {{ extracting ? "提取中..." : "提取元素" }}
                    </n-button>
                </div>
            </header>

            <section class="mb-4 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl">
                <div class="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                    <h2 class="text-lg font-semibold">目标界面</h2>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="grid gap-1 text-sm">
                            <span class="flex items-center justify-between gap-2">
                                <span>主题名称</span>
                                <span class="flex items-center gap-2">
                                    <span v-if="nameInputTouched && !form.name.trim()" class="text-xs text-red-400">主题名称不能为空</span>
                                    <n-badge badge="outline-warning" size="xs" class="uppercase">必填*</n-badge>
                                </span>
                            </span>
                            <n-input
                                ref="nameInputRef"
                                v-model="form.name"
                                placeholder="我的主题"
                                required
                                @blur="nameInputTouched = true"
                            />
                        </label>
                        <label class="grid gap-1 text-sm">
                            <span class="flex items-center justify-between gap-2">
                                <span>作者</span>
                                <span class="flex items-center gap-2">
                                    <span v-if="authorInputTouched && !form.author.trim()" class="text-xs text-red-400">作者不能为空</span>
                                    <n-badge badge="outline-warning" size="xs" class="uppercase">必填*</n-badge>
                                </span>
                            </span>
                            <n-input
                                ref="authorInputRef"
                                v-model="form.author"
                                placeholder="你的名字"
                                required
                                @blur="authorInputTouched = true"
                            />
                        </label>
                    </div>
                </div>
                <n-tabs v-model="form.target">
                    <n-tabs-list
                        class="!grid !h-auto !w-full !gap-1 !rounded-xl !border !border-slate-850 !bg-slate-950/60 !p-1 sm:!grid-cols-2 lg:!grid-cols-4 xl:!grid-cols-7">
                        <n-tabs-trigger
                            v-for="target in INFO_TARGETS"
                            :key="target"
                            :value="target"
                            class="!h-9 !min-w-0 !justify-center !gap-1.5 !rounded-lg !border-0 !bg-transparent !px-2 !py-1 !text-xs !text-slate-300 !shadow-none !ring-0 hover:!bg-slate-800/50 data-[state=active]:!bg-primary/25 data-[state=active]:!text-primary-200 sm:!text-sm"
                        >
                            <span :class="[INFO_TARGET_LABELS[target].icon, 'shrink-0 text-sm leading-none']" />
                            <span class="min-w-0 truncate font-semibold">{{ INFO_TARGET_LABELS[target].title }}</span>
                        </n-tabs-trigger>
                    </n-tabs-list>
                </n-tabs>
            </section>

            <section class="mb-4 grid items-stretch gap-3 lg:grid-cols-[minmax(0,1.7fr)_auto_minmax(320px,1fr)]">
                <article class="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl">
                    <h2 class="text-lg font-semibold">背景</h2>
                    <div v-if="backgroundAssetKey" class="grid gap-2">
                        <span class="text-xs text-slate-400 font-mono">{{ NXTHEME_ASSET_FILENAMES[backgroundAssetKey] }}</span>
                        <div
                            ref="bgPreviewRef"
                            class="group relative grid aspect-video max-w-[720px] cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed border-slate-700/60 bg-slate-950/40 transition-all duration-300 hover:border-primary-400/80 hover:bg-slate-950/60"
                            :class="{ 'border-primary-400 ring-1 ring-primary-400 bg-slate-950/70': dragActive[backgroundAssetKey] }"
                            role="button"
                            tabindex="0"
                            @click="openAssetPicker(backgroundAssetKey)"
                            @keydown.enter.prevent="openAssetPicker(backgroundAssetKey)"
                            @dragenter.prevent="onAssetDragEnter(backgroundAssetKey)"
                            @dragover.prevent
                            @dragleave.prevent="onAssetDragLeave(backgroundAssetKey)"
                            @drop.prevent="onAssetDrop(backgroundAssetKey, $event)"
                        >
                            <img
                                v-if="previewUrls[backgroundAssetKey]"
                                :src="previewUrls[backgroundAssetKey]"
                                :alt="ASSET_DISPLAY_NAMES[backgroundAssetKey]"
                                class="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
                                draggable="false"
                                @load="onBgImgLoad"
                            />
                            <div v-else class="flex flex-col items-center gap-2 p-4 text-center">
                                <span class="i-lucide-file-up text-3xl text-slate-500 transition-colors group-hover:text-primary-400" />
                                <span class="text-xs font-medium text-slate-300">拖拽背景图到此处，或点击上传</span>
                                <span class="text-[10px] text-slate-500">支持 JPG、PNG</span>
                            </div>
                            <div v-if="previewUrls[backgroundAssetKey] && layoutNodes.length && layoutOverlayOn && bgImgRect" class="pointer-events-none absolute z-10" :style="bgImgRectStyle">
                                <template v-for="(node, i) in layoutNodes" :key="i">
                                    <div
                                        v-if="node.kind === 'box' || node.hasPosition"
                                        :class="layoutOverlayClasses(node, i)"
                                        :style="node.kind === 'box' ? layoutBoxStyle(node) : layoutPatchBoxStyle(node)"
                                        :title="node.id"
                                        @click.stop="onOverlaySelect(i)"
                                    >
                                        <img
                                            v-if="layoutIconUrl(node)"
                                            :src="layoutIconUrl(node)"
                                            :alt="node.id"
                                            class="pointer-events-none h-full w-full rounded-md object-contain"
                                            draggable="false"
                                        />
                                        <span class="absolute left-0 top-0 max-w-full truncate bg-black/60 px-1 text-[8px] leading-3 text-sky-100">{{ layoutShortName(node) }}</span>
                                    </div>
                                </template>
                            </div>
                        </div>
                        <p class="text-xs text-slate-400">
                            {{ ASSET_SIZING_RULES[backgroundAssetKey].width }}x{{ ASSET_SIZING_RULES[backgroundAssetKey].height }}
                            ({{ ASSET_SIZING_RULES[backgroundAssetKey].mimeType.split('/')[1].toUpperCase() }})
                        </p>
                        <div class="flex flex-wrap gap-2">
                            <n-button type="button" btn="soft"  leading="i-lucide-file-up" size="sm"
                                      @click="openAssetPicker(backgroundAssetKey)">选择
                            </n-button>
                            <input
                                :ref="(element) => setAssetInputRef(backgroundAssetKey!, element as HTMLInputElement | null)"
                                style="display: none"
                                type="file"
                                accept="image/*"
                                @change="onAssetSelected(backgroundAssetKey, $event)"
                            />
                            <n-button btn="soft-error" size="sm" :disabled="!form.assets[backgroundAssetKey]"
                                      leading="i-lucide-x-circle" @click="removeAsset(backgroundAssetKey)">清除
                            </n-button>
                        </div>
                        <div v-if="layoutNodes.length && layoutOverlayOn" class="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-xs font-semibold text-slate-200">布局元素（{{ layoutNodes.length }}）</span>
                                <span class="text-[10px] text-slate-500">点击行选中，预览区同步高亮</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <input
                                    v-model="layoutSearch"
                                    type="text"
                                    placeholder="搜索元素名称..."
                                    class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none placeholder-slate-600 focus:border-primary-500/60"
                                />
                                <label class="flex shrink-0 items-center gap-1 text-[10px] text-slate-400 whitespace-nowrap">
                                    <input v-model="layoutShowPositionedOnly" type="checkbox" class="accent-primary-500" />
                                    仅显示有位置
                                </label>
                            </div>
                            <div class="max-h-44 overflow-y-auto rounded-lg border border-slate-800">
                                <div class="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-2 py-1 text-[9px] uppercase tracking-wide text-slate-500">
                                    <span class="w-24 shrink-0">文件</span>
                                    <span class="min-w-0 flex-1">元素</span>
                                    <span class="w-20 shrink-0 text-right">位置</span>
                                    <span class="w-8 shrink-0 text-center">显示</span>
                                </div>
                                <div
                                    v-for="item in filteredLayoutNodes"
                                    :key="item.index"
                                    :id="`layout-row-${item.index}`"
                                    class="flex cursor-pointer items-center gap-2 border-b border-slate-800/60 px-2 py-1 text-[10px] transition-colors last:border-b-0"
                                    :class="item.index === selectedLayoutIndex ? 'bg-primary-400/20 text-primary-200' : 'text-slate-300 hover:bg-slate-800/40'"
                                    @click="onSelectLayoutNode(item.index, item.node)"
                                >
                                    <span class="w-24 shrink-0 truncate text-slate-500">{{ item.node.kind === 'patch' ? (item.node.id.split(' · ')[0] || '—') : '—' }}</span>
                                    <span class="min-w-0 flex-1 truncate">
                                        {{ item.node.kind === 'patch' ? (item.node.id.split(' · ')[1] ?? item.node.id) : item.node.id }}<span v-if="paneDisplayLabel(item.node)" class="text-slate-500">（{{ paneDisplayLabel(item.node) }}）</span>
                                    </span>
                                    <button type="button" class="shrink-0 rounded p-0.5 text-slate-600 transition-colors hover:text-slate-300" title="标注中文名" @click.stop="annotatePane(item.node)">
                                        <span class="i-lucide-tag text-[9px] block" />
                                    </button>
                                    <span class="w-20 shrink-0 text-right font-mono text-slate-400">{{ item.node.hasPosition ? `${Math.round(item.node.x)}, ${Math.round(item.node.y)}` : '—' }}</span>
                                    <span class="flex w-8 shrink-0 justify-center">
                                        <input v-model="item.node.visible" type="checkbox" class="accent-primary-500" @click.stop @change="writeBackLayout" />
                                    </span>
                                </div>
                                <p v-if="!filteredLayoutNodes.length" class="px-2 py-2 text-[10px] text-slate-500">没有匹配的元素</p>
                            </div>
                            <div v-if="selectedLayoutNode" class="grid gap-2 border-t border-slate-800 pt-2">
                                <div class="flex items-center justify-between gap-2">
                                    <strong class="truncate text-xs text-slate-100">{{ selectedLayoutNode.id }}</strong>
                                    <label class="flex items-center gap-1.5 text-xs text-slate-300">
                                        <input v-model="selectedLayoutNode.visible" type="checkbox" class="accent-primary-500" @change="writeBackLayout" />
                                        显示此元素
                                    </label>
                                </div>
                                <div v-if="selectedLayoutNode.kind === 'box'" class="grid grid-cols-4 gap-2">
                                    <label class="grid gap-1 text-[10px] text-slate-400">X
                                        <input v-model.number="selectedLayoutNode.x" type="number" class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60" @input="writeBackLayout" />
                                    </label>
                                    <label class="grid gap-1 text-[10px] text-slate-400">Y
                                        <input v-model.number="selectedLayoutNode.y" type="number" class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60" @input="writeBackLayout" />
                                    </label>
                                    <label class="grid gap-1 text-[10px] text-slate-400">宽度
                                        <input v-model.number="selectedLayoutNode.width" type="number" class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60" @input="writeBackLayout" />
                                    </label>
                                    <label class="grid gap-1 text-[10px] text-slate-400">高度
                                        <input v-model.number="selectedLayoutNode.height" type="number" class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60" @input="writeBackLayout" />
                                    </label>
                                </div>
                                <div v-else class="grid grid-cols-2 gap-2">
                                    <label class="grid gap-1 text-[10px] text-slate-400">X（Position）
                                        <input v-model.number="selectedLayoutNode.x" type="number" class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60" @input="writeBackLayout" />
                                    </label>
                                    <label class="grid gap-1 text-[10px] text-slate-400">Y（Position）
                                        <input v-model.number="selectedLayoutNode.y" type="number" class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60" @input="writeBackLayout" />
                                    </label>
                                </div>
                                <p v-if="selectedLayoutNode.kind === 'patch' && !selectedLayoutNode.hasPosition" class="text-[10px] text-slate-500">该补丁原本没有 Position，设置 X/Y 后将自动新建。</p>
                                <label v-if="selectedLayoutNode.kind === 'box'" class="grid gap-1 text-[10px] text-slate-400">层级（z-index）
                                    <input v-model.number="selectedLayoutNode.zIndex" type="number" class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60" @input="writeBackLayout" />
                                </label>
                            </div>
                        </div>
                    </div>
                </article>

                <div class="flex items-center justify-center max-lg:order-2">
                    <n-badge badge="outline-warning" size="xs" class="px-2 uppercase tracking-wide">且/或</n-badge>
                </div>

                <article
                    class="flex flex-col h-full gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl max-lg:order-3">
                    <div class="flex items-center justify-between gap-2">
                        <h2 class="text-lg font-semibold">布局</h2>
                        <div class="flex items-center gap-1.5">
                            <button
                                type="button"
                                title="帮助"
                                class="rounded-lg border p-1.5 transition-colors"
                                :class="layoutHelpOpen ? 'border-primary-400 bg-primary-400/20 text-primary-200' : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'"
                                @click="layoutHelpOpen = !layoutHelpOpen"
                            >
                                <span class="i-lucide-circle-help text-sm block" />
                            </button>
                            <button
                                v-if="layoutMetaFields.length"
                                type="button"
                                title="布局信息（PatchName / AuthorName 等）"
                                class="rounded-lg border p-1.5 transition-colors"
                                :class="layoutInfoOpen ? 'border-primary-400 bg-primary-400/20 text-primary-200' : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-600 hover:text-slate-200'"
                                @click="layoutInfoOpen = !layoutInfoOpen"
                            >
                                <span class="i-lucide-settings text-sm block" />
                            </button>
                        </div>
                    </div>
                    <div v-if="layoutHelpOpen" class="grid gap-1.5 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-[10px] leading-4 text-slate-400">
                        <span class="text-xs font-semibold text-slate-200">说明</span>
                        <span>· <b class="text-slate-300">方法 = 布局积木</b>：把复杂布局（或其部分文件）命名存档，随时搭进别的布局。</span>
                        <span>· 保存：点「保存当前布局为方法」→ 命名 → 勾选要包含的文件/动画 → 保存，方法集合自动打包存入本机文件夹（dist-offline/methods/，用预览脚本打开时）。</span>
                        <span>· 应用：点方法的「应用」→ 先看<b class="text-orange-300">冲突预览</b>（新增=<b class="text-emerald-300">绿</b>，覆盖=<b class="text-orange-300">橙</b>）→ 确认应用。</span>
                        <span>· 分类颜色：<b class="text-sky-300">背景</b> / <b class="text-violet-300">按钮</b> / <b class="text-amber-300">布局</b> / <b class="text-emerald-300">顶部</b> / <b class="text-rose-300">气泡</b> / 灰=其他。</span>
                        <span>· 备份：点「导出全部」存成 .json；换入口（双击 index.html vs 启动预览.cmd）或换电脑后，用「导入」找回。</span>
                        <span>· 数据：用「启动预览.cmd」打开时自动存到文件夹；双击 index.html 打开时存浏览器 localStorage（两种入口不互通，可互相用「导出/导入」迁移）。</span>
                    </div>
                    <div v-if="layoutInfoOpen && layoutMetaFields.length" class="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                        <span class="text-xs font-semibold text-slate-200">布局信息</span>
                        <label class="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-300">
                            <span>叠加层：在背景图上显示布局元素</span>
                            <input v-model="layoutOverlayOn" type="checkbox" class="accent-primary-500" />
                        </label>
                        <div class="grid gap-2 sm:grid-cols-2">
                            <label v-for="field in layoutMetaFields" :key="field.key" class="grid gap-1 text-[10px] text-slate-400">
                                {{ field.label }}<span v-if="field.label !== field.key" class="font-mono text-slate-600">（{{ field.key }}）</span>
                                <input
                                    v-if="field.type === 'boolean'"
                                    v-model="layoutParsed[field.key]"
                                    type="checkbox"
                                    class="accent-primary-500 justify-self-start"
                                    @change="layoutMetaWriteBack"
                                />
                                <input
                                    v-else-if="field.type === 'number'"
                                    v-model.number="layoutParsed[field.key]"
                                    type="number"
                                    class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60"
                                    @input="layoutMetaWriteBack"
                                />
                                <input
                                    v-else
                                    v-model="layoutParsed[field.key]"
                                    type="text"
                                    class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-primary-500/60"
                                    @input="layoutMetaWriteBack"
                                />
                            </label>
                        </div>
                    </div>
                    <div class="rounded-xl border border-slate-800 bg-slate-950/40">
                        <button
                            type="button"
                            class="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-slate-300 transition-colors hover:text-slate-100"
                            @click="methodPanelOpen = !methodPanelOpen"
                        >
                            <span class="font-semibold">方法</span>
                            <span class="text-[10px] text-slate-500">{{ layoutMethods.length ? `已存 ${layoutMethods.length} 个` : '把复杂布局提取成可复用的积木' }}</span>
                        </button>
                        <div v-if="methodPanelOpen" class="grid gap-2 border-t border-slate-800 p-3">
                            <p v-if="methodSaveToast" class="rounded-lg border border-emerald-800/50 bg-emerald-950/30 px-2 py-1 text-[10px] text-emerald-300">{{ methodSaveToast }}</p>
                            <div class="flex items-center gap-1.5">
                                <button type="button" class="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100" @click="exportMethods">导出全部</button>
                                <button type="button" class="rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100" @click="methodImportInput?.click()">导入</button>
                                <input ref="methodImportInput" type="file" accept=".json,application/json" class="hidden" @change="onMethodImportFile" />
                            </div>
                            <button
                                v-if="layoutParsed"
                                type="button"
                                class="rounded-lg border border-primary-500/40 bg-primary-500/10 px-2 py-1.5 text-xs text-primary-200 transition-colors hover:bg-primary-500/20"
                                @click="openMethodSave"
                            >
                                ＋ 保存当前布局为方法
                            </button>
                            <div v-if="methodSaveOpen" class="grid gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 p-2">
                                <input
                                    v-model="methodName"
                                    type="text"
                                    placeholder="方法名称（如：壁纸持续滚动）"
                                    class="w-full rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none placeholder-slate-600 focus:border-primary-500/60"
                                />
                                <div v-if="layoutFilesForMethod.length" class="grid gap-1">
                                    <span class="text-[10px] text-slate-500">选择要包含的文件：</span>
                                    <div class="grid max-h-32 gap-0.5 overflow-y-auto pr-1">
                                        <label v-for="f in layoutFilesForMethod" :key="f.name" class="flex items-center gap-1.5 text-[10px] text-slate-300">
                                            <input v-model="methodFileSelections[f.name]" type="checkbox" class="accent-primary-500" />
                                            <span class="min-w-0 flex-1 truncate font-mono">{{ f.name }}</span>
                                            <span class="shrink-0 text-slate-500">{{ f.count }} 补丁</span>
                                        </label>
                                    </div>
                                </div>
                                <div v-if="layoutAnimsForMethod.length" class="grid gap-1">
                                    <span class="text-[10px] text-slate-500">动画（默认不勾选，通常随主题）：</span>
                                    <div class="grid max-h-24 gap-0.5 overflow-y-auto pr-1">
                                        <label v-for="an in layoutAnimsForMethod" :key="an" class="flex items-center gap-1.5 text-[10px] text-slate-300">
                                            <input v-model="methodAnimsSelections[an]" type="checkbox" class="accent-primary-500" />
                                            <span class="min-w-0 flex-1 truncate font-mono">{{ an }}</span>
                                        </label>
                                    </div>
                                </div>
                                <div class="flex justify-end gap-2">
                                    <button type="button" class="rounded-md px-2 py-1 text-[10px] text-slate-400 transition-colors hover:text-slate-200" @click="methodSaveOpen = false">取消</button>
                                    <button type="button" class="rounded-md bg-primary-500/20 px-2 py-1 text-[10px] text-primary-200 transition-colors hover:bg-primary-500/30" @click="saveMethod">保存</button>
                                </div>
                                <p v-if="methodSaveError" class="text-[10px] text-red-400">⚠ {{ methodSaveError }}</p>
                            </div>
                            <div v-if="layoutMethods.length" class="grid gap-1">
                                <div v-for="(m, i) in layoutMethods" :key="m.savedAt + '-' + i" class="grid gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2 py-1.5">
                                    <div class="flex items-center gap-2">
                                        <span class="min-w-0 flex-1 truncate text-xs text-slate-200" :title="m.name">{{ m.name }}</span>
                                        <span class="shrink-0 rounded border border-slate-700 px-1 py-px text-[9px] text-slate-500">{{ new Date(m.savedAt).toLocaleDateString() }}</span>
                                        <button type="button" class="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors" :class="methodDetailIndex === i ? 'border-sky-400 bg-sky-400/20 text-sky-200' : 'border-slate-700 text-sky-300 hover:border-sky-500/60 hover:text-sky-200'" @click="toggleMethodDetail(i)">应用</button>
                                        <button type="button" class="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:text-slate-200" title="重命名" @click="renameMethod(m)"><span class="i-lucide-pencil text-[10px] block" /></button>
                                        <button type="button" class="shrink-0 rounded-md p-1 text-slate-500 transition-colors hover:text-red-400" title="删除" @click="deleteMethod(i)"><span class="i-lucide-trash-2 text-[10px] block" /></button>
                                    </div>
                                    <div class="flex flex-wrap gap-1">
                                        <span v-for="c in methodCategorySummary(m)" :key="c.label" class="rounded bg-slate-950/70 px-1.5 py-px text-[9px] font-medium" :class="c.cls">{{ c.label }} × {{ c.count }}</span>
                                        <span v-if="methodConflictSummary(m).overwrites" class="rounded bg-orange-950/40 px-1.5 py-px text-[9px] font-medium text-orange-300">会覆盖 {{ methodConflictSummary(m).overwrites }} 项</span>
                                        <span v-if="methodConflictSummary(m).news" class="rounded bg-emerald-950/40 px-1.5 py-px text-[9px] font-medium text-emerald-300">新增 {{ methodConflictSummary(m).news }} 项</span>
                                        <span v-if="!layoutParsed" class="rounded bg-slate-950/70 px-1.5 py-px text-[9px] text-slate-500">等待布局</span>
                                    </div>
                                    <div v-if="methodDetailIndex === i" class="grid gap-1 rounded-lg border border-slate-700/60 bg-slate-950/40 p-2">
                                        <span class="text-[10px] font-semibold text-slate-300">应用冲突预览（对当前布局）：</span>
                                        <p v-if="!methodConflictInfo(m).files.length && !methodConflictInfo(m).anims.length" class="text-[10px] text-slate-500">此方法为空，或当前布局格式不匹配（数组格式）。</p>
                                        <div v-for="f in methodConflictInfo(m).files" :key="f.file" class="flex items-center gap-1.5 text-[10px]">
                                            <span class="w-10 shrink-0 font-medium" :class="f.status === 'new' ? 'text-emerald-300' : 'text-orange-300'">{{ f.status === 'new' ? '新增' : '覆盖' }}</span>
                                            <span class="min-w-0 flex-1 truncate font-mono" :class="f.cls">{{ f.file }}</span>
                                        </div>
                                        <div v-for="a in methodConflictInfo(m).anims" :key="a.file" class="flex items-center gap-1.5 text-[10px]">
                                            <span class="w-10 shrink-0 font-medium" :class="a.status === 'new' ? 'text-emerald-300' : 'text-orange-300'">{{ a.status === 'new' ? '新增' : '覆盖' }}</span>
                                            <span class="min-w-0 flex-1 truncate font-mono text-violet-300">{{ a.file }}</span>
                                        </div>
                                        <button type="button" class="mt-0.5 rounded-md bg-sky-500/20 px-2 py-1 text-[10px] text-sky-200 transition-colors hover:bg-sky-500/30" :disabled="!layoutParsed" @click="applyMethod(m)">确认应用</button>
                                    </div>
                                </div>
                            </div>
                            <p v-else-if="!layoutParsed" class="text-[10px] text-slate-500">先粘贴/导入布局，才能保存方法。</p>
                            <p v-else class="text-[10px] text-slate-500">还没有方法：点「保存当前布局为方法」或「导入」找回。</p>
                        </div>
                    </div>
                    <div class="flex flex-col gap-3 flex-grow min-h-0">
                        <label class="flex flex-col gap-1 text-sm flex-1 min-h-0">
                            <span class="text-xs text-slate-400">layout.json</span>
                            <div class="relative flex-grow min-h-40">
                                <textarea
                                    ref="layoutTextareaRef"
                                    v-model="form.layoutJson"
                                    class="h-full w-full rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/50 transition-all duration-200 outline-none resize-none"
                                    placeholder="在此粘贴布局 JSON。设置后背景图变为可选。"
                                />
                                <button
                                    v-if="form.layoutJson.trim()"
                                    type="button"
                                    class="absolute right-2.5 top-2.5 rounded-lg bg-red-950/40 p-1 text-red-400 hover:bg-red-950/80 transition-colors border border-red-900/30"
                                    @click="clearLayoutJson"
                                >
                                    <span class="i-lucide-x text-xs block" />
                                </button>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <n-button size="sm" type="button" leading="i-lucide-file-up" btn="soft"
                                          @click="onSelectLayoutJson">选择
                                </n-button>
                            </div>
                            <input
                                ref="layoutJsonInput"
                                style="display: none"
                                type="file"
                                accept="application/json,.json,text/plain"
                                @change="onLayoutJsonSelected"
                            />
                        </label>

                        <label v-if="form.target === 'home'" class="flex flex-col gap-1 text-sm flex-1 min-h-0">
                            <span class="flex items-center justify-between gap-2 text-xs text-slate-400">
                                <span>common.json</span>
                                <n-badge badge="outline" size="xs" class="uppercase">可选</n-badge>
                            </span>
                            <div class="relative flex-grow min-h-40">
                                <textarea
                                    v-model="form.commonJson"
                                    class="h-full w-full rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs font-mono text-slate-300 placeholder-slate-600 focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/50 transition-all duration-200 outline-none resize-none"
                                    placeholder="在此粘贴 common JSON。"
                                />
                                <button
                                    v-if="form.commonJson.trim()"
                                    type="button"
                                    class="absolute right-2.5 top-2.5 rounded-lg bg-red-950/40 p-1 text-red-400 hover:bg-red-950/80 transition-colors border border-red-900/30"
                                    @click="clearCommonJson"
                                >
                                    <span class="i-lucide-x text-xs block" />
                                </button>
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <n-button size="sm" type="button" leading="i-lucide-file-up" btn="soft"
                                          @click="onSelectCommonJson">选择
                                </n-button>
                            </div>
                            <input
                                ref="commonJsonInput"
                                style="display: none"
                                type="file"
                                accept="application/json,.json,text/plain"
                                @change="onCommonJsonSelected"
                            />
                        </label>
                    </div>
                </article>
            </section>

            <section v-if="iconAssetKeys.length > 0"
                     class="mb-4 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl">
                <h2 class="text-lg font-semibold">图标</h2>
                <p class="text-sm text-slate-300">所有图标均为可选。</p>
                <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
                    <article v-for="key in iconAssetKeys" :key="key"
                             class="group relative flex flex-col gap-3 rounded-2xl border border-slate-800/60 bg-slate-950/20 hover:bg-slate-950/40 transition-all duration-300 p-3 shadow-sm">
                        <div class="flex items-start justify-between gap-2">
                            <div class="grid gap-0.5 min-w-0">
                                <strong class="text-xs font-semibold text-slate-200 truncate">{{ ASSET_DISPLAY_NAMES[key] }}</strong>
                                <span class="text-[10px] text-slate-500 font-mono truncate">{{ NXTHEME_ASSET_FILENAMES[key] }}</span>
                            </div>
                            <n-badge badge="outline" size="xs" class="uppercase">可选</n-badge>
                        </div>

                        <div
                            class="group/drop relative grid h-24 w-full cursor-pointer place-items-center overflow-hidden rounded-xl border border-dashed border-slate-800 bg-slate-950/30 transition-all duration-300 hover:border-primary-500/60 hover:bg-slate-950/50"
                            :class="{ 'border-primary-400 ring-1 ring-primary-400 bg-slate-950/60': dragActive[key] }"
                            role="button"
                            tabindex="0"
                            @click="openAssetPicker(key)"
                            @keydown.enter.prevent="openAssetPicker(key)"
                            @dragenter.prevent="onAssetDragEnter(key)"
                            @dragover.prevent
                            @dragleave.prevent="onAssetDragLeave(key)"
                            @drop.prevent="onAssetDrop(key, $event)"
                        >
                            <img
                                v-if="previewUrls[key]"
                                :src="previewUrls[key]"
                                :alt="ASSET_DISPLAY_NAMES[key]"
                                class="h-auto max-h-[64px] w-auto max-w-[64px] object-contain transition-transform duration-300 group-hover/drop:scale-105"
                            />
                            <img
                                v-else-if="ASSET_ICON_PRESETS[key]"
                                :src="presetIconUrl(key) || undefined"
                                :alt="ASSET_DISPLAY_NAMES[key]"
                                class="h-auto w-auto max-h-[56px] max-w-[56px] object-contain opacity-40 transition-opacity duration-300 group-hover/drop:opacity-60"
                            />
                            <span v-else class="text-[10px] text-slate-500 text-center">
                                <span class="i-lucide-file-up text-lg block mx-auto mb-1 text-slate-600 group-hover/drop:text-slate-400" />
                                无预览
                            </span>
                        </div>

                        <div class="flex items-center justify-between text-[9px] text-slate-500">
                            <span>{{ ASSET_SIZING_RULES[key].width }}x{{ ASSET_SIZING_RULES[key].height }}</span>
                            <span class="uppercase font-mono">{{ ASSET_SIZING_RULES[key].mimeType.split('/')[1] }}</span>
                        </div>

                        <div class="flex gap-2">
                            <n-button leading="i-lucide-file-up" size="xs" btn="soft" type="button" class="flex-1 justify-center" @click="openAssetPicker(key)">
                                选择
                            </n-button>
                            <input
                                :ref="(element) => setAssetInputRef(key, element as HTMLInputElement | null)"
                                style="display: none"
                                type="file"
                                accept="image/*"
                                @change="onAssetSelected(key, $event)"
                            />
                            <n-button icon size="xs" btn="soft-error" :disabled="!form.assets[key]"
                                      leading="i-lucide-x" class="px-2" @click="removeAsset(key)">
                            </n-button>
                        </div>
                    </article>
                </div>
            </section>

            <n-dialog
                v-if="cropAssetKey"
                :open="Boolean(cropAssetKey)"
                :una="{ dialogContent: 'w-[96vw] !max-w-[980px]' }"
                @update:open="(nextOpen) => { if (!nextOpen) closeCropEditor() }"
                title="裁剪与缩放"
                description="保存前调整裁剪范围"
            >
                <div class="grid w-full gap-3">
                    <p class="text-sm text-slate-300">
                        正在编辑 <strong>{{ ASSET_DISPLAY_NAMES[cropAssetKey] }}</strong>
                        （{{ ASSET_SIZING_RULES[cropAssetKey].width }}x{{ ASSET_SIZING_RULES[cropAssetKey].height }}），
                        来源：{{ cropFileName }}
                    </p>
                    <div class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <div
                            v-if="cropEditorMetrics"
                            class="relative mx-auto w-full overflow-hidden select-none touch-none"
                            :style="{ width: `${cropEditorMetrics.displayWidth}px`, height: `${cropEditorMetrics.displayHeight}px` }"
                            @pointermove.prevent="onCropDragMove"
                            @pointerup="stopCropDrag"
                            @pointercancel="stopCropDrag"
                        >
                            <img
                                :src="cropSource"
                                alt="裁剪源图"
                                class="h-full w-full object-contain"
                                draggable="false"
                            />
                            <div
                                class="absolute cursor-move rounded border-2 border-primary-400 bg-primary-400/10"
                                :class="{ 'ring-2 ring-primary-300': cropDrag.active }"
                                :style="{
                                    left: `${cropEditorMetrics.frameLeft}px`,
                                    top: `${cropEditorMetrics.frameTop}px`,
                                    width: `${cropEditorMetrics.frameWidth}px`,
                                    height: `${cropEditorMetrics.frameHeight}px`,
                                    boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.55)',
                                }"
                                @pointerdown.prevent="startCropDrag"
                                @pointermove.prevent="onCropDragMove"
                                @pointerup="stopCropDrag"
                                @pointercancel="stopCropDrag"
                            >
                                <span class="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-primary-300" />
                                <span class="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary-300" />
                                <span class="absolute -bottom-1 -left-1 h-2 w-2 rounded-full bg-primary-300" />
                                <span class="absolute -bottom-1 -right-1 h-2 w-2 rounded-full bg-primary-300" />
                            </div>
                        </div>
                    </div>
                    <label class="grid gap-1 text-sm">
                        缩放
                        <input v-model.number="cropState.zoom" class="w-full" type="range" :min="cropState.minZoom"
                               max="4" step="0.01" />
                    </label>
                    <div class="flex justify-center rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <canvas ref="cropCanvas" class="max-w-[420px]" />
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <n-button leading="i-lucide-check" @click="applyCrop">应用裁剪</n-button>
                        <n-button btn="soft" leading="i-lucide-x" @click="closeCropEditor">取消</n-button>
                    </div>
                </div>
            </n-dialog>

            <section class="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl">
                <div class="flex flex-wrap justify-center gap-2">
                    <n-button :disabled="loading" :leading="loading ? 'i-lucide-loader-circle' : 'i-lucide-download'"
                               @click="onBuild">
                        {{ loading ? "构建中..." : "构建并下载 .nxtheme" }}
                    </n-button>
                    <n-button btn="solid-error" :disabled="loading" leading="i-lucide-rotate-ccw" @click="onReset">
                        重置
                    </n-button>
                </div>
                <input
                    ref="importInput"
                    style="display: none"
                    type="file"
                    accept=".nxtheme,application/octet-stream"
                    @change="onImportSelected"
                />
            </section>
        </div>
        <n-toaster />
    </main>
</template>


