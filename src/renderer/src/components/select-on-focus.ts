// Click a number field, get the whole value selected, type over it (ADR-0024).
//
// `select()` alone is not enough: the mouseup that completes the focusing click
// lands AFTER the focus event and collapses the selection to a caret. So the
// focus handler marks the element, and the very next mouseup on it is
// swallowed once — later clicks in an already-focused field place the caret
// normally, so editing in place still works.
//
// Stateless (the flag rides the element's dataset) so it can be spread onto
// inputs rendered inside loops, where a hook could not be called.

const FLAG = 'selectOnFocus'

export const selectAllOnFocus = {
  onFocus: (e: React.FocusEvent<HTMLInputElement>): void => {
    e.currentTarget.select()
    e.currentTarget.dataset[FLAG] = '1'
  },
  onMouseUp: (e: React.MouseEvent<HTMLInputElement>): void => {
    if (e.currentTarget.dataset[FLAG]) {
      delete e.currentTarget.dataset[FLAG]
      e.preventDefault()
    }
  }
}
