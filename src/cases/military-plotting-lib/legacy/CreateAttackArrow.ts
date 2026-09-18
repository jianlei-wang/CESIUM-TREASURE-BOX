// @ts-nocheck
/*
 * 创建攻击箭头
 * @Author: Wang jianLei
 * @Date: 2022-04-15 14:21:28
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-05-05 15:36:43
 */
import "./thirdPart/algorithm";
import "./thirdPart/plotUtil";
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateAttackArrow = function (viewer, resultList, options, callBack) {
  if (!viewer) throw new Error("no viewer object!");
  options = options || {};
  let id = options.id || setSessionid();
  if (viewer.entities.getById(id))
    throw new Error("the id parameter is an unique value");
  let color = options.color || Cesium.Color.RED;
  const curDepth = viewer.scene.globe.depthTestAgainstTerrain;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  let anchorpoints = [],
    pottingPoint = [];
  let arrowEntity = undefined;
  let toolTip = "左键单击开始绘制";
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
  handler.setInputAction(function (event) {
    toolTip = "左键增加点，右键完成绘制";
    let cartesian = viewer.scene.pickPosition(event.position);
    if (!cartesian) return;
    anchorpoints.push(cartesian);
    let GeoPoints = createGeoPoints(viewer, [event.position]);
    pottingPoint.push(GeoPoints);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(function (move) {
    CreateRemindertip(toolTip, move.endPosition, true);
    if (anchorpoints.length < 2) {
      toolTip = anchorpoints.length === 1 ? "左键点击绘制箭尾" : toolTip;
      return;
    }
    let my_ellipsoid = viewer.scene.globe.ellipsoid;
    let cartesian = viewer.camera.pickEllipsoid(move.endPosition, my_ellipsoid);
    if (!cartesian) return;
    if (anchorpoints.length >= 2) {
      if (!Cesium.defined(arrowEntity)) {
        anchorpoints.push(cartesian);
        let GeoPoints = createGeoPoints(viewer, [move.endPosition]);
        pottingPoint.push(GeoPoints);

        arrowEntity = showAttackArrowOnMap(viewer, anchorpoints, color, id);
        arrowEntity.GeoType = "AttackArrow";
      } else {
        anchorpoints.pop();
        pottingPoint.pop();
        anchorpoints.push(cartesian);
        let GeoPoints = createGeoPoints(viewer, [move.endPosition]);
        pottingPoint.push(GeoPoints);
      }
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function (event) {
    CreateRemindertip(toolTip, event.position, false);
    arrowEntity.pottingPoint = pottingPoint;
    resultList.push(arrowEntity);
    viewer.scene.globe.depthTestAgainstTerrain = curDepth;
    handler.destroy();
    callBack && callBack(arrowEntity);
  }, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
};

function showAttackArrowOnMap(viewer, positions, color, id) {
  let update = function () {
    //计算面
    if (positions.length < 3) {
      return null;
    }
    let lnglatArr = [];
    for (let i = 0; i < positions.length; i++) {
      let lnglat = cartesianToLatlng(viewer, positions[i]);
      lnglatArr.push(lnglat);
    }
    let res = window.xp.algorithm.tailedAttackArrow(lnglatArr);
    let index = JSON.stringify(res.polygonalPoint).indexOf("null");
    let returnData = [];
    if (index == -1) returnData = res.polygonalPoint;
    return new Cesium.PolygonHierarchy(returnData);
  };
  return viewer.entities.add({
    id: id,
    name: "AttackArrow",
    polygon: new Cesium.PolygonGraphics({
      hierarchy: new Cesium.CallbackProperty(update, false),
      show: true,
      fill: true,
      material: color,
    }),
  });
}
function cartesianToLatlng(viewer, cartesian) {
  let latlng = viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian);
  let lat = Cesium.Math.toDegrees(latlng.latitude);
  let lng = Cesium.Math.toDegrees(latlng.longitude);
  return [lng, lat];
}
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
export default CreateAttackArrow;
