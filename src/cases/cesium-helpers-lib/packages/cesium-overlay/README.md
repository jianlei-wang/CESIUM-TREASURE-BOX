# HTML overlay for CesiumJS

An HTML layer over a CesiumJS scene, and pins: elements kept on a point of the world as the camera moves. A tool's line and label,
a character's speech bubble, a place's card: plain HTML and CSS, crisp at any zoom, laid over the canvas.

- one layer a scene, shared: whoever asks gets the same, its pixels the canvas's, clipped to the canvas's box
- a pin keeps an element on a point, hidden behind the camera and the globe's horizon, or, asked, behind what the scene shows in
  front of it; the nearest pin on top
- the element keeps its own layout and transform: in flow or positioned, centred or lifted above the point by its own CSS
- lines: a few points of the world joined, SVG under the pins, cut where they pass behind the camera, and, asked, split into
  what is seen and what is hidden, behind what the scene shows or by a test of yours
- TypeScript declarations included

## Installation

```bash
npm i --save @geoblocks/cesium-overlay
```

## Usage

```js
import {overlayOf} from '@geoblocks/cesium-overlay';

const overlay = overlayOf(viewer);                 // a Viewer, a CesiumWidget or a scene
const card = Object.assign(document.createElement('div'), {className: 'card', textContent: 'Lausanne'});
const pin = overlay.pin(card, Cartesian3.fromDegrees(6.63, 46.52, 500), {offset: [0, -8]});
pin.move(() => train.position);                    // read on every render
pin.hidden = true;                                 // hidden, its position kept; false shows it again
pin.remove();                                      // the card put back where it was, if it was somewhere

// a box's edge, hidden where the scene shows something in front of it
const edge = overlay.line([corner1, corner2], {occlude: 'depth', className: 'box'});
edge.move(() => [corner1, raised(corner2)]);      // points read on every render
```

```css
/* above the point, its middle on it; clickable */
.card { translate: -50% -100%; pointer-events: auto; }
```

## API

`overlayOf(target)` returns the scene's overlay, made by the first call; it lives as long as the widget.

