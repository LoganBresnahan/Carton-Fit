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
import { registerViewportCapture } from './capture'
import { viewportPalette } from './palette'
import { resolvedView, useAppStore } from '../store'

// The viewport island (ADR-0008). Owns the imperative three lifecycle and syncs
// scene content from the store's parts slice — but no scene *logic*: content is
// built by the pure builders, disposed through the pure choke point (sceneContent),
// and framed by pure math. What lives here is only wiring: renderer, subscription,
// render-on-demand, teardown.

const FOV = 50

/** `#rrggbb`, for the container's `data-clear-color`. */
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

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

    // The RESOLVED scheme, and the only place the renderer learns it (ADR-0025
    // §5). It is read from `prefers-color-scheme` rather than from the theme IPC
    // because that media query IS the one mechanism: main points it at the
    // preference through `nativeTheme.themeSource`, so this covers a pinned
    // theme and an OS switch under `system` without having to tell them apart.
    const scheme = window.matchMedia('(prefers-color-scheme: dark)')
    let dark = scheme.matches
    let palette = viewportPalette(dark)

    const scene = new Scene()
    const background = new Color(palette.background)
    scene.background = background
    const hemi = new HemisphereLight(0xffffff, palette.ground, 1.1)
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
          buildPackedScene(parts, packResult.placements, packed, dark)
        )
      } else {
        content = swapContent(scene, content, parts.length ? buildPartsScene(parts, dark) : null)
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

    // The e2e's window onto the clear colour. three stays private to this island
    // (ADR-0008) and the drawing buffer is not preserved, so the spec compares
    // this attribute against the stylesheet's resolved `--bg` instead of trying
    // to sample the canvas.
    const publishClearColor = (): void => {
      container.dataset.clearColor = hex(palette.background)
    }

    // Export's window onto the scene (ADR-0017): render and read back inside
    // one call, so the drawing buffer is still intact — no standing
    // preserveDrawingBuffer taxing every frame for a rare click.
    registerViewportCapture(() => {
      renderer.render(scene, camera)
      return renderer.domElement.toDataURL('image/png')
    })

    // Re-tint on a scheme change. Two of the four colours belong to objects this
    // component owns (background, hemisphere ground) and are set in place; the
    // other two are baked into content by the PURE builders, so the content is
    // rebuilt through the same choke point every other change uses rather than
    // traversing materials — one path, one disposal contract (ADR-0008), and no
    // second place that has to know which material is which. Rebuilding is
    // affordable because it is rare: a theme switch is a deliberate click, not a
    // keystroke. `framedKey` is untouched, so applyScene does not reframe and a
    // camera the user has orbited stays where they left it.
    const retint = (): void => {
      dark = scheme.matches
      palette = viewportPalette(dark)
      background.set(palette.background)
      hemi.groundColor.set(palette.ground)
      publishClearColor()
      applyScene(useAppStore.getState())
    }
    scheme.addEventListener('change', retint)

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
    publishClearColor()
    applyScene(useAppStore.getState()) // render whatever is already loaded

    return () => {
      unsubscribe()
      scheme.removeEventListener('change', retint)
      registerViewportCapture(null) // the context below is about to be lost
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
