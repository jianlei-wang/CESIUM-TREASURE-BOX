// @ts-nocheck
/*
 * 创建扇形
 * @Author: Wang jianLei
 * @Date: 2022-04-15 11:37:53
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-15 18:20:54
 */
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateSector = function (viewer, resultList, options, callBack) {
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
  let SectorPoints;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(function (event) {
    if (anchorpoints.length == 3) {
      return;
    }
    let window_position = event.position;
    let GeoPoints = createGeoPoints(viewer, [
      { x: window_position.x, y: window_position.y },
    ]);
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
    CreateRemindertip(toolTip, movement.endPosition, true);
    let w_p = movement.endPosition;
    if (anchorpoints.length > 2) {
      if (!Cesium.defined(polygon)) {
        let window_points = computeSectorPoints(anchorpoints);
        let GeoPoints = [];
        window_points.forEach((item) => {
          GeoPoints.push(item.x, item.y, anchorpoints[0].z);
        });
        SectorPoints = Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints);

        polygon = viewer.entities.add({
          id: id,
          name: "Sector",
          polygon: {
            hierarchy: SectorPoints,
            material: color,
          },
        });
        polygon.polygon.hierarchy = new Cesium.CallbackProperty(function () {
          return new Cesium.PolygonHierarchy(SectorPoints);
        }, false);
        polygon.GeoType = "Sector";
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

        let window_points = computeSectorPoints(anchorpoints);
        let GeoPoints1 = [];
        window_points.forEach((item) => {
          GeoPoints1.push(item.x, item.y, anchorpoints[0].z);
        });
        SectorPoints = Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints1);
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
 * @param window_points 屏幕坐标
 * @returns {Array} 地理坐标（经纬度）
 * @private
 */
function createGeoPoints(viewer, window_points) {
  let points = [];
  let ray, cartesian, cartographic, lng, lat, height;
  for (let i = 0; i < window_points.length; i++) {
    ray = viewer.camera.getPickRay(window_points[i]);
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
 *计算扇形特征点
 * @param anchor
 * @returns {Array}
 * @private
 */
function computeSectorPoints(anchor) {
  let theta1 = calculateAngle(anchor[0], anchor[1]);
  let theta2 = calculateAngle(anchor[0], anchor[2]);
  if (theta1 > theta2) {
    theta2 = 2 * Math.PI + theta2;
  }
  let step = Math.PI / 180;
  let radius = theta1;
  let points = [anchor[0]];
  let r = Math.sqrt(
    (anchor[1].x - anchor[0].x) * (anchor[1].x - anchor[0].x) +
      (anchor[1].y - anchor[0].y) * (anchor[1].y - anchor[0].y)
  );
  for (let i = 0; i < Math.abs(theta1 - theta2); i += step) {
    let X = anchor[0].x + r * Math.cos(radius);
    let Y = anchor[0].y + r * Math.sin(radius);
    radius = radius + step;
    radius = radius < 0 ? 2 * Math.PI + radius : radius;
    radius = radius > 2 * Math.PI ? radius - 2 * Math.PI : radius;
    points.push({ x: X, y: Y });
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
export default CreateSector;
