import { 
  HalfFloatType,
  LinearFilter,
  Loader,
  Data3DTexture,
  LoadingManager,
  DataTextureLoader,
  FloatType,
  RGBAFormat
 } from "three";
import {
  IRRADIANCE_TEXTURE_HEIGHT,
  IRRADIANCE_TEXTURE_WIDTH,
  SCATTERING_TEXTURE_DEPTH,
  SCATTERING_TEXTURE_HEIGHT,
  SCATTERING_TEXTURE_WIDTH,
  TRANSMITTANCE_TEXTURE_HEIGHT,
  TRANSMITTANCE_TEXTURE_WIDTH
} from './AtmosphereConstants.js';
import { createData3DTextureLoader, createDataTextureLoader } from './PrecomputedDataLoader.js';
import { parseFloat16Array } from './typedArrayParsers.js';
import { EXRLoader } from "./EXRLoader.js";

// EXR3DLoader 类：用于加载 EXR3D 图像数据
export class EXR3DLoader extends Loader {
  constructor(manager) {
    super(manager);
    this.depth = undefined;
  }

  setDepth(value) {
    this.depth = value;
    return this;
  }
  load(url, onLoad, onProgress, onError) {
    const loader = new EXRLoader(this.manager);
    loader.setRequestHeader(this.requestHeader);
    loader.setPath(this.path);
    loader.setWithCredentials(this.withCredentials);
    loader.load(
      url,
      exr => {
        const { data, width, height } = exr.image;
        const depth = this.depth !== undefined ? this.depth : Math.sqrt(height);
        const texture = new Data3DTexture(data, width, height / depth, depth);
        texture.type = exr.type;
        texture.format = exr.format;
        texture.colorSpace = exr.colorSpace;
        texture.needsUpdate = true;

        try {
          onLoad(texture);
        } catch (error) {
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

/**
 * 将多个 URL 片段连接成一个规范的 URL。
 * 例如：join('http://example.com/', '/path/', 'to/', '/file.txt') => "http://example.com/path/to/file.txt"
 * @param  {...string} parts - URL 的各个部分
 * @returns {string} 拼接后的 URL
 */
export function join(...parts) {
  return parts
    .filter(part => part) // 过滤空值
    .map((part, index) => {
      if (index === 0) {
        // 第一个片段保留协议等信息，去除尾部斜杠
        return part.replace(/\/+$/g, '');
      }
      // 去除开头和尾部的斜杠
      return part.replace(/^\/+|\/+$/g, '');
    })
    .join('/');
}

export default class PrecomputedTexturesLoader extends Loader {
  constructor() {
    super()
    // 默认使用 EXR 格式
    this.format = 'exr'
    // 默认使用 half-float 类型
    this.type = FloatType
  }

  setTypeFromRenderer(renderer) {
    this.type =
      renderer.getContext().getExtension('OES_texture_float_linear') == null
        ? HalfFloatType
        : FloatType
    return this
  }

  load(url, onLoad, onProgress, onError) {
    const result = {}
    let finished = false
    const reportError = error => {
      if (finished) return
      finished = true
      if (onError != null) onError(error)
      else console.error(error)
    }
    const loadTexture = (name, { loader, extension }) => {
      loader.setRequestHeader(this.requestHeader)
      loader.setPath(this.path)
      loader.setWithCredentials(this.withCredentials)
      loader.load(
        join(url, `${name}${extension}`),
        texture => {
          if (finished) return
          // Older FileLoader versions rethrow onLoad errors as unhandled rejections.
          try {
            texture.minFilter = LinearFilter
            texture.magFilter = LinearFilter
            // 使用指定类型（FloatType 或 HalfFloatType）
            texture.type = this.type
            if (this.type === FloatType) {
              texture.image.data = new Float32Array(
                new Float16Array(texture.image.data.buffer)
              )
            }
            result[`${name}Texture`] = texture
            if (
              result.irradianceTexture != null &&
              result.scatteringTexture != null &&
              result.transmittanceTexture != null
              // result.higher_order_scattering != null
            ) {
              onLoad(result)
              finished = true
            }
          } catch (error) {
            reportError(error)
          }
        },
        onProgress,
        reportError
      )
    }

    if (this.format === 'exr') {
      loadTexture('irradiance', {
        loader: new EXRLoader(this.manager),
        extension: '.exr'
      })
      loadTexture('scattering', {
        loader: new EXR3DLoader(this.manager).setDepth(SCATTERING_TEXTURE_DEPTH),
        extension: '.exr'
      })
      loadTexture('transmittance', {
        loader: new EXRLoader(this.manager),
        extension: '.exr'
      })
      // loadTexture('single_mie_scattering', {
      //   loader: new EXR3DLoader(this.manager).setDepth(SCATTERING_TEXTURE_DEPTH),
      //   extension: '.exr'
      // })
      // loadTexture('higher_order_scattering', {
      //   loader: new EXR3DLoader(this.manager).setDepth(SCATTERING_TEXTURE_DEPTH),
      //   extension: '.exr'
      // })
    } else {
      loadTexture('irradiance', {
        loader: createDataTextureLoader(parseFloat16Array, {
          width: IRRADIANCE_TEXTURE_WIDTH,
          height: IRRADIANCE_TEXTURE_HEIGHT
        }),
        extension: '.bin'
      })
      loadTexture('scattering', {
        loader: createData3DTextureLoader(parseFloat16Array, {
          width: SCATTERING_TEXTURE_WIDTH,
          height: SCATTERING_TEXTURE_HEIGHT,
          depth: SCATTERING_TEXTURE_DEPTH
        }),
        extension: '.bin'
      })
      loadTexture('transmittance', {
        loader: createDataTextureLoader(parseFloat16Array, {
          width: TRANSMITTANCE_TEXTURE_WIDTH,
          height: TRANSMITTANCE_TEXTURE_HEIGHT
        }),
        extension: '.bin'
      })
    }
  }
}
