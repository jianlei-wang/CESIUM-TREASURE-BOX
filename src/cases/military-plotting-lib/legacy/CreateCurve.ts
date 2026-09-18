// @ts-nocheck
/*
 * 创建圆滑曲线
 * 可拆卸
 * @Author: Wang jianLei
 * @Date: 2022-04-16 21:49:57
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-21 08:57:55
 */
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateCurve = function (viewer, resultList, options, callback) {
  if (!viewer) throw new Error("no viewer object!");
  options = options || {};
  let id = options.id || setSessionid();
  if (viewer.entities.getById(id))
    throw new Error("the id parameter is an unique value");
  let color = options.color || Cesium.Color.RED;
  let width = options.width || 2;
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  let toolTip = "左键点击开始绘制";
  let anchorpoints = [];
  let polyline = undefined;
  let linePoints;
  handler.setInputAction(function (event) {
    toolTip = "左键添加点，右键结束绘制";
    let pixPos = event.position;
    let cartesian = getCatesian3FromPX(viewer, pixPos);
    let geoPoint = transformCartesianToWGS84(viewer, cartesian);
    if (anchorpoints.length == 0) {
      anchorpoints.push({ x: geoPoint.lng, y: geoPoint.lat });
    }
    anchorpoints.push({ x: geoPoint.lng, y: geoPoint.lat });
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(function (movement) {
    let endPos = movement.endPosition;
    CreateRemindertip(toolTip, endPos, true);
    if (anchorpoints.length > 0) {
      if (!Cesium.defined(polyline)) {
        let window_points = createBezierPoints(anchorpoints);
        let geoPoints = [];
        window_points.forEach((item) => {
          geoPoints.push(item.x, item.y);
        });
        linePoints = Cesium.Cartesian3.fromDegreesArray(geoPoints);
        polyline = viewer.entities.add({
          name: "Curve",
          id: id,
          polyline: {
            positions: new Cesium.CallbackProperty(function () {
              return linePoints;
            }, false),
            width: width,
            material: color,
          },
        });
        polyline.GeoType = "Curve";
      } else {
        anchorpoints.pop();
        let cartesian = getCatesian3FromPX(viewer, endPos);
        let geoPoint = transformCartesianToWGS84(viewer, cartesian);
        anchorpoints.push({ x: geoPoint.lng, y: geoPoint.lat });
        let window_points = createBezierPoints(anchorpoints);
        let GeoPoints1 = [];
        window_points.forEach((item) => {
          GeoPoints1.push(item.x, item.y);
        });
        linePoints = Cesium.Cartesian3.fromDegreesArray(GeoPoints1);
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function (event) {
    polyline.pottingPoint = anchorpoints;
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
function getCatesian3FromPX(viewer, px) {
  let picks = viewer.scene.drillPick(px);
  let cartesian = null;
  let isOn3dtiles = false,
    isOnTerrain = false;
  // drillPick
  for (let i in picks) {
    let pick = picks[i];
    if (
      (pick && pick.primitive instanceof Cesium.Cesium3DTileFeature) ||
      (pick && pick.primitive instanceof Cesium.Cesium3DTileset) ||
      (pick && pick.primitive instanceof Cesium.Model)
    ) {
      //模型上拾取
      isOn3dtiles = true;
    }
    // 3dtilset
    if (isOn3dtiles) {
      viewer.scene.pick(px);
      cartesian = viewer.scene.pickPosition(px);
      if (cartesian) {
        let cartographic = Cesium.Cartographic.fromCartesian(cartesian);
        if (cartographic.height < 0) cartographic.height = 0;
        let lon = Cesium.Math.toDegrees(cartographic.longitude),
          lat = Cesium.Math.toDegrees(cartographic.latitude),
          height = cartographic.height;
        cartesian = transformWGS84ToCartesian(viewer, {
          lng: lon,
          lat: lat,
          alt: height,
        });
      }
    }
  }
  // 地形
  let boolTerrain =
    viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider;
  // Terrain
  if (!isOn3dtiles && !boolTerrain) {
    let ray = viewer.scene.camera.getPickRay(px);
    if (!ray) return null;
    cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    isOnTerrain = true;
  }
  // 地球
  if (!isOn3dtiles && !isOnTerrain && boolTerrain) {
    cartesian = viewer.scene.camera.pickEllipsoid(
      px,
      viewer.scene.globe.ellipsoid
    );
  }
  if (cartesian) {
    let position = transformCartesianToWGS84(viewer, cartesian);
    if (position.alt < 0) {
      cartesian = transformWGS84ToCartesian(viewer, position, 0.1);
    }
    return cartesian;
  }
  return false;
}

/***
 * 坐标转换 84转笛卡尔
 * @param {Object} {lng,lat,alt} 地理坐标
 * @return {Object} Cartesian3 三维位置坐标
 */
function transformWGS84ToCartesian(viewer, position, alt) {
  return position
    ? Cesium.Cartesian3.fromDegrees(
        position.lng || position.lon,
        position.lat,
        (position.alt = alt || position.alt),
        Cesium.Ellipsoid.WGS84
      )
    : Cesium.Cartesian3.ZERO;
}

/***
 * 坐标转换 笛卡尔转84
 * @param {Object} Cartesian3 三维位置坐标
 * @return {Object} {lng,lat,alt} 地理坐标
 */
function transformCartesianToWGS84(viewer, cartesian) {
  let ellipsoid = Cesium.Ellipsoid.WGS84;
  let cartographic = ellipsoid.cartesianToCartographic(cartesian);
  return {
    lng: Cesium.Math.toDegrees(cartographic.longitude),
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    alt: cartographic.height,
  };
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
export default CreateCurve;
