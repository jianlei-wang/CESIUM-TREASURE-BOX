import {Cartesian3, ComponentDatatype, Matrix4, PrimitiveType, Quaternion} from "@cesium/core";
import {Axis} from "@cesium/engine";

// The triangles of a glTF's meshes, in a triangle mesh's frame: glTF's y up turned z up by Cesium's own matrix
// (Axis.Y_UP_TO_Z_UP), its glTF (x, y, z) at (x, -z, y), as Cesium loads a model with forwardAxis X; with forwardAxis Z,
// Cesium's default, also turned by Axis.Z_UP_TO_X_UP, as Cesium's ModelUtility does.

// the extensions that change where the vertices are, which are not read
const UNSUPPORTED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'EXT_mesh_gpu_instancing'];

const COMPONENTS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
// the component types (glTF's are Cesium's ComponentDatatype's): their DataView getter, their size in bytes and, normalized, their largest value
/** @type {Record<number, [string, number, number]>} */
const TYPES = {
  [ComponentDatatype.BYTE]: ['getInt8', 1, 127],
  [ComponentDatatype.UNSIGNED_BYTE]: ['getUint8', 1, 255],
  [ComponentDatatype.SHORT]: ['getInt16', 2, 32767],
  [ComponentDatatype.UNSIGNED_SHORT]: ['getUint16', 2, 65535],
  [ComponentDatatype.UNSIGNED_INT]: ['getUint32', 4, 0],
  [ComponentDatatype.FLOAT]: ['getFloat32', 4, 0],
};

// in Cesium, not in its typings
const yUpToZUp = /** @type {Matrix4} */ (/** @type {any} */ (Axis).Y_UP_TO_Z_UP);
const zUpToXUp = /** @type {Matrix4} */ (/** @type {any} */ (Axis).Z_UP_TO_X_UP);
const pointScratch = new Cartesian3();

/**
 * @typedef {object} GltfTriangles The triangles of one primitive of a node's mesh.
 * @property {Float32Array} vertices x, y, z, in the node's world frame, z up.
 * @property {Uint32Array} triangles
 * @property {string | undefined} name The node's name, else its mesh's.
 * @property {number} node The node's index.
 * @property {number} mesh The mesh's index.
 * @property {number} primitive The primitive's index in its mesh.
 */

/**
 * The glb's JSON and binary chunk.
 * @param {ArrayBuffer | Uint8Array} glb
 * @return {{json: any, bin: Uint8Array | undefined}}
 */
function parseGlb(glb) {
  const bytes = glb instanceof Uint8Array ? glb : new Uint8Array(glb);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('Not a binary glTF');
  }
  if (view.getUint32(4, true) !== 2) {
    throw new Error(`glTF version ${view.getUint32(4, true)}, only 2 is read`);
  }
  let json;
  let bin;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(chunk));
    } else if (type === 0x004e4942) {
      bin = chunk;
    }
    offset += 8 + length;
  }
  if (!json) {
    throw new Error('A binary glTF without its JSON');
  }
  return {json, bin};
}

/**
 * An accessor's values, normalized ones as floats.
 * @param {any} gltf
 * @param {(Uint8Array | undefined)[]} buffers
 * @param {number} index
 * @return {{values: ArrayLike<number>, size: number, count: number}}
 */
function readAccessor(gltf, buffers, index) {
  const accessor = gltf.accessors?.[index];
  if (!accessor) {
    throw new Error(`No accessor ${index}`);
  }
  if (accessor.sparse) {
    throw new Error(`Accessor ${index} is sparse, which is not read`);
  }
  const type = TYPES[accessor.componentType];
  const size = COMPONENTS[/** @type {keyof typeof COMPONENTS} */ (accessor.type)];
  if (!type || !size) {
    throw new Error(`Accessor ${index}'s ${accessor.type} of ${accessor.componentType} is not read`);
  }
  const [getter, bytes, largest] = type;
  const count = accessor.count;
  const values = new Float64Array(count * size);
  // no buffer view: zeros
  if (accessor.bufferView === undefined) {
    return {values, size, count};
  }
  const bufferView = gltf.bufferViews[accessor.bufferView];
  if (bufferView.extensions?.EXT_meshopt_compression || bufferView.extensions?.KHR_meshopt_compression) {
    throw new Error(`Buffer view ${accessor.bufferView} is meshopt compressed, which is not read`);
  }
  const buffer = buffers[bufferView.buffer];
  if (!buffer) {
    throw new Error(`No data for buffer ${bufferView.buffer}`);
  }
  const start = buffer.byteOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = bufferView.byteStride ?? size * bytes;
  const view = new DataView(buffer.buffer);
  const read = /** @type {(at: number, littleEndian: boolean) => number} */ (view[/** @type {'getInt16'} */ (getter)].bind(view));
  const normalized = accessor.normalized && largest > 0;
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < size; k++) {
      const value = read(start + i * stride + k * bytes, true);
      values[i * size + k] = normalized ? Math.max(value / largest, -1) : value;
    }
  }
  return {values, size, count};
}

/**
 * A primitive's triangles, of its indices or of its vertices in order: a list, a strip or a fan.
 * @param {number} mode
 * @param {ArrayLike<number>} indices
 * @return {Uint32Array}
 */
