import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import Konva from 'konva'
import { Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva'
import type { Drawing, Region, Stroke } from '../../types/workflow'
import { loadImage } from './images'

export type CanvasHandle = { snapshot: () => string }
type Props = {
  drawing: Drawing; region: Region | null; highlight: Region | null
  tool: 'brush' | 'eraser' | 'select'; color: string; width: number; disabled: boolean
  onChange: (drawing: Drawing) => void; onRegion: (region: Region | null) => void
  onReady: (ready: boolean) => void; onError: (message: string) => void
}

export const CanvasEditor = forwardRef<CanvasHandle, Props>(function CanvasEditor(props, ref) {
  const { drawing, region, highlight, tool, color, width, disabled, onChange, onRegion, onReady, onError } = props
  const container = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const overlay = useRef<Konva.Layer>(null)
  const [size, setSize] = useState(600)
  const [image, setImage] = useState<HTMLImageElement>()
  const [stroke, setStroke] = useState<Stroke | null>(null)
  const [selection, setSelection] = useState<Region | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const activeStroke = useRef<Stroke | null>(null)
  const activeRegion = useRef<Region | null>(null)

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize(Math.max(1, Math.floor(entry.contentRect.width))))
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    onReady(false)
    setImage(undefined)
    if (!drawing.base) { onReady(true); return }
    loadImage(drawing.base).then(value => {
      if (!cancelled) { setImage(value); onReady(true) }
    }).catch(error => { if (!cancelled) onError(error.message) })
    return () => { cancelled = true }
  }, [drawing.base, onReady, onError])

  useImperativeHandle(ref, () => ({
    snapshot() {
      overlay.current?.hide()
      try { return stage.current!.toDataURL({ pixelRatio: 1024 / size }) }
      finally { overlay.current?.show() }
    },
  }), [size])

  function point() {
    const p = stage.current?.getPointerPosition()
    return p ? { x: Math.max(0, Math.min(1024, p.x * 1024 / size)), y: Math.max(0, Math.min(1024, p.y * 1024 / size)) } : null
  }
  function start(event: Konva.KonvaEventObject<PointerEvent>) {
    if (disabled || event.evt.button > 0) return
    event.evt.preventDefault()
    const p = point()
    if (!p) return
    ;(event.evt.target as HTMLElement).setPointerCapture?.(event.evt.pointerId)
    origin.current = p
    if (tool === 'select') { activeRegion.current = null; setSelection(null) }
    else {
      activeStroke.current = { points: [p.x, p.y, p.x + 0.01, p.y + 0.01], color, width, tool }
      setStroke(activeStroke.current)
    }
  }
  function move() {
    if (!origin.current) return
    const p = point()
    if (!p) return
    if (tool === 'select') {
      activeRegion.current = { x: Math.min(p.x, origin.current.x) / 1024, y: Math.min(p.y, origin.current.y) / 1024, width: Math.abs(p.x - origin.current.x) / 1024, height: Math.abs(p.y - origin.current.y) / 1024 }
      setSelection(activeRegion.current)
    } else if (activeStroke.current) {
      activeStroke.current = { ...activeStroke.current, points: [...activeStroke.current.points, p.x, p.y] }
      setStroke(activeStroke.current)
    }
  }
  function finish() {
    if (!origin.current) return
    origin.current = null
    if (tool === 'select') {
      const next = activeRegion.current
      onRegion(next && next.width > 0.01 && next.height > 0.01 ? next : null)
    } else if (activeStroke.current) onChange({ ...drawing, strokes: [...drawing.strokes, activeStroke.current] })
    activeStroke.current = null
    activeRegion.current = null
    setStroke(null)
    setSelection(null)
  }
  function regionRect(value: Region, color: string, fill: string) {
    return <Rect x={value.x * 1024} y={value.y * 1024} width={value.width * 1024} height={value.height * 1024} stroke={color} fill={fill} strokeWidth={2} dash={[10, 7]} listening={false} />
  }
  return <div ref={container} className={`canvas-frame ${disabled ? 'locked' : tool}`} aria-label="绘画画布">
    <Stage ref={stage} width={size} height={size} scaleX={size / 1024} scaleY={size / 1024}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <Layer listening={false}><Rect width={1024} height={1024} fill="#ffffff" /></Layer>
      <Layer>
        {image && <KonvaImage image={image} width={1024} height={1024} listening={false} />}
        {[...drawing.strokes, ...(stroke ? [stroke] : [])].map((line, index) => <Line key={index} points={line.points} stroke={line.color} strokeWidth={line.width} lineCap="round" lineJoin="round" globalCompositeOperation={line.tool === 'eraser' ? 'destination-out' : 'source-over'} listening={false} />)}
      </Layer>
      <Layer ref={overlay} listening={false}>
        {highlight && regionRect(highlight, '#7099ac', '#7099ac15')}
        {(selection || region) && regionRect((selection || region)!, '#d87144', '#d8714412')}
      </Layer>
    </Stage>
  </div>
})
