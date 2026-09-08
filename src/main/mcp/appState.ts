import type { ImportedPart } from '../../renderer/src/workers/import-protocol'
import { changedGroups, type InputGroup, type PackingSettings } from '../../renderer/src/packing/settings'
import type { PartWeightOverrides } from '../../renderer/src/packing/kinds'
import { partKinds } from '../../renderer/src/packing/kinds'
import type { PackStatus } from '../../renderer/src/packing/types'
import {
  dimsFromMm,
  fromG,
  fromMm,
  resolveOutputUnits,
  type DimensionsValue,
  type LengthValue,
  type OutputUnits,
  type WeightUnit,
  type WeightValue
} from './wire'

// `get_app_state`'s report (ADR-0029 v2) — the app as it stands, worded for a
// client that cannot see the screen. Every figure is unit-tagged like the rest
// of the wire; the settings are echoed as the app UNDERSTANDS them (canonical
// mm/g converted out), so a mis-set input is visible next to a surprising
// answer. Pure and Electron-free: the renderer assembles this from its own
// store; main adds only the version, which the renderer does not know.

export interface AppStateReport {
  /** Added by the SERVER, not the renderer — one version, one source. */
  version?: string
  file:
    | { loaded: false }
    | {
        loaded: true
        name: string
        parts: number
        kinds: number
        /** On get_app_state and load_model (ADR-0029 amendment 8): receipts this
         *  document holds across its linked versions (ADR-0034 §3). */
        savedEstimates?: number
      }
  inputs: {
    mode: PackingSettings['mode']
    tier: PackingSettings['tier']
    carton: {
      dimensions: DimensionsValue
      measured: 'inner' | 'outer'
      wallThickness: LengthValue
    }
    clearances: { betweenParts: LengthValue; wall: LengthValue }
    maxWeight: WeightValue
    weight:
      | { mode: 'direct'; partWeight: WeightValue }
      | { mode: 'density'; densityGPerCm3: number }
    overrides: Array<{ kind: string; weight: WeightValue }>
    unitPart: string | null
    displayUnits: { length: 'mm' | 'in'; maxWeight: WeightUnit; partWeight: WeightUnit }
    /** Which groups this session changed, and what the rest are (ADR-0034
     *  amendment 1). The answer to "which of these did I set?". */
    provenance: {
      changedThisSession: InputGroup[]
      unchangedAre: 'earlier-session' | 'defaults'
    }
  }
  packStatus: PackStatus
  view: 'model' | 'packed'
  units: OutputUnits
  /** Who the app is working for (ADR-0035 §4); null is house. A label on
   *  what is shown and saved, never an input: nothing above depends on it. */
  customer: { id: number; name: string } | null
}

export interface AppStateSource {
  customer: { id: number; name: string } | null
  /** The settings at launch and where they came from — see the store. */
  settingsAtLaunch: PackingSettings
  launchSource: 'earlier-session' | 'defaults'
  fileName: string | null
  parts: readonly ImportedPart[]
  settings: PackingSettings
  unitPartName: string | null
  overrides: PartWeightOverrides
  packStatus: PackStatus
  view: 'model' | 'packed'
}

export function buildAppState(
  source: AppStateSource,
  outputUnits?: Partial<OutputUnits>
): AppStateReport {
  const units = resolveOutputUnits(outputUnits)
  const { settings } = source
  return {
    file:
      source.fileName === null
        ? { loaded: false }
        : {
            loaded: true,
            name: source.fileName,
            parts: source.parts.length,
            kinds: partKinds(source.parts).length
          },
    inputs: {
      mode: settings.mode,
      tier: settings.tier,
      carton: {
        dimensions: dimsFromMm(settings.boxDimsMm, units.length),
        measured: settings.enterOuter ? 'outer' : 'inner',
        wallThickness: fromMm(settings.wallMm, units.length)
      },
      clearances: {
        betweenParts: fromMm(settings.clearancePartMm, units.length),
        wall: fromMm(settings.clearanceWallMm, units.length)
      },
      maxWeight: fromG(settings.maxWeightG, units.weight),
      weight:
        settings.weightMode === 'density'
          ? { mode: 'density', densityGPerCm3: settings.densityGPerCm3 }
          : { mode: 'direct', partWeight: fromG(settings.partWeightG, units.weight) },
      overrides: Object.entries(source.overrides).map(([kind, grams]) => ({
        kind,
        weight: fromG(grams, units.weight)
      })),
      unitPart: source.unitPartName,
      displayUnits: {
        length: settings.unitSystem === 'imperial' ? 'in' : 'mm',
        maxWeight: settings.maxWeightUnit,
        partWeight: settings.partWeightUnit
      },
      provenance: {
        changedThisSession: changedGroups(source.settingsAtLaunch, settings),
        unchangedAre: source.launchSource
      }
    },
    packStatus: source.packStatus,
    view: source.view,
    units,
    customer: source.customer
  }
}
