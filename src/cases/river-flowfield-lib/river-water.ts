// @ts-nocheck
import * as Cesium from 'cesium'

export default class RiverWater {
  viewer: any
  primitive: any
  meteorPrimitive: any
  positions: any
  centerlineGeoJson: any
  height: number
  params: any
  textureSize: number
  debugCanvas: any
  debugHost: any
  bounds: any
  _maskCanvas: any

  constructor(viewer, positions, centerlineGeoJson, height = 1500.0, options = {}) {
    this.viewer = viewer
    this.primitive = null
    this.meteorPrimitive = null
    this.positions = positions
    this.centerlineGeoJson = centerlineGeoJson
    this.height = height

    this.params = {
      speed: 0.163,
      flowMultiplier: -1.5,
      foamScale: 0.875,
      foamOffset: 0.267,
      shoreWidth: 0.15,
      deepColor: '#061a14',
      shallowColor: '#147a61',
      alpha: 0.85,
      specularIntensity: 0.4,
      specularShininess: 300.0,
      // 高光抗锯齿强度：0=关（窄高光瓣 + 高频波纹法线 = 密集白点闪烁），
      // 1=按屏幕空间法线导数正常滤波，>1 更狠（远处更平静，代价是细节变糊）
      specularAA: 1.0,
      specularColor: '#dee3df',
      fresnelPower: 5.0,
      fresnelIntensity: 0.156,
      skyColor: '#ffffff',
      exposure: 1.81,

      showMeteor: true,
      meteorLength: 190.0,
      meteorWidth: 11.0,
      flowSpeed: 1.8,
      tailLength: 0.94,
      meteorAlpha: 1.0,
      meteorSpacing: 2.0
    }

    Object.assign(this.params, options);

    this.textureSize = 512
    this.debugCanvas = null
    this.debugHost = options.debugHost || null
    this.bounds = null
    this._maskCanvas = null

    // 波纹目标物理波长（米）。以约 6km 宽的河段(6150m/60≈102m)为基准标定，
    // 各河段据此按真实尺寸换算周期数，保证疏密一致、不随包围盒尺寸变化
    this.rippleWavelength = 102.5

    this._sdfCanvas = null
    this._flowmapCanvas = null
    this._initCanvases()

    // 流场箭头颜色渐变映射（青蓝发光系：内侧缓流偏青白 → 外侧急流偏亮蓝）
    this.meteorColorStops = [
      { stop: 0.0, color: 'rgba(140, 232, 255, 1.0)' },
      { stop: 0.5, color: 'rgba(70, 185, 255, 1.0)' },
      { stop: 1.0, color: 'rgba(18, 120, 255, 1.0)' }
    ];

    // 【优化 1】：在构造函数中一次性预编译颜色 stops，避免在像素高频循环中解析 CSS 字符串
    this._parsedColorStops = this.meteorColorStops.map(stop => ({
      stop: stop.stop,
      color: Cesium.Color.fromCssColorString(stop.color)
    })).sort((a, b) => a.stop - b.stop);

    // 【优化 2】：全局静态缓存包围球，防止图层重建时重复计算数千个点
    this._cachedBoundingSphere = Cesium.BoundingSphere.fromPoints(this.positions);

    this._cachedColors = {
      deep: new Cesium.Color(),
      shallow: new Cesium.Color(),
      specular: new Cesium.Color(),
      sky: new Cesium.Color()
    }

    this._init()
  }

  _initCanvases() {
    this._sdfCanvas = document.createElement('canvas');
    this._sdfCanvas.width = this.textureSize;
    this._sdfCanvas.height = this.textureSize;

    this._flowmapCanvas = document.createElement('canvas');
    this._flowmapCanvas.width = this.textureSize;
    this._flowmapCanvas.height = this.textureSize;

    this._maskCanvas = document.createElement('canvas');
    this._maskCanvas.width = this.textureSize;
    this._maskCanvas.height = this.textureSize;
  }

  _computeBounds() {
    if (this.bounds) return this.bounds;

    const cartographics = this.positions.map(p => Cesium.Cartographic.fromCartesian(p));
    let minLon = Infinity, maxLon = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;

    cartographics.forEach(c => {
      if (c.longitude < minLon) minLon = c.longitude;
      if (c.longitude > maxLon) maxLon = c.longitude;
      if (c.latitude < minLat) minLat = c.latitude;
      if (c.latitude > maxLat) maxLat = c.latitude;
    });

    // 计算水面包围盒的物理尺寸（米），供波纹频率按真实尺度自适应
    // 使得不同物理大小的河段拥有一致的波纹波长（疏密相同）
    const R = 6378137.0;
    const midLat = (minLat + maxLat) / 2.0;
    const widthMeters = (maxLon - minLon) * R * Math.cos(midLat);
    const heightMeters = (maxLat - minLat) * R;

    this.bounds = { minLon, maxLon, minLat, maxLat, cartographics, widthMeters, heightMeters };
    return this.bounds;
  }

  _extractLinesFromGeoJSON(geoJson) {
    const lines = [];
    if (!geoJson) return lines;

    const processGeometry = (geometry) => {
      if (geometry.type === 'LineString') {
        lines.push(geometry.coordinates);
      } else if (geometry.type === 'MultiLineString') {
        geometry.coordinates.forEach(coords => lines.push(coords));
      }
    };

    if (geoJson.type === 'FeatureCollection') {
      geoJson.features.forEach(feature => {
        if (feature.geometry) processGeometry(feature.geometry);
      });
    } else if (geoJson.type === 'Feature') {
      processGeometry(geoJson.geometry);
    } else {
      processGeometry(geoJson);
    }

    return lines;
  }

  _createSDFCanvas() {
    const size = this.textureSize;
    const canvas = this._sdfCanvas;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, size, size);

    const { minLon, maxLon, minLat, maxLat, cartographics } = this._computeBounds();

    const getXY = (lon, lat) => {
      const x = ((lon - minLon) / (maxLon - minLon)) * size;
      const y = (1.0 - ((lat - minLat) / (maxLat - minLat))) * size;
      return { x, y };
    };

