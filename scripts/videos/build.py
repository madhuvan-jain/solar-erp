#!/usr/bin/env python3
"""Builds the SuryaSetu video guide (English and Hindi) from the recordings made by record.mjs.

  python3 scripts/videos/build.py --work <VIDEO_WORK> --out "user video" [--lang en hi] [--only 01 02]

For each lesson and language: narration (Google text-to-speech, cached), a title card, the recorded screens with each
scene held until its narration ends, a "next video" card, then a 1080p WebM (VP9 + Opus) that YouTube accepts, an SRT
caption file, a 1280x720 thumbnail, and playlist.md / youtube.csv with titles, descriptions, chapters and tags.
Every output is checked (length, streams, sound in every scene) before it is listed.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, time, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FPS, W, H, SR = 25, 1920, 1080, 48000
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ICON = os.path.join(ROOT, 'public', 'icon-512.png')
NOTO = '/usr/share/fonts/truetype/noto/'
LANG = {
    'en': dict(dir='english', tts=dict(lang='en', tld='co.in'), series='SuryaSetu Video Guide', part='Part', next='Next video',
               last='That is the whole guide. Thank you for watching!', playlist='SuryaSetu — Solar business app: full video guide (English)',
               subs='English'),
    'hi': dict(dir='hindi', tts=dict(lang='hi'), series='सूर्यसेतु वीडियो गाइड', part='भाग', next='अगला वीडियो',
               last='यह पूरी गाइड थी। देखने के लिए धन्यवाद!', playlist='SuryaSetu — सोलर बिज़नेस ऐप: पूरी वीडियो गाइड (हिंदी)',
               subs='Hindi'),
}
NAVY, TEAL, SUN = (11, 37, 69), (14, 116, 104), (245, 166, 35)


def font(size, bold=True, hindi=False):
    name = ('NotoSansDevanagari-' if hindi else 'NotoSans-') + ('Bold' if bold else 'Regular') + '.ttf'
    return ImageFont.truetype(NOTO + name, size, layout_engine=ImageFont.Layout.RAQM)


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        raise RuntimeError(f'{cmd[0]} failed: {r.stderr[-800:]}')
    return r.stdout


# ------------------------------------------------------------------ speech
def tts(text, lang, cache):
    """Narration for one text as mono 48 kHz int16 samples (cached by text)."""
    key = hashlib.sha1(f'{lang}|{text}'.encode()).hexdigest()[:20]
    d = os.path.join(cache, lang)
    os.makedirs(d, exist_ok=True)
    wav = os.path.join(d, key + '.wav')
    if not os.path.exists(wav):
        from gtts import gTTS
        mp3 = os.path.join(d, key + '.mp3')
        for attempt in range(6):
            try:
                gTTS(text, **LANG[lang]['tts']).save(mp3)
                break
            except Exception as e:  # rate limits: wait and try again
                if attempt == 5:
                    raise
                time.sleep(4 * (attempt + 1))
        run(['gst-launch-1.0', '-q', 'filesrc', f'location={mp3}', '!', 'mpegaudioparse', '!', 'mpg123audiodec', '!', 'audioconvert', '!',
             'audioresample', '!', f'audio/x-raw,rate={SR},channels=1,format=S16LE', '!', 'wavenc', '!', 'filesink', f'location={wav}'])
        time.sleep(0.4)
    with wave.open(wav) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    # Trim the silence the voice adds at both ends, then bring every clip to the same loudness.
    loud = np.where(np.abs(a) > 300)[0]
    if len(loud):
        a = a[max(0, loud[0] - 1200): loud[-1] + 2400]
    peak = np.max(np.abs(a)) or 1
    return (a * (0.82 * 32767 / peak)).astype(np.int16)


# ------------------------------------------------------------------ cards
def gradient():
    img = Image.new('RGB', (W, H))
    top, bot = np.array(NAVY, float), np.array(TEAL, float)
    t = np.linspace(0, 1, H)[:, None]
    row = (top * (1 - t) + bot * t).astype(np.uint8)
    img.paste(Image.fromarray(np.repeat(row[:, None, :], W, axis=1).reshape(H, W, 3)))
    d = ImageDraw.Draw(img)
    d.ellipse((W - 520, -260, W + 260, 520), fill=(245, 166, 35))  # the sun
    return img.filter(ImageFilter.GaussianBlur(0.6))


def runs(text, hindi):
    """Hindi text often holds English words (PM, kW, WhatsApp): those go in the Latin font, the rest in Devanagari."""
    if not hindi:
        return [(text, False)]
    out, cur, dev = [], '', None
    for ch in text:
        kind = True if '\u0900' <= ch <= '\u097F' else False if ('A' <= ch <= 'Z' or 'a' <= ch <= 'z') else None
        if kind is None or kind == dev or dev is None:
            cur += ch
            dev = kind if dev is None else dev
        else:
            out.append((cur, dev)); cur, dev = ch, kind
    if cur:
        out.append((cur, True if dev is None else dev))
    return out


def tlen(d, text, size, bold, hindi):
    return sum(d.textlength(t, font=font(size, bold, dv)) for t, dv in runs(text, hindi))


def draw(d, xy, text, size, bold, hindi, fill):
    x, y = xy
    for t, dv in runs(text, hindi):
        d.text((x, y), t, font=font(size, bold, dv), fill=fill)
        x += d.textlength(t, font=font(size, bold, dv))


def wrap(d, text, size, bold, hindi, width):
    words, lines, cur = text.split(), [], ''
    for w_ in words:
        t = (cur + ' ' + w_).strip()
        if tlen(d, t, size, bold, hindi) <= width or not cur:
            cur = t
        else:
            lines.append(cur); cur = w_
    if cur:
        lines.append(cur)
    return lines


def card(lang, lesson, kind, next_title=None):
    hi = lang == 'hi'
    L = LANG[lang]
    img = gradient()
    d = ImageDraw.Draw(img)
    icon = Image.open(ICON).convert('RGBA').resize((150, 150))
    img.paste(icon, (120, 110), icon)
    draw(d, (300, 135), L['series'], 56, True, hi, 'white')
    d.text((300, 210), 'SuryaSetu · Solar ERP', font=font(34, False), fill=(220, 235, 240))
    num = int(lesson['id'])
    if kind == 'intro':
        d.rounded_rectangle((120, 380, 120 + 330, 380 + 76), 38, fill=SUN)
        draw(d, (150, 388), f"{L['part']} {num}", 46, True, hi, NAVY)
        y = 500
        for line in wrap(d, lesson['title'][lang], 96, True, hi, W - 260):
            draw(d, (120, y), line, 96, True, hi, 'white'); y += 132
        for line in wrap(d, lesson['about'][lang], 40, False, hi, W - 260)[:3]:
            draw(d, (124, y + 20), line, 40, False, hi, (225, 238, 242)); y += 58
    else:
        y = 420
        if next_title:
            draw(d, (120, y), L['next'] + ':', 54, False, hi, (225, 238, 242)); y += 90
            for line in wrap(d, next_title, 88, True, hi, W - 260):
                draw(d, (120, y), line, 88, True, hi, 'white'); y += 122
        else:
            for line in wrap(d, L['last'], 80, True, hi, W - 260):
                draw(d, (120, y), line, 80, True, hi, 'white'); y += 116
    return img


def thumbnail(lang, lesson, shot):
    """1280x720: the lesson's screen on the right, its number and title on the left."""
    hi = lang == 'hi'
    img = gradient().resize((1280, 720))
    if shot is not None:
        s = shot.resize((760, 428))
        frame = Image.new('RGB', (776, 444), 'white')
        frame.paste(s, (8, 8))
        img.paste(frame.rotate(0), (470, 200))
    d = ImageDraw.Draw(img)
    icon = Image.open(ICON).convert('RGBA').resize((84, 84))
    img.paste(icon, (40, 36), icon)
    d.text((140, 52), 'SuryaSetu', font=font(48, True), fill='white')
    d.rounded_rectangle((40, 160, 40 + 150, 160 + 150), 24, fill=SUN)
    n = lesson['id']
    d.text((115 - d.textlength(n, font=font(92, True)) / 2, 172), n, font=font(92, True), fill=NAVY)
    y = 340
    for line in wrap(d, lesson['title'][lang], 58, True, hi, 420)[:4]:
        draw(d, (40, y), line, 58, True, hi, 'white'); y += 76
    return img


