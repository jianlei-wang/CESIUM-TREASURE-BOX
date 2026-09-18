declare module 'shpjs' {
  type ShpInput =
    | ArrayBuffer
    | string
    | { shp: ArrayBuffer; dbf?: ArrayBuffer; prj?: string | ArrayBuffer; cpg?: string }
    | File

  interface ShpFeature {
    type: 'Feature'
    geometry: { type: string; coordinates: unknown } | null
    properties: Record<string, unknown>
  }

  interface ShpFeatureCollection {
    type: 'FeatureCollection'
    fileName?: string
    features: ShpFeature[]
  }

  function shp(input: ShpInput): Promise<ShpFeatureCollection | ShpFeatureCollection[]>
  export default shp
}