    ctx.beginPath();
    const start = getXY(cartographics[0].longitude, cartographics[0].latitude);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < cartographics.length; i++) {
      const pt = getXY(cartographics[i].longitude, cartographics[i].latitude);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const steps = 30;
    for (let i = steps; i >= 1; i--) {
      ctx.lineWidth = (i / steps) * 40;
      const alpha = 1.0 - (i / steps);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.15})`;
      ctx.stroke();
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 1.0)';
    ctx.stroke();

    return canvas;
  }

  // 干净的水域内部掩膜：仅多边形内部为白色(255)，岸线外一律黑色(0)。
  // 与 SDF(仅描边、含内外羽化)不同，此图用于把流向箭头精确约束在河道内部。
  _createMaskCanvas() {
    const size = this.textureSize;
    const canvas = this._maskCanvas;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    const { minLon, maxLon, minLat, maxLat, cartographics } = this._computeBounds();
    const getXY = (lon, lat) => {
      const x = ((lon - minLon) / (maxLon - minLon)) * size;
      const y = (1.0 - ((lat - minLat) / (maxLat - minLat))) * size;
      return { x, y };
    };

    ctx.beginPath();
    const start = getXY(cartographics[0].longitude, cartographics[0].latitude);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < cartographics.length; i++) {
      const pt = getXY(cartographics[i].longitude, cartographics[i].latitude);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    return canvas;
  }

  _createFlowmapCanvas() {
    const size = this.textureSize;
    const canvas = this._flowmapCanvas;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgb(127, 127, 255)';
    ctx.fillRect(0, 0, size, size);

    const lines = this._extractLinesFromGeoJSON(this.centerlineGeoJson);
    if (lines.length === 0) return canvas;

    const { minLon, maxLon, minLat, maxLat, cartographics } = this._computeBounds();

    const getXYFromRad = (lonRad, latRad) => {
      const x = ((lonRad - minLon) / (maxLon - minLon)) * size;
      const y = (1.0 - ((latRad - minLat) / (maxLat - minLat))) * size;
      return { x, y };
    };
    const getXYFromDeg = (lonDeg, latDeg) => {
      return getXYFromRad(Cesium.Math.toRadians(lonDeg), Cesium.Math.toRadians(latDeg));
    };

    ctx.beginPath();
    const start = getXYFromRad(cartographics[0].longitude, cartographics[0].latitude);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < cartographics.length; i++) {
      const pt = getXYFromRad(cartographics[i].longitude, cartographics[i].latitude);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();

    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    const segments = [];
    lines.forEach(lineCoords => {
      for (let i = 0; i < lineCoords.length - 1; i++) {
        const p1 = getXYFromDeg(lineCoords[i][0], lineCoords[i][1]);
        const p2 = getXYFromDeg(lineCoords[i + 1][0], lineCoords[i + 1][1]);

        const canvas_dx = p2.x - p1.x;
        const canvas_dy = p2.y - p1.y;
        const lengthSq = canvas_dx * canvas_dx + canvas_dy * canvas_dy;
        if (lengthSq === 0) continue;

        const vector_dx = p2.x - p1.x;
        const vector_dy = p1.y - p2.y;
        const len = Math.sqrt(vector_dx * vector_dx + vector_dy * vector_dy);

        let curvature = 0.0;
        if (i < lineCoords.length - 2) {
          const p3 = getXYFromDeg(lineCoords[i + 2][0], lineCoords[i + 2][1]);
          const next_dx = p3.x - p2.x;
          const next_dy = p3.y - p2.y;
          const ang1 = Math.atan2(canvas_dy, canvas_dx);
          const ang2 = Math.atan2(next_dy, next_dx);
          let diff = ang2 - ang1;
          curvature = Math.atan2(Math.sin(diff), Math.cos(diff));
        }

        segments.push({
          p1, p2,
          dx: canvas_dx,
          dy: canvas_dy,
          lengthSq,
          minX: Math.min(p1.x, p2.x),
          maxX: Math.max(p1.x, p2.x),
          minY: Math.min(p1.y, p2.y),
          maxY: Math.max(p1.y, p2.y),
          dirR: Math.floor((vector_dx / len * 0.5 + 0.5) * 255),
          dirG: Math.floor((vector_dy / len * 0.5 + 0.5) * 255),
          curvature: curvature
        });
      }
    });

    const segCount = segments.length;

    // 关键调优参数
    const SEG_BLEND_RADIUS = 24.0;    // 邻接分段流向混合半径（消除折角接缝）
    const DYNAMIC_SMOOTH_WIDTH = 180.0; // 适配超宽流道的流速过渡带宽（从12像素大幅扩容至180像素）

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const index = (y * size + x) * 4;

        if (data[index] === 255) {
          let minD1 = Infinity;
          let minD2 = Infinity;
          let seg1 = null;
          let seg2 = null;

          // 优化 1：不引入额外过滤盒，保证超宽河段两岸像素都能认领到最近中心线
          for (let i = 0; i < segCount; i++) {
            const seg = segments[i];

            let t = ((x - seg.p1.x) * seg.dx + (y - seg.p1.y) * seg.dy) / seg.lengthSq;
            t = Math.max(0, Math.min(1, t));

            const projX = seg.p1.x + t * seg.dx;
            const projY = seg.p1.y + t * seg.dy;
            const distSq = (x - projX) * (x - projX) + (y - projY) * (y - projY);

            if (distSq < minD1) {
              minD2 = minD1;
              seg2 = seg1;
              minD1 = distSq;
              seg1 = seg;
            } else if (distSq < minD2) {
              minD2 = distSq;
              seg2 = seg;
            }
          }

          let finalR = 127;
          let finalG = 127;
          let meanderFactor = 1.0;

          if (seg1) {
            const d1 = Math.sqrt(minD1);
            let blendedVx = (seg1.dirR / 255.0) * 2.0 - 1.0;
            let blendedVy = (seg1.dirG / 255.0) * 2.0 - 1.0;
            let blendedCurvature = seg1.curvature;

            // 分段间流向邻接平滑
            if (seg2) {
              const d2 = Math.sqrt(minD2);
              const distDiff = d2 - d1;
              if (distDiff < SEG_BLEND_RADIUS) {
                const weight = distDiff / SEG_BLEND_RADIUS;
                const smoothWeight = weight * weight * (3.0 - 2.0 * weight);
                const vx2 = (seg2.dirR / 255.0) * 2.0 - 1.0;
                const vy2 = (seg2.dirG / 255.0) * 2.0 - 1.0;

                blendedVx = Cesium.Math.lerp(vx2, blendedVx, smoothWeight);
                blendedVy = Cesium.Math.lerp(vy2, blendedVy, smoothWeight);
                blendedCurvature = Cesium.Math.lerp(seg2.curvature, seg1.curvature, smoothWeight);
              }
            }

            const len = Math.sqrt(blendedVx * blendedVx + blendedVy * blendedVy);
            if (len > 0.001) {
              finalR = Math.floor((blendedVx / len * 0.5 + 0.5) * 255);
              finalG = Math.floor((blendedVy / len * 0.5 + 0.5) * 255);
            } else {
              finalR = seg1.dirR;
              finalG = seg1.dirG;
            }

            // 优化 2：宽流道横向流速连续过渡
            if (Math.abs(blendedCurvature) > 0.01) {
              const segLen = Math.sqrt(seg1.lengthSq);
              const cross = seg1.dx * (y - seg1.p1.y) - seg1.dy * (x - seg1.p1.x);
              const perpDist = cross / segLen; // 带正负号的垂直距离

              // 按曲率方向区分凸岸与凹岸因子
              const sideFactor = perpDist * Math.sign(blendedCurvature);

              // 归一化到 [-1, 1]，利用大带宽 DYNAMIC_SMOOTH_WIDTH 保证整个宽江大河都有渐变
              const normDist = Cesium.Math.clamp(sideFactor / DYNAMIC_SMOOTH_WIDTH, -1.0, 1.0);

              // 使用正弦缓动替代硬夹断，使中心线附近的流速过渡更加细腻平滑
              const smoothT = Math.sin(normDist * Math.PI * 0.5) * 0.5 + 0.5;

              // 从内弯慢速(0.65)到外弯快速(1.35)实现无缝丝滑过渡
              meanderFactor = Cesium.Math.lerp(0.65, 1.35, smoothT);
            }
          }

          data[index] = finalR;
          data[index + 1] = finalG;
          data[index + 2] = Math.floor(Cesium.Math.clamp(meanderFactor * 127.0, 0.0, 255.0));
        } else {
          // 非水体区保持中值基色
          data[index] = 127;
          data[index + 1] = 127;
          data[index + 2] = 127;
        }
      }
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = size;
    tempCanvas.height = size;
    tempCanvas.getContext('2d').putImageData(imageData, 0, 0);

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgb(127, 127, 255)';
    ctx.fillRect(0, 0, size, size);

    // 适度进行高斯模糊，让写入 WebGL 纹理的矢量方向和速率彻底消除像素锯齿
    ctx.filter = 'blur(5px)';
    ctx.drawImage(tempCanvas, 0, 0);

    return canvas;
  }

  // 【性能调优】：移除内层临时对象分配与浅拷贝，改用静态结果接收变量
  _getMeteorColor(speedFactor, resultColor) {
    const d = Cesium.Math.clamp((speedFactor - 0.65) / (1.35 - 0.65), 0.0, 1.0);
    const stops = this._parsedColorStops;

    if (d <= stops[0].stop) return Cesium.Color.clone(stops[0].color, resultColor);
    if (d >= stops[stops.length - 1].stop) return Cesium.Color.clone(stops[stops.length - 1].color, resultColor);

    for (let i = 0; i < stops.length - 1; i++) {
      if (d >= stops[i].stop && d <= stops[i + 1].stop) {
        const t = (d - stops[i].stop) / (stops[i + 1].stop - stops[i].stop);
        const smoothT = t * t * (3.0 - 2.0 * t);
        return Cesium.Color.lerp(stops[i].color, stops[i + 1].color, smoothT, resultColor);
      }
    }
    return Cesium.Color.clone(Cesium.Color.YELLOW, resultColor);
  }

  // ==========================================
  // 【超核级性能重构】：单管道零分配扫描网格
  // ==========================================
  _initMeteors() {
    const size = this.textureSize;
    const canvas = this._flowmapCanvas;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;

    const { minLon, maxLon, minLat, maxLat } = this._computeBounds();
    const spacing = this.params.meteorSpacing;

    // ---- 流向箭头收敛到精确河道内部 ----
    // 旧实现只跳过精确等于 (127,127,127) 的像素；但流向贴图烘焙后做了 5px
    // 高斯模糊，模糊会把河道白色向外扩散一圈，岸线外的过渡像素不等于中性值，
    // 导致大量箭头生成在水面范围之外。这里以「干净的水域内部掩膜」过滤：
    // 箭头四边形覆盖的每个像素都必须落在河道内部，整支箭头才允许生成。
    this._createMaskCanvas();
    const maskCtx = this._maskCanvas.getContext('2d');
    const maskImage = maskCtx.getImageData(0, 0, size, size);
    const maskPx = maskImage.data;
    const inside = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      inside[i] = maskPx[i * 4] > 200 ? 1 : 0;
    }

    const L = this.params.meteorLength;
    const W = this.params.meteorWidth;
    const halfL = L / 2;
    const halfW = W / 2;
    const R_EARTH = 6378137.0;
    let sdx = 0.0;
    let sdy = 0.0;

    // 检查整支箭头四边形的纹理覆盖范围是否完全在河道内部掩膜中
    const quadFitsInside = (lonRad, latRad, dirX, dirY) => {
      const cosLat = Math.cos(latRad) || 1e-9;
      const rightX = -dirY;
      const rightY = dirX;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 4; k++) {
        const along = k < 2 ? -halfL : halfL;
        const side = k % 2 === 0 ? -halfW : halfW;
        const e = dirX * along + rightX * side;
        const n = dirY * along + rightY * side;
        const lon = lonRad + e / (R_EARTH * cosLat);
        const lat = latRad + n / R_EARTH;
        const px = ((lon - minLon) / (maxLon - minLon)) * size;
        const py = (1.0 - ((lat - minLat) / (maxLat - minLat))) * size;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
      const bx0 = Math.max(0, Math.floor(x0));
      const bx1 = Math.min(size - 1, Math.ceil(x1));
      const by0 = Math.max(0, Math.floor(y0));
      const by1 = Math.min(size - 1, Math.ceil(y1));
      for (let yy = by0; yy <= by1; yy++) {
        const rowBase = yy * size;
        for (let xx = bx0; xx <= bx1; xx++) {
          if (inside[rowBase + xx] === 0) return false;
        }
      }
      return true;
    };

    // 单元格判定：流向非中性且非静止、箭头整体落在河道内部；通过时回写方向
    const sample = (index, lonRad, latRad) => {
      if (data[index] === 127 && data[index + 1] === 127 && data[index + 2] === 127) return false;
      const vx = (data[index] / 255.0) * 2.0 - 1.0;
      const vy = (data[index + 1] / 255.0) * 2.0 - 1.0;
      const lenSq = vx * vx + vy * vy;
      if (lenSq < 0.0025) return false;
      const len = Math.sqrt(lenSq);
      sdx = vx / len;
      sdy = vy / len;
      return quadFitsInside(lonRad, latRad, sdx, sdy);
    };

    // 首轮统计，精准分配缓冲区
    let mCount = 0;
    for (let y = spacing; y < size; y += spacing) {
      for (let x = spacing; x < size; x += spacing) {
        const index = (y * size + x) * 4;
        const lonRad = minLon + (x / size) * (maxLon - minLon);
        const latRad = minLat + (1.0 - (y / size)) * (maxLat - minLat);
        if (sample(index, lonRad, latRad)) mCount++;
      }
    }

    if (mCount === 0) return;

    // 精准一次性分配固定内存
    const posArray = new Float64Array(mCount * 4 * 3);
    const stArray = new Float32Array(mCount * 4 * 2);
    const colArray = new Uint8Array(mCount * 4 * 4);
    const speedArray = new Float32Array(mCount * 4);
    const idxArray = new Uint32Array(mCount * 6);

    let vIdx = 0;
    let iIdx = 0;

    const localPoints = [new Cesium.Cartesian3(), new Cesium.Cartesian3(), new Cesium.Cartesian3(), new Cesium.Cartesian3()];
    const worldPoint = new Cesium.Cartesian3();
    const scratchColor = new Cesium.Color();
    const scratchCartesian = new Cesium.Cartesian3();
    const enuMat = new Cesium.Matrix4();

    // 核心填充单次扫描（与首轮同条件，绝不在水面外生成）
    for (let y = spacing; y < size; y += spacing) {
      for (let x = spacing; x < size; x += spacing) {
        const index = (y * size + x) * 4;
        const lonRad = minLon + (x / size) * (maxLon - minLon);
        const latRad = minLat + (1.0 - (y / size)) * (maxLat - minLat);

        if (!sample(index, lonRad, latRad)) continue;

        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const meanderFactor = b / 127.0;
        const dirX = sdx;
        const dirY = sdy;

        // 使用高精度零分配方法填充局部东北天(ENU)矩阵
        Cesium.Cartesian3.fromRadians(lonRad, latRad, this.height, Cesium.Ellipsoid.WGS84, scratchCartesian);
        Cesium.Transforms.eastNorthUpToFixedFrame(scratchCartesian, Cesium.Ellipsoid.WGS84, enuMat);

        const localRightX = -dirY;
        const localRightY = dirX;

        const tailX = -dirX * L / 2, tailY = -dirY * L / 2;
        const headX = dirX * L / 2, headY = dirY * L / 2;

        localPoints[0].x = tailX - localRightX * W / 2; localPoints[0].y = tailY - localRightY * W / 2;
        localPoints[1].x = tailX + localRightX * W / 2; localPoints[1].y = tailY + localRightY * W / 2;
        localPoints[2].x = headX - localRightX * W / 2; localPoints[2].y = headY - localRightY * W / 2;
        localPoints[3].x = headX + localRightX * W / 2; localPoints[3].y = headY + localRightY * W / 2;

        this._getMeteorColor(meanderFactor, scratchColor);
        const cR = Math.round(scratchColor.red * 255);
        const cG = Math.round(scratchColor.green * 255);
        const cB = Math.round(scratchColor.blue * 255);
        const randomPhase = Math.floor(Math.random() * 256);

        const calculatedSpeed = meanderFactor * this.params.flowSpeed;
        const baseV = vIdx;

        for (let k = 0; k < 4; k++) {
          localPoints[k].z = 0.5;
          Cesium.Matrix4.multiplyByPoint(enuMat, localPoints[k], worldPoint);

          const pIdx = vIdx * 3;
          posArray[pIdx] = worldPoint.x;
          posArray[pIdx + 1] = worldPoint.y;
          posArray[pIdx + 2] = worldPoint.z;

          const sIdx = vIdx * 2;
          stArray[sIdx] = k < 2 ? 0.0 : 1.0;
          stArray[sIdx + 1] = k % 2 === 0 ? 0.0 : 1.0;

          const colIdx = vIdx * 4;
          colArray[colIdx] = cR;
          colArray[colIdx + 1] = cG;
          colArray[colIdx + 2] = cB;
          colArray[colIdx + 3] = randomPhase;

          speedArray[vIdx] = calculatedSpeed;
          vIdx++;
        }

        idxArray[iIdx++] = baseV + 0; idxArray[iIdx++] = baseV + 1; idxArray[iIdx++] = baseV + 2;
        idxArray[iIdx++] = baseV + 1; idxArray[iIdx++] = baseV + 3; idxArray[iIdx++] = baseV + 2;
      }
    }

    const geometry = new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: posArray }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: stArray }),
        color: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE, componentsPerAttribute: 4, values: colArray, normalize: true }),
        speed: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 1, values: speedArray })
      },
      indices: idxArray,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: this._cachedBoundingSphere
    });

    this.meteorPrimitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: geometry }),
      appearance: new Cesium.Appearance({
        renderState: {
          blending: Cesium.BlendingState.ADDITIVE_BLEND,
          depthTest: { enabled: true },
          cull: { enabled: false }
        },
        vertexShaderSource: `
          in vec3 position3DHigh;
          in vec3 position3DLow;
          in vec2 st;
          in vec4 color;
          in float speed; 
          in float batchId; 
          out vec2 v_st;
          out vec4 v_color;
          out float v_speed; 
          void main() {
              vec4 p = czm_computePosition();
              gl_Position = czm_modelViewProjectionRelativeToEye * p;
              v_st = st;
              v_color = color;
              v_speed = speed;
          }
        `,
        fragmentShaderSource: `
          in vec2 v_st;
          in vec4 v_color;
          in float v_speed; 
          void main() {
              vec3 baseCol = v_color.rgb;
              float phase = v_color.a; 
              float y = (v_st.y - 0.5) * 2.0; 
              
              float headOffset = 0.05; 
              float tailLen = ${this.params.tailLength.toFixed(2)}; 
              float anim = float(czm_frameNumber) * 0.018 * v_speed + phase; 
              
              // 同一 quad 内两个半周期错开的柔化彗星，消除单周期带来的颗粒感
              float q1 = fract(anim - v_st.x);
              float q2 = fract(anim + 0.5 - v_st.x);
              
              float shape = 0.0;
              float core = 0.0;
              
              for (int i = 0; i < 2; i++) {
                  float q = i == 0 ? q1 : q2;
                  float dx = q - headOffset;
                  float s = 0.0;
                  float c = 0.0;
                  if (dx <= 0.0) {
                      float r = length(vec2(dx / headOffset, y * 0.9));
                      s = smoothstep(1.0, 0.25, r); 
                      c = smoothstep(0.7, 0.0, r) * 0.5;  
                  } else if (dx < tailLen) {
                      float tFront = dx / tailLen;
                      float widthCurve = pow(1.0 - tFront, 0.8); 
                      float r = abs(y) / (widthCurve + 0.035);
                      float fadeOut = mix(0.3, 1.0, pow(1.0 - tFront, 1.5)); 
                      s = smoothstep(1.2, 0.4, r) * fadeOut;
                      c = smoothstep(0.9, 0.2, r) * pow(1.0 - tFront, 1.0) * 0.32;
                  }
                  shape = max(shape, s);
                  core = max(core, c);
              }
              
              vec3 hot = baseCol + vec3(0.6); 
              vec3 finalColor = mix(baseCol, hot, core); 
              float alpha = shape * ${this.params.meteorAlpha.toFixed(2)};
              
              if (alpha < 0.02) discard;
              out_FragColor = vec4(finalColor * alpha, alpha); 
          }
        `
      }),
      show: this.params.showMeteor,
      asynchronous: false
    });

    this.viewer.scene.primitives.add(this.meteorPrimitive);
  }

  _init() {
    if (!this.positions || this.positions.length < 3) return;

    const sdfCanvasTexture = this._createSDFCanvas();
    const flowmapCanvasTexture = this._createFlowmapCanvas();

    const vs = `
      in vec3 position3DHigh;
      in vec3 position3DLow;
      in vec3 normal;
      in vec2 st;
      in float batchId;

      out vec3 v_positionEC;
      out vec3 v_normalEC;
      out vec3 v_tangentEC;
      out vec3 v_binormalEC;
      out vec2 v_st;

      void main() {
          vec4 p = czm_translateRelativeToEye(position3DHigh, position3DLow);
          p = czm_modelViewRelativeToEye * p;

          vec3 normalEC = normalize(czm_normal * normal);
          vec3 tangentEC = normalize(cross(vec3(0.0, 1.0, 0.0), normalEC));
          if(length(tangentEC) < 0.1) {
              tangentEC = normalize(cross(vec3(1.0, 0.0, 0.0), normalEC));
          }
          vec3 binormalEC = normalize(cross(normalEC, tangentEC));

          v_positionEC = p.xyz;
          v_normalEC = normalEC;
          v_tangentEC = tangentEC;
          v_binormalEC = binormalEC;
          v_st = st;

          gl_Position = czm_projection * p;
      }`

    const fs = `
      in vec3 v_positionEC;
      in vec3 v_normalEC;
      in vec3 v_tangentEC;
      in vec3 v_binormalEC;
      in vec2 v_st;

      const int k_fmbWaterSteps = 3;
      const vec2 MOD2 = vec2(4.438975, 3.972973);

      float Hash(float p) {
          vec2 p2 = fract(vec2(p) * MOD2);
          p2 += dot(p2.yx, p2.xy + 19.19);
          return fract(p2.x * p2.y);    
      }
      vec2 Hash2(float p) {
          vec3 p3 = fract(vec3(p) * vec3(.1031, .1030, .0973));
          p3 += dot(p3, p3.yzx + 19.19);
          return fract((p3.xx + p3.yz) * p3.zy);
      }
      float SmoothNoise(in vec2 o) {
          vec2 p = floor(o); vec2 f = fract(o); float n = p.x + p.y * 57.0;
          float a = Hash(n +  0.0); float b = Hash(n +  1.0); float c = Hash(n + 57.0); float d = Hash(n + 58.0);
          vec2 f2 = f * f; vec2 f3 = f2 * f; vec2 t = 3.0 * f2 - 2.0 * f3; float u = t.x; float v = t.y;
          return a + (b - a) * u + (c - a) * v + (a - b + d - c) * u * v;
      }
      vec3 SmoothNoise_DXY(in vec2 o) {
          vec2 p = floor(o); vec2 f = fract(o); float n = p.x + p.y * 57.0;
          float a = Hash(n +  0.0); float b = Hash(n +  1.0); float c = Hash(n + 57.0); float d = Hash(n + 58.0);
          vec2 f2 = f * f; vec2 f3 = f2 * f; vec2 t = 3.0 * f2 - 2.0 * f3; vec2 dt = 6.0 * f - 6.0 * f2; 
          float u = t.x; float v = t.y; float du = dt.x; float dv = dt.y;   
          float res = a + (b - a) * u + (c - a) * v + (a - b + d - c) * u * v;
          float dx = (b - a) * du + (a - b + d - c) * du * v; float dy = (c - a) * dv + (a - b + d - c) * u * dv;    
          return vec3(dx, dy, res);
      }
      vec3 FBM_DXY(vec2 p, vec2 flow, float ps, float df) {
          vec3 f = vec3(0.0); float tot = 0.0; float a = 1.0;
          for(int i = 0; i < k_fmbWaterSteps; i++) {
              p += flow; flow *= -0.75; vec3 v = SmoothNoise_DXY(p);
              f += v * a; p += v.xy * df; p *= 2.0; tot += a; a *= ps;
          }
          return f / tot;
      }

      vec3 GetFlowRate(const vec2 vPos, const vec2 st, float baseMask) {
          vec3 flowColor = getDynFlowColor(st); 
          vec2 dynamicFlowDir = flowColor.xy * 2.0 - 1.0; 
          
          float meanderVelocityMultiplier = flowColor.z * 2.0;

          if (length(dynamicFlowDir) > 0.05) {
              dynamicFlowDir = normalize(dynamicFlowDir) * getDynFlowMultiplier();
          } else {
              dynamicFlowDir = vec2(0.0);
          }

          float distanceToShore = 1.0 - baseMask;
          float turbulentProfile = pow(max(distanceToShore, 0.0), 1.0 / 7.0);
          float manningDepthFactor = pow(max(distanceToShore, 0.0), 2.0 / 3.0);

          float physicalSpeedWeight = turbulentProfile * manningDepthFactor * meanderVelocityMultiplier;
          dynamicFlowDir *= physicalSpeedWeight; 

          vec2 vBaseFlow = dynamicFlowDir;
          vec2 noiseDistortion = SmoothNoise_DXY(vPos * 0.2).xy * 0.3;
          vec2 vFlow = vBaseFlow + noiseDistortion;

          float fFoamScale1 = 0.5; float fFoamCutoff = 0.4;
          float fFoam = abs(length(vFlow)) * fFoamScale1;
          fFoam += clamp(fFoam - fFoamCutoff, 0.0, 1.0);
          return vec3(vFlow * 0.6, fFoam);
      }

      vec4 SampleWaterNormal(vec2 vUV, vec2 vFlowOffset, float fMag, float fFoam) {    
          vec2 vFilterWidth = max(abs(dFdx(vUV)), abs(dFdy(vUV)));
          float fFilterWidth = max(vFilterWidth.x, vFilterWidth.y);
          // 斜视 UV 导数变大会把 fScale 压到接近 0，波纹法线被抹平；保留最低混比
          float fScale = 1.0 / (1.0 + fFilterWidth * fFilterWidth * 600.0);
          fScale = max(fScale, 0.62);
          float fGradientAscent = 0.25 + (fFoam * -1.5);
          vec3 dxy = FBM_DXY(vUV * 20.0, vFlowOffset * 20.0, 0.75 + fFoam * 0.25, fGradientAscent);
          fScale *= max(0.45, 1.0 - fFoam * 5.0); 
          vec3 vBlended = mix(vec3(0.0, 1.0, 0.0), normalize(vec3(dxy.x, fMag, dxy.y)), fScale);
          return vec4(normalize(vBlended), dxy.z * fScale);
      }

      float SampleWaterFoam(vec2 vUV, vec2 vFlowOffset, float fFoam) {
          float f = FBM_DXY(vUV * 30.0, vFlowOffset * 50.0, 0.8, -0.5).z;
          float fAmount = 0.2; f = max(0.0, (f - fAmount) / fAmount); return pow(0.5, f);
      }

      // ================= 几何镜面抗锯齿 =================
      // 水面法线是高频 FBM，一个像素里往往盖了几十上百个波。用单点法线去算
      // pow(dot(N,H), 220) 这种极窄高光瓣，法线抖一点结果就在 0/1 之间跳，
      // 表现为密集白点逐帧闪烁（放大看尤其明显）。
      //
      // 做法（Tokuyoshi & Kaplanyan 2019）：用法线的屏幕空间导数估计像素内的
      // 法线锥宽度，把它当成「额外粗糙度」加宽高光瓣，同时按能量守恒压低峰值。
      // 近处导数小 → 几乎不改；远处导数大 → 高光自动积分成柔和的一片。
      // 关键是必须配能量守恒：只放宽不压峰值，水面会糊成一片惨白。
      //
      // 返回滤波后的 shininess，能量缩放因子从 fOutEnergy 带出。
      float FilterShininess(vec3 vNormal, float fShininess, float fStrength, out float fOutEnergy) {
          vec3 dndx = dFdx(vNormal);
          vec3 dndy = dFdy(vNormal);
          // 0.25 = 屏幕空间高斯核方差 sigma^2
          float fVariance = 0.25 * (dot(dndx, dndx) + dot(dndy, dndy));
          // Blinn-Phong 的 shininess 换算成 GGX 粗糙度平方
          float fAlpha2 = 2.0 / (fShininess + 2.0);
          // 上限防止近景被过度模糊（法线锥再宽也不至于变成朗伯面）
          float fKernel = min(2.0 * fVariance * fStrength, 0.18);
          float fFiltered = clamp(fAlpha2 + fKernel, 0.0, 1.0);
          float fOut = max(2.0 / fFiltered - 2.0, 1.0);
          // Blinn-Phong 归一化常数正比于 (s+2)，瓣变宽多少就把峰值压多少
          fOutEnergy = (fOut + 2.0) / (fShininess + 2.0);
          return fOut;
      }

      vec4 SampleFlowingNormal(const vec2 vUV, const vec2 vFlowRate, const float fFoam, const float time, out float fOutFoamTex) {
          float fMag = 2.5 / (1.0 + dot(vFlowRate, vFlowRate) * 5.0);
          float t0 = fract(time); float t1 = fract(time + 0.5); float i0 = floor(time); float i1 = floor(time + 0.5);
          float o0 = t0 - 0.5; float o1 = t1 - 0.5;
          vec2 vUV0 = vUV + Hash2(i0); vec2 vUV1 = vUV + Hash2(i1);
          vec4 sample0 = SampleWaterNormal(vUV0, vFlowRate * o0, fMag, fFoam); vec4 sample1 = SampleWaterNormal(vUV1, vFlowRate * o1, fMag, fFoam);
          float weight = abs(t0 - 0.5) * 2.0;
          float foam0 = SampleWaterFoam(vUV0, vFlowRate * o0 * 0.25, fFoam); float foam1 = SampleWaterFoam(vUV1, vFlowRate * o1 * 0.25, fFoam);
          vec4 result = mix(sample0, sample1, weight); result.xyz = normalize(result.xyz); fOutFoamTex = mix(foam0, foam1, weight);
          return result;
      }

      void main() {
          float time = mod(float(czm_frameNumber), 20000.0) * 0.016 * getDynSpeed();
          vec3 viewDir = normalize(-v_positionEC);
          vec3 lightDir = normalize(czm_sunDirectionEC);
          vec2 uv = (v_st - 0.5) * getDynUvScale();
          
          float baseMask = getDynShoreMask(v_st);
          float shoreMask = pow(baseMask, 1.0 / getDynShoreWidth());
          shoreMask *= (0.5 + 0.5 * FBM_DXY(uv * 15.0, vec2(0.0), 0.6, 0.0).z);

          vec3 vFlowRateAndFoam = GetFlowRate(uv, v_st, baseMask);
          vec2 vFlowRate = vFlowRateAndFoam.xy;
          float fFoamBase = vFlowRateAndFoam.z;
          
          float fFoamScale = getDynFoamScale();
          float fFoamOffset = getDynFoamOffset();
          float fFoam = clamp((fFoamBase - fFoamOffset) * fFoamScale, 0.0, 1.0);
          
          fFoam = fFoam * pow(shoreMask, 0.8); 
          fFoam = fFoam * fFoam * 0.5;

          float fWaterFoamTex = 1.0;
          vec4 vWaterNormalAndHeight = SampleFlowingNormal(uv, vFlowRate, fFoam, time, fWaterFoamTex);
          vec3 localNorm = vWaterNormalAndHeight.xyz;

          vec3 t = normalize(v_tangentEC); vec3 b = normalize(v_binormalEC); vec3 n = normalize(v_normalEC);
          float NdotV_geo = max(dot(n, viewDir), 0.0);

          // 旧逻辑按视距把法线压到 0.08，斜视远处会出现水平分界、细节全丢
          float viewDist = length(v_positionEC);
          float distFade = clamp(1.0 - max(viewDist - 15000.0, 0.0) / 25000.0, 0.88, 1.0);
          // 斜视掠射角补偿：视角越斜，略加强波纹法线，与正视细节对齐
          float obliqueBoost = mix(1.55, 1.0, smoothstep(0.08, 0.42, NdotV_geo));
          localNorm.xz *= distFade * obliqueBoost;
          localNorm = normalize(localNorm);

          vec3 finalNormal = normalize(localNorm.x * t + localNorm.z * b + localNorm.y * n);

          vec3 deepColor = getDynDeepColor();
          vec3 shallowColor = getDynShallowColor();
          vec3 waterBaseCol = mix(deepColor, shallowColor, shoreMask);

          // 抑制斜视乳白：Fresnel 只混少量偏水色天空反射，不压法线/高光
          float fresnel = pow(1.0 - NdotV_geo, getDynFresnelPower());
          float fresnelMix = fresnel * getDynFresnelIntensity();
          fresnelMix *= mix(0.35, 1.0, pow(clamp(NdotV_geo, 0.0, 1.0), 0.55));
          vec3 skyColor = getDynSkyColor();
          vec3 reflectCol = mix(waterBaseCol * 1.1, skyColor, 0.35);
          vec3 color = mix(waterBaseCol, reflectCol, fresnelMix);

          // 法线调制基色：斜视也能看到流动明暗纹，不只靠高光
          float rippleLight = 0.86 + 0.14 * max(dot(finalNormal, lightDir), 0.0);
          rippleLight += 0.06 * max(dot(finalNormal, viewDir), 0.0);
          color *= rippleLight;

          // 太阳高光：先按像素内法线锥宽度把高光瓣滤一遍，再算 —— 否则窄瓣 +
          // 高频法线 = 逐帧闪烁的白点
          float fSpecAA = getDynSpecularAA();
          float fSunEnergy;
          float fSunShininess = FilterShininess(finalNormal, getDynSpecShininess(), fSpecAA, fSunEnergy);
          vec3 H = normalize(lightDir + viewDir);
          float spec = pow(max(dot(finalNormal, H), 0.0), fSunShininess) * fSunEnergy;
          float specBoost = mix(1.5, 1.0, smoothstep(0.12, 0.5, NdotV_geo));
          color += spec * getDynSpecColor() * getDynSpecIntensity() * specBoost;

          // 环境高光同理（它的瓣是太阳的 0.55 倍宽，一样会闪）
          float fAmbEnergy;
          float fAmbShininess = FilterShininess(finalNormal, getDynSpecShininess() * 0.55, fSpecAA, fAmbEnergy);
          vec3 H_amb = normalize(n + viewDir);
          float ambSpec = pow(max(dot(finalNormal, H_amb), 0.0), fAmbShininess) * fAmbEnergy;
          color += ambSpec * getDynSpecColor() * (getDynSpecIntensity() * 0.32);

          float fFoamBlend = 1.0 - pow(fWaterFoamTex, fFoam * 5.0);
          fFoamBlend = clamp(fFoamBlend, 0.0, 1.0);
          
          vec3 foamColor = vec3(0.9, 0.95, 1.0) * max(dot(finalNormal, lightDir), 0.45);
          color = mix(color, foamColor, fFoamBlend);

          color = (color * (0.010 * color + 0.132)) / (color * (0.010 * color + 0.163) + 0.101);
          color = color * getDynExposure(); 

          float depthAlpha = mix(getDynAlpha(), 0.0, pow(shoreMask, 2.2));
          float finalAlpha = depthAlpha;
          finalAlpha = mix(finalAlpha, max(finalAlpha, 0.8), fresnelMix * 0.3);
          finalAlpha += spec * getDynSpecIntensity() * 0.75 + ambSpec * (getDynSpecIntensity() * 0.28);
          finalAlpha = mix(finalAlpha, 1.0, fFoamBlend);
          finalAlpha = clamp(finalAlpha, 0.0, 1.0);

          vec3 finalWaterCol = mix(color, color * 1.4, shoreMask * 0.4);

          out_FragColor = vec4(finalWaterCol, finalAlpha);
      }`

    const instance = new Cesium.GeometryInstance({
      geometry: new Cesium.PolygonGeometry({
        polygonHierarchy: new Cesium.PolygonHierarchy(this.positions),
        height: this.height,
        vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
        granularity: Cesium.Math.toRadians(0.01)
      })
    })

    this._parseColors();

    // 波纹频率按物理尺寸换算：每段铺 (物理米数 / 目标波长) 个周期，
    // 使不同尺度河段的波纹疏密一致，且 x/y 各自换算消除拉伸变形
    const { widthMeters, heightMeters } = this._computeBounds();
    const uvScale = new Cesium.Cartesian2(
      widthMeters / this.rippleWavelength,
      heightMeters / this.rippleWavelength
    );

    const material = new Cesium.Material({
      fabric: {
        type: 'RiverWaterDynamicMaterial_Static',
        uniforms: {
          u_speed: this.params.speed,
          u_flowMultiplier: this.params.flowMultiplier,
          u_foamScale: this.params.foamScale,
          u_foamOffset: this.params.foamOffset,
          u_shoreWidth: this.params.shoreWidth,
          u_deepColor: this._cachedColors.deep,
          u_shallowColor: this._cachedColors.shallow,
          u_alpha: this.params.alpha,

          // 用 Cesium 内置静态占位符，避免内部克隆时报错
          u_sdfTexture: Cesium.Material.DefaultImageId,
          u_flowTexture: Cesium.Material.DefaultImageId,

          u_specularIntensity: this.params.specularIntensity,
          u_specularShininess: this.params.specularShininess,
          u_specularAA: this.params.specularAA,
          u_specularColor: this._cachedColors.specular,
          u_fresnelPower: this.params.fresnelPower,
          u_fresnelIntensity: this.params.fresnelIntensity,
          u_skyColor: this._cachedColors.sky,
          u_exposure: this.params.exposure,
          u_uvScale: uvScale
        },
        source: `
          float getDynSpeed() { return u_speed; }
          float getDynFlowMultiplier() { return u_flowMultiplier; } 
          float getDynFoamScale() { return u_foamScale; }
          float getDynFoamOffset() { return u_foamOffset; }
          float getDynShoreWidth() { return max(u_shoreWidth, 0.01); } 
          vec3 getDynDeepColor() { return u_deepColor.rgb; }
          vec3 getDynShallowColor() { return u_shallowColor.rgb; }
          float getDynAlpha() { return u_alpha; }

          float getDynSpecIntensity() { return u_specularIntensity; }
          float getDynSpecShininess() { return u_specularShininess; }
          float getDynSpecularAA() { return u_specularAA; }
          vec3 getDynSpecColor() { return u_specularColor.rgb; }
          float getDynFresnelPower() { return u_fresnelPower; }
          float getDynFresnelIntensity() { return u_fresnelIntensity; }
          vec3 getDynSkyColor() { return u_skyColor.rgb; }
          float getDynExposure() { return u_exposure; }
          vec2 getDynUvScale() { return u_uvScale; }

          float getDynShoreMask(vec2 st) {
              return texture(u_sdfTexture, st).r;
          }

          vec3 getDynFlowColor(vec2 st) {
              return texture(u_flowTexture, st).rgb;
          }
        `
      }
    })

    material.uniforms.u_sdfTexture = sdfCanvasTexture;
    material.uniforms.u_flowTexture = flowmapCanvasTexture;

    this.primitive = new Cesium.Primitive({
      geometryInstances: instance,
      appearance: new Cesium.Appearance({
        material: material,
        translucent: true,
        closed: false,
        renderState: {
          depthTest: { enabled: true },
          cull: { enabled: false },
          blending: Cesium.BlendingState.ALPHA_BLEND
        },
        vertexShaderSource: vs,
        fragmentShaderSource: fs
      }),
      asynchronous: true
    })

    this.viewer.scene.primitives.add(this.primitive);

    this._initMeteors();
  }

  _parseColors() {
    Cesium.Color.fromCssColorString(this.params.deepColor, this._cachedColors.deep);
    Cesium.Color.fromCssColorString(this.params.shallowColor, this._cachedColors.shallow);
    Cesium.Color.fromCssColorString(this.params.specularColor, this._cachedColors.specular);
    Cesium.Color.fromCssColorString(this.params.skyColor, this._cachedColors.sky);
  }

  updateUniforms() {
    if (!this.primitive || !this.primitive.appearance.material) return;
    const uniforms = this.primitive.appearance.material.uniforms;

    uniforms.u_speed = this.params.speed;
    uniforms.u_flowMultiplier = this.params.flowMultiplier;
    uniforms.u_foamScale = this.params.foamScale;
    uniforms.u_foamOffset = this.params.foamOffset;
    uniforms.u_shoreWidth = this.params.shoreWidth;
    uniforms.u_alpha = this.params.alpha;

    this._parseColors();

    uniforms.u_specularIntensity = this.params.specularIntensity;
    uniforms.u_specularShininess = this.params.specularShininess;
    uniforms.u_specularAA = this.params.specularAA;
    uniforms.u_fresnelPower = this.params.fresnelPower;
    uniforms.u_fresnelIntensity = this.params.fresnelIntensity;
    uniforms.u_exposure = this.params.exposure;

    if (this.meteorPrimitive) {
      this.meteorPrimitive.show = this.params.showMeteor;
    }
  }

  updateParams(newParams) {
    let needsMeteorRebuild = false;

    if (newParams.meteorLength !== undefined ||
      newParams.meteorWidth !== undefined ||
      newParams.flowSpeed !== undefined ||
      newParams.tailLength !== undefined ||
      newParams.meteorAlpha !== undefined ||
      newParams.meteorSpacing !== undefined) {
      needsMeteorRebuild = true;
    }

    Object.assign(this.params, newParams);
    this.updateUniforms();

    if (needsMeteorRebuild) {
      if (this._updateTimer) clearTimeout(this._updateTimer);
      this._updateTimer = setTimeout(() => {
        if (this.meteorPrimitive) {
          this.viewer.scene.primitives.remove(this.meteorPrimitive);
          this.meteorPrimitive = null;
        }
        this._initMeteors();
      }, 50);
    }
  }

  updateFlowmap() {
    if (!this.primitive || !this.primitive.appearance.material) return;

    const newFlowmapCanvas = this._createFlowmapCanvas();
    this.primitive.appearance.material.uniforms.u_flowTexture = newFlowmapCanvas;

    if (this.meteorPrimitive) {
      this.viewer.scene.primitives.remove(this.meteorPrimitive);
      this.meteorPrimitive = null;
    }
    this._initMeteors();

    if (this.debugCanvas) {
      const ctx = this.debugCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
      ctx.drawImage(newFlowmapCanvas, 0, 0);
    }
  }

  toggleDebugCanvas(show) {
    const host = this.viewer && this.viewer.container ? this.viewer.container : (this.debugHost || document.body);

    if (show) {
      if (!this.debugCanvas) {
        this.debugCanvas = document.createElement('canvas');
        this.debugCanvas.width = this.textureSize;
        this.debugCanvas.height = this.textureSize;

        this.debugCanvas.style.position = 'absolute';
        this.debugCanvas.style.top = '10px';
        this.debugCanvas.style.left = '10px';
        this.debugCanvas.style.width = '288px';
        this.debugCanvas.style.height = '288px';
        this.debugCanvas.style.border = '1px solid rgba(137, 210, 233, 0.65)';
        this.debugCanvas.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.45)';
        this.debugCanvas.style.zIndex = '9999';
        this.debugCanvas.style.pointerEvents = 'none';
        this.debugCanvas.style.imageRendering = 'pixelated';

        if (host !== document.body) {
          const style = window.getComputedStyle(host);
          if (style.position === 'static') {
            host.style.position = 'relative';
          }
        }
        host.appendChild(this.debugCanvas);
      }

      const currentFlowmap = this._createFlowmapCanvas();
      const ctx = this.debugCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
      ctx.drawImage(currentFlowmap, 0, 0);
    } else {
      if (this.debugCanvas && this.debugCanvas.parentNode) {
        this.debugCanvas.parentNode.removeChild(this.debugCanvas);
        this.debugCanvas = null;
      }
    }
  }

  flyToTest() {
    if (!this.positions || this.positions.length === 0) return;
    this.viewer.camera.flyToBoundingSphere(this._cachedBoundingSphere, {
      duration: 2.0,
      offset: new Cesium.HeadingPitchRange(0.0, Cesium.Math.toRadians(-45.0), this._cachedBoundingSphere.radius * 3.0)
    });
  }

  destroy() {
    if (this.debugCanvas && this.debugCanvas.parentNode) {
      this.debugCanvas.parentNode.removeChild(this.debugCanvas);
    }
    this.debugCanvas = null;

    if (this.viewer && this.primitive) {
      this.viewer.scene.primitives.remove(this.primitive)
    }
    this.primitive = null

    if (this.viewer && this.meteorPrimitive) {
      this.viewer.scene.primitives.remove(this.meteorPrimitive);
    }
    this.meteorPrimitive = null;

    this.bounds = null;
    this._sdfCanvas = null;
    this._flowmapCanvas = null;
  }
}