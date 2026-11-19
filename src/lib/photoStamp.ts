// The location stamp burned into site photos taken with the app's camera: a mini map with a pin, the place,
// Plus Code, coordinates, date and time, a note, the app badge and a QR code. Drawn on a canvas, in our design.
import qrcode from 'qrcode-generator';
import { STATE_SHAPES, project } from './geo/indiaMap';
import { nearbyTowns, type Place } from './geo/whereIs';

export interface StampInfo {
  place: Place | null;
  /** GPS accuracy in metres */
  accuracy?: number;
  takenAt: Date;
  note: string;
  /** badge text, e.g. "SuryaSetu Camera" */
  badge: string;
  /** what the QR code opens (empty: no QR) */
  qr: string;
}

export const DEFAULT_PHOTO_QR = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

/** "Tuesday, 10/11/2026 01:29 PM" */
export function stampTime(d: Date): string {
  const day = d.toLocaleDateString('en-IN', { weekday: 'long' });
  const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${day}, ${date} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif';

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Lines of text that fit `width`, at most `max` lines (the last one ends with "…" if cut). */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width <= width || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    let last = kept[max - 1];
    while (last && g.measureText(last + '…').width > width) last = last.slice(0, -1);
    kept[max - 1] = last + '…';
    return kept;
  }
  return lines;
}

