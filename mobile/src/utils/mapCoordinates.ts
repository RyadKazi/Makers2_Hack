export type Bounds = readonly [minX: number, minY: number, maxX: number, maxY: number];
export type ViewBox = { x: number; y: number; width: number; height: number };
export type ScreenSize = { width: number; height: number };
export type ScreenPoint = { x: number; y: number };

/** Scale and inset used by SVG's xMidYMid meet behavior. */
export function aspectFit(viewBox: ViewBox, screen: ScreenSize) {
  const scale = Math.min(screen.width / viewBox.width, screen.height / viewBox.height);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  return {
    scale,
    offsetX: (screen.width - renderedWidth) / 2,
    offsetY: (screen.height - renderedHeight) / 2,
  };
}

/** Convert a screen tap to local floor-plan coordinates, excluding SVG letterbox space. */
export function screenToLocal(point: ScreenPoint, screen: ScreenSize, viewBox: ViewBox): ScreenPoint | null {
  if (screen.width <= 0 || screen.height <= 0) return null;
  const fit = aspectFit(viewBox, screen);
  const x = (point.x - fit.offsetX) / fit.scale + viewBox.x;
  const y = (point.y - fit.offsetY) / fit.scale + viewBox.y;
  if (x < viewBox.x || x > viewBox.x + viewBox.width || y < viewBox.y || y > viewBox.y + viewBox.height) return null;
  return { x, y };
}

/** Inverse of screenToLocal, useful for accessible overlays anchored to map features. */
export function localToScreen(point: ScreenPoint, screen: ScreenSize, viewBox: ViewBox): ScreenPoint {
  const fit = aspectFit(viewBox, screen);
  return {
    x: fit.offsetX + (point.x - viewBox.x) * fit.scale,
    y: fit.offsetY + (point.y - viewBox.y) * fit.scale,
  };
}

/** Pan in screen points while retaining the SVG aspect ratio. */
export function panViewBox(viewBox: ViewBox, dx: number, dy: number, screen: ScreenSize, bounds: Bounds): ViewBox {
  const scale = aspectFit(viewBox, screen).scale;
  return clampViewBox({ ...viewBox, x: viewBox.x - dx / scale, y: viewBox.y - dy / scale }, bounds);
}

/** Zoom around the current center without distorting the floor-plan coordinate space. */
export function zoomViewBox(viewBox: ViewBox, factor: number, bounds: Bounds): ViewBox {
  const fullWidth = bounds[2] - bounds[0];
  const fullHeight = bounds[3] - bounds[1];
  // Scale both dimensions by one factor. Independent clamping changes the
  // floor-plan aspect ratio and makes route geometry appear stretched.
  const minFactor = Math.max((fullWidth * 0.12) / viewBox.width, (fullHeight * 0.12) / viewBox.height);
  const maxFactor = Math.min(fullWidth / viewBox.width, fullHeight / viewBox.height);
  const scale = Math.max(minFactor, Math.min(maxFactor, factor));
  const nextWidth = viewBox.width * scale;
  const nextHeight = viewBox.height * scale;
  const centerX = viewBox.x + viewBox.width / 2;
  const centerY = viewBox.y + viewBox.height / 2;
  return clampViewBox({ x: centerX - nextWidth / 2, y: centerY - nextHeight / 2, width: nextWidth, height: nextHeight }, bounds);
}

function clampViewBox(viewBox: ViewBox, bounds: Bounds): ViewBox {
  const maxX = bounds[2] - viewBox.width;
  const maxY = bounds[3] - viewBox.height;
  return {
    ...viewBox,
    x: Math.max(bounds[0], Math.min(maxX, viewBox.x)),
    y: Math.max(bounds[1], Math.min(maxY, viewBox.y)),
  };
}
