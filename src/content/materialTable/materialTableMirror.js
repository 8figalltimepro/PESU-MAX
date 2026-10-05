export const MATERIAL_TABLE_MIRROR_KEY = "pesuMaxMaterialTable";

export function readMaterialTableMirror() {
  try {
    return localStorage.getItem(MATERIAL_TABLE_MIRROR_KEY);
  } catch (error) {
    return null;
  }
}

export function writeMaterialTableMirror(enabled) {
  try {
    localStorage.setItem(MATERIAL_TABLE_MIRROR_KEY, enabled ? "1" : "0");
  } catch (error) {
  }
}
