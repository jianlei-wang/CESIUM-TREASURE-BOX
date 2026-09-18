// @ts-nocheck
/*
 * 创建圆角矩形
 * @Author: Wang jianLei
 * @Date: 2022-04-14 15:16:06
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-15 11:54:02
 */
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateRoundRectangle = function (viewer, resultList, options, callBack) {
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

  let RoundedRectanglePoints;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(function (event) {
    let pixPos = event.position;
    toolTip = "右键完成绘制";
    if (Cesium.defined(polygon)) {
      return;
    }
    if (anchorpoints.length == 0) {
      let GeoPoints = createGeoPoints(viewer, [{ x: pixPos.x, y: pixPos.y }]);
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
    if (anchorpoints.length > 1) {
      if (!Cesium.defined(polygon)) {
        let pixPos = computeRoundedRectanglePoints(anchorpoints);
        let GeoPoints = [];
        pixPos.forEach((item) => {
          GeoPoints.push(item.x, item.y, anchorpoints[0].z);
        });
        RoundedRectanglePoints =
          Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints);
        polygon = viewer.entities.add({
          id: id,
          name: "RoundedRectangle",
          polygon: {
            hierarchy: RoundedRectanglePoints,
            material: color,
          },
        });
        polygon.polygon.hierarchy = new Cesium.CallbackProperty(function () {
          return new Cesium.PolygonHierarchy(RoundedRectanglePoints);
        }, false);
        polygon.GeoType = "RoundedRectangle";
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

        let pixPos = computeRoundedRectanglePoints(anchorpoints);
        let GeoPoints1 = [];
        pixPos.forEach((item) => {
          GeoPoints1.push(item.x, item.y, anchorpoints[0].z);
        });
        RoundedRectanglePoints =
          Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints1);
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
function computeRoundedRectanglePoints(anchor) {
  let o_x = (anchor[0].x + anchor[1].x) / 2;
  let o_y = (anchor[0].y + anchor[1].y) / 2;
  //a为矩形的长边，b为矩形的短边
  let a = Math.abs(anchor[0].x - anchor[1].x);
  let b = Math.abs(anchor[0].y - anchor[1].y);
  let r = (1 / 10) * Math.min(a, b);
  //从左上点开始，顺时针求四个圆弧的圆心
  let o1_x = o_x - a / 2 + r;
  let o1_y = o_y - b / 2 + r;
  let o1 = { x: o1_x, y: o1_y };
  let o2 = { x: o_x + a / 2 - r, y: o_y - b / 2 + r };
  let o3 = { x: o_x + a / 2 - r, y: o_y + b / 2 - r };
  let o4 = { x: o_x - a / 2 + r, y: o_y + b / 2 - r };
  //从左上角开始画圆弧
  let step = Math.PI / 180;
  let points1 = [];
  let theta1 = Math.PI;
  let theta2 = (3 / 2) * Math.PI;
  let radius1 = theta1;
  for (let i = 0; i < Math.abs(theta1 - theta2); i += step) {
    let X = o1.x + r * Math.cos(radius1);
    let Y = o1.y + r * Math.sin(radius1);
    radius1 = radius1 + step;
    radius1 = radius1 < 0 ? 2 * Math.PI + radius1 : radius1;
    radius1 = radius1 > 2 * Math.PI ? 2 * Math.PI - radius1 : radius1;
    points1.push({ x: X, y: Y });
  }
  let points2 = points1;
  let theta3 = (Math.PI * 3) / 2;
  let theta4 = 2 * Math.PI;
  let radius2 = theta3;
  for (let i = 0; i < Math.abs(theta3 - theta4); i += step) {
    let X = o2.x + r * Math.cos(radius2);
    let Y = o2.y + r * Math.sin(radius2);
    radius2 = radius2 + step;
    radius2 = radius2 < 0 ? 2 * Math.PI + radius2 : radius2;
    radius2 = radius2 > 2 * Math.PI ? 2 * Math.PI - radius2 : radius2;
    points2.push({ x: X, y: Y });
  }
  let points3 = points2;
  let theta5 = 0;
  let theta6 = (1 / 2) * Math.PI;
  let radius3 = theta5;
  for (let i = 0; i < Math.abs(theta5 - theta6); i += step) {
    let X = o3.x + r * Math.cos(radius3);
    let Y = o3.y + r * Math.sin(radius3);
    radius3 = radius3 + step;
    radius3 = radius3 < 0 ? 2 * Math.PI + radius3 : radius3;
    radius3 = radius3 > 2 * Math.PI ? 2 * Math.PI - radius3 : radius3;
    points3.push({ x: X, y: Y });
  }
  let points = points3;
  let theta7 = (1 / 2) * Math.PI;
  let theta8 = Math.PI;
  let radius4 = theta7;
  for (let i = 0; i < Math.abs(theta7 - theta8); i += step) {
    let X = o4.x + r * Math.cos(radius4);
    let Y = o4.y + r * Math.sin(radius4);
    radius4 = radius4 + step;
    radius4 = radius4 < 0 ? 2 * Math.PI + radius4 : radius4;
    radius4 = radius4 > 2 * Math.PI ? 2 * Math.PI - radius4 : radius4;
    points.push({ x: X, y: Y });
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
export default CreateRoundRectangle;
