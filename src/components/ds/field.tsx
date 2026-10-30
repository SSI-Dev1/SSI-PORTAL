// Connects a <Field> label to the control inside it without making the whole field clickable.
// Native inputs register their id so the label (and only the label text) focuses them; button
// controls (dropdowns, date and time pickers, segmented options) are named via aria-labelledby
// instead, so clicking a label never opens a dropdown or picks an option.
import { createContext, useContext, useId, useLayoutEffect } from 'react';

export interface FieldCtx {
  labelId: string;
  register: (id: string) => () => void;
}
export const FieldContext = createContext<FieldCtx | null>(null);

/** aria-labelledby for button-based controls inside a Field (undefined outside one). */
export function useFieldLabelledBy() {
  return useContext(FieldContext)?.labelId;
}

/** Id for a native input/textarea; the enclosing Field label points at it. */
export function useFieldControlId(explicit?: string, native = true) {
  const own = useId();
  const id = explicit ?? own;
  const ctx = useContext(FieldContext);
  useLayoutEffect(() => (ctx && native ? ctx.register(id) : undefined), [ctx, id, native]);
  return id;
}
