import { useAppStore, resolvedView } from '../store'
import { importFile } from '../import/service'
import { captureViewportPng, dataUrlToBase64 } from '../viewport/capture'
import { partKinds } from '../packing/kinds'
import { buildAppState } from '../../../main/mcp/appState'
import {
  buildEstimateReport,
  liveWeightSupplied,
  EstimateInputError
} from '../../../main/mcp/estimate'
import { settingsPatchFrom } from '../../../main/mcp/inputs'
import type { OutputUnits } from '../../../main/mcp/wire'
import type {
  DriveAction,
  DriveEnvelope,
  DriveOutcome,
  DriveResult,
  EstimateAvailability
} from '../../../shared/mcpDrive'
import { createSettleTracker, type SettleOutcome } from './settle'

// The renderer half of the drive bridge (ADR-0029 v2, slice `v2-drive-tools`).
//
// EVERYTHING GOES THROUGH THE STORE'S OWN ACTIONS, NEVER A SIDE DOOR — the
// ADR's rule, and the reason the drive tier is trustworthy at all: an AI
// client's edit lands in the same slices, re-packs through the same auto-run
// subscription, and snapshots onto the same undo stack as a person's edit
// (ADR-0016 — Ctrl+Z steps back Claude's carton just like anyone else's).
// `set_inputs` applies its whole patch in ONE `updateSettings` call, which is
// what makes it one undo step.
//
// Main sends one request at a time (the bridge serializes), so these handlers
// never interleave with each other — only with the person at the window, which
// is exactly the situation the settle tracker exists for.

/** A refusal whose message is meant for the AI client's eyes — the drive-side
 *  sibling of EstimateInputError. */
class DriveRefusal extends Error {}

const store = useAppStore
const settle = createSettleTracker(store)

function estimateFrom(outcome: SettleOutcome, units?: Partial<OutputUnits>): EstimateAvailability {
  if (outcome.status === 'empty') {
    return { available: false, reason: 'No model is loaded — call load_model first.' }
  }
  if (outcome.status === 'failed') {
    return { available: false, reason: `Packing failed: ${outcome.error}` }
  }
  const state = store.getState()
  if (state.packResult === null || state.packRequest === null) {
    return { available: false, reason: 'No estimate has been computed yet.' }
  }
  return {
    available: true,
    report: buildEstimateReport(
      {
        parts: state.parts,
        settings: state.settings,
        unitPart: state.unitPartName,
        overrides: state.partWeightsG,
        request: state.packRequest,
        result: state.packResult,
        weightSupplied: liveWeightSupplied(state.settings)
      },
      units
    )
  }
}

function snapshotState(units?: Partial<OutputUnits>): DriveOutcome['state'] {
  const state = store.getState()
  return buildAppState(
    {
      fileName: state.file?.name ?? null,
      parts: state.parts,
      settings: state.settings,
      unitPartName: state.unitPartName,
      overrides: state.partWeightsG,
      packStatus: state.packStatus,
      view: resolvedView(state.viewMode, state.packResult !== null)
    },
    units
  )
}

/** Settle, then answer with where the app now stands. */
async function settledOutcome(units?: Partial<OutputUnits>): Promise<DriveOutcome> {
  const outcome = await settle.waitForSettle()
  return { state: snapshotState(units), estimate: estimateFrom(outcome, units) }
}

/** Wait for the import triggered by load_model to land in the store. The
 *  pipeline's promise resolves at DISPATCH, so completion is a store event. */
function waitForImport(): Promise<void> {
  const finished = (): boolean => {
    const status = store.getState().status
    return status === 'done' || status === 'failed'
  }
  if (finished()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = store.subscribe(() => {
      if (finished()) {
        unsubscribe()
        resolve()
      }
    })
  })
}

/** Two frames, so a store write has been through a React commit and the
 *  viewport's effect has re-rendered the scene it captures. The timeout
 *  fallback keeps this from hanging if rAF is throttled. */
function afterRender(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 250)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer)
        resolve()
      })
    )
  })
}

async function handle(action: DriveAction): Promise<DriveResult> {
  switch (action.type) {
    case 'load_model': {
      const buffer = action.bytes.buffer.slice(
        action.bytes.byteOffset,
        action.bytes.byteOffset + action.bytes.byteLength
      ) as ArrayBuffer
      await importFile({
        name: action.name,
        size: action.bytes.byteLength,
        arrayBuffer: async () => buffer
      })
      await waitForImport()
      const state = store.getState()
      if (state.status === 'failed') {
        throw new DriveRefusal(state.error ?? `could not import ${action.name}`)
      }
      return { kind: 'outcome', outcome: await settledOutcome(action.units) }
    }

    case 'set_inputs': {
      const patch = settingsPatchFrom(action.input)
      if (Object.keys(patch).length > 0) store.getState().updateSettings(patch)
      if (action.unitPart !== undefined) store.getState().setUnitPartName(action.unitPart)
      return { kind: 'outcome', outcome: await settledOutcome(action.units) }
    }

    case 'set_part_weight': {
      const kinds = partKinds(store.getState().parts)
      if (!kinds.some((kind) => kind.kind === action.partKind)) {
        const known = kinds.map((kind) => kind.kind).join(', ')
        throw new DriveRefusal(
          kinds.length === 0
            ? 'No model is loaded — call load_model first.'
            : `No part kind named "${action.partKind}" in this file. It has: ${known}.`
        )
      }
      store.getState().setPartWeight(action.partKind, action.grams)
      return { kind: 'outcome', outcome: await settledOutcome(action.units) }
    }

    case 'get_estimate': {
      const outcome = await settle.waitForSettle()
      return { kind: 'estimate', estimate: estimateFrom(outcome, action.units) }
    }

    case 'get_app_state': {
      // Deliberately NOT settled: this is the "where do things stand" tool, and
      // an in-flight recompute IS where things stand. The estimate field says
      // so instead of blocking.
      const busy = settle.isDirty() || store.getState().packStatus === 'packing'
      return {
        kind: 'outcome',
        outcome: {
          state: snapshotState(action.units),
          estimate: busy
            ? { available: false, reason: 'An estimate is being recomputed right now — call get_estimate to wait for it.' }
            : estimateFrom(await settle.waitForSettle(), action.units)
        }
      }
    }

    case 'capture_view': {
      if (action.view !== undefined) {
        store.getState().setViewMode(action.view)
        await afterRender()
      }
      const url = captureViewportPng()
      if (url === null) {
        throw new DriveRefusal(
          'Nothing to capture — the 3D viewport is not showing (no model loaded, or GL unavailable).'
        )
      }
      return { kind: 'image', pngBase64: dataUrlToBase64(url) }
    }
  }
}

let started = false

/** Install the drive request handler. Called once from the renderer entry;
 *  idempotent for the same StrictMode reason startAutoPack is. */
export function startDriveHost(): void {
  if (started) return
  started = true

  window.api.mcpDrive.onRequest((envelope: DriveEnvelope) => {
    void handle(envelope.action)
      .then((result) => window.api.mcpDrive.respond({ id: envelope.id, ok: true, result }))
      .catch((err: unknown) => {
        const error =
          err instanceof DriveRefusal || err instanceof EstimateInputError
            ? err.message
            : `the app could not complete this: ${err instanceof Error ? err.message : String(err)}`
        window.api.mcpDrive.respond({ id: envelope.id, ok: false, error })
      })
  })
  window.api.mcpDrive.ready()
}
