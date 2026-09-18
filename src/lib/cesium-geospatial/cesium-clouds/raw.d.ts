// Vite `?raw` 导入类型声明（所有扩展名通用，与 core/src/raw.d.ts 一致）。
// clouds 同时用 .glsl / .frag / .vert 三种扩展名做 ?raw 导入，此通配符一并覆盖。
declare module '*?raw' {
  const content: string
  export default content
}
