// The SuryaSetu video guide: one entry per video, in playlist order. Each scene has the English and Hindi narration
// and what happens on screen while it is spoken (h = helpers from engine.mjs). Screens show the demo business.
import { L01 } from './lessons/01-10.mjs';
import { L11 } from './lessons/11-20.mjs';

export const LESSONS = [...L01, ...L11].sort((a, b) => a.id.localeCompare(b.id));