/** The mini map: states around the spot (from the app's India map), nearby towns, and a pin. */
function drawMiniMap(g: CanvasRenderingContext2D, x: number, y: number, size: number, place: Place | null) {
  g.save();
  rounded(g, x, y, size, size, size * 0.06);
  g.clip();
  g.fillStyle = '#dfeee6'; g.fillRect(x, y, size, size);
  if (place) {
    const [cx, cy] = project(place.lat, place.lng);
    const span = 22; // map units across (~0.65° ≈ 70 km)
    const k = size / span;
    g.save();
    g.translate(x + size / 2 - cx * k, y + size / 2 - cy * k);
    g.scale(k, k);
    for (const s of STATE_SHAPES) {
      const p = new Path2D(s.d);
      g.fillStyle = s.name === place.state ? '#f6f2e4' : '#e9e4d3';
      g.fill(p);
      g.strokeStyle = '#9aa7a0'; g.lineWidth = 1.2 / k; g.stroke(p);
    }
    g.restore();
    // Nearby towns as dots with names (biggest first).
    g.font = `${Math.max(9, size * 0.055)}px ${FONT}`;
    g.textBaseline = 'middle';
    for (const t of nearbyTowns(place.lat, place.lng, 40, 6)) {
      const [tx, ty] = project(t.lat, t.lng);
      const px = x + size / 2 + (tx - cx) * k, py = y + size / 2 + (ty - cy) * k;
      if (px < x + 4 || px > x + size - 4 || py < y + 4 || py > y + size - 4) continue;
      g.fillStyle = '#5c6b64'; g.beginPath(); g.arc(px, py, size * 0.012, 0, Math.PI * 2); g.fill();
      if (t.km > 2) { g.fillStyle = '#33403a'; g.fillText(t.name, px + size * 0.025, py); }
    }
    // Scale hint: ~10 km
    g.strokeStyle = '#33403a'; g.lineWidth = Math.max(1, size * 0.008);
    const bar = (10 / 111) * (33.9) * k; // 10 km in map units → px (longitude scale at ~23°N)
    g.beginPath(); g.moveTo(x + size * 0.06, y + size * 0.93); g.lineTo(x + size * 0.06 + bar, y + size * 0.93); g.stroke();
    g.fillStyle = '#33403a'; g.font = `${Math.max(8, size * 0.05)}px ${FONT}`; g.textBaseline = 'bottom';
    g.fillText('10 km', x + size * 0.06, y + size * 0.91);
    // The pin.
    const pr = size * 0.07, px = x + size / 2, py = y + size / 2;
    g.fillStyle = '#d93a2b';
    g.beginPath(); g.moveTo(px, py); g.arc(px, py - pr * 1.6, pr, Math.PI * 0.85, Math.PI * 0.15); g.closePath(); g.fill();
    g.fillStyle = '#7a1209'; g.beginPath(); g.arc(px, py - pr * 1.6, pr * 0.38, 0, Math.PI * 2); g.fill();
  } else {
    g.fillStyle = '#5c6b64'; g.font = `${size * 0.08}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('No location', x + size / 2, y + size / 2);
    g.textAlign = 'left';
  }
  g.restore();
}

/** Draws the stamp along the bottom of a photo already drawn on `g` (canvas width w, height h). */
export function drawStamp(g: CanvasRenderingContext2D, w: number, h: number, s: StampInfo) {
  const u = Math.min(w, h * 1.35) / 100; // one unit; the stamp keeps its proportions on portrait photos too
  const pad = 1.6 * u, gap = 1.6 * u, margin = 1.6 * u;
  const block = 16.5 * u; // map and QR squares
  const panelH = block + pad * 2;
  const panelW = w - margin * 2;
  const px = margin, py = h - margin - panelH;
  // Panel
  g.save();
  rounded(g, px, py, panelW, panelH, 1.4 * u);
  g.fillStyle = 'rgba(17, 24, 22, 0.72)'; g.fill();
  // Badge above the panel's right end
  g.font = `600 ${2.1 * u}px ${FONT}`;
  const badgeW = g.measureText(s.badge).width + 6.2 * u, badgeH = 3.9 * u;
  const bx = px + panelW - badgeW, by = py - badgeH - 0.6 * u;
  rounded(g, bx, by, badgeW, badgeH, 0.9 * u); g.fillStyle = 'rgba(17, 24, 22, 0.72)'; g.fill();
  // little sun mark
  const sx = bx + 1.9 * u, sy = by + badgeH / 2;
  g.fillStyle = '#f5a623'; g.beginPath(); g.arc(sx, sy, 0.95 * u, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#f5a623'; g.lineWidth = 0.28 * u;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    g.beginPath(); g.moveTo(sx + Math.cos(a) * 1.25 * u, sy + Math.sin(a) * 1.25 * u); g.lineTo(sx + Math.cos(a) * 1.6 * u, sy + Math.sin(a) * 1.6 * u); g.stroke();
  }
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle';
  g.fillText(s.badge, bx + 3.7 * u, sy);
  // Map
  drawMiniMap(g, px + pad, py + pad, block, s.place);
  // QR
  const hasQr = !!s.qr;
  const qx = px + panelW - pad - block;
  if (hasQr) {
    g.fillStyle = '#ffffff'; rounded(g, qx, py + pad, block, block, 1 * u); g.fill();
    const q = qrcode(0, 'M'); q.addData(s.qr); q.make();
    const n = q.getModuleCount(), quiet = 1.1 * u, cell = (block - quiet * 2) / n;
    g.fillStyle = '#000000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect(qx + quiet + c * cell, py + pad + quiet + r * cell, Math.ceil(cell), Math.ceil(cell));
  }
  // Text
  const tx = px + pad + block + gap;
  const tw = (hasQr ? qx - gap : px + panelW - pad) - tx;
  let ty = py + pad + 0.2 * u;
  g.textBaseline = 'top';
  const p = s.place;
  g.fillStyle = '#ffffff';
  g.font = `600 ${3 * u}px ${FONT}`;
  for (const line of wrap(g, p ? p.title : 'Location not available', tw, 2)) { g.fillText(line, tx, ty); ty += 3.55 * u; }
  g.font = `${2.15 * u}px ${FONT}`;
  const lines: string[] = [];
  if (p) {
    lines.push(...wrap(g, p.address, tw, 2));
    lines.push(`Lat ${p.lat.toFixed(6)}°  Long ${p.lng.toFixed(6)}°${s.accuracy ? `  ±${Math.round(s.accuracy)} m` : ''}`);
  } else lines.push('GPS was off or not allowed when this photo was taken');
  lines.push(stampTime(s.takenAt));
  if (s.note) lines.push(...wrap(g, `Note: ${s.note}`, tw, 1));
  const room = py + panelH - pad - ty;
  const lh = Math.min(2.75 * u, room / Math.max(lines.length, 1));
  for (const line of lines) { g.fillText(line, tx, ty, tw); ty += lh; }
  g.restore();
}

/** Puts the stamp on a photo and returns a JPEG (long side at most `maxSide` pixels). */
export async function stampPhoto(src: CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number },
  info: StampInfo, maxSide = 2560): Promise<Blob> {
  const sw = src.videoWidth || src.naturalWidth || src.width || 0, sh = src.videoHeight || src.naturalHeight || src.height || 0;
  if (!sw || !sh) throw new Error('The photo could not be read.');
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const g = c.getContext('2d');
  if (!g) throw new Error('This device cannot prepare the photo.');
  g.drawImage(src, 0, 0, c.width, c.height);
  drawStamp(g, c.width, c.height, info);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.88));
  if (!blob) throw new Error('This device could not save the photo.');
  return blob;
}