def phone_bg(lang, lesson):
    hi = lang == 'hi'
    img = gradient()
    d = ImageDraw.Draw(img)
    y = 280
    for line in wrap(d, lesson['title'][lang], 72, True, hi, 960)[:2]:
        draw(d, (120, y), line, 72, True, hi, 'white'); y += 96
    y += 30
    for line in wrap(d, lesson['about'][lang], 40, False, hi, 960)[:6]:
        draw(d, (124, y), line, 40, False, hi, (225, 238, 242)); y += 58
    d.rounded_rectangle((1210, 20, 1210 + 539, 20 + 1040), 54, fill=(20, 20, 24))  # the phone
    return img


# ------------------------------------------------------------------ captions
def chunks(text, n=84):
    parts = re.split(r'(?<=[.!?।])\s+', text.strip())
    out = []
    for p in parts:
        while len(p) > n:
            cut = p.rfind(', ', 0, n)
            cut = cut + 1 if cut > n // 3 else p.rfind(' ', 0, n)
            out.append(p[:cut].strip()); p = p[cut:].strip()
        if p:
            out.append(p)
    return out


def ts(t):
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def mmss(t):
    t = int(t)
    return f'{t // 60}:{t % 60:02d}'


# ------------------------------------------------------------------ one video
def build(lesson, lang, nxt, work, outdir):
    rec = os.path.join(work, 'rec', lesson['id'])
    tl = json.load(open(os.path.join(rec, 'timeline.json')))
    frames = tl['frames']
    ftimes = np.array([f[0] for f in frames])
    seq = os.path.join(work, 'seq', lang, lesson['id'])
    shutil.rmtree(seq, ignore_errors=True)
    os.makedirs(seq)
    cache = os.path.join(work, 'tts')
    phone = tl['device'] == 'phone'
    composed = {}

    def src(i):  # a recorded frame, placed on the background for phone lessons
        name = frames[i][1]
        path = os.path.join(rec, 'frames', name)
        if not phone:
            return path
        if name not in composed:
            if 'bg' not in composed:
                composed['bg'] = phone_bg(lang, lesson)
            im = composed['bg'].copy()
            shot = Image.open(path).convert('RGB')
            shot = shot.resize((int(shot.width * 1000 / shot.height), 1000))
            im.paste(shot, (1210 + (539 - shot.width) // 2, 40))
            p = os.path.join(seq, 'c_' + name)
            im.save(p, quality=90)
            composed[name] = p
        return composed[name]

    out_frames, audio, subs, chapters, scene_marks = [], [], [], [], []
    t = 0.0

    def hold(path, secs):
        for _ in range(max(1, int(round(secs * FPS)))):
            out_frames.append(path)

    def say(text, at):
        a = tts(text, lang, cache)
        audio.append((at, a))
        return len(a) / SR

    # Title card
    cdir = os.path.join(work, 'cards', lang)
    os.makedirs(cdir, exist_ok=True)
    intro_p = os.path.join(cdir, f"{lesson['id']}-intro.jpg")
    card(lang, lesson, 'intro').save(intro_p, quality=92)
    d0 = say(lesson['intro'][lang], 0.6)
    subs.append((0.6, 0.6 + d0, lesson['intro'][lang]))
    dur = max(4.0, d0 + 1.2)
    hold(intro_p, dur)
    chapters.append((0.0, 'Introduction' if lang == 'en' else 'परिचय'))
    t = len(out_frames) / FPS

    for i, sc in enumerate(lesson['scenes']):
        mark = tl['scenes'][i]
        a0, a1 = mark['start'], mark['end']
        text = sc[lang]
        dn = say(text, t + 0.25)
        act = (a1 - a0) / 1000.0
        D = max(act, dn + 0.9)
        n = int(round(D * FPS))
        k = 0
        for f in range(n):
            ms = a0 + min(f / FPS, act) * 1000
            k = int(np.searchsorted(ftimes, ms, side='right')) - 1
            out_frames.append(src(max(k, 0)))
        # captions for this scene, spread over its narration by length
        parts = chunks(text)
        total = sum(len(p) for p in parts) or 1
        s0 = t + 0.25
        for p in parts:
            dp = dn * len(p) / total
            subs.append((s0, s0 + dp, p)); s0 += dp
        if sc.get('ch'):
            chapters.append((t, sc['ch'][lang]))
        scene_marks.append((t + 0.25, t + 0.25 + dn))
        t = len(out_frames) / FPS

    # Next-video card
    outro_p = os.path.join(cdir, f"{lesson['id']}-outro.jpg")
    card(lang, lesson, 'outro', nxt['title'][lang] if nxt else None).save(outro_p, quality=92)
    ot = lesson['outro'][lang] if lesson.get('outro') else (f"{LANG[lang]['next']}: {nxt['title'][lang]}." if nxt else LANG[lang]['last'])
    d1 = say(ot, t + 0.5)
    subs.append((t + 0.5, t + 0.5 + d1, ot))
    hold(outro_p, max(4.5, d1 + 1.5))
    total = len(out_frames) / FPS

    # The soundtrack
    track = np.zeros(int(total * SR) + SR, dtype=np.int32)
    for at, a in audio:
        i0 = int(at * SR)
        track[i0:i0 + len(a)] += a[: max(0, len(track) - i0)]
    track = np.clip(track[: int(total * SR)], -32767, 32767).astype(np.int16)
    wav = os.path.join(seq, 'audio.wav')
    with wave.open(wav, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(track.tobytes())

    # The frame sequence (links, no copies)
    for i, p in enumerate(out_frames):
        os.link(p, os.path.join(seq, f's{i:06d}.jpg'))

    name = f"{lesson['id']} - {lesson['title'][lang]}"
    safe = re.sub(r'[\\/:*?"<>|]', '', name)
    os.makedirs(outdir, exist_ok=True)
    webm = os.path.join(outdir, safe + '.webm')
    run(['gst-launch-1.0', '-q', 'multifilesrc', f"location={os.path.join(seq, 's%06d.jpg')}", 'index=0', f'caps=image/jpeg,framerate={FPS}/1', '!',
         'jpegdec', '!', 'videoconvert', '!', 'video/x-raw,format=I420', '!',
         'vp9enc', 'deadline=1', 'cpu-used=5', 'threads=6', 'row-mt=true', 'tile-columns=2', 'end-usage=vbr', 'target-bitrate=3500000',
         f'keyframe-max-dist={FPS * 5}', '!', 'queue', '!', 'webmmux', 'name=mux', '!', 'filesink', f'location={webm}',
         'filesrc', f'location={wav}', '!', 'wavparse', '!', 'audioconvert', '!', 'audioresample', '!', 'opusenc', 'bitrate=96000', '!', 'queue', '!', 'mux.'])

    with open(os.path.join(outdir, safe + '.srt'), 'w', encoding='utf-8') as f:
        for i, (a, b, s) in enumerate(subs, 1):
            f.write(f'{i}\n{ts(a)} --> {ts(min(b, total))}\n{s}\n\n')
    shot = Image.open(src(min(len(frames) - 1, int(len(frames) * 0.55)))).convert('RGB') if frames else None
    thumbnail(lang, lesson, shot).save(os.path.join(outdir, safe + '.jpg'), quality=90)

    # YouTube chapters: from 0:00, each at least 10 seconds long
    ch = []
    for at, label in chapters:
        if ch and at - ch[-1][0] < 10:
            continue
        ch.append((at, label))
    if ch and total - ch[-1][0] < 10 and len(ch) > 1:
        ch.pop()
    shutil.rmtree(seq, ignore_errors=True) if os.environ.get('KEEP_SEQ') != '1' else None
    return dict(file=safe, total=total, chapters=ch if len(ch) >= 3 else [], scenes=scene_marks, track=track)


# ------------------------------------------------------------------ checks
def verify(webm, total, scenes, track):
    out = run(['gst-discoverer-1.0', webm])
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', out)
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0
    problems = []
    if 'VP9' not in out: problems.append('no VP9 video')
    if 'Opus' not in out: problems.append('no Opus audio')
    if not re.search(r'Width: 1920', out) or not re.search(r'Height: 1080', out): problems.append('not 1920x1080')
    if abs(dur - total) > 0.6: problems.append(f'length {dur:.1f}s, expected {total:.1f}s')
    for i, (a, b) in enumerate(scenes, 1):
        seg = track[int(a * SR): int(b * SR)].astype(np.float32)
        if not len(seg) or np.sqrt(np.mean(seg ** 2)) < 400:
            problems.append(f'scene {i} has no narration')
    return dur, problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--work', required=True)
    ap.add_argument('--out', default=os.path.join(ROOT, 'user video'))
    ap.add_argument('--lang', nargs='*', default=['en', 'hi'])
    ap.add_argument('--only', nargs='*', default=[])
    args = ap.parse_args()
    lessons = json.load(open(os.path.join(args.work, 'lessons.json')))
    rp = lambda lang: os.path.join(args.work, f'report-{lang}.json')  # one per language: the two can be built at once
    report = {lang: json.load(open(rp(lang))) for lang in LANG if os.path.exists(rp(lang))}
    bad = 0
    for lang in args.lang:
        outdir = os.path.join(args.out, LANG[lang]['dir'])
        for i, L in enumerate(lessons):
            if args.only and L['id'] not in args.only:
                continue
            if not os.path.exists(os.path.join(args.work, 'rec', L['id'], 'timeline.json')):
                print(f'· {lang} {L["id"]}: not recorded yet'); continue
            t0 = time.time()
            r = build(L, lang, lessons[i + 1] if i + 1 < len(lessons) else None, args.work, outdir)
            dur, problems = verify(os.path.join(outdir, r['file'] + '.webm'), r['total'], r['scenes'], r['track'])
            bad += bool(problems)
            report.setdefault(lang, {})[L['id']] = dict(file=r['file'], seconds=round(dur, 1), chapters=r['chapters'], problems=problems)
            print(f"{'✓' if not problems else '✗'} {lang} {r['file']}  {mmss(dur)}  ({time.time() - t0:.0f}s){'  ' + '; '.join(problems) if problems else ''}", flush=True)
            json.dump(report[lang], open(rp(lang), 'w'), ensure_ascii=False, indent=1)
    write_lists(lessons, report, args.out)
    sys.exit(1 if bad else 0)


def write_lists(lessons, report, out):
    for lang, info in report.items():
        L = LANG[lang]
        d = os.path.join(out, L['dir'])
        rows, md = [], [f"# {L['playlist']}\n", 'Upload the videos in this order as one YouTube playlist. For each video: the .webm file, the thumbnail (.jpg, under "Thumbnail") and the captions (.srt, under "Subtitles → Upload file → With timing").\n']
        for les in lessons:
            r = info.get(les['id'])
            if not r:
                continue
            title = f"{les['title'][lang]} | SuryaSetu {L['part']} {int(les['id'])}"
            chap = '\n'.join(f'{mmss(a)} {label}' for a, label in r['chapters'])
            desc = f"{les['about'][lang]}\n\n{chap}\n\n{L['playlist']}\n#SuryaSetu #SolarERP #Solar #PMSuryaGhar" if chap else f"{les['about'][lang]}\n\n{L['playlist']}\n#SuryaSetu #SolarERP #Solar #PMSuryaGhar"
            tags = ', '.join(['SuryaSetu', 'solar ERP', 'solar business software', 'solar installer app', 'PM Surya Ghar'] + les.get('tags', []))
            md.append(f"\n## {les['id']}. {les['title'][lang]}  ({mmss(r['seconds'])})\n\n- **File:** `{r['file']}.webm` · thumbnail `{r['file']}.jpg` · captions `{r['file']}.srt` ({L['subs']})\n- **Title:** {title}\n- **Tags:** {tags}\n\n**Description:**\n\n```\n{desc}\n```\n")
            rows.append([les['id'], r['file'] + '.webm', title, desc, tags, r['file'] + '.jpg', r['file'] + '.srt', str(r['seconds'])])
        open(os.path.join(d, 'playlist.md'), 'w', encoding='utf-8').write('\n'.join(md))
        import csv
        with open(os.path.join(d, 'youtube.csv'), 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f)
            w.writerow(['order', 'video file', 'title', 'description', 'tags', 'thumbnail', 'captions', 'seconds'])
            w.writerows(rows)


if __name__ == '__main__':
    main()
