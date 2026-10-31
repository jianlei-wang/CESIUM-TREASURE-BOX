// 原生替代 @petamoriken/float16：getFloat16 实现
function getFloat16(view, byteOffset, littleEndian) {
  const bits = view.getUint16(byteOffset, littleEndian);
  const sign = (bits & 0x8000) >> 15;
  const exponent = (bits & 0x7C00) >> 10;
  const fraction = bits & 0x03FF;

  if (exponent === 0) {
    return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / Math.pow(2, 10));
  } else if (exponent === 0x1F) {
    return fraction ? NaN : ((sign ? -1 : 1) * Infinity);
  }

  return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / Math.pow(2, 10));
}

// 模拟 Float16Array：包装 Uint16Array 并添加语义
class Float16Array extends Uint16Array { }

// 兼容 TypedArray 构造器
const TypedArrayConstructors = {
  Uint8Array, Int8Array, Uint16Array, Int16Array,
  Uint32Array, Int32Array, Float32Array, Float64Array,
  Float16Array
};

// 判断主机字节序
let hostLittleEndian;
function isHostLittleEndian() {
  if (hostLittleEndian != null) return hostLittleEndian;
  const a = new Uint32Array([0x10000000]);
  const b = new Uint8Array(a.buffer);
  hostLittleEndian = b[0] === 0;
  return hostLittleEndian;
}

// 通用解析器
function parseTypedArray(buffer, TypedArray, getValue, littleEndian = true) {
  if (littleEndian === isHostLittleEndian()) {
    return new TypedArray(buffer);
  }

  const dataView = new DataView(buffer);
  dataView.getFloat16 = function (byteOffset, littleEndian) {
    return getFloat16(this, byteOffset, littleEndian);
  };

  const array = new TypedArray(dataView.byteLength / TypedArray.BYTES_PER_ELEMENT);

  for (let index = 0, byteIndex = 0; index < array.length; ++index, byteIndex += TypedArray.BYTES_PER_ELEMENT) {
    array[index] = dataView[getValue](byteIndex, littleEndian);
  }

  return array;
}

// 各类型解析器导出
export const parseUint8Array = buffer => new Uint8Array(buffer);
export const parseInt8Array = buffer => new Int8Array(buffer);

export const parseUint16Array = (buffer, le) => parseTypedArray(buffer, Uint16Array, 'getUint16', le);
export const parseInt16Array = (buffer, le) => parseTypedArray(buffer, Int16Array, 'getInt16', le);
export const parseUint32Array = (buffer, le) => parseTypedArray(buffer, Uint32Array, 'getUint32', le);
export const parseInt32Array = (buffer, le) => parseTypedArray(buffer, Int32Array, 'getInt32', le);

export const parseFloat16Array = (buffer, le) => parseTypedArray(buffer, Float16Array, 'getFloat16', le);
export const parseFloat32Array = (buffer, le) => parseTypedArray(buffer, Float32Array, 'getFloat32', le);
export const parseFloat64Array = (buffer, le) => parseTypedArray(buffer, Float64Array, 'getFloat64', le);

// 可选：导出 Float16Array 类
export { Float16Array };

export default {};