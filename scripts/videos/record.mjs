// Records the tutorial lessons from the running app (npm run build && npx vite preview --port 4173 first).
//   VIDEO_WORK=/path/to/work node scripts/videos/record.mjs            all lessons
//   VIDEO_WORK=/path/to/work node scripts/videos/record.mjs 05 06      some lessons
// Writes <work>/rec/<id>/frames/*.jpg + timeline.json, and <work>/lessons.json (titles and narration for build.py).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LESSONS } from './lessons.mjs';
import { openLesson, signUp } from './engine.mjs';

const WORK = process.env.VIDEO_WORK || join(tmpdir(), 'suryasetu-videos');
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, 'lessons.json'), JSON.stringify(LESSONS.map((l) => ({
  id: l.id, device: l.device || 'desktop', title: l.title, about: l.about, tags: l.tags || [],
  intro: l.intro, outro: l.outro,
  scenes: l.scenes.map((s) => ({ en: s.en, hi: s.hi, ch: s.ch || null })),
})), null, 1));

const only = process.argv.slice(2);
let failed = 0;
for (const lesson of LESSONS) {
  if (only.length && !only.includes(lesson.id)) continue;
  const dir = join(WORK, 'rec', lesson.id);
  const s = await openLesson(lesson, dir);
  const t = Date.now();
  try {
    await (lesson.setup ? lesson.setup(s.page, s.h) : signUp(s.page));
    await s.h.startCapture();
    await s.page.waitForTimeout(400);
    for (const [i, scene] of lesson.scenes.entries()) {
      s.h.mark('start');
      try { await scene.act(s.h); }
      catch (e) { throw new Error(`scene ${i + 1}: ${String(e.message || e).split('\n')[0]}`); }
      await s.page.waitForTimeout(450);
      s.h.mark('end');
    }
    await s.h.stopCapture();
    if (s.errors.length) throw new Error('errors in the app while recording: ' + s.errors.join(' | '));
    writeFileSync(join(dir, 'timeline.json'), JSON.stringify({ id: lesson.id, device: lesson.device || 'desktop', scenes: s.scenes, frames: s.frames }));
    console.log(`✓ ${lesson.id} ${lesson.title.en} — ${lesson.scenes.length} scenes, ${s.frames.length} frames, ${Math.round((Date.now() - t) / 1000)} s`);
  } catch (e) {
    failed++;
    await s.page.screenshot({ path: join(dir, 'error.png') }).catch(() => {});
    console.log(`✗ ${lesson.id} ${lesson.title.en}: ${e.message}`);
  } finally {
    await s.close();
  }
}
process.exitCode = failed ? 1 : 0;
