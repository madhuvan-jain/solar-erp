// The app's own camera: a live view with GPS, and every photo stamped with where and when it was taken
// (mini map, place, Plus Code, coordinates, date and time, a note and a QR code) — see lib/photoStamp.ts.
// Falls back to the phone's camera app (or choosing a photo) where a live camera is not available.
import { useEffect, useRef, useState } from 'react';
import { useStore, type FileRef } from '../../lib/store';
import { loadTowns, whereIs, type Place } from '../../lib/geo/whereIs';
import { DEFAULT_PHOTO_QR, stampPhoto, stampTime } from '../../lib/photoStamp';
import { BRAND } from '../../config/brand';
import { errorText, useDialogFocus, useFeedback } from './feedback';

export interface GeoPhoto { file: File; geo?: NonNullable<FileRef['geo']> }

type Pos = { lat: number; lng: number; accuracy: number };

const fileName = (d: Date) => `IMG_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.jpg`;

export function GeoCamera({ note: initialNote, onDone, onClose }: { note?: string; onDone: (p: GeoPhoto) => void | Promise<void>; onClose: () => void }) {
  const store = useStore();
  const { toast } = useFeedback();
  const s = store.settings();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const native = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [live, setLive] = useState<'starting' | 'on' | 'off'>('starting');
  const [pos, setPos] = useState<Pos | null>(null);
  const [gpsError, setGpsError] = useState('');
  const [place, setPlace] = useState<Place | null>(null);
  const [now, setNow] = useState(new Date());
  const [note, setNote] = useState(initialNote || s.photoNote || `Captured by ${BRAND.name}`);
  const [shot, setShot] = useState<{ blob: Blob; url: string; at: Date; pos: Pos | null; place: Place | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const dlg = useDialogFocus(true, () => { if (!busy) onClose(); });

  // Location: watched while the camera is open, so it improves while you frame the shot.
  useEffect(() => {
    void loadTowns().then(() => setPos((p) => (p ? { ...p } : p)));
    if (!('geolocation' in navigator)) { setGpsError('This device cannot share its location.'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setGpsError(''); setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
      (e) => setGpsError(e.code === 1 ? 'Location is not allowed — allow it to stamp the place.' : 'Looking for GPS… (works best outdoors)'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(t); };
  }, []);
  useEffect(() => { setPlace(pos ? whereIs(pos.lat, pos.lng) : null); }, [pos]);

  // Live camera.
  useEffect(() => {
    let cancelled = false;
    setLive('starting');
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
        if (cancelled) { st.getTracks().forEach((t) => t.stop()); return; }
        stream.current = st;
        if (video.current) { video.current.srcObject = st; await video.current.play().catch(() => {}); }
        setLive('on');
      } catch { if (!cancelled) setLive('off'); }
    })();
    return () => { cancelled = true; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [facing]);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  const stamp = async (src: CanvasImageSource & { width?: number; height?: number }, at: Date) => {
    const p = pos;
    const pl = p ? whereIs(p.lat, p.lng) : null;
    const qr = p ? (s.photoQrUrl?.trim() || DEFAULT_PHOTO_QR(p.lat, p.lng)) : (s.photoQrUrl?.trim() || '');
    const blob = await stampPhoto(src, { place: pl, accuracy: p?.accuracy, takenAt: at, note: note.trim(), badge: `${BRAND.name} Camera`, qr });
    setShot({ blob, url: URL.createObjectURL(blob), at, pos: p, place: pl });
  };

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    setBusy(true);
    try { await stamp(v, new Date()); } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };

  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const url = URL.createObjectURL(f);
      try {
        const img = new Image();
        await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('That file is not a photo this device can open.')); img.src = url; });
        await stamp(img, new Date());
      } finally { URL.revokeObjectURL(url); }
    } catch (e) { toast(errorText(e), true); } finally { setBusy(false); }
  };

  const use = async () => {
    if (!shot) return;
    setBusy(true);
    try {
      const file = new File([shot.blob], fileName(shot.at), { type: 'image/jpeg' });
      const geo = shot.pos ? { lat: Math.round(shot.pos.lat * 1e6) / 1e6, lng: Math.round(shot.pos.lng * 1e6) / 1e6, accuracy: Math.round(shot.pos.accuracy), at: shot.at.toISOString(), place: shot.place?.address } : undefined;
      await onDone({ file, geo });
    } catch (e) { toast(errorText(e), true); setBusy(false); }
  };

  return (
    <div className="modal-back camera-back">
      <div ref={dlg} className="camera" role="dialog" aria-modal="true" aria-label={`${BRAND.name} Camera`}>
        {shot ? (
          <>
            <img className="camera-view" src={shot.url} alt="The stamped photo" />
            <div className="camera-bar">
              <button type="button" className="btn" onClick={() => { URL.revokeObjectURL(shot.url); setShot(null); }} disabled={busy}>Retake</button>
              <button type="button" className="btn primary" onClick={() => void use()} disabled={busy} data-autofocus>{busy ? 'Saving…' : 'Use photo'}</button>
            </div>
          </>
        ) : (
          <>
            {live !== 'off' ? (
              <video ref={video} className="camera-view" playsInline muted autoPlay aria-label="Camera view" />
            ) : (
              <div className="camera-view camera-off">
                <p>The live camera is not available here{typeof window !== 'undefined' && !window.isSecureContext ? ' (it needs a secure https:// address)' : ''}.</p>
                <button type="button" className="btn primary" onClick={() => native.current?.click()}>📷 Open the phone camera</button>
                <p className="small">The photo is stamped with the place and time when you come back.</p>
              </div>
            )}
            {/* What the stamp will say, live */}
            <div className="camera-info" aria-live="polite">
              <strong>{place ? place.title : gpsError || 'Looking for GPS…'}</strong>
              {place && <span>{place.address}</span>}
              {pos && <span>Lat {pos.lat.toFixed(6)}°  Long {pos.lng.toFixed(6)}° · <b className={pos.accuracy <= 20 ? 'good' : pos.accuracy <= 60 ? 'ok' : 'poor'}>±{Math.round(pos.accuracy)} m</b></span>}
              <span>{stampTime(now)}</span>
              <label className="camera-note"><span>Note</span><input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} /></label>
            </div>
            <div className="camera-bar">
              <button type="button" className="btn" onClick={onClose} disabled={busy} aria-label="Close camera">✕</button>
              <button type="button" className="btn" onClick={() => gallery.current?.click()} disabled={busy}>From gallery</button>
              <button type="button" className="shutter" onClick={() => void (live === 'on' ? capture() : native.current?.click())} disabled={busy || live === 'starting'} aria-label="Take photo" />
              <button type="button" className="btn" onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')} disabled={busy || live !== 'on'} aria-label="Switch camera">⟲</button>
            </div>
          </>
        )}
        <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void fromFile(f); }} />
        <input ref={native} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void fromFile(f); }} />
      </div>
    </div>
  );
}

/** A "📷 Camera" button that opens the app's camera and hands back the stamped photo. */
export function CameraButton({ label = '📷 Camera', note, onPhoto, className = 'btn sm', disabled }: {
  label?: string; note?: string; onPhoto: (p: GeoPhoto) => void | Promise<void>; className?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} disabled={disabled}>{label}</button>
      {open && <GeoCamera note={note} onClose={() => setOpen(false)} onDone={async (p) => { await onPhoto(p); setOpen(false); }} />}
    </>
  );
}
