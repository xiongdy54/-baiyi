// imageFit.mjs 的类型声明（渲染层与测试共用同一纯函数实现）。
export interface FitImageResult {
  fitScale: number;
  width: number;
  height: number;
}

export function fitImage(
  naturalW: number,
  naturalH: number,
  availableW: number,
  availableH: number,
  zoom?: number
): FitImageResult;
