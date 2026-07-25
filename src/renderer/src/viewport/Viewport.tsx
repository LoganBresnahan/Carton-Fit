import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from 'three'
import { OrbitControls } from './adapters/orbitControls'
import { buildPartsScene } from './sceneFromParts'
import { boundsOfCarton, buildPackedScene } from './sceneFromPlacements'
import { boundsOfParts, frameBox } from './cameraFraming'
import { swapContent } from './sceneContent'
import { resolvedView, useAppStore } from '../store'

// The viewport island (ADR-0008). Owns the imperative three lifecycle and syncs
// scene content from the store's parts slice — but no scene *logic*: content is
// built by the pure builders, disposed through the pure choke point (sceneContent),
// and framed by pure math. What lives here is only wiring: renderer, subscription,
// render-on-demand, teardown.

const BACKGROUND = 0x1b1e24 // matches --bg
const FOV = 50

export default function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [glFailed, setGlFailed] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    // Graceful degradation: a machine with no/broken GPU drivers (RDP, VMs, old
    // hardware) can't create a context. Fall back to a message instead of letting
    // three throw into the render tree. Normal Windows GPUs never hit this.
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true })
    } catch {
      setGlFailed(true)
      return
    }
    renderer.setPixelRatio(window.devicePixelRatio)

    const scene = new Scene()
    scene.background = new Color(BACKGROUND)
    const hemi = new HemisphereLight(0xffffff, 0x333844, 1.1)
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(1, 1.5, 1)
    scene.add(hemi, key, new AmbientLight(0xffffff, 0.25))

    const camera = new PerspectiveCamera(FOV, 1, 0.1, 5000)
    camera.position.set(3, 2.4, 3)
    const controls = new OrbitControls(camera, canvas)

    // Render on demand, coalesced to a single rAF so a burst of invalidations
    // (swap + resize + controls) renders once.
    let rafId = 0
    const invalidate = (): void => {
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        renderer.render(scene, camera)
      })
    }

    const aspect = (): number => {
      const w = container.clientWidth || 1
      const h = container.clientHeight || 1
      return w / h
    }

    const resize = (): void => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    // The one place scene content changes: swap through the choke point (which
    // disposes the outgoing geometry), then reframe the camera to the new model.
    //
    // Two scenes, one slot: the loose imported parts until an estimate exists,
    // then the PACKED scene — the carton with the parts placed in it. The carton
    // comes from the request that produced the result, not from live settings,
    // so the box on screen always agrees with the placements inside it.
    let content: Object3D | null = null
    let framedKey = ''
    const applyScene = (state: ReturnType<typeof useAppStore.getState>): void => {
      const { parts, packResult, packRequest, viewMode } = state
      const showPacked =
        resolvedView(viewMode, packResult !== null && packRequest !== null) === 'packed'
      const packed = showPacked && packResult && packRequest ? packRequest.carton : null

      if (packed && packResult) {
        content = swapContent(
          scene,
          content,
          buildPackedScene(parts, packResult.placements, packed)
        )
      } else {
        content = swapContent(scene, content, parts.length ? buildPartsScene(parts) : null)
      }

      const bounds = packed ? boundsOfCarton(packed) : parts.length ? boundsOfParts(parts) : null
      // Reframe only when the subject actually changes size/identity — otherwise
      // every re-pack (a keystroke away) would yank a camera the user has orbited.
      const key = packed ? `carton:${packed.join(',')}` : `parts:${parts.length}`
      if (bounds && key !== framedKey) {
        framedKey = key
        const framing = frameBox(bounds, { fov: FOV, aspect: aspect() })
        camera.position.copy(framing.position)
        camera.near = framing.near
        camera.far = framing.far
        camera.updateProjectionMatrix()
        controls.target.copy(framing.target)
        controls.update()
      }
      if (!bounds) framedKey = ''
      invalidate()
    }

    controls.addEventListener('change', invalidate)
    const observer = new ResizeObserver(() => {
      resize()
      invalidate()
    })
    observer.observe(container)

    // React to imports and to new estimates; both slices are replaced by
    // reference, never mutated.
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (
        state.parts !== prev.parts ||
        state.packResult !== prev.packResult ||
        state.viewMode !== prev.viewMode
      ) {
        applyScene(state)
      }
    })

    resize()
    applyScene(useAppStore.getState()) // render whatever is already loaded

    return () => {
      unsubscribe()
      if (rafId) cancelAnimationFrame(rafId)
      observer.disconnect()
      controls.removeEventListener('change', invalidate)
      swapContent(scene, content, null) // dispose remaining content
      controls.dispose()
      renderer.dispose()
      // Release the GL context so StrictMode remount + HMR don't accumulate
      // contexts toward Chromium's ~16 cap.
      renderer.forceContextLoss()
    }
  }, [])

  return (
    <div className="viewport" data-testid="viewport" ref={containerRef}>
      <canvas
        ref={canvasRef}
        data-testid="viewport-canvas"
        style={{ display: glFailed ? 'none' : 'block' }}
      />
      {glFailed && (
        <div className="viewport-fallback" data-testid="viewport-fallback">
          3D preview unavailable on this system.
        </div>
      )}
    </div>
  )
}
