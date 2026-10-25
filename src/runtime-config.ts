export interface StudioRuntimeConfig {
  appTitle: string
  apiBaseUrl: string
  cesiumIonToken: string
  whiteModelTilesetBase: string
}

declare global {
  interface Window {
    __CESIUM_STUDIO_CONFIG__?: Partial<StudioRuntimeConfig>
  }
}

const injected = typeof window === 'undefined' ? {} : (window.__CESIUM_STUDIO_CONFIG__ ?? {})

export const runtimeConfig: StudioRuntimeConfig = {
  appTitle: typeof injected.appTitle === 'string' && injected.appTitle.trim() ? injected.appTitle.trim() : 'Cesium酱の百宝箱',
  apiBaseUrl: typeof injected.apiBaseUrl === 'string' ? injected.apiBaseUrl.trim() : '',
  cesiumIonToken: typeof injected.cesiumIonToken === 'string' ? injected.cesiumIonToken.trim() : '',
  whiteModelTilesetBase: typeof injected.whiteModelTilesetBase === 'string' ? injected.whiteModelTilesetBase.trim() : ''
}
