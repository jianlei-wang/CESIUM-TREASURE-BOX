import {
  Cartesian3,
  CustomShader,
  Matrix4,
  Transforms,
  UniformType,
  type Cesium3DTileset
} from 'cesium'

export interface FlatOption {
  height?: number
  outline?: boolean
}

export interface FlatRegionOption {
  positions: Cartesian3[]
  id: string
}

class Flatten {
  private _flatHeight: number
  private _center: Cartesian3 | undefined
  private _matrix!: Matrix4
  private _localMatrix!: Matrix4
  private _regionList: FlatRegionOption[]
  private _localPositionsArr: Array<number[][]>

  constructor(private tileset: Cesium3DTileset, option: FlatOption = {}) {
    this._regionList = []
    this._localPositionsArr = []

    this._flatHeight = option.height || 0

    if (!tileset) {
      throw new Error('3DTiles模型异常，未检索到进行压平操作的模型对象')
    }

    this._center = tileset.boundingSphere.center.clone()
    this._matrix = Transforms.eastNorthUpToFixedFrame(this._center.clone())
    this._localMatrix = Matrix4.inverse(this._matrix, new Matrix4())
  }

  addRegion(region: FlatRegionOption): void {
    this._regionList.push(region)
    this.calculateStr()
  }

  removeRegionById(id: string): void {
    if (!id) return
    this._regionList = this._regionList.filter((region) => region.id !== id)
    this._localPositionsArr = []
    this.calculateStr()
  }

  private calculateStr(): void {
    for (let i = 0; i < this._regionList.length; i++) {
      const { positions } = this._regionList[i]
      const localCoord = this.car3ToLocal(positions)
      this._localPositionsArr.push(localCoord)
    }

    const funStr = this.strInPolygonFun(this._localPositionsArr)
    let str = ''

    for (let i = 0; i < this._localPositionsArr.length; i++) {
      const coors = this._localPositionsArr[i]
      const n = coors.length
      let instr = ''

      coors.forEach((coordinate, index) => {
        instr += `points_${n}[${index}] = vec2(${coordinate[0]}, ${coordinate[1]});\n`
      })

      str += `
              ${instr}
              if(isPointInPolygon_${n}(position2D)){
                vec4 tileset_local_position_transformed = vec4(tileset_local_position.x, tileset_local_position.y, ground_z, 1.0);
                vec4 model_local_position_transformed = czm_inverseModel * u_tileset_localToWorldMatrix * tileset_local_position_transformed;
                vsOutput.positionMC.xy = model_local_position_transformed.xy;
                vsOutput.positionMC.z = model_local_position_transformed.z + modelMC.z*0.0001;
                return;
              }
            `
    }

    this.updateShader(funStr, str)
  }

  destroy(): void {
    this.tileset.customShader = undefined
  }

  private strInPolygonFun(polygons: Array<number[][]>): string {
    const pMap = polygons.map((polygon) => polygon.length)
    const uniqueArray = this.getUniqueArray(pMap)
    let str = ''

    uniqueArray.forEach((length) => {
      str += `
              vec2 points_${length}[${length}];
              bool isPointInPolygon_${length}(vec2 point){
                int nCross = 0;
                const int n = ${length};
                for(int i = 0; i < n; i++){
                  vec2 p1 = points_${length}[i];
                  vec2 p2 = points_${length}[int(mod(float(i+1),float(n)))];
                  if(p1[1] == p2[1]){ continue; }
                  if(point[1] < min(p1[1], p2[1])){ continue; }
                  if(point[1] >= max(p1[1], p2[1])){ continue; }
                  float x = p1[0] + ((point[1] - p1[1]) * (p2[0] - p1[0])) / (p2[1] - p1[1]);
                  if(x > point[0]){ nCross++; }
                }
                return int(mod(float(nCross), float(2))) == 1;
              }
            `
    })
    return str
  }

  private updateShader(vtx1: string, vtx2: string): void {
    const flatCustomShader = new CustomShader({
      uniforms: {
        u_tileset_localToWorldMatrix: {
          type: UniformType.MAT4,
          value: this._matrix
        },
        u_tileset_worldToLocalMatrix: {
          type: UniformType.MAT4,
          value: this._localMatrix
        },
        u_flatHeight: {
          type: UniformType.FLOAT,
          value: this._flatHeight
        }
      },
      vertexShaderText: `
            ${vtx1}
            void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput){
              vec3 modelMC = vsInput.attributes.positionMC;
              vec4 model_local_position = vec4(modelMC.x, modelMC.y, modelMC.z, 1.0);
              vec4 tileset_local_position = u_tileset_worldToLocalMatrix * czm_model * model_local_position;
              vec2 position2D = vec2(tileset_local_position.x,tileset_local_position.y);
              float ground_z = 0.0 + u_flatHeight;
              ${vtx2}
            }`
    })
    this.tileset.customShader = flatCustomShader
  }

  private getUniqueArray = (arr: number[]): number[] => {
    return arr.filter((item, index, arr) => arr.indexOf(item, 0) === index)
  }

  private car3ToLocal(positions: Cartesian3[]): number[][] {
    const arr: number[][] = []
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i]
      const lp = Matrix4.multiplyByPoint(this._localMatrix, position, new Cartesian3())
      arr.push([lp.x, lp.y])
    }
    return arr
  }
}

export default Flatten
