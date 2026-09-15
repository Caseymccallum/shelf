/**
 * Finding an element a page's script cannot work without.
 *
 * Handwritten null checks at the top of a file look like they narrow, but TypeScript will not carry a
 * compound `if (a === null || b === null) throw` into the functions defined below it - so the checks
 * end up duplicated in every closure, or quietly dropped. One helper that returns the element means
 * the type system knows what the runtime already guarantees, and a markup/script mismatch fails with
 * the selector that is missing rather than with a null dereference three functions later.
 */
export function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`This page is missing the element "${selector}", which its script needs.`);
  }
  return element;
}
