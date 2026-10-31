import {
    Cartesian2 as CesiumCartesian2,
    Cartesian3 as CesiumCartesian3,
    Cartesian4 as CesiumCartesian4,
    Matrix4 as CesiumMatrix4,
} from "cesium";

// Internal convenience methods belong to these types, never to Cesium's prototypes.
// All setters reuse their receiver, including the homogeneous divide used by projections.
export class Cartesian2 extends CesiumCartesian2 {
    set(x, y) { this.x = x; this.y = y; return this; }
    copy(source) { return this.set(source.x, source.y); }
}

export class Cartesian3 extends CesiumCartesian3 {
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(source) { return this.set(source.x, source.y, source.z); }
    toArray() { return [this.x, this.y, this.z]; }
    applyMatrix4(matrix) {
        const { x, y, z } = this;
        const w = 1 / (matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]);
        return this.set(
            (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * w,
            (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * w,
            (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * w,
        );
    }
}

export class Cartesian4 extends CesiumCartesian4 {
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
    copy(source) { return this.set(source.x, source.y, source.z, source.w); }
    toArray() { return [this.x, this.y, this.z, this.w]; }
}

export class Matrix4 extends CesiumMatrix4 {
    copy(source) { return CesiumMatrix4.clone(source, this); }
}
