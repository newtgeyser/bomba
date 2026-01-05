import { button, el } from './dom.js';
import { DEFAULT_KEYBINDINGS } from './ws_input.js';
import { GAME_VERSION } from '../shared/constants.js';

const ACTION_LABELS = {
  up: 'Move Up',
  down: 'Move Down',
  left: 'Move Left',
  right: 'Move Right',
  drop: 'Drop Bomb / Pickup',
  secondary: 'Secondary Action',
  taunt: 'Taunt',
};

const KEY_DISPLAY_NAMES = {
  ArrowUp: 'Arrow Up',
  ArrowDown: 'Arrow Down',
  ArrowLeft: 'Arrow Left',
  ArrowRight: 'Arrow Right',
  Space: 'Space',
  Enter: 'Enter',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyT: 'T',
};

function getKeyDisplayName(code) {
  if (KEY_DISPLAY_NAMES[code]) return KEY_DISPLAY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem('aboSettings') ?? '{}');
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  localStorage.setItem('aboSettings', JSON.stringify(settings));
}

function loadKeybindings() {
  try {
    const stored = localStorage.getItem('aboKeybindings');
    return stored ? JSON.parse(stored) : { ...DEFAULT_KEYBINDINGS };
  } catch {
    return { ...DEFAULT_KEYBINDINGS };
  }
}

function saveKeybindings(bindings) {
  localStorage.setItem('aboKeybindings', JSON.stringify(bindings));
}

export function createSettingsView({ state, onBack }) {
  const settings = loadSettings();
  const keybindings = loadKeybindings();

  let rebindingAction = null;
  let rebindingElement = null;

  const container = el('div', { class: 'panel settings-panel' }, [
    el('h2', { text: 'Settings' }),
  ]);

  // Accessibility settings
  const accessibilitySection = el('div', { class: 'settings-section' }, [
    el('h3', { text: 'Accessibility' }),
  ]);

  const reduceMotionToggle = el('input', {
    type: 'checkbox',
    checked: settings.reduceMotion ?? false,
    onchange: (e) => {
      settings.reduceMotion = e.target.checked;
      saveSettings(settings);
    },
  });

  const colorblindToggle = el('input', {
    type: 'checkbox',
    checked: settings.colorblindMode ?? false,
    onchange: (e) => {
      settings.colorblindMode = e.target.checked;
      saveSettings(settings);
    },
  });

  accessibilitySection.append(
    el('div', { class: 'row' }, [
      el('label', { text: 'Reduce motion/flashing' }),
      reduceMotionToggle,
    ]),
    el('div', { class: 'row' }, [
      el('label', { text: 'Colorblind-friendly markers' }),
      colorblindToggle,
    ])
  );

  // Audio settings (placeholder for future)
  const audioSection = el('div', { class: 'settings-section' }, [
    el('h3', { text: 'Audio' }),
    el('div', { class: 'muted', text: 'Audio settings will be available in a future update.' }),
  ]);

  // Keybindings section
  const keybindingsSection = el('div', { class: 'settings-section' }, [
    el('h3', { text: 'Keyboard Controls' }),
    el('div', { class: 'muted', text: 'Click a key to rebind it. Press Escape to cancel.' }),
  ]);

  const keybindingsList = el('div', { class: 'keybindings-list' }, []);

  function renderKeybindings() {
    keybindingsList.innerHTML = '';
    for (const [action, keys] of Object.entries(keybindings)) {
      const label = ACTION_LABELS[action] ?? action;
      const keyTexts = keys.map(getKeyDisplayName).join(' / ');

      const row = el('div', { class: 'keybind-row' }, [
        el('span', { text: label }),
        el('div', { class: 'keybind-keys' }, [
          el('span', { class: 'keybind-key', text: keyTexts }),
          button('Edit', () => startRebinding(action, row)),
        ]),
      ]);
      keybindingsList.append(row);
    }
  }

  function startRebinding(action, rowElement) {
    if (rebindingElement) {
      rebindingElement.classList.remove('rebinding');
    }
    rebindingAction = action;
    rebindingElement = rowElement;
    rowElement.classList.add('rebinding');

    const keySpan = rowElement.querySelector('.keybind-key');
    if (keySpan) keySpan.textContent = 'Press a key...';
  }

  function handleKeyForRebind(e) {
    if (!rebindingAction) return;

    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') {
      // Cancel rebinding
      rebindingAction = null;
      if (rebindingElement) rebindingElement.classList.remove('rebinding');
      rebindingElement = null;
      renderKeybindings();
      return;
    }

    // Set the new binding (single key for simplicity)
    keybindings[rebindingAction] = [e.code];
    saveKeybindings(keybindings);

    rebindingAction = null;
    if (rebindingElement) rebindingElement.classList.remove('rebinding');
    rebindingElement = null;
    renderKeybindings();
  }

  window.addEventListener('keydown', handleKeyForRebind, true);

  renderKeybindings();
  keybindingsSection.append(keybindingsList);

  const resetBtn = button('Reset to Defaults', () => {
    Object.assign(keybindings, DEFAULT_KEYBINDINGS);
    saveKeybindings(keybindings);
    renderKeybindings();
  });

  keybindingsSection.append(el('div', { class: 'row' }, [resetBtn]));

  // Gamepad section
  const gamepadSection = el('div', { class: 'settings-section' }, [
    el('h3', { text: 'Gamepad' }),
    el('div', { class: 'muted', text: 'Gamepads are automatically detected. Use the left stick or D-pad to move, A/X to drop bombs, B/Y for secondary action.' }),
  ]);

  // Version info
  const versionSection = el('div', { class: 'settings-section' }, [
    el('h3', { text: 'About' }),
    el('div', { text: `Atomic Bomberman Online v${GAME_VERSION}` }),
    el('div', { class: 'muted', text: 'A faithful reimplementation of Atomic Bomberman for the modern web.' }),
  ]);

  container.append(
    accessibilitySection,
    audioSection,
    keybindingsSection,
    gamepadSection,
    versionSection,
    el('div', { class: 'row' }, [
      button('Back', () => {
        window.removeEventListener('keydown', handleKeyForRebind, true);
        onBack?.();
      }),
    ])
  );

  return container;
}
