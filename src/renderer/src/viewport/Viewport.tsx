import { useEffect, useRef } from 'react'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three'
import { OrbitControls } from './adapters/orbitControls'

// The viewport lifecycle island (ADR-0008 phase 2). It owns ONLY the imperative
// three lifecycle — renderer, camera, controls, lights, resize, teardown — and
// deliberately holds no scene logic: parts come from the store swap (phase 3),
// and disposal of replaced geometry lands in phase 4. Because a WebGLRenderer
// needs a real GL context, this component's verification is Playwright/dogfood
// (ADR-0005), not vitest — which is exactly why all testable logic lives in the
// pure builders instead of here.
//
// Renders on demand (controls 'change', resize) rather than a continuous rAF
// loop; phase 3's render-on-demand slice adds invalidation coalescing and the
// swap hook. Damping is off: it would need a per-frame update loop that on-demand
// rendering deliberately avoids.

const BACKGROUND = 0x1b1e24 // matches --bg

export default function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const renderer = new WebGLRenderer({ canvas, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)

    const scene = new Scene()
    scene.background = new Color(BACKGROUND)
    const hemi = new HemisphereLight(0xffffff, 0x333844, 1.1)
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(1, 1.5, 1)
    scene.add(hemi, key, new AmbientLight(0xffffff, 0.25))

    const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
    camera.position.set(3, 2.4, 3)

    const controls = new OrbitControls(camera, canvas)

    const render = (): void => renderer.render(scene, camera)

    const resize = (): void => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    controls.addEventListener('change', render)
    const observer = new ResizeObserver(() => {
      resize()
      render()
    })
    observer.observe(container)

    resize()
    render()

    return () => {
      observer.disconnect()
      controls.removeEventListener('change', render)
      controls.dispose()
      renderer.dispose()
      // Release the GL context so StrictMode's mount→unmount→mount and HMR
      // remounts don't accumulate contexts toward Chromium's ~16 live cap.
      renderer.forceContextLoss()
    }
  }, [])

  return (
    <div className="viewport" data-testid="viewport" ref={containerRef}>
      <canvas ref={canvasRef} data-testid="viewport-canvas" />
    </div>
  )
}
