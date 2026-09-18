// @ts-nocheck
/*
 * 创建燕尾箭头
 * @Author: Wang jianLei
 * @Date: 2022-04-14 14:49:29
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-15 18:21:01
 */
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
const CreateSwallowtailArrow = function (
  viewer,
  resultList,
  options,
  callBack
) {
  if (!viewer) throw new Error("no viewer object!");
  options = options || {};
  let id = options.id || setSessionid();
  if (viewer.entities.getById(id))
    throw new Error("the id parameter is an unique value");
  let color = options.color || Cesium.Color.RED;
  let polygon = undefined,
    pottingPoint = [],
    anchorpoints = [];
  let toolTip = "左键单击开始绘制";
  let SwallowtailArrowPoints;
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
  handler.setInputAction(function (event) {
    let w_p = event.endPosition;
    CreateRemindertip(toolTip, w_p, true);
    if (anchorpoints.length > 1) {
      if (!Cesium.defined(polygon)) {
        polygon = plotingSwallowtailArrow(viewer, anchorpoints, color);
        let control_w_p = computeSwallowtailArrow(anchorpoints);
        let GeoPoints = [];
        control_w_p.forEach((item) => {
          GeoPoints.push(item.x, item.y, anchorpoints[0].z);
        });
        SwallowtailArrowPoints =
          Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints);
        polygon.polygon.hierarchy = new Cesium.CallbackProperty(function () {
          return new Cesium.PolygonHierarchy(SwallowtailArrowPoints);
        }, false);
        polygon.GeoType = "SwallowtailArrow";
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

        let control_w_p = computeSwallowtailArrow(anchorpoints);
        let GeoPoints1 = [];
        control_w_p.forEach((item) => {
          GeoPoints1.push(item.x, item.y, anchorpoints[0].z);
        });
        SwallowtailArrowPoints =
          Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints1);
      }
    } else {
      return;
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(function (event) {
    polygon.pottingPoint = pottingPoint;
    handler.destroy();
    resultList.push(polygon);
    CreateRemindertip(toolTip, event.position, false);
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
 * 绘制燕尾箭头
 * @param viewer
 * @param anchorpoints
 */
function plotingSwallowtailArrow(viewer, anchorpoints, color) {
  let window_points = computeSwallowtailArrow(anchorpoints);
  let GeoPoints = [];
  window_points.forEach((item) => {
    GeoPoints.push(item.x, item.y, anchorpoints[0].z);
  });
  let polygon = viewer.entities.add({
    name: "SwallowtailArrow",
    polygon: {
      hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights(GeoPoints),
      material: color,
    },
  });
  return polygon;
}
/**
 * 计算燕尾箭头特征点屏幕坐标
 * @param anchorpoints
 * @returns {any[]}
 * @private
 */
function computeSwallowtailArrow(anchorpoints) {
  let x0 = anchorpoints[0].x;
  let y0 = anchorpoints[0].y;
  let x1 = anchorpoints[1].x;
  let y1 = anchorpoints[1].y;
  let xt = (15.8 * x1 + 3.2 * x0) / 19;
  let yt = (15.8 * y1 + 3.2 * y0) / 19;
  let ap = new Array(7);
  ap[0] = { x: x1, y: y1 };
  ap[1] = {
    x: xt + (0.85 / 3.2) * (y1 - yt),
    y: yt - (0.85 / 3.2) * (x1 - xt),
  };
  ap[2] = {
    x: xt + (0.25 / 3.2) * (y1 - yt),
    y: yt - (0.25 / 3.2) * (x1 - xt),
  };
  ap[3] = { x: x0 + (1.6 / 19) * (y1 - y0), y: y0 - (1.6 / 19) * (x1 - x0) };
  ap[4] = { x: (3.2 * x1 + 15.8 * x0) / 19, y: (3.2 * y1 + 15.8 * y0) / 19 };
  ap[5] = { x: x0 - (1.6 / 19) * (y1 - y0), y: y0 + (1.6 / 19) * (x1 - x0) };
  ap[6] = {
    x: xt - (0.25 / 3.2) * (y1 - yt),
    y: yt + (0.25 / 3.2) * (x1 - xt),
  };
  ap[7] = {
    x: xt - (0.85 / 3.2) * (y1 - yt),
    y: yt + (0.85 / 3.2) * (x1 - xt),
  };
  return ap;
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
export default CreateSwallowtailArrow;
