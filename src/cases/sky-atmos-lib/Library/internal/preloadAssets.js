import { buildModuleUrl } from "cesium";
import { loadAssetBuffer } from "./AssetCache.js";

const requiredFiles = Object.freeze([
    "local_weather.png", "turbulence.png", "shape.bin", "shape_detail.bin", "stbn.bin",
    "irradiance.exr", "scattering.exr", "transmittance.exr",
]);

export default async function preloadAssets() {
    const results = await Promise.allSettled(requiredFiles.map(file =>
        loadAssetBuffer(buildModuleUrl(`sky-atmos-assets/GeospatialAssets/${file}`))));
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "[SkyAtmos] Asset preloading failed; retry to download missing assets.");
}
