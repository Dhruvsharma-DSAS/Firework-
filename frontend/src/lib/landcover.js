export const LAND_CLASSES = [
  ["Tree cover", "#2f5a36"],
  ["Shrubland", "#7d7442"],
  ["Grassland", "#9c9a5c"],
  ["Cropland", "#d1a64f"],
  ["Built-up", "#c6c0b8"],
  ["Bare / sparse", "#8b8073"],
  ["Snow and ice", "#e6ebf0"],
  ["Wetland", "#3f7a73"],
  ["Mangroves", "#2c6a52"],
  ["Moss / lichen", "#8f9a7e"],
];

const RGB = LAND_CLASSES.map((c) => [parseInt(c[1].slice(1, 3), 16), parseInt(c[1].slice(3, 5), 16), parseInt(c[1].slice(5, 7), 16)]);
const state = { pixels: null, width: 0, height: 0, loading: null };

export function loadLandCover(url) {
  if (state.loading) {
    return state.loading;
  }
  state.loading = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      state.pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      state.width = canvas.width;
      state.height = canvas.height;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
  return state.loading;
}

export function landCoverAt(lat, lon) {
  if (!state.pixels) {
    return "";
  }
  const x = Math.min(state.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * state.width)));
  const y = Math.min(state.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * state.height)));
  const i = (y * state.width + x) * 4;
  if (state.pixels[i + 3] < 128) {
    return "Open water";
  }
  let best = 0;
  let bestD = Infinity;
  RGB.forEach((c, k) => {
    const d = (c[0] - state.pixels[i]) ** 2 + (c[1] - state.pixels[i + 1]) ** 2 + (c[2] - state.pixels[i + 2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return LAND_CLASSES[best][0];
}

export function landCoverMatch(lat, lon) {
  if (!state.pixels) {
    return ["", null];
  }
  const x = Math.min(state.width - 1, Math.max(0, Math.floor(((lon + 180) / 360) * state.width)));
  const y = Math.min(state.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * state.height)));
  const i = (y * state.width + x) * 4;
  if (state.pixels[i + 3] < 128) {
    return ["Open water", 0];
  }
  let best = 0;
  let bestD = Infinity;
  RGB.forEach((c, k) => {
    const d = (c[0] - state.pixels[i]) ** 2 + (c[1] - state.pixels[i + 1]) ** 2 + (c[2] - state.pixels[i + 2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return [LAND_CLASSES[best][0], bestD];
}
