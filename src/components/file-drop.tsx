import { useCallback, useRef, useState } from "react"
import { Upload } from "lucide-react"
import { cn } from "@/lib/utils"

function normalizeSVG(text: string): string {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml")
  const svg = doc.documentElement
  if (!svg || svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) {
    throw new Error("that SVG could not be parsed")
  }
  let vw = 1000
  let vh = 1000
  const vb = svg.getAttribute("viewBox")
  const wAttr = parseFloat(svg.getAttribute("width") || "")
  const hAttr = parseFloat(svg.getAttribute("height") || "")
  if (vb) {
    const p = vb.trim().split(/[\s,]+/).map(Number)
    if (p.length === 4 && p[2] > 0 && p[3] > 0) {
      vw = p[2]
      vh = p[3]
    }
  } else if (wAttr > 0 && hAttr > 0) {
    vw = wAttr
    vh = hAttr
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`)
  }
  const k = 1500 / Math.max(vw, vh)
  svg.setAttribute("width", String(Math.round(vw * k)))
  svg.setAttribute("height", String(Math.round(vh * k)))
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  return new XMLSerializer().serializeToString(svg)
}

export function FileDrop({
  fileName,
  dims,
  onLoad,
  onError,
}: {
  fileName: string
  dims: string
  onLoad: (img: HTMLImageElement, name: string) => void
  onError: (msg: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [hot, setHot] = useState(false)

  const loadFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return
      const isSVG = file.type === "image/svg+xml" || /\.svg$/i.test(file.name)
      try {
        let src: string
        if (isSVG) {
          src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(normalizeSVG(await file.text()))
        } else {
          src = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader()
            fr.onload = () => resolve(fr.result as string)
            fr.onerror = () => reject(new Error("the file couldn't be read from disk"))
            fr.readAsDataURL(file)
          })
        }
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error("the browser can't decode this format"))
          img.src = src
        })
        onLoad(img, file.name)
      } catch (e) {
        onError((e as Error).message || "unknown error")
      }
    },
    [onLoad, onError]
  )

  return (
    <div className="space-y-2.5">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setHot(true)
        }}
        onDragLeave={() => setHot(false)}
        onDrop={(e) => {
          e.preventDefault()
          setHot(false)
          loadFile(e.dataTransfer.files[0])
        }}
        className={cn(
          "border border-dashed rounded p-4 text-center cursor-pointer transition-colors bg-panel-2",
          hot ? "border-accent bg-accent-soft" : "border-line-strong hover:border-accent"
        )}
      >
        <Upload className="mx-auto mb-1.5 h-4 w-4 text-dim" />
        <b className="block text-[11.5px] font-medium">Drop a file, or click to browse</b>
        <small className="text-dimmer text-[10px] tracking-wide">PNG · JPG · WEBP · GIF · SVG</small>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept="image/*,.svg,.png,.jpg,.jpeg,.webp,.gif"
        onChange={(e) => {
          loadFile(e.target.files?.[0])
          e.target.value = ""
        }}
      />
      <div className="flex justify-between gap-2.5 text-[10.5px] text-dim">
        <b className="text-ink font-normal truncate">{fileName}</b>
        <span className="shrink-0">{dims}</span>
      </div>
    </div>
  )
}
