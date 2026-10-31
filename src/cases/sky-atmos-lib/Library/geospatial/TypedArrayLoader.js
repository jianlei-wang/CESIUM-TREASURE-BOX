import {  Loader  } from "three";

import ArrayBufferLoader from './ArrayBufferLoader.js';
import { invalidateAssetBuffer } from '../internal/AssetCache.js';
// TypedArrayLoader 抽象基类（在 JS 中无法强制抽象，但可用约定方式使用）
export default class TypedArrayLoader extends Loader {
  // 子类需实现该方法
  parseTypedArray(buffer) {
    throw new Error('parseTypedArray must be implemented by subclass');
  }

  load(url, onLoad, onProgress, onError) {
    const loader = new ArrayBufferLoader(this.manager);
    loader.setRequestHeader(this.requestHeader);
    loader.setPath(this.path);
    loader.setWithCredentials(this.withCredentials);
    loader.load(
      url,
      arrayBuffer => {
        try {
          onLoad(this.parseTypedArray(arrayBuffer));
        } catch (error) {
          invalidateAssetBuffer(this.manager.resolveURL((this.path || '') + url), arrayBuffer);
          if (onError != null) {
            onError(error);
          } else {
            console.error(error);
          }
          this.manager.itemError(url);
        }
      },
      onProgress,
      onError
    );
  }
}

// 工厂函数，创建一个 TypedArrayLoader 子类
export function createTypedArrayLoaderClass(parser) {
  return class extends TypedArrayLoader {
    parseTypedArray(buffer) {
      return parser(buffer);
    }
  };
}

// 工厂函数，直接返回 TypedArrayLoader 实例
export function createTypedArrayLoader(parser) {
  const LoaderClass = createTypedArrayLoaderClass(parser);
  return new LoaderClass();
}