function toTriangles(mode, indices) {
  const n = indices.length;
  if (mode === PrimitiveType.TRIANGLES) {
    return Uint32Array.from(indices);
  }
  const triangles = new Uint32Array(Math.max(n - 2, 0) * 3);
  for (let i = 0; i + 2 < n; i++) {
    // a strip's every other triangle turned back the right way round; a fan's round its first vertex
    const corners = mode === PrimitiveType.TRIANGLE_STRIP ? [i, i + 1 + (i % 2), i + 2 - (i % 2)] : [i + 1, i + 2, 0];
    triangles.set(corners.map(k => indices[k]), i * 3);
  }
  return triangles;
}

/**
 * The triangles of every mesh primitive of a glTF's scene (its default scene, else its first, else its root
 * nodes), lists, strips and fans, each node using a mesh giving its own copy, in a triangle mesh's frame, z up:
 * glTF's (x, y, z) at (x, -z, y). The positions in floats, or quantized (KHR_mesh_quantization), with a
 * byteStride or not, indexed or not. The materials, textures, animations, skins and morph targets are ignored;
 * Draco, meshopt, GPU instancing and sparse accessors are not read: they throw.
 * @param {ArrayBuffer | Uint8Array | object} gltf A binary glTF, or a glTF's JSON.
 * @param {ArrayBuffer | Uint8Array | (ArrayBuffer | Uint8Array)[]} [buffers] With a glTF's JSON, its binary
 *     buffer, or its buffers in order.
 * @param {Axis} [forwardAxis] The one a Model is loaded with: Axis.X, as here, or Cesium's default Axis.Z, which
 *     turns the triangles a quarter round z, (x, y, z) to (-y, x, z).
 * @return {GltfTriangles[]}
 */
export function gltfTriangles(gltf, buffers, forwardAxis = Axis.X) {
  /** @type {any} */
  let json;
  /** @type {(Uint8Array | undefined)[]} */
  let data;
  const toBytes = (/** @type {ArrayBuffer | Uint8Array} */ b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
  if (gltf instanceof ArrayBuffer || gltf instanceof Uint8Array) {
    const {json: parsed, bin} = parseGlb(gltf);
    json = parsed;
    data = [bin];
  } else {
    json = gltf;
    data = (Array.isArray(buffers) ? buffers : buffers ? [buffers] : []).map(toBytes);
  }
  const unsupported = (json.extensionsRequired ?? []).filter((/** @type {string} */ name) => UNSUPPORTED.includes(name));
  if (unsupported.length > 0) {
    throw new Error(`The glTF requires ${unsupported.join(', ')}, which is not read`);
  }

  const correction = forwardAxis === Axis.Z ? Matrix4.multiplyTransformation(yUpToZUp, zUpToXUp, new Matrix4()) : yUpToZUp;
  const nodes = json.nodes ?? [];
  /** @type {number[]} */
  let roots;
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene) {
    roots = scene.nodes ?? [];
  } else {
    const children = new Set(nodes.flatMap((/** @type {any} */ node) => node.children ?? []));
    roots = nodes.map((/** @type {any} */ _, /** @type {number} */ i) => i).filter((/** @type {number} */ i) => !children.has(i));
  }

  /** @type {Map<number, {positions: ArrayLike<number>, triangles: Uint32Array}[]>} */
  const meshes = new Map();
  const primitivesOf = (/** @type {number} */ meshIndex) => {
    let primitives = meshes.get(meshIndex);
    if (!primitives) {
      primitives = json.meshes[meshIndex].primitives.map((/** @type {any} */ primitive) => {
        const mode = primitive.mode ?? PrimitiveType.TRIANGLES;
        if (mode < PrimitiveType.TRIANGLES || mode > PrimitiveType.TRIANGLE_FAN || primitive.attributes.POSITION === undefined) {
          return undefined;
        }
        const {values, count} = readAccessor(json, data, primitive.attributes.POSITION);
        const indices = primitive.indices === undefined ? Uint32Array.from({length: count}, (_, i) => i) :
          readAccessor(json, data, primitive.indices).values;
        return {positions: values, triangles: toTriangles(mode, indices)};
      });
      meshes.set(meshIndex, /** @type {any} */ (primitives));
    }
    return /** @type {({positions: ArrayLike<number>, triangles: Uint32Array} | undefined)[]} */ (primitives);
  };

  /** @type {GltfTriangles[]} */
  const result = [];
  /**
   * @param {number} index
   * @param {Matrix4} parent
   */
  const visit = (index, parent) => {
    const node = nodes[index];
    const local = node.matrix ? Matrix4.unpack(node.matrix, 0, new Matrix4()) :
      Matrix4.fromTranslationQuaternionRotationScale(
        Cartesian3.unpack(node.translation ?? [0, 0, 0]),
        Quaternion.unpack(node.rotation ?? [0, 0, 0, 1]),
        Cartesian3.unpack(node.scale ?? [1, 1, 1]),
      );
    const world = Matrix4.multiply(parent, local, local);
    if (node.mesh !== undefined) {
      primitivesOf(node.mesh).forEach((primitive, k) => {
        if (!primitive) {
          return;
        }
        const {positions, triangles} = primitive;
        const vertices = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i += 3) {
          const p = Matrix4.multiplyByPoint(world, Cartesian3.fromElements(positions[i], positions[i + 1], positions[i + 2], pointScratch), pointScratch);
          // + 0: not -0
          vertices[i] = p.x + 0;
          vertices[i + 1] = p.y + 0;
          vertices[i + 2] = p.z + 0;
        }
        result.push({vertices, triangles: triangles.slice(), name: node.name ?? json.meshes[node.mesh].name, node: index, mesh: node.mesh, primitive: k});
      });
    }
    for (const child of node.children ?? []) {
      visit(child, world);
    }
  };
  for (const root of roots) {
    visit(root, correction);
  }
  return result;
}
