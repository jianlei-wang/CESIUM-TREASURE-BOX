declare module 'jsts' {
  export interface JtsGeometry {
    getNumGeometries(): number
    getGeometryN(n: number): JtsGeometry
    union(other: JtsGeometry): JtsGeometry
    intersection(other: JtsGeometry): JtsGeometry
    difference(other: JtsGeometry): JtsGeometry
    getArea(): number
    isEmpty(): boolean
  }

  export interface BufferParametersInstance {
    setJoinStyle(style: number): void
    setEndCapStyle(style: number): void
    setQuadrantSegments(segments: number): void
    setMitreLimit(limit: number): void
  }

  export interface BufferOpInstance {
    getResultGeometry(distance: number): JtsGeometry
  }

  export interface GeoJSONReader {
    read(geometry: { type: string; coordinates: unknown }): JtsGeometry
  }

  export interface GeoJSONWriter {
    write(geometry: JtsGeometry): { type: string; coordinates: unknown }
  }

  const jsts: {
    io: {
      GeoJSONReader: new () => GeoJSONReader
      GeoJSONWriter: new () => GeoJSONWriter
    }
    operation: {
      buffer: {
        BufferOp: {
          new (geometry: JtsGeometry, params: BufferParametersInstance): BufferOpInstance
        }
        BufferParameters: {
          new (): BufferParametersInstance
          JOIN_ROUND: number
          JOIN_MITRE: number
          JOIN_BEVEL: number
          CAP_ROUND: number
          CAP_FLAT: number
          CAP_SQUARE: number
        }
      }
    }
  }

  export default jsts
}
