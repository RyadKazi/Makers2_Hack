import { aspectFit, localToScreen, panViewBox, screenToLocal, zoomViewBox, type ViewBox } from './mapCoordinates';

const screen = { width: 360, height: 300 };
const bounds = [15, 80, 105, 120] as const;
const viewBox: ViewBox = { x: 0, y: 0, width: 90, height: 40 };

describe('floor-plan coordinate transforms', () => {
  it('accounts for vertical letterboxing when mapping taps', () => {
    const fit = aspectFit(viewBox, screen);
    expect(fit.offsetY).toBeGreaterThan(0);
    const screenPoint = localToScreen({ x: 40, y: 20 }, screen, viewBox);
    expect(screenToLocal(screenPoint, screen, viewBox)).toEqual({ x: 40, y: 20 });
  });

  it('ignores taps in the empty margins outside the rendered plan', () => {
    expect(screenToLocal({ x: screen.width / 2, y: 5 }, screen, viewBox)).toBeNull();
  });

  it('pans in map space and clamps the plan to its floor bounds', () => {
    const moved = panViewBox(viewBox, -24, 0, screen, bounds);
    expect(moved.x).toBeGreaterThan(viewBox.x);
    expect(moved.x + moved.width).toBeLessThanOrEqual(bounds[2]);
  });

  it('zooms without changing the source map aspect ratio', () => {
    const zoomed = zoomViewBox(viewBox, 0.5, bounds);
    expect(zoomed.width / zoomed.height).toBeCloseTo(viewBox.width / viewBox.height);
    expect(zoomed.width).toBeLessThan(viewBox.width);
  });
});
