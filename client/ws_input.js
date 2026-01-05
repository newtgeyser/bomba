// Default keyboard bindings - can be customized via settings
const DEFAULT_KEYBINDINGS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drop: ['Space'],
  secondary: ['Enter', 'ShiftLeft', 'ShiftRight'],
  taunt: ['KeyT'],
};

// Gamepad configuration
const GAMEPAD_CONFIG = {
  deadzone: 0.3,
  // Standard gamepad mapping (Xbox/PS style)
  buttons: {
    drop: [0, 2],       // A/X or X/Square
    secondary: [1, 3],  // B/Circle or Y/Triangle
    taunt: [4, 5],      // Shoulder buttons
  },
};

export function createInput(customBindings = null) {
  const keybindings = customBindings ?? loadKeybindings() ?? DEFAULT_KEYBINDINGS;
  const keyToAction = new Map();

  // Build reverse lookup: keycode -> action
  for (const [action, keys] of Object.entries(keybindings)) {
    for (const key of keys) {
      keyToAction.set(key, action);
    }
  }

  const down = new Set();
  let gamepadConnected = false;

  function isEditableTarget(target) {
    if (!target || typeof target !== 'object') return false;
    const el = /** @type {any} */ (target);
    const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!el.isContentEditable;
  }

  function onKey(e, isDown) {
    if (isEditableTarget(e.target)) return;
    const action = keyToAction.get(e.code);
    if (!action) return;
    // Don't prevent default for taunt key (allows typing)
    if (action !== 'taunt') e.preventDefault();
    if (isDown) down.add(action);
    else down.delete(action);
  }

  const onKeyDown = (e) => onKey(e, true);
  const onKeyUp = (e) => onKey(e, false);

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Gamepad connection events
  const onGamepadConnected = (e) => {
    console.log(`Gamepad connected: ${e.gamepad.id}`);
    gamepadConnected = true;
  };
  const onGamepadDisconnected = () => {
    gamepadConnected = false;
  };

  window.addEventListener('gamepadconnected', onGamepadConnected);
  window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

  function sampleGamepad() {
    const result = {
      up: false,
      down: false,
      left: false,
      right: false,
      drop: false,
      secondary: false,
      taunt: false,
    };

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gamepads) {
      if (!gp) continue;

      // D-pad or left stick for movement
      const axisX = gp.axes[0] ?? 0;
      const axisY = gp.axes[1] ?? 0;
      const dz = GAMEPAD_CONFIG.deadzone;

      if (axisX < -dz) result.left = true;
      if (axisX > dz) result.right = true;
      if (axisY < -dz) result.up = true;
      if (axisY > dz) result.down = true;

      // D-pad buttons (indices 12-15 on standard gamepad)
      if (gp.buttons[12]?.pressed) result.up = true;
      if (gp.buttons[13]?.pressed) result.down = true;
      if (gp.buttons[14]?.pressed) result.left = true;
      if (gp.buttons[15]?.pressed) result.right = true;

      // Action buttons
      for (const btnIdx of GAMEPAD_CONFIG.buttons.drop) {
        if (gp.buttons[btnIdx]?.pressed) result.drop = true;
      }
      for (const btnIdx of GAMEPAD_CONFIG.buttons.secondary) {
        if (gp.buttons[btnIdx]?.pressed) result.secondary = true;
      }
      for (const btnIdx of GAMEPAD_CONFIG.buttons.taunt) {
        if (gp.buttons[btnIdx]?.pressed) result.taunt = true;
      }
    }

    return result;
  }

  return {
    sample() {
      const gp = sampleGamepad();
      return {
        up: down.has('up') || gp.up,
        down: down.has('down') || gp.down,
        left: down.has('left') || gp.left,
        right: down.has('right') || gp.right,
        drop: down.has('drop') || gp.drop,
        secondary: down.has('secondary') || gp.secondary,
        taunt: down.has('taunt') || gp.taunt,
      };
    },
    isGamepadConnected() {
      return gamepadConnected;
    },
    getKeybindings() {
      return { ...keybindings };
    },
    setKeybinding(action, keys) {
      keybindings[action] = keys;
      // Rebuild reverse lookup
      keyToAction.clear();
      for (const [act, ks] of Object.entries(keybindings)) {
        for (const k of ks) keyToAction.set(k, act);
      }
      saveKeybindings(keybindings);
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    },
  };
}

// Persistence for keybindings
function loadKeybindings() {
  try {
    const stored = localStorage.getItem('aboKeybindings');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveKeybindings(bindings) {
  try {
    localStorage.setItem('aboKeybindings', JSON.stringify(bindings));
  } catch {
    // ignore
  }
}

export { DEFAULT_KEYBINDINGS };
