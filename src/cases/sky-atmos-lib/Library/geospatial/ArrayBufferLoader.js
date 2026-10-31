import { Loader } from "three";
import { invalidateAssetBuffer, loadAssetBuffer } from "../internal/AssetCache.js";

export default class ArrayBufferLoader extends Loader {
  load(url, onLoad, onProgress, onError) {
    url = this.manager.resolveURL((this.path || "") + (url || ""));
    this.manager.itemStart(url);
    const reportError = error => {
      if (onError != null) onError(error);
      else console.error(error);
      this.manager.itemError(url);
    };
    // Handle errors inside the callbacks so observer failures never create an
    // unhandled rejection in this callback-based Loader interface.
    loadAssetBuffer(url, onProgress, this).then(arrayBuffer => {
      try {
        onLoad?.(arrayBuffer);
      } catch (error) {
        invalidateAssetBuffer(url, arrayBuffer);
        reportError(error);
      }
    }, reportError).finally(() => this.manager.itemEnd(url)).catch(error => console.error(error));
  }
}
