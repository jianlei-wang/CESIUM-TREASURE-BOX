export const CLUSTER_WORKER_SOURCE = `
let store = null;

self.onmessage = function (event) {
  var message = event.data;
  if (!message) return;

  if (message.type === 'setData') {
    store = message.data;
    store.epoch = message.epoch;
    self.postMessage({ type: 'dataReady', epoch: message.epoch, requestId: message.requestId });
    return;
  }

  if (message.type === 'cluster') {
    if (!store) {
      self.postMessage({ type: 'clusterResult', epoch: message.epoch, requestId: message.requestId, clusters: [], singles: new Int32Array(0), visibleCount: 0, computeTime: 0 });
      return;
    }
    var started = performance.now();
    var result = computeCluster(message.camera, message.options);
    self.postMessage({
      type: 'clusterResult',
      epoch: message.epoch,
      requestId: message.requestId,
      clusters: result.clusters,
      singles: result.singles,
      visibleCount: result.visibleCount,
      computeTime: performance.now() - started
    }, [result.singles.buffer]);
    return;
  }

  if (message.type === 'dispose') {
    store = null;
  }
};

function computeCluster(camera, options) {
  var count = store.count;
  var position = store.position;
  var lons = store.lons;
  var lats = store.lats;
  var width = camera.width;
  var height = camera.height;
  var pixelRange = options.pixelRange;
  var minimumClusterSize = options.minimumClusterSize;

  // 地平线剔除：把相机与点换算到椭球缩放空间（单位球），相机可见区域为
  // camScaled · pointScaled >= 1，小于 1 表示被地球本体遮挡，即使落在视锥内也不应绘制。
  var camPos = camera.cameraPosition;
  var radii = camera.ellipsoidRadii;
  var irx = 1;
  var iry = 1;
  var irz = 1;
  var cvx = 0;
  var cvy = 0;
  var cvz = 0;
  var horizonCulling = false;
  if (camPos && radii && radii[0] > 0 && radii[1] > 0 && radii[2] > 0) {
    irx = 1 / radii[0];
    iry = 1 / radii[1];
    irz = 1 / radii[2];
    cvx = camPos[0] * irx;
    cvy = camPos[1] * iry;
    cvz = camPos[2] * irz;
    horizonCulling = true;
  }

  // Cesium 使用列主序矩阵，裁剪坐标 = projection * view * world，顺序不可颠倒。
  var vp = multiply(camera.projection, camera.view);
  var halfWidth = width * 0.5;
  var halfHeight = height * 0.5;
  var gridCols = Math.max(1, Math.ceil(width / pixelRange));
  var cells = new Map();
  var keys = new Int32Array(count);
  var visibleCount = 0;

  for (var i = 0; i < count; i++) {
    keys[i] = -1;
    var off = i * 3;
    var x = position[off];
    var y = position[off + 1];
    var z = position[off + 2];

    var sx = x * irx;
    var sy = y * iry;
    var sz = z * irz;
    if (horizonCulling && cvx * sx + cvy * sy + cvz * sz < 1) continue;

    var clipX = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
    var clipY = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
    var clipZ = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
    var clipW = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (clipW <= 0) continue;

    var ndcX = clipX / clipW;
    var ndcY = clipY / clipW;
    var ndcZ = clipZ / clipW;
    if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1 || ndcZ < -1 || ndcZ > 1) continue;
    visibleCount++;

    var screenX = (ndcX + 1) * halfWidth;
    var screenY = (1 - ndcY) * halfHeight;
    var col = Math.min(gridCols - 1, Math.max(0, Math.floor(screenX / pixelRange)));
    var row = Math.max(0, Math.floor(screenY / pixelRange));
    var key = row * gridCols + col;
    keys[i] = key;

    var cell = cells.get(key);
    if (cell === undefined) {
      cell = { count: 0, sumLon: 0, sumLat: 0, sumSx: 0, sumSy: 0, sumSz: 0 };
      cells.set(key, cell);
    }
    cell.count++;
    cell.sumLon += lons[i];
    cell.sumLat += lats[i];
    cell.sumSx += sx;
    cell.sumSy += sy;
    cell.sumSz += sz;
  }

  var clusters = [];
  cells.forEach(function (value) {
    if (value.count < minimumClusterSize) return;
    // 聚合点位置取单元格内可见点的均值，均值同样需要做地平线剔除，避免图标落在天际线之外。
    if (horizonCulling) {
      var dot =
        (cvx * value.sumSx + cvy * value.sumSy + cvz * value.sumSz) / value.count;
      if (dot < 1) return;
    }
    clusters.push({
      longitude: value.sumLon / value.count,
      latitude: value.sumLat / value.count,
      pointCount: value.count
    });
  });

  var singleCount = 0;
  for (var j = 0; j < count; j++) {
    var k = keys[j];
    if (k === -1) continue;
    var c = cells.get(k);
    if (c !== undefined && c.count < minimumClusterSize) singleCount++;
  }

  var singles = new Int32Array(singleCount);
  var cursor = 0;
  for (var m = 0; m < count; m++) {
    var key2 = keys[m];
    if (key2 === -1) continue;
    var cell2 = cells.get(key2);
    if (cell2 !== undefined && cell2.count < minimumClusterSize) singles[cursor++] = m;
  }

  return { clusters: clusters, singles: singles, visibleCount: visibleCount };
}

function multiply(a, b) {
  var result = new Float64Array(16);
  for (var col = 0; col < 4; col++) {
    for (var row = 0; row < 4; row++) {
      result[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return result;
}
`
