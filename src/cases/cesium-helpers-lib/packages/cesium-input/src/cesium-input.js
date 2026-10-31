// the dead zone of the sticks, round so that a slight diagonal does not snap to an axis
const DEAD_ZONE = 0.15;
// the sticks' axes in the standard mapping, x then y, y down
const STICKS = {left: [0, 1], right: [2, 3]};
// the elements whose keys are typing, not playing
const TEXT_FIELDS = ":read-write, select";

// keys by event.code, gamepad buttons by index in the standard mapping, mouse buttons by MouseEvent.button
/** @typedef {{type: 'button', keys?: string[], buttons?: number[], mouse?: number[]}} ButtonBinding */
// from -1 to 1: gamepad buttons by their analog value, the triggers for instance; a stick's x or y, y up, with
// a dead zone of its own, so that two axes on one stick, a radio's throttle and yaw, stay apart
/** @typedef {{type: 'axis', keys?: {negative?: string[], positive?: string[]}, buttons?: {negative?: number[], positive?: number[]}, stick?: 'left' | 'right', along?: 'x' | 'y', invert?: boolean}} AxisBinding */
// x right and y up, no longer than 1
/** @typedef {{type: 'vector', keys?: {up?: string[], down?: string[], left?: string[], right?: string[]}, stick?: 'left' | 'right', invertY?: boolean}} VectorBinding */
/** @typedef {ButtonBinding | AxisBinding | VectorBinding} Binding */
/** @typedef {{x: number, y: number}} Vector */
/**
 * Another place the actions come from, touch controls, an AI or a replay: what it reads by the name of a binding, as
 * that binding's type, the names it leaves out ignored. A plain read of its state, called on every read of the controls,
 * and its own to hold what must not be lost between two reads (a tap): only the devices' keys are latched.
 * @template {Record<string, Binding>} [B=Record<string, Binding>]
 * @typedef {{read(): Partial<Actions<B>>}} Source
 */
/**
 * What each binding reads: a button true or false, an axis from -1 to 1, a vector x and y.
 * @template {Record<string, Binding>} B
 * @typedef {{[K in keyof B]: B[K] extends ButtonBinding ? boolean : B[K] extends AxisBinding ? number : Vector}} Actions
 */

/** @type {Record<string, any>[]} */
const NO_SOURCES = [];

/** @type {Gamepad | undefined} */
let gamepad;
let polled = false;

/**
 * The first gamepad of the standard mapping, if any, read once per task: every mode reading it on the same
 * clock tick shares one read.
 * @return {Gamepad | undefined}
 */
export function standardGamepad() {
  if (!polled) {
    polled = true;
    queueMicrotask(() => polled = false);
    try {
      gamepad = navigator.getGamepads?.().find(pad => pad?.mapping === "standard") ?? undefined;
    } catch {
      // a Permissions Policy blocks the gamepads
      gamepad = undefined;
    }
  }
  return gamepad;
}

/**
 * A stick without its dead zone, round so that a slight diagonal does not snap to an axis, rescaled so that
 * the output starts from 0 and stops at full deflection.
 * @param {number} x
 * @param {number} y
 * @param {number} [size]
 * @return {[number, number]}
 */
export function deadZone(x, y, size = DEAD_ZONE) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < size) {
    return [0, 0];
  }
  const scale = Math.min(1, (magnitude - size) / (1 - size)) / magnitude;
  return [x * scale, y * scale];
}

/**
 * Reads the keyboard, the mouse buttons and the gamepad into named actions, from bindings that are plain
 * data, so that they can be remapped and saved. A key or a mouse button pressed since the last read reads
 * as pressed, even if released already.
 * @template {Record<string, Binding>} [B=Record<string, Binding>]
 */
export default class Controls {
  /**
   * @param {B} bindings
   * @param {{deadZone?: number, sources?: Source<B>[]}} [options]
   */
  constructor(bindings, options = {}) {
    /**
     * @type {B}
     */
    this.bindings = bindings;

    /**
     * The sticks' dead zone, from 0 to 1.
     * @type {number}
     */
    this.deadZone = options.deadZone ?? DEAD_ZONE;

    /**
     * What is read besides the devices, added up with them. Its owner turns it on and off, not `active`.
     * @type {Source<B>[]}
     */
    this.sources = [...options.sources ?? []];

    this.active_ = false;
    // the keys, by event.code, and the mouse buttons, as mouse0 to mouse4: held, and pressed since the last read
    /** @type {Set<string>} */
    this.held_ = new Set();
    /** @type {Set<string>} */
    this.pressed_ = new Set();

    this.handleKeyFunction_ = this.handleKey_.bind(this);
    this.handleMouseFunction_ = this.handleMouse_.bind(this);
    this.releaseFunction_ = () => this.held_.clear();
  }

  get active() {
    return this.active_;
  }

  /**
   * Whether the keyboard and the mouse buttons are listened to.
   * @param {boolean} active
   */
  set active(active) {
    if (active === this.active_) {
      return;
    }
    this.active_ = active;
    if (active) {
      document.addEventListener("keydown", this.handleKeyFunction_);
      document.addEventListener("keyup", this.handleKeyFunction_);
      document.addEventListener("mousedown", this.handleMouseFunction_);
      document.addEventListener("mouseup", this.handleMouseFunction_);
      window.addEventListener("blur", this.releaseFunction_);
    } else {
      document.removeEventListener("keydown", this.handleKeyFunction_);
      document.removeEventListener("keyup", this.handleKeyFunction_);
      document.removeEventListener("mousedown", this.handleMouseFunction_);
      document.removeEventListener("mouseup", this.handleMouseFunction_);
      window.removeEventListener("blur", this.releaseFunction_);
      this.held_.clear();
      this.pressed_.clear();
    }
  }

