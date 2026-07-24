import { Box3, MathUtils, Sphere, Vector3 } from 'three'
import { partBox3 } from './partGeometry'
import type { ImportedPart } from '../workers/import-protocol'

// Pure camera-framing math (ADR-0008). Given the model bounds and a perspective
// camera's fov/aspect, place the camera so the whole model fits with margin.
// three's Box3/Vector3/Sphere are plain data classes → unit-tested under Node.

export interface CameraFraming {
  position: Vector3
  target: Vector3
  near: number
  far: number
}

/** Union AABB of every part, as a three Box3 — the input to frameBox. */
export function boundsOfParts(parts: ImportedPart[]): Box3 {
  const box = new Box3()
  for (const part of parts) box.union(partBox3(part))
  return box
}

/** A pleasant three-quarter view direction (front-top-right), normalized. */
const VIEW_DIR = new Vector3(1, 0.8, 1).normalize()

/**
 * Frame a bounding box in a perspective camera. Fits the box's bounding sphere
 * to whichever frustum half-angle is tighter (vertical fov, or the aspect-
 * derived horizontal fov when the viewport is portrait), so nothing clips at any
 * aspect ratio. Degenerate/empty boxes fall back to a unit sphere at the origin
 * rather than producing NaN.
 */
export function frameBox(
  box: Box3,
  opts: { fov: number; aspect: number; padding?: number }
): CameraFraming {
  const padding = opts.padding ?? 1.15
  const center = box.isEmpty() ? new Vector3(0, 0, 0) : box.getCenter(new Vector3())

  const sphere = box.isEmpty() ? new Sphere(center, 1) : box.getBoundingSphere(new Sphere())
  const radius = sphere.radius > 0 && Number.isFinite(sphere.radius) ? sphere.radius : 1

  const vFov = MathUtils.degToRad(opts.fov)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * opts.aspect)
  const limitingHalfFov = Math.min(vFov, hFov) / 2
  const distance = (radius / Math.sin(limitingHalfFov)) * padding

  const position = center.clone().addScaledVector(VIEW_DIR, distance)
  const near = Math.max((distance - radius) * 0.5, distance * 0.001)
  const far = (distance + radius) * 1.5
  return { position, target: center.clone(), near, far }
}
