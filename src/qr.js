import QRCode from "qrcode";
import jpeg from "jpeg-js";

const MARGIN = 4; // белое поле вокруг кода в модулях — нужно сканерам

/** QR-код в PNG: чёрные квадраты на белом, примерно size пикселей по стороне */
export async function qrPng(text, size = 1000) {
  return QRCode.toBuffer(text, { type: "png", errorCorrectionLevel: "M", margin: MARGIN, width: size, color: { dark: "#000000", light: "#ffffff" } });
}

/** QR-код в JPG. Размер модуля — целое число пикселей, чтобы края были чёткими */
export function qrJpg(text, size = 1000) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  const cells = n + MARGIN * 2;
  const scale = Math.max(1, Math.floor(size / cells));
  const width = cells * scale;
  const data = Buffer.alloc(width * width * 4, 0xff);
  for (let y = 0; y < width; y++) {
    const my = Math.floor(y / scale) - MARGIN;
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / scale) - MARGIN;
      if (mx >= 0 && my >= 0 && mx < n && my < n && modules.get(my, mx)) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return jpeg.encode({ data, width, height: width }, 100).data;
}