  /**
   * @param {string} code
   * @return {boolean}
   */
  bound_(code) {
    for (const binding of Object.values(this.bindings)) {
      const keys = binding.keys;
      if (Array.isArray(keys) ? keys.includes(code) : Object.values(keys ?? {}).some(codes => codes?.includes(code))) {
        return true;
      }
      if (binding.type === "button" && binding.mouse?.some(button => `mouse${button}` === code)) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {KeyboardEvent} event
   */
  handleKey_(event) {
    if (!this.bound_(event.code)) {
      return;
    }
    if (event.type === "keyup") {
      // always, or a key released with a modifier held would stay pressed
      this.held_.delete(event.code);
      return;
    }
    // leave the shortcuts (Ctrl+R, Cmd+F...) and the typing alone
    const target = /** @type {Element | undefined} */ (event.composedPath()[0]);
    if (event.ctrlKey || event.metaKey || event.altKey || target?.matches?.(TEXT_FIELDS)) {
      return;
    }
    // nor scroll the page, nor activate the focused control, a switch toggled by Space
    event.preventDefault();
    this.held_.add(event.code);
    this.pressed_.add(event.code);
  }

  /**
   * @param {MouseEvent} event
   */
  handleMouse_(event) {
    const code = `mouse${event.button}`;
    if (!this.bound_(code)) {
      return;
    }
    if (event.type === "mouseup") {
      this.held_.delete(code);
    } else {
      this.held_.add(code);
      this.pressed_.add(code);
    }
  }

  /**
   * @param {string[] | undefined} codes
   * @return {boolean}
   */
  down_(codes) {
    return codes?.some(code => this.held_.has(code) || this.pressed_.has(code)) ?? false;
  }

  /**
   * @param {Gamepad | undefined} pad
   * @param {'left' | 'right'} stick
   * @return {[number, number]} x right and y up, the round dead zone taken out
   */
  stick_(pad, stick) {
    const [x, y] = STICKS[stick];
    const [right, down] = deadZone(pad?.axes[x] ?? 0, pad?.axes[y] ?? 0, this.deadZone);
    return [right, -down];
  }

  /**
   * @param {Gamepad | undefined} pad
   * @param {'left' | 'right'} stick
   * @param {'x' | 'y'} along
   * @return {number} right or up, its own dead zone taken out
   */
  stickAxis_(pad, stick, along) {
    const [x, y] = STICKS[stick];
    const value = along === "y" ? -(pad?.axes[y] ?? 0) : pad?.axes[x] ?? 0;
    return deadZone(value, 0, this.deadZone)[0];
  }

  /**
   * The actions now: what each binding reads, the keyboard, the mouse and the first gamepad of the standard
   * mapping added up.
   * @return {Actions<B>}
   */
  read() {
    const pad = standardGamepad();
    /** @type {Record<string, any>[]} */
    const sources = this.sources.length ? this.sources.map(source => source.read()) : NO_SOURCES;
    /** @type {Record<string, boolean | number | Vector>} */
    const actions = {};
    for (const [name, binding] of Object.entries(this.bindings)) {
      if (binding.type === "button") {
        actions[name] = this.down_(binding.keys) ||
          this.down_(binding.mouse?.map(button => `mouse${button}`)) ||
          (binding.buttons?.some(index => pad?.buttons[index]?.pressed) ?? false) ||
          sources.some(source => source[name] === true);
      } else if (binding.type === "axis") {
        const value = (/** @type {number[] | undefined} */ indices) =>
          indices?.reduce((sum, index) => sum + (pad?.buttons[index]?.value ?? 0), 0) ?? 0;
        let axis = Number(this.down_(binding.keys?.positive)) - Number(this.down_(binding.keys?.negative)) +
          value(binding.buttons?.positive) - value(binding.buttons?.negative);
        for (const source of sources) {
          axis += Number(source[name]) || 0;
        }
        if (binding.stick) {
          axis += this.stickAxis_(pad, binding.stick, binding.along ?? "x") * (binding.invert ? -1 : 1);
        }
        actions[name] = Math.min(1, Math.max(-1, axis));
      } else {
        let x = Number(this.down_(binding.keys?.right)) - Number(this.down_(binding.keys?.left));
        let y = Number(this.down_(binding.keys?.up)) - Number(this.down_(binding.keys?.down));
        if (binding.stick) {
          const [right, up] = this.stick_(pad, binding.stick);
          x += right;
          y += binding.invertY ? -up : up;
        }
        for (const source of sources) {
          const vector = /** @type {Vector | undefined} */ (source[name]);
          x += vector?.x ?? 0;
          y += vector?.y ?? 0;
        }
        // diagonally no longer than straight
        const length = Math.hypot(x, y);
        actions[name] = length > 1 ? {x: x / length, y: y / length} : {x, y};
      }
    }
    this.pressed_.clear();
    return /** @type {Actions<B>} */ (actions);
  }
}
