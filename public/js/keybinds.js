// Rebindable controls. Every action has one key (or mouse button), saved in the browser.
// Keys are stored as "codes" (like KeyW or Space), so they work on any keyboard layout.
const STORE = 'lowPolyArena.keybinds.v1';

export const ACTIONS = [
  { id: 'forward',    label: 'Move forward',      def: 'KeyW' },
  { id: 'back',       label: 'Move back',         def: 'KeyS' },
  { id: 'left',       label: 'Move left',         def: 'KeyA' },
  { id: 'right',      label: 'Move right',        def: 'KeyD' },
  { id: 'jump',       label: 'Jump',              def: 'Space' },
  { id: 'crouch',     label: 'Crouch (hold)',     def: 'KeyC' },
  { id: 'leanLeft',   label: 'Lean left (hold)',  def: 'KeyQ' },
  { id: 'leanRight',  label: 'Lean right (hold)', def: 'KeyE' },
  { id: 'sprint',     label: 'Sprint (hold)',     def: 'ShiftLeft' },
  { id: 'fire',       label: 'Fire',              def: 'Mouse0' },
  { id: 'aim',        label: 'Aim down sights',   def: 'Mouse2' },
  { id: 'reload',     label: 'Reload',            def: 'KeyR' },
  { id: 'slot1',      label: 'Primary weapon',    def: 'Digit1' },
  { id: 'slot2',      label: 'Secondary weapon',  def: 'Digit2' },
  { id: 'slot3',      label: 'Melee weapon',      def: 'Digit3' },
  { id: 'quick',      label: 'Quick knife',       def: 'KeyV' },
  { id: 'ability',    label: 'Use ability',       def: 'KeyF' },
  { id: 'grenade',    label: 'Throw grenade (hold to aim)', def: 'KeyG' },
  { id: 'scoreboard', label: 'Scoreboard (hold)', def: 'Tab' },
  { id: 'minimap',    label: 'Show or hide minimap', def: 'KeyM' },
  { id: 'stats',      label: 'FPS counter',       def: 'F3' },
];

const VALID = /^(Key[A-Z]|Digit\d|Numpad\w+|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-2])|Space|Tab|(Shift|Control|Alt)(Left|Right)|Backquote|Minus|Equal|Bracket(Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Backspace|Enter|CapsLock|Mouse[0-4])$/;

const NAMES = {
  Space: 'Space', Tab: 'Tab', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backspace: 'Backspace', Enter: 'Enter', CapsLock: 'Caps Lock',
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
};

/** A short readable name for a key code. */
export function keyName(code) {
  if (!code) return 'Unbound';
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
  return code;
}

export function defaults() {
  const o = {};
  for (const a of ACTIONS) o[a.id] = a.def;
  return o;
}

/** Cleans a saved set of binds: unknown actions, bad codes and duplicates fall back to the defaults. */
export function sanitize(raw) {
  const out = defaults();
  if (!raw || typeof raw !== 'object') return out;
  const picked = {};
  const used = new Set();
  for (const a of ACTIONS) {
    const c = raw[a.id];
    if (typeof c === 'string' && VALID.test(c) && !used.has(c)) { picked[a.id] = c; used.add(c); }
  }
  // Actions that were added later (or saved badly) get their default key, as long as nobody else took it
  for (const a of ACTIONS) {
    if (picked[a.id]) continue;
    if (used.has(a.def)) return out;       // a clash we cannot solve: start again from the defaults
    picked[a.id] = a.def; used.add(a.def);
  }
  return picked;
}

export class Keybinds {
  constructor() {
    this.map = defaults();
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) this.map = sanitize(JSON.parse(raw));
    } catch (e) { /* keep the defaults */ }
    this.rev = {};
    this.rebuild();
    this.listeners = [];
  }

  rebuild() {
    this.rev = {};
    for (const a of ACTIONS) this.rev[this.map[a.id]] = a.id;
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.map)); } catch (e) { /* not remembered */ }
  }

  onChange(fn) { this.listeners.push(fn); }
  fire() { this.rebuild(); this.save(); for (const fn of this.listeners) fn(); }

  /** The key code bound to an action. */
  get(action) { return this.map[action]; }

  /** Which action a key code is bound to (or undefined). */
  actionFor(code) { return this.rev[code]; }

  /** Bind a key to an action. If another action had it, the two swap keys. Returns the action that was swapped, if any. */
  set(action, code) {
    if (!VALID.test(code) || this.map[action] === undefined) return null;
    const other = this.rev[code];
    const old = this.map[action];
    let swapped = null;
    if (other && other !== action) { this.map[other] = old; swapped = other; }
    this.map[action] = code;
    this.fire();
    return swapped;
  }

  reset() { this.map = defaults(); this.fire(); }
}

/**
 * Builds the rebinding list inside `root`. Click a key, press the new one (Esc cancels).
 */
export function buildKeybindUi(root, binds, note) {
  root.textContent = '';
  const rows = new Map();
  for (const a of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'kb-row';
    const l = document.createElement('span');
    l.textContent = a.label;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kb-key';
    b.dataset.action = a.id;
    row.append(l, b);
    root.appendChild(row);
    rows.set(a.id, b);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn ghost kb-reset';
  reset.textContent = 'Reset keys to default';
  root.appendChild(reset);

  const refresh = () => { for (const [id, b] of rows) { b.textContent = keyName(binds.get(id)); b.classList.remove('wait'); } };
  refresh();
  binds.onChange(refresh);

  let waiting = null;
  const stop = () => {
    waiting = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    refresh();
  };
  const apply = (code) => {
    const action = waiting;
    const swapped = binds.set(action, code);
    stop();
    if (note) note(swapped ? keyName(code) + ' was used for "' + ACTIONS.find((a) => a.id === swapped).label + '". The two swapped keys.' : '');
  };
  function onKey(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.code === 'Escape') { stop(); if (note) note(''); return; }
    if (!VALID.test(e.code)) { if (note) note('That key cannot be used.'); return; }
    apply(e.code);
  }
  function onMouse(e) {
    if (e.target.closest && e.target.closest('.kb-key')) return;   // the click that started the wait
    e.preventDefault(); e.stopPropagation();
    apply('Mouse' + e.button);
  }
  for (const [id, b] of rows) {
    b.addEventListener('click', () => {
      if (waiting) stop();
      waiting = id;
      b.textContent = 'Press a key...';
      b.classList.add('wait');
      if (note) note('Press the new key for "' + ACTIONS.find((a) => a.id === id).label + '". Esc cancels.');
      window.addEventListener('keydown', onKey, true);
      setTimeout(() => window.addEventListener('mousedown', onMouse, true), 0);
    });
  }
  reset.addEventListener('click', () => { if (waiting) stop(); binds.reset(); if (note) note('Keys reset to default.'); });
  return { refresh };
}
