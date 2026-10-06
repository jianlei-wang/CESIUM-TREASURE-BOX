// d3 提供完整的 ESM 运行时；此处使用环境声明（ambient module）避免安装大型类型包，
// 允许各 D3 案例按需命名导入 d3 的任意子模块函数。
declare module 'd3'
declare module 'topojson-client'
declare module 'd3-force'
declare module 'd3-hexbin'
declare module 'd3-contour'
declare module 'd3-sankey'
declare module 'd3-delaunay'
declare module 'd3-quadtree'
declare module 'd3-hull'
declare module 'd3-treemap'
declare module 'd3-hierarchy'
