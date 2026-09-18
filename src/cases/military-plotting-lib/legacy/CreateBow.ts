// @ts-nocheck
/*
 * 创建弓形对象
 * @Author: Wang jianLei
 * @Date: 2022-04-15 14:21:28
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-15 15:24:15
 */
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateBow = function (viewer, resultList, options, callBack) {
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
  let BowPoints;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(function (event) {
    if (anchorpoints.length == 3) {
      return;
    }
    let pixPos = event.position;
    let GeoPoints = createGeoPoints(viewer, [{ x: pixPos.x, y: pixPos.y }]);
    if (anchorpoints.length == 0) {
      toolTip = "左键添加点";
      anchorpoints.push({ x: GeoPoints[0], y: GeoPoints[1], z: GeoPoints[2] });
      pottingPoint.push(GeoPoints);
    } else if (anchorpoints.length == 1) {
      toolTip = "右键完成绘制";
      anchorpoints.push(
        { x: GeoPoints[0], y: GeoPoints[1], z: GeoPoints[2] },
        {
          x: GeoPoints[0] + 0.0000001,
          y: GeoPoints[1] + 0.0000001,
          z: GeoPoints[2],
        }
      );
      pottingPoint.push(GeoPoints, GeoPoints);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(function (movement) {
    let w_p = movement.endPosition;
    CreateRemindertip(toolTip, movement.endPosition, true);
    if (anchorpoints.length > 2) {
      if (!Cesium.defined(polygon)) {
        let pixPos = computeBowPoints(anchorpoints);
        let GeoPoints = [];
        pixPos.forEach((item) => {
          GeoPoints.push(item.x, item.y, anchorpoints[0].z);
        });
        BowPoints = Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints);
        polygon = viewer.entities.add({
          id: id,
          name: "Bow",
          polygon: {
            hierarchy: BowPoints,
            material: color,
          },
        });
        polygon.polygon.hierarchy = new Cesium.CallbackProperty(function () {
          return new Cesium.PolygonHierarchy(BowPoints);
        }, false);
        polygon.GeoType = "Bow";
      } else {
        anchorpoints.pop();
        pottingPoint.pop();
        let GeoPoints = createGeoPoints(viewer, [{ x: w_p.x, y: w_p.y }]);
        anchorpoints.push({
          x: GeoPoints[0],
          y: GeoPoints[1],
          z: GeoPoints[2],
        });
        pottingPoint.push(GeoPoints);
        let pixPos = computeBowPoints(anchorpoints);
        let GeoPoints1 = [];
        pixPos.forEach((item) => {
          GeoPoints1.push(item.x, item.y, anchorpoints[0].z);
        });
        BowPoints = Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints1);
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function (event) {
    CreateRemindertip(toolTip, event.position, false);
    polygon.pottingPoint = pottingPoint;
    resultList.push(polygon);
    handler.destroy();
    callBack && callBack(polygon);
  }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
};

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
/**
 * 计算弓形特征点
 * @param anchorpoints
 * @returns {Array}
 * @private
 */
function computeBowPoints(anchor) {
  //根据三个点到圆心的距离相等
  let A1 = 2 * (anchor[1].x - anchor[0].x);
  let B1 = 2 * (anchor[1].y - anchor[0].y);
  let C1 =
    anchor[1].x * anchor[1].x +
    anchor[1].y * anchor[1].y -
    anchor[0].x * anchor[0].x -
    anchor[0].y * anchor[0].y;
  let A2 = 2 * (anchor[2].x - anchor[1].x);
  let B2 = 2 * (anchor[2].y - anchor[1].y);
  let C2 =
    anchor[2].x * anchor[2].x +
    anchor[2].y * anchor[2].y -
    anchor[1].x * anchor[1].x -
    anchor[1].y * anchor[1].y;
  let o_x = (C1 * B2 - C2 * B1) / (A1 * B2 - A2 * B1);
  let o_y = (A1 * C2 - A2 * C1) / (A1 * B2 - A2 * B1);
  let o = { x: o_x, y: o_y };
  let r = Math.sqrt(
    (anchor[0].x - o_x) * (anchor[0].x - o_x) +
      (anchor[0].y - o_y) * (anchor[0].y - o_y)
  );
  let theta1 = calculateAngle(o, anchor[0]);
  let theta2 = calculateAngle(o, anchor[1]);
  let theta3 = calculateAngle(o, anchor[2]);
  let step = Math.PI / 180;
  let radius = undefined;
  let points = [];
  if (
    (theta1 < theta3 && theta3 < theta2) ||
    (theta2 < theta3 && theta3 < theta1)
  ) {
    radius = theta1 < theta2 ? theta1 : theta2;
    for (let i = 0; i < Math.abs(theta1 - theta2); i += step) {
      let X = o_x + r * Math.cos(radius);
      let Y = o_y + r * Math.sin(radius);
      radius = radius + step;
      radius = radius < 0 ? 2 * Math.PI + radius : radius;
      radius = radius > 2 * Math.PI ? 2 * Math.PI - radius : radius;
      points.push({ x: X, y: Y });
    }
  } else {
    radius = theta1 > theta2 ? theta1 : theta2;
    for (let i = 0; i < 2 * Math.PI - Math.abs(theta1 - theta2); i += step) {
      let X = o_x + r * Math.cos(radius);
      let Y = o_y + r * Math.sin(radius);
      radius = radius + step;
      radius = radius < 0 ? 2 * Math.PI + radius : radius;
      radius = radius > 2 * Math.PI ? radius - 2 * Math.PI : radius;
      points.push({ x: X, y: Y });
    }
  }
  return points;
}

/**
 * 根据输入的两点计算向量的角度
 * @param a1
 * @param a2
 * @returns {*}
 */
function calculateAngle(a1, a2) {
  let a = { x: a2.x - a1.x, y: a2.y - a1.y };
  let theta = Math.atan2(a.y, a.x);
  if (theta < 0) {
    theta = theta + 2 * Math.PI;
  }
  return theta;
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
export default CreateBow;