| Name          | Description
| ------------- | -----------
| `element`     | The layer, `div.cesium-overlay`: what is appended to it is drawn over the pins (a tool's line, its label)
| `pin(element, position?, options?)` | Keeps `element` on `position`, a `Cartesian3`, a function returning one, or `undefined` (hidden): returns a pin
| `line(points, options?)` | Joins `points`, a few `Cartesian3` or a function returning them, as SVG under the pins: returns a line

A pin is `{element, anchor, move(position), hidden, remove()}`: `element` the one pinned, `anchor` what holds it, moved to the
point's place; `hidden` hides it whatever its position, which it keeps (a pin shown now and then on the same point); `remove()`
puts the element back where it was taken from, or out of the document if it was nowhere.

| Option    | Default  | Description
| --------- | -------- | -----------
| `offset`  | `[0, 0]` | In pixels, right and down, from the point's place
| `occlude` | `true`   | `true`: hidden behind the globe's horizon (Cesium's labels' test, cheap); `'depth'`: also behind what the scene shows in front of the point, by a read of the depth buffer a render (a perspective view's: an orthographic one's depth is not read back); `false`: never hidden
| `live`    | `false`  | The scene rendered on every frame while the pin is: for a position function that changes by itself in a scene that renders on request (`requestRenderMode`); else a render, from the camera or `scene.requestRender()`, moves it

The pins are placed after every render: a scene rendering on request moves them when it renders.

A line is `{element, move(points), hidden, remove()}`: `element` the SVG group of its paths, the seen ones over the hidden one;
`move` gives it other points; `hidden` leaves it undrawn, its points kept. Its points are a few `Cartesian3`, joined in order, or
several such polylines apart (`[[a, b], [c, d, e]]`: a few edges, one line to style), or a function giving them. `move` and
`hidden` draw it again and ask for a render only when its points or `hidden` changed, so that a tool may set them as it renders.
A tool whose points change as it renders (in its own `postRender`) does better to give a function that computes them: the overlay's
lines are drawn after every render before the tool's own listener runs, a frame late for points it computes there. Seen runs that
meet are one path, their corners joined (`stroke-linejoin`), a closed polyline seen all round closed. It is redrawn after every render, each segment cut to
what is in view: in front of the camera (a meter beyond twice the near distance, where the projection holds) and within the view's
sides, so that a camera standing among the lines draws only what is in front of it, and an edge passing beside it costs no more
than what of it shows. Then, if it is tested, it is split where it goes from seen to hidden: tested every `step` pixels along it on
the screen, and where two tests differ, the change found to about 2 pixels by halving (a part hidden shorter than `step` between
two tests is missed: a post a few pixels wide, unless the line's `step` is small; one or two lines can afford `step: 8`). A segment is tested again when the view or the segment changes. A test of yours runs then, in the render.
The depth buffer is read between renders, once the GPU has drawn the last frame (a fence in the scene's WebGL 2 context, placed at
each render while tests are pending; without one, 50 ms after the render): a read before it would wait for the GPU, tens of
milliseconds. The reads go in the time the browser says is idle (`requestIdleCallback`: what is left of a frame while the view
moves, so that its frames stay on time, up to 50 ms once it is still; after 100 ms without one, a task of 8 ms all the same), in
tasks of 8 ms where the browser has no such call (Safari), counted from the end of a task's first test, until all the segments are
tested, a coarse pass first; a new view stops them and starts them again; while the view moves, a line keeps the split last found,
and a new segment is drawn seen. A scene rendering the same view again (on every frame, or by itself) is tested too: after two renders
without a drawn frame, the reads go on, a task waiting once for the GPU.

The element may be moved into a tool's own `<svg>`, where its stylesheet reaches it: its paths then need `fill: none`.

| Option      | Default | Description
| ----------- | ------- | -----------
| `closed`    | `false` | The last point joined to the first, of each polyline
| `occlude`   | `false` | `true`, a pin's horizon test, means nothing for a line: taken as `false`. `false`: all seen, drawn over the scene; `'depth'`: hidden where the scene shows something nearer than the line, by reads of the depth buffer (a perspective view's), with a tolerance of 2 pixels' worth of meters at the line's distance, so that a line on a surface is seen; a function `(point, windowPosition) => boolean`: hidden where it returns true, a test of yours (a ray against what you know of the scene)
| `step`      | `24`    | In pixels, how far apart along the line it is tested
| `className` | `''`    | Classes of its paths, besides `cesium-overlay-seen` and `cesium-overlay-hidden`: the hidden path's only class besides its own, `.cesium-overlay-hidden.box` in a stylesheet
| `fill`      | `false` | A closed line of three points or more filled too, under its lines: what of it is in view, never hidden (a translucent plane, a zone)
| `strokes`   | `['']`  | A seen path for each class given, of that class too, all drawing the same: a halo, an edge and a core, `['halo', 'edge', 'core']`, the first under the others; the hidden path is one, of none of them

## Styling

| Class                 | Default
| --------------------- | -------
| `.cesium-overlay`     | `position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 5`
| `.cesium-overlay-pins` | `position: absolute; inset: 0; isolation: isolate`: the pins, first in the layer, under what else is appended to it
| `.cesium-overlay-pin` | `position: absolute; inset: 0; display: flex; align-items: flex-start`, moved by `translate`: the layer's size, its corner on the point, so that the element in it has room to lay out
| `.cesium-overlay-label` | A value's pill (a length, a depth), in the palette's label colors and font, for a page's own pin
| `.cesium-overlay-hint`  | A hint's pill (what to do), in the palette's hint colors and font
| `.cesium-overlay-lines` | The lines' `<svg>`, first in the layer, under the pins: `position: absolute; inset: 0`, the layer's size
| `.cesium-overlay-seen`  | What is seen of a line: `fill: none`, the palette's core, 1.5 px, round caps
| `.cesium-overlay-hidden` | What is hidden of a line: the same, 1 px, dashed `3 4`, 60 % opaque
| `.cesium-overlay-fill`  | A filled line's inside: the palette's core, 15 % opaque, no stroke

```css
.box.cesium-overlay-seen { stroke: #a7aba8; stroke-width: 1; }
.box.cesium-overlay-hidden { stroke: #a7aba8; }
```

```js
const depth = Object.assign(document.createElement('div'), {className: 'cesium-overlay-label', textContent: '470 m deep'});
overlay.pin(depth, point, {offset: [10, 0]});
```

The tools drawn in the layer (`@geoblocks/cesium-measure`, `@geoblocks/cesium-arrange`) share its palette, custom properties
read with their defaults on `.cesium-overlay`: set them on the widget's container or on `:root` to restyle them all, or a tool's own
(`--cesium-measure-core`, ...) for one.

| Custom property                     | Default
| ----------------------------------- | -------
| `--cesium-overlay-core`             | `#fffaf3`, the lines' light core, the points' fill
| `--cesium-overlay-edge`             | `#2b1d10`, the lines' dark edge, seen on a light ground and a dark one
| `--cesium-overlay-glow`             | `#ff9a3c`, what glows: an edge snapped to, a guide, a halo
| `--cesium-overlay-label-background` | the core, 93% opaque: a value's pill (a length, an angle)
| `--cesium-overlay-label-color`      | the edge: a value's text
| `--cesium-overlay-hint-background`  | `#333e`, a hint's pill (what to do)
| `--cesium-overlay-hint-color`       | `#fff`, a hint's text
| `--cesium-overlay-font`             | `12px/1.3 system-ui, sans-serif`

What is in the layer, a page's pins included, reads the palette resolved, the page's value or the default, as `--overlay-*`,
declared on `.cesium-overlay`: `--overlay-core`, `--overlay-edge`, `--overlay-glow`, `--overlay-label-background`,
`--overlay-label-color`, `--overlay-hint-background`, `--overlay-hint-color`, `--overlay-font`. Read them, never set them.

The layer takes no pointer; give `pointer-events: auto` to what in it should. Its styles are in a `<style>` in the layer, not
in the head: scoped to the layer (`@scope`) and in a cascade layer (`@layer cesium-overlay`), so that a page's rule in no
cascade layer wins whatever its specificity, but for `[hidden]`'s `display: none`, which is `!important`. A page's own cascade
layers, declared in the head, come before the overlay's and lose to it: declare it first (`@layer cesium-overlay;` before the
page's layers) for them to win.

### Custom styles

A page styles the layer and its pins from its own stylesheet, as anything else: its rules, in no cascade layer, win over the
overlay's.

```css
.cesium-overlay-label { font-size: 14px; }
.depth { color: var(--overlay-edge); }
```

A package that draws over the overlay and ships its styles in its module puts them where it draws, the same way: a `<style>`
in its own element in the layer, which takes it away with it, its rules in a cascade layer, so that a page's still win, and in
`@scope`, which keeps them to that element. In `@scope`, a selector without `:scope` matches only what is inside the element:
the element's own rule is `:scope`.

```js
const STYLE = `
@layer my-tool {
  @scope {
    :scope { position: absolute; inset: 0; }
    .my-tool-label { background: var(--overlay-label-background); color: var(--overlay-label-color); }
  }
}
`;

const element = document.createElement('div');
element.className = 'my-tool';
const style = document.createElement('style');
style.textContent = STYLE;
element.append(style);
overlayOf(viewer).element.append(element);
```

## Test page

`demos/cesium-overlay.html` in the repository draws lines of each kind over a grid of boxes, and benchmarks them:
`await bench.measure({view: 'above'})` in the console (`bench.views`: `above`, `side`, `inside`; `?continuous` for a scene
rendering every frame).

## Limits

- `occlude: 'depth'` reads the depth buffer once a pin a render: a few pins, not hundreds.
- One element a pin, moved every render it changes: hundreds of names are a `LabelCollection`'s job.
- A line is a few points: a polyline of hundreds is a `Polyline`'s job. `occlude: 'depth'` reads the depth buffer about once every
  `step` pixels of line in view (a coarse pass, then a fine one) and a few times more where it changes, once the view is still:
  a box's edges, not a map's roads. On an integrated GPU (the test page, request mode): 280 to 620 reads of 0.2 ms, the first
  split 25 to 40 ms after the camera stops and the last read 70 to 150 ms after it, no long task; rendering every frame, the reads
  end later (up to about 330 ms), each task waiting once for the GPU.
- A test of yours runs on every render, every `step` pixels of a segment and at least at its two ends: an outline of tens of
  points costs two tests a segment.
