// Draws a map from its box data, seen from above. Used for the minimap now and for
// the map vote cards in a later stage. Higher boxes are drawn lighter.

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(hex, topHeight) {
  const [r, g, b] = hexToRgb(hex || '#888888');
  const lift = Math.min(0.55, topHeight / 9);        // 0 on the floor, lighter as it gets taller
  const mix = (c) => Math.round(c + (255 - c) * lift);
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
}

/**
 * Draw `map` into a square canvas context of `size` pixels.
 * Options: background colour, whether to draw the outer walls.
 */
export function drawMapTopDown(ctx, map, size, opts) {
  const o = Object.assign({ background: '#14171d', walls: false }, opts || {});
  const pxX = size / map.width, pxZ = size / map.depth;
  ctx.save();
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, size, size);

  const boxes = map.boxes
    .filter((b) => o.walls || b.kind !== 'wall')
    .slice()
    .sort((a, b) => (a.y + a.h) - (b.y + b.h));       // low first, so tall things end up on top

  for (const b of boxes) {
    const x = (b.x - b.w / 2 + map.width / 2) * pxX;
    const y = (b.z - b.d / 2 + map.depth / 2) * pxZ;
    const w = b.w * pxX, h = b.d * pxZ;
    ctx.fillStyle = shade(b.c, b.y + b.h);
    ctx.fillRect(x, y, w, h);
    if (w > 3 && h > 3) {
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
  ctx.restore();
}
