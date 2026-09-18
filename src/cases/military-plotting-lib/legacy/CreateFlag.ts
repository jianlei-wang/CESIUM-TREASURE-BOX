// @ts-nocheck
/*
 * 创建旗标
 * 可拆卸
 * @Author: Wang jianLei
 * @Date: 2022-04-16 20:38:08
 * @Last Modified by: Wang JianLei
 * @Last Modified time: 2022-04-23 10:39:52
 */
import * as utils from "./thirdPart/utils";
import CreateRemindertip from "./ReminderTip";
const Cesium = window.Cesium;
/**
 * 创建旗标主方法
 * @param {*} viewer
 * @param {Array} resultList 存放结果集合
 * @param {Number} options 旗标参数{color，id，type-0:曲线,1:矩形.2:正三角,3:倒三角,4:对三角}
 * @param {Function} callBack 回调函数
 */
const CreateFlag = function (viewer, resultList, options, callBack) {
  if (!viewer) throw new Error("no viewer object!");
  options = options || {};
  let id = options.id || setSessionid();
  if (viewer.entities.getById(id))
    throw new Error("the id parameter is an unique value");
  let color = options.color || Cesium.Color.RED;
  let outlineColor = color.withAlpha(1);
  let type = options.type || 0;
  const flagType = {
    0: "CurveFlag",
    1: "RectangleFlag",
    2: "RegularTriangleFlag",
    3: "InvertedTriangleFlag",
    4: "TriangleFlag",
  };
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);

  let flagEntity = null; //活动曲线旗标
  let pottingPoint = []; //活动点
  let toolTip = "左键点击单击开始绘制";

  handler.setInputAction(function (evt) {
    let cartesian = getCatesian3FromPX(viewer, evt.position);
    toolTip = "右键完成绘制";
    if (pottingPoint.length == 0) {
      pottingPoint.push(cartesian.clone());
      pottingPoint.push(cartesian);
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction(function (evt) {
    CreateRemindertip(toolTip, evt.endPosition, true);
    if (pottingPoint.length < 2) return;
    let cartesian = getCatesian3FromPX(viewer, evt.endPosition);
    if (!Cesium.defined(flagEntity)) {
      flagEntity = viewer.entities.add({
        id: id,
        name: flagType[type],
        polygon: {
          hierarchy: new Cesium.CallbackProperty(function () {
            let arrow = [];
            let res = fineArrow();
            for (let i = 0; i < res.length; i++) {
              let cart3 = new Cesium.Cartesian3(res[i].x, res[i].y, res[i].z);
              arrow.push(cart3);
            }
            return new Cesium.PolygonHierarchy(arrow);
          }, false),
          perPositionHeight: true,
          extrudedHeight: 0,
          material: color,
          outline: true,
          outlineColor: outlineColor,
        },
      });
      flagEntity.GeoType = flagType[type];
    } else {
      pottingPoint.pop();
      pottingPoint.push(cartesian);
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(function (event) {
    CreateRemindertip(toolTip, event.position, false);
    flagEntity.pottingPoint = pottingPoint;
    resultList.push(flagEntity);
    handler.destroy();
    callBack && callBack(flagEntity);
  }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

  function fineArrow() {
    let points = pottingPoint.length;
    if (points < 2) {
      return false;
    } else {
      let pnts = new Array();
      pottingPoint.forEach(function (item) {
        pnts.push(cartesianToLatlng(item));
      });
      let arcArr = calculatePonits(pnts, type);
      return Cesium.Cartesian3.fromDegreesArray([].concat.apply([], arcArr));
    }
  }
  function cartesianToLatlng(cartesian) {
    let latlng =
      viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian);
    let lat = Cesium.Math.toDegrees(latlng.latitude);
    let lng = Cesium.Math.toDegrees(latlng.longitude);
    return [lng, lat];
  }
};
/**
 *
 * @param {*} points
 * @param {*} type 0-曲线，1-直线，2-正三角，3-倒三角，4-对三角
 * @returns
 */
function calculatePonits(points, type) {
  type = type ? type : 0;
  let components = [];
  // 至少需要两个控制点
  if (points.length > 1) {
    // 取第一个
    let startPoint = points[0];
    // 取最后一个
    let endPoint = points[points.length - 1];
    // 中间点
    let pointCenter = [
      endPoint[0],
      (endPoint[1] - startPoint[1]) / 4 + startPoint[1],
    ];
    // 上曲线起始点
    let point1 = startPoint;
    // 上曲线第一控制点
    let point2 = [
      (endPoint[0] - startPoint[0]) / 4 + startPoint[0],
      (endPoint[1] - startPoint[1]) / 8 + startPoint[1],
    ];
    // 上曲线第二个点
    let point3 = [(startPoint[0] + endPoint[0]) / 2, startPoint[1]];
    // 上曲线第二控制点
    let point4 = [
      ((endPoint[0] - startPoint[0]) * 3) / 4 + startPoint[0],
      -(endPoint[1] - startPoint[1]) / 8 + startPoint[1],
    ];
    // 上曲线结束点
    let point5 = [endPoint[0], startPoint[1]];
    // 下曲线结束点
    let point6 = [endPoint[0], (startPoint[1] + endPoint[1]) / 2];
    // 下曲线第二控制点
    let point7 = [
      ((endPoint[0] - startPoint[0]) * 3) / 4 + startPoint[0],
      ((endPoint[1] - startPoint[1]) * 3) / 8 + startPoint[1],
    ];
    // 下曲线第二个点
    let point8 = [
      (startPoint[0] + endPoint[0]) / 2,
      (startPoint[1] + endPoint[1]) / 2,
    ];
    // 下曲线第一控制点
    let point9 = [
      (endPoint[0] - startPoint[0]) / 4 + startPoint[0],
      ((endPoint[1] - startPoint[1]) * 5) / 8 + startPoint[1],
    ];
    // 下曲线起始点
    let point10 = [startPoint[0], (startPoint[1] + endPoint[1]) / 2];
    // 旗杆底部点
    let point11 = [startPoint[0], endPoint[1]];
    let curve1Points, curve2Points;
    //type：0-曲线，1-直线，2-正三角，3-倒三角，4-对三角
    switch (type) {
      case 0:
        curve1Points = [point1, point2, point3, point4, point5];
        curve2Points = [
          point6,
          point7,
          point8,
          point9,
          point10,
          point10,
          point10,
          point10,
          point10,
        ];
        break;
      case 1:
        curve1Points = [point1, point5];
        curve2Points = [point6, point10, point10, point10, point10, point10];
        break;
      case 2:
        curve1Points = [point1, point6];
        curve2Points = [point6, point10, point10, point10, point10, point10];
        break;
      case 3:
        curve1Points = [point1, point5];
        curve2Points = [point5, point10, point10, point10, point10, point10];
        break;
      case 4:
        curve1Points = [point1, pointCenter];
        curve2Points = [
          pointCenter,
          point10,
          point10,
          point10,
          point10,
          point10,
        ];
        break;
    }
    // 计算上曲线
    let curveTop = utils.getBezierPoints(curve1Points);
    // 计算下曲线
    let curveBottom = utils.getBezierPoints(curve2Points);
    // 合并
    components = curveTop.concat(curveBottom);
    components.push(point11);
    components.push(startPoint);
  }
  return components;
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
      viewer.scene.pick(px); // pick
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
  let chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz0123456789";
  let maxPos = chars.length;
  let pwd = "";
  for (let i = 0; i < len; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * maxPos));
  }
  return pwd;
}
export default CreateFlag;
