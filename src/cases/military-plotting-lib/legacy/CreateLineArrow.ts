// @ts-nocheck
/*
 * 创建简单剪头-直线Or曲线，通过options传递的boolStraight判定，默认曲线
 * @Author: Wang jianLei
 * @Date: 2022-04-14 14:49:57
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-15 23:07:48
 */
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateLineArrow = function (viewer, resultList, options, callback) {
  if (!viewer) throw new Error("no viewer object!");
  options = options || {};
  let id = options.id || setSessionid();
  if (viewer.entities.getById(id))
    throw new Error("the id parameter is an unique value");
  let color = options.color || Cesium.Color.RED;
  let width = options.width || 15;
  let boolStraight = options.straight || false;
  let geoType = boolStraight ? "StraightLineArrow" : "CurveLineArrow";
  let anchorpoints = [],
    pottingPoint = [],
    polyline = undefined;
  let LineArrowPoints;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  let toolTip = "左键点击开始绘制";
  handler.setInputAction(function (event) {
    toolTip = boolStraight ? "右键结束绘制" : "左键添加点，右键结束绘制";
    if (Cesium.defined(polyline) && boolStraight) {
      return;
    }
    let pixPos = event.position;
    let GeoPoints = createGeoPoints(viewer, [{ x: pixPos.x, y: pixPos.y }]);
    if (anchorpoints.length == 0) {
      anchorpoints.push({
        x: GeoPoints[0],
        y: GeoPoints[1],
      });
      pottingPoint.push(GeoPoints);
    }
    anchorpoints.push({
      x: GeoPoints[0],
      y: GeoPoints[1],
    });
    pottingPoint.push(GeoPoints);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(function (movement) {
    let endPos = movement.endPosition;
    CreateRemindertip(toolTip, endPos, true);
    if (anchorpoints.length > 0) {
      if (!Cesium.defined(polyline)) {
        let window_points = createBezierPoints(anchorpoints);
        let GeoPoints = [];
        window_points.forEach((item) => {
          GeoPoints.push(item.x, item.y);
        });
        LineArrowPoints = Cesium.Cartesian3.fromDegreesArray(GeoPoints);
        polyline = viewer.entities.add({
          name: "LineArrow",
          id: id,
          polyline: {
            positions: new Cesium.CallbackProperty(function () {
              return LineArrowPoints;
            }, false),
            width: width,
            material: new Cesium.PolylineArrowMaterialProperty(color),
          },
        });
        polyline.GeoType = geoType;
      } else {
        anchorpoints.pop();
        pottingPoint.pop();
        let GeoPoints = createGeoPoints(viewer, [{ x: endPos.x, y: endPos.y }]);
        anchorpoints.push({
          x: GeoPoints[0],
          y: GeoPoints[1],
        });
        pottingPoint.push(GeoPoints);

        let window_points = createBezierPoints(anchorpoints);
        let GeoPoints1 = [];
        window_points.forEach((item) => {
          GeoPoints1.push(item.x, item.y);
        });
        LineArrowPoints = Cesium.Cartesian3.fromDegreesArray(GeoPoints1);
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function (event) {
    polyline.pottingPoint = pottingPoint;
    resultList.push(polyline);
    handler.destroy();
    CreateRemindertip(toolTip, event.position, false);
    if (typeof callback == "function") callback(polyline);
  }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
};
function createBezierPoints(anchorpoints) {
  let numpoints = 100;
  let points = [];
  for (let i = 0; i <= numpoints; i++) {
    let point = computeBezierPoints(anchorpoints, i / numpoints);
    points.push(point);
  }
  return points;
}
/**
 * 计算贝塞尔曲线特征点
 * @param anchorpoints
 * @param t
 * @returns {{x: number, y: number}}
 * @private
 */
function computeBezierPoints(anchorpoints, t) {
  let x = 0,
    y = 0;
  let Binomial_coefficient = computeBinomial(anchorpoints);
  for (let j = 0; j < anchorpoints.length; j++) {
    let tempPoint = anchorpoints[j];
    x +=
      tempPoint.x *
      Math.pow(1 - t, anchorpoints.length - 1 - j) *
      Math.pow(t, j) *
      Binomial_coefficient[j];
    y +=
      tempPoint.y *
      Math.pow(1 - t, anchorpoints.length - 1 - j) *
      Math.pow(t, j) *
      Binomial_coefficient[j];
  }
  return { x: x, y: y };
}
/**
 * 计算二项式系数
 * @param anchorpoints
 * @returns {Array}
 * @private
 */
function computeBinomial(anchorpoints) {
  let lens = anchorpoints.length;
  let Binomial_coefficient = [];
  Binomial_coefficient.push(1);
  for (let k = 1; k < lens - 1; k++) {
    let cs = 1,
      bcs = 1;
    for (let m = 0; m < k; m++) {
      cs = cs * (lens - 1 - m);
      bcs = bcs * (k - m);
    }
    Binomial_coefficient.push(cs / bcs);
  }
  Binomial_coefficient.push(1);
  return Binomial_coefficient;
}
function createGeoPoints(viewer, window_points) {
  let points = [];
  let ray, cartesian, cartographic, lng, lat;
  for (let i = 0; i < window_points.length; i++) {
    ray = viewer.camera.getPickRay(window_points[i]);
    ray && (cartesian = viewer.scene.globe.pick(ray, viewer.scene));
    if (cartesian) {
      cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      lng = Cesium.Math.toDegrees(cartographic.longitude);
      lat = Cesium.Math.toDegrees(cartographic.latitude);
      points.push(lng, lat);
    }
  }
  return points;
}
function setSessionid(num) {
  let len = num || 32;
  let chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
  let maxPos = chars.length;
  let pwd = "";
  for (let i = 0; i < len; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * maxPos));
  }
  return pwd;
}
export default CreateLineArrow;
