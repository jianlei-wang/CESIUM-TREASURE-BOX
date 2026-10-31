declare module 'jsfive' {
  export class Dataset {
    value: ArrayLike<number>
    attrs: Record<string, unknown>
  }
  export class Group {
    get(path: string): Dataset | Group
  }
  export class File extends Group {
    constructor(buffer: ArrayBuffer, filename?: string)
  }
  export class Filters {}
}
