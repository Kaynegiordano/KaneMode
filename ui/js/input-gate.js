// Bloque les validations pendant un passage à une autre application et jusqu'au retour.
export function createInputGate() {
  let suspended = false;
  return { suspend() { suspended = true; }, resume() { suspended = false; },
    allows(visible, focused) { return !suspended && visible && focused; } };
}
