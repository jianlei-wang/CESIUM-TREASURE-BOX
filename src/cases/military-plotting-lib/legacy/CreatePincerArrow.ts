// @ts-nocheck
/*
 * 创建弓形对象
 * @Author: Wang jianLei
 * @Date: 2022-04-15 14:21:28
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-05-09 14:26:08
 */
import "./thirdPart/algorithm";
import "./thirdPart/plotUtil";
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreatePincerArrow = function (viewer, resultList, options, callBack) {
  if (!viewer) throw new Error("no viewer object!");
  options = options || {};
  let id = options.id || setSessionid();
  if (viewer.entities.getById(id))
    throw new Error("the id parameter is an unique value");
  let color = options.color || Cesium.Color.RED;
  const curDepth = viewer.scene.globe.depthTestAgainstTerrain;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  let anchorpoints = [];
  let pottingPoint = [];
  let arrowEntity = undefined;
  let toolTip = "左键点击单击开始绘制";
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(function (event) {
    let pixPos = event.position;
    anchorpoints.length > 3
      ? (toolTip = "右键完成绘制")
      : (toolTip = "左键增加点");
    let cartesian = viewer.scene.pickPosition(event.position);
    if (!cartesian || anchorpoints.length > 4) return;
    anchorpoints.push(cartesian);
    let GeoPoints = createGeoPoints(viewer, [{ x: pixPos.x, y: pixPos.y }]);
    pottingPoint.push(GeoPoints);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(function (evt) {
    CreateRemindertip(toolTip, evt.endPosition, true);
    //移动时绘制面
    if (anchorpoints.length < 2) return;
    let my_ellipsoid = viewer.scene.globe.ellipsoid;
    let cartesian = viewer.camera.pickEllipsoid(evt.endPosition, my_ellipsoid);
    if (!cartesian) return;
    if (anchorpoints.length >= 2) {
      if (!Cesium.defined(arrowEntity)) {
        anchorpoints.push(cartesian);
        let GeoPoints = createGeoPoints(viewer, [evt.endPosition]);
        pottingPoint.push(GeoPoints);
        arrowEntity = showArrowOnMap(viewer, anchorpoints, color, id);
        arrowEntity.GeoType = "PincerArrow";
      } else {
        anchorpoints.pop();
        pottingPoint.pop();
        anchorpoints.push(cartesian);
        let GeoPoints = createGeoPoints(viewer, [evt.endPosition]);
        pottingPoint.push(GeoPoints);
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function (event) {
    CreateRemindertip(toolTip, event.position, false);
    arrowEntity.pottingPoint = pottingPoint;
    handler.destroy();
    resultList.push(arrowEntity);
    viewer.scene.globe.depthTestAgainstTerrain = curDepth;
    callBack && callBack(arrowEntity);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);
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
function showArrowOnMap(viewer, positions, color, id) {
  let update = function () {
    //计算面
    if (positions.length < 3) {
      return null;
    }
    let lnglatArr = [];
    for (let i = 0; i < positions.length; i++) {
      let latlng = viewer.scene.globe.ellipsoid.cartesianToCartographic(
        positions[i]
      );
      let lat = Cesium.Math.toDegrees(latlng.latitude);
      let lng = Cesium.Math.toDegrees(latlng.longitude);
      lnglatArr.push([lng, lat]);
    }
    let res = window.xp.algorithm.doubleArrow(lnglatArr);
    let returnData = [];
    let index = JSON.stringify(res.polygonalPoint).indexOf("null");
    if (index == -1) returnData = res.polygonalPoint;
    return new Cesium.PolygonHierarchy(returnData);
  };
  return viewer.entities.add({
    id: id,
    name: "PincerArrow",
    polygon: new Cesium.PolygonGraphics({
      hierarchy: new Cesium.CallbackProperty(update, false),
      show: true,
      fill: true,
      material: color,
    }),
  });
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

export default CreatePincerArrow;
