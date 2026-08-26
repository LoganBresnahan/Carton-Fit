import { useEffect, useState } from 'react'
import { THEME_PREFERENCES, type ThemePreference } from '../../../shared/theme'

const LABELS: Record<ThemePreference, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark'
}

/**
 * The whole theme UI (ADR-0025 §6): three options in the app-scope header.
 *
 * A select rather than a cycling button because all three states have to be
 * visible — "System" behind a button label reads as an action, not as a setting
 * that is currently in force.
 *
 * The preference lives HERE and not in `settings`, which is deliberate: presets
 * and saved estimates serialize `settings` whole, so a theme inside it would be
 * re-applied by "Restore inputs" — the wrong-home problem ADR-0018 §3 solved
 * for the per-kind weights. Main owns the persisted copy; this component holds
 * only what the select is showing.
 *
 * Nothing here touches the stylesheet or the viewport. Setting the preference
 * moves `nativeTheme.themeSource` in main, which moves `prefers-color-scheme`,
 * which is what the CSS and the viewport island are both already watching.
 */
export default function ThemeSelect(): React.JSX.Element {
  // `null` until main answers — the select renders at full width immediately
  // and disabled, so the header does not reflow when the value lands (ADR-0021's
  // fixed-height rule applied to width).
  const [preference, setPreference] = useState<ThemePreference | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const state = await window.api.theme.get()
        if (live) setPreference(state.preference)
      } catch {
        // No preload, or a rejected invoke. A theme control that cannot reach
        // main has nothing useful to say; it stays disabled rather than
        // offering a choice it could not carry out.
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const choose = async (next: ThemePreference): Promise<void> => {
    setPreference(next) // optimistic: the select must not lag the click
    try {
      // Main returns the preference actually in force, so a value it declined
      // corrects the select instead of leaving it lying about what is applied.
      const state = await window.api.theme.set(next)
      setPreference(state.preference)
    } catch {
      // Leave the optimistic value: the next launch reads main's copy, and
      // there is nothing here the user could do about a dead channel.
    }
  }

  return (
    <select
      className="theme-select"
      data-testid="theme-select"
      aria-label="Theme"
      value={preference ?? 'system'}
      disabled={preference === null}
      onChange={(e) => void choose(e.target.value as ThemePreference)}
    >
      {THEME_PREFERENCES.map((option) => (
        <option key={option} value={option}>
          {LABELS[option]}
        </option>
      ))}
    </select>
  )
}
