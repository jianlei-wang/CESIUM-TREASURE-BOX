
import { 
  ByteType,
  Data3DTexture,
  DataTexture,
  FloatType,
  HalfFloatType,
  IntType,
  LinearFilter,
  Loader,
  RGBAFormat,
  ShortType,
  UnsignedByteType,
  UnsignedIntType,
  UnsignedShortType
 } from "three";
import { createTypedArrayLoaderClass } from './TypedArrayLoader.js';
// 注意：typedArrayParsers 中的 parser 由调用者提供，对应的实现需自行提供
function invariant(condition, message = 'Invariant failed') {
  if (!condition) {
    throw new Error(message);
  }
}
// 根据输入的数组类型返回对应的纹理数据类型
function getTextureDataType(array) {
  // prettier-ignore
  const type =
    array instanceof Int8Array ? ByteType :
      array instanceof Uint8Array ? UnsignedByteType :
        array instanceof Uint8ClampedArray ? UnsignedByteType :
          array instanceof Int16Array ? ShortType :
            array instanceof Uint16Array ? UnsignedShortType :
              array instanceof Int32Array ? IntType :
                array instanceof Uint32Array ? UnsignedIntType :
                  array instanceof Float16Array ? HalfFloatType :
                    array instanceof Float32Array ? FloatType :
                      array instanceof Float64Array ? FloatType :
                        null;
  invariant(type != null, 'Could not determine texture data type.');
  return type;
}

// 默认纹理参数
const defaultDataTextureParameter = {
  format: RGBAFormat,
  minFilter: LinearFilter,
  magFilter: LinearFilter
};

// DataLoader 类，作为 DataTexture 和 Data3DTexture Loader 的基类
export default class DataLoader extends Loader {
  constructor() {
    super();
    // 子类中需要定义以下两个字段：
    // this.Texture：例如 DataTexture 或 Data3DTexture
    // this.TypedArrayLoader：创建对应的 TypedArrayLoader 类
    this.parameters = {};
  }

  load(url, onLoad, onProgress, onError) {
    const texture = new this.Texture();
    const loader = new this.TypedArrayLoader(this.manager);
    loader.setRequestHeader(this.requestHeader);
    loader.setPath(this.path);
    loader.setWithCredentials(this.withCredentials);
    loader.load(
      url,
      array => {
        // 若加载到的数据为 Float16Array，则转换成 Uint16Array；否则直接赋值
        texture.image.data =
          array instanceof Float16Array ? new Uint16Array(array.buffer) : array;
        const { width, height, depth, ...params } = this.parameters;
        if (width != null) {
          texture.image.width = width;
        }
        if (height != null) {
          texture.image.height = height;
        }
        // 若 texture.image 支持 depth 属性，则设置深度
        if ('depth' in texture.image && depth != null) {
          texture.image.depth = depth;
        }

        // 根据数据数组的类型设置纹理数据类型
        texture.type = getTextureDataType(array);
        Object.assign(texture, params);
        texture.needsUpdate = true;
        onLoad(texture);
      },
      onProgress,
      onError
    );
  }
}

// 工厂函数，用于动态生成 DataLoader 的子类
function createDataLoaderClass(Texture, parser, parameters) {
  return class extends DataLoader {
    constructor(manager) {
      super(manager);
      this.Texture = Texture;
      this.TypedArrayLoader = createTypedArrayLoaderClass(parser);
      this.parameters = {
        ...defaultDataTextureParameter,
        ...parameters
      };
    }
  };
}

// 创建 Data3DTexture Loader 子类
export function createData3DTextureLoaderClass(parser, parameters) {
  return createDataLoaderClass(Data3DTexture, parser, parameters);
}

// 创建 DataTexture Loader 子类
export function createDataTextureLoaderClass(parser, parameters) {
  return createDataLoaderClass(DataTexture, parser, parameters);
}

// 直接创建一个 Data3DTexture Loader 实例
export function createData3DTextureLoader(parser, parameters) {
  const LoaderClass = createData3DTextureLoaderClass(parser, parameters);
  return new LoaderClass();
}

// 直接创建一个 DataTexture Loader 实例
export function createDataTextureLoader(parser, parameters) {
  const LoaderClass = createDataTextureLoaderClass(parser, parameters);
  return new LoaderClass();
}
