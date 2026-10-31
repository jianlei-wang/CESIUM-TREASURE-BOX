# Input for camera modes

The keyboard, the mouse buttons and a gamepad read into named actions, from bindings that are plain data,
so that they can be remapped and saved. Camera modes, the walk, the first-person look or the drone, read
their intent from it on each tick, and never the devices themselves: any other source, touch controls,
an AI or a replay, can take its place.

## Installation

```bash
npm i --save @geoblocks/cesium-input
```

## Usage

```javascript
import Controls from '@geoblocks/cesium-input';

const controls = new Controls({
  move: {type: 'vector', keys: {up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD']}, stick: 'left'},
  climb: {type: 'axis', keys: {negative: ['KeyQ'], positive: ['KeyE']}, buttons: {negative: [6], positive: [7]}},
  jump: {type: 'button', keys: ['Space'], buttons: [0], mouse: [2]},
});
controls.active = true; // listens to the keyboard and the mouse buttons

// on each tick
const {move, climb, jump} = controls.read(); // {x, y}, -1 to 1, true or false
```

Each action adds up all its bindings:

- `button`: keys by `event.code`, gamepad buttons and mouse buttons. It reads true while held, and once
  if pressed and released since the last read, so that a tap between two ticks is not lost.
- `axis`, from -1 to 1: keys, the analog value of gamepad buttons (the triggers), and a stick's `x` or `y`
  (`along`), y up, with a dead zone of its own, so that two axes on one stick, a radio's throttle and yaw,
  stay apart; `invert` reverses the stick.
- `vector`, `{x, y}`, x right and y up, no longer than 1: four keys and a stick; `invertY` reverses the
  stick's y.

The gamepad is the first one of the standard mapping, read once per task, so that every mode reading it
on the same clock tick shares one read. A stick read as a vector has a round dead zone, 0.15 by default
(`new Controls(bindings, {deadZone})`), so that a slight diagonal does not snap to an axis.

Other places the actions come from, touch controls, an AI or a replay, are `sources`: objects with a `read()`
returning, by the name of a binding, a boolean, a number or a vector as its type, added up with the devices the same
way (`new Controls(bindings, {sources})`, or `controls.sources`). The names it leaves out, and those not bound, are
ignored. A source is not a device: `active` does not turn it on, its owner does. It is read on every read of the
controls, so it is a plain read of its state, and what must not be lost between two reads, a tap, it holds itself:
only the devices' keys are latched.

```javascript
const controls = new Controls(bindings, {sources: [{read: () => ({move: {x: 0, y: stickAhead}})}]});
```

The bound keys do not scroll the page or activate the focused control. The shortcuts, with Ctrl, Cmd
or Alt, and the typing in text fields are left alone, and everything is released when the window loses
the focus.

`standardGamepad()` and `deadZone(x, y)` are exported as well, for inputs of your own.
