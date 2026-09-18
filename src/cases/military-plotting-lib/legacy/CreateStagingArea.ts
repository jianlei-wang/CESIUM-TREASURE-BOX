// @ts-nocheck
/*
 * 创建集结地
 * @Author: Wang jianLei
 * @Date: 2022-04-15 23:16:38
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-15 23:49:23
 */
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateStagingArea = function (viewer, resultList, options, callBack) {
  if (!viewer) throw new Error("no viewer object!");
  options = options || {};
  let id = options.id || setSessionid();
  if (viewer.entities.getById(id))
    throw new Error("the id parameter is an unique value");
  let color = options.color || Cesium.Color.RED;
  let toolTip = "左键单击开始绘制";
  let anchorpoints = [],
    pottingPoint = [];
  let polygon = undefined;

  let jjdPoints;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(function (event) {
    if (anchorpoints.length >= 1) {
      return;
    }
    let pixPos = event.position;
    toolTip = "右键完成绘制";
    let GeoPoints = createGeoPoints(viewer, [{ x: pixPos.x, y: pixPos.y }]);
    if (!GeoPoints.length) return;
    anchorpoints.push({
      x: GeoPoints[0],
      y: GeoPoints[1],
      z: GeoPoints[2],
    });
    pottingPoint.push(GeoPoints);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function updateGatheringPoints(w_p) {
    if (anchorpoints.length < 1) return;
    let GeoPoints = createGeoPoints(viewer, [{ x: w_p.x, y: w_p.y }]);
    if (!GeoPoints.length) return;
    if (anchorpoints.length < 2) {
      anchorpoints.push({ x: GeoPoints[0], y: GeoPoints[1], z: GeoPoints[2] });
      pottingPoint.push(GeoPoints);
    } else {
      anchorpoints.pop();
      pottingPoint.pop();
      anchorpoints.push({ x: GeoPoints[0], y: GeoPoints[1], z: GeoPoints[2] });
      pottingPoint.push(GeoPoints);
    }
    let GatheringPlacePoints = computeGatheringPlacePoints(anchorpoints);
    if (!GatheringPlacePoints || GatheringPlacePoints.length < 3) return;
    let CardinalPoints = createCloseCardinal(GatheringPlacePoints);
    let pixPos = calculatePointsFBZ3(CardinalPoints, 100);
    let GeoPoints1 = [];
    pixPos.forEach((item) => {
      if (item && isFinite(item.x) && isFinite(item.y)) {
        GeoPoints1.push(item.x, item.y, anchorpoints[0].z);
      }
    });
    if (GeoPoints1.length < 3) return;
    jjdPoints = GeoPoints1;
    if (!Cesium.defined(polygon)) {
      polygon = viewer.entities.add({
        id: id,
        name: "StagingArea",
        polygon: {
          hierarchy: new Cesium.CallbackProperty(function () {
            return new Cesium.PolygonHierarchy(
              Cesium.Cartesian3.fromDegreesArrayHeights(jjdPoints)
            );
          }, false),
          material: color,
        },
      });
      polygon.GeoType = "StagingArea";
    }
  }
  handler.setInputAction(function (event) {
    let w_p = event.endPosition;
    CreateRemindertip(toolTip, event.endPosition, true);
    updateGatheringPoints(w_p);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function (event) {
    CreateRemindertip(toolTip, event.position, false);
    if (!polygon) {
      updateGatheringPoints(event.position);
    }
    if (polygon) {
      polygon.pottingPoint = pottingPoint;
      resultList.push(polygon);
    }
    handler.destroy();
    polygon && callBack && callBack(polygon);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
};
/**
 * 生成集结地面状实体（无实际用法保留，防止破坏引用）
 */
/**
 * 生成闭合的样条点
 * @param points
 * @returns {*}
 */
function createCloseCardinal(points) {
  if (points == null || points.length < 3) {
    return points;
  }
  //获取起点，作为终点，以闭合曲线。
  let lastP = points[0];
  points.push(lastP);
  //定义传入的点数组，将在点数组中央（每两个点）插入两个控制点
  let cPoints = points;
  //包含输入点和控制点的数组
  let cardinalPoints = [];
  //至少三个点以上
  //这些都是相关资料测出的经验数值
  //定义张力系数，取值在0<t<0.5
  let t = 0.4;
  //为端点张力系数因子，取值在0<b<1
  // let b = 0.5;
  //误差控制，是一个大于等于0的数，用于三点非常趋近与一条直线时，减少计算量
  let e = 0.005;
  //传入的点数量，至少有三个，n至少为2
  let n = cPoints.length - 1;
  //从开始遍历到倒数第二个，其中倒数第二个用于计算起点（终点）的插值控制点
  for (let k = 0; k <= n - 1; k++) {
    let p0, p1, p2;
    //计算起点（终点）的左右控制点
    if (k == n - 1) {
      //三个基础输入点
      p0 = cPoints[n - 1];
      p1 = cPoints[0];
      p2 = cPoints[1];
    } else {
      p0 = cPoints[k];
      p1 = cPoints[k + 1];
      p2 = cPoints[k + 2];
    }
    //定义p1的左控制点和右控制点
    let p1l = { x: undefined, y: undefined };
    let p1r = { x: undefined, y: undefined };
    //通过p0、p1、p2计算p1点的做控制点p1l和又控制点p1r
    //计算向量p0_p1和p1_p2
    let p0_p1 = { x: p1.x - p0.x, y: p1.y - p0.y };
    let p1_p2 = { x: p2.x - p1.x, y: p2.y - p1.y };
    //并计算模
    let d01 = Math.sqrt(p0_p1.x * p0_p1.x + p0_p1.y * p0_p1.y);
    let d12 = Math.sqrt(p1_p2.x * p1_p2.x + p1_p2.y * p1_p2.y);
    //向量单位化
    let p0_p1_1 = { x: p0_p1.x / d01, y: p0_p1.y / d01 };
    let p1_p2_1 = { x: p1_p2.x / d12, y: p1_p2.y / d12 };
    //计算向量p0_p1和p1_p2的夹角平分线向量
    let p0_p1_p2 = { x: p0_p1_1.x + p1_p2_1.x, y: p0_p1_1.y + p1_p2_1.y };
    //计算向量 p0_p1_p2 的模
    let d012 = Math.sqrt(p0_p1_p2.x * p0_p1_p2.x + p0_p1_p2.y * p0_p1_p2.y);
    //单位化向量p0_p1_p2
    let p0_p1_p2_1 = { x: p0_p1_p2.x / d012, y: p0_p1_p2.y / d012 };
    //判断p0、p1、p2是否共线，这里判定向量p0_p1和p1_p2的夹角的余弦和1的差值小于e就认为三点共线
    let cosE_p0p1p2 = (p0_p1_1.x * p1_p2_1.x + p0_p1_1.y * p1_p2_1.y) / 1;
    //共线
    if (Math.abs(1 - cosE_p0p1p2) < e) {
      //计算p1l的坐标
      p1l.x = p1.x - p1_p2_1.x * d01 * t;
      p1l.y = p1.y - p1_p2_1.y * d01 * t;
      //计算p1r的坐标
      p1r.x = p1.x + p0_p1_1.x * d12 * t;
      p1r.y = p1.y + p0_p1_1.y * d12 * t;
    }
    //非共线
    else {
      //计算p1l的坐标
      p1l.x = p1.x - p0_p1_p2_1.x * d01 * t;
      p1l.y = p1.y - p0_p1_p2_1.y * d01 * t;
      //计算p1r的坐标
      p1r.x = p1.x + p0_p1_p2_1.x * d12 * t;
      p1r.y = p1.y + p0_p1_p2_1.y * d12 * t;
    }
    //记录起点（终点）的左右插值控制点及倒数第二个控制点
    if (k == n - 1) {
      cardinalPoints[0] = p1;
      cardinalPoints[1] = p1r;
      cardinalPoints[(n - 2) * 3 + 2 + 3] = p1l;
      cardinalPoints[(n - 2) * 3 + 2 + 4] = cPoints[n];
    } else {
      //记录下这三个控制点
      cardinalPoints[k * 3 + 2 + 0] = p1l;
      cardinalPoints[k * 3 + 2 + 1] = p1;
      cardinalPoints[k * 3 + 2 + 2] = p1r;
    }
  }
  return cardinalPoints;
}
/**
 * 计算三阶贝塞尔点
 * @param points
 * @param part
 * @returns {Array}
 */
function calculatePointsFBZ3(points, part) {
  if (!part) part = 20;
  //获取待拆分的点
  let bezierPts = [];
  let scale = 0.05;
  if (part > 0) {
    scale = 1 / part;
  }
  for (let i = 0; i < points.length - 3; ) {
    //起始点
    let pointS = points[i];
    //第一个控制点
    let pointC1 = points[i + 1];
    //第二个控制点
    let pointC2 = points[i + 2];
    //结束点
    let pointE = points[i + 3];
    bezierPts.push(pointS);
    for (let t = 0; t < 1; ) {
      //三次贝塞尔曲线公式
      let x =
        (1 - t) * (1 - t) * (1 - t) * pointS.x +
        3 * t * (1 - t) * (1 - t) * pointC1.x +
        3 * t * t * (1 - t) * pointC2.x +
        t * t * t * pointE.x;
      let y =
        (1 - t) * (1 - t) * (1 - t) * pointS.y +
        3 * t * (1 - t) * (1 - t) * pointC1.y +
        3 * t * t * (1 - t) * pointC2.y +
        t * t * t * pointE.y;
      let point = { x: x, y: y };
      bezierPts.push(point);
      t += scale;
    }
    i += 3;
    if (i >= points.length) {
      bezierPts.push(pointS);
    }
  }
  return bezierPts;
}
/**
 * 计算聚集区特征点
 * @param anchorpoints
 * @returns {Array}
 * @private
 */
function computeGatheringPlacePoints(anchorpoints) {
  let points = [];
  if (anchorpoints.length == 2) {
    let originP = anchorpoints[0];
    let lastP = anchorpoints[anchorpoints.length - 1];
    let vectorOL = { x: lastP.x - originP.x, y: lastP.y - originP.y };
    let dOL = Math.sqrt(vectorOL.x * vectorOL.x + vectorOL.y * vectorOL.y);
    let v_O_P1_lr = calculateVector(
      vectorOL,
      Math.PI / 3,
      (Math.sqrt(3) / 12) * dOL
    );
    let originP_P1 = v_O_P1_lr[1];
    let p1 = { x: originP.x + originP_P1.x, y: originP.y + originP_P1.y };
    let p2 = { x: (originP.x + lastP.x) / 2, y: (originP.y + lastP.y) / 2 };
    let v_L_P3_lr = calculateVector(
      vectorOL,
      (Math.PI * 2) / 3,
      (Math.sqrt(3) / 12) * dOL
    );
    let lastP_P3 = v_L_P3_lr[1];
    let p3 = { x: lastP.x + lastP_P3.x, y: lastP.y + lastP_P3.y };
    let v_O_P5_lr = calculateVector(vectorOL, Math.PI / 2, (1 / 2) * dOL);
    let v_O_P5 = v_O_P5_lr[0];
    let p5 = { x: v_O_P5.x + p2.x, y: v_O_P5.y + p2.y };
    let p0 = originP;
    let p4 = lastP;
    points.push(p0, p1, p2, p3, p4, p5);
  }
  return points;
}
/**
 * 根据基准向量、夹角、长度计算指定向量
 * @param v
 * @param theta
 * @param d
 * @returns {*[]}
 */
function calculateVector(v, theta, d) {
  if (!theta) theta = Math.PI / 2;
  if (!d) d = 1;
  let x_1;
  let x_2;
  let y_1;
  let y_2;
  let v_l;
  let v_r;
  let d_v = Math.sqrt(v.x * v.x + v.y * v.y);
  if (v.y == 0) {
    x_1 = x_2 = (d_v * d * Math.cos(theta)) / v.x;
    if (v.x > 0) {
      y_1 = Math.sqrt(d * d - x_1 * x_1);
      y_2 = -y_1;
    } else if (v.x < 0) {
      y_2 = Math.sqrt(d * d - x_1 * x_1);
      y_1 = -y_2;
    }
    v_l = { x: x_1, y: y_1 };
    v_r = { x: x_2, y: y_2 };
  } else {
    let n = -v.x / v.y;
    let m = (d * d_v * Math.cos(theta)) / v.y;
    let a = 1 + n * n;
    let b = 2 * n * m;
    let c = m * m - d * d;
    x_1 = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    x_2 = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
    y_1 = n * x_1 + m;
    y_2 = n * x_2 + m;
    if (v.y >= 0) {
      v_l = { x: x_1, y: y_1 };
      v_r = { x: x_2, y: y_2 };
    } else if (v.y < 0) {
      v_l = { x: x_2, y: y_2 };
      v_r = { x: x_1, y: y_1 };
    }
  }
  return [v_l, v_r];
}
/**
 *根据特征点屏幕坐标计算地理坐标
 * @param viewer
 * @param pixPos 屏幕坐标
 * @returns {Array} 地理坐标（经纬度）
 * @private
 */
function createGeoPoints(viewer, pixPos) {
  let points = [];
  let ray, cartesian, cartographic, lng, lat, height;
  for (let i = 0; i < pixPos.length; i++) {
    ray = viewer.camera.getPickRay(pixPos[i]);
    ray && (cartesian = viewer.scene.globe.pick(ray, viewer.scene));
    if (cartesian) {
      cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      lng = Cesium.Math.toDegrees(cartographic.longitude);
      lat = Cesium.Math.toDegrees(cartographic.latitude);
      height = cartographic.height;
      points.push(lng, lat, height);
    }
  }
  return points;
}
function setSessionid(num) {
  let len = num || 32;
  let chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz0123456789";
  let maxPos = chars.length;
  let pwd = "";
  for (let i = 0; i < len; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * maxPos));
  }
  return pwd;
}
export default CreateStagingArea;
