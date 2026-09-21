import type { ComponentType } from "react";

export interface SkinDef {
  id: string;
  name: string;
  component: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
  bodyClass?: string;
}

export const SKINS: SkinDef[] = [
  { id: "none", name: "默认（纯色）", component: () => null, props: {} }
];

export function getSkin(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
