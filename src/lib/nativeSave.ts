// Inside the Android app (Capacitor) a web page cannot "download" a file. Exports, backups and documents are
// written to the app's cache and handed to Android's share sheet, where the person can save them to Files or
// Drive, or send them on WhatsApp or email. In a browser nothing here is used.
export const isNativeApp = (): boolean =>
  typeof window !== 'undefined' && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function saveInApp(filename: string, blob: Blob): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-120) || 'file';
  const res = await Filesystem.writeFile({ path: safe, data: await toBase64(blob), directory: Directory.Cache });
  await Share.share({ title: safe, files: [res.uri], dialogTitle: 'Save or send' });
}
