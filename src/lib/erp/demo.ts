import { getRawSetting, setRawSetting } from "@/lib/settings";
import { ErpSnapshot, ErpReminderSnapshot, ReminderType } from "./types";

/**
 * DEMO ERP simulator — a clearly-labelled stand-in for the real ERP so the whole
 * pipeline (sync → change detection → recalculation → warnings → reminders)
 * works without real ERP credentials. Every UI surface that shows demo data is
 * explicitly labelled "DEMO".
 *
 * The simulated ERP "evolves" over time (like a real college ERP does when
 * teachers mark attendance), so periodic syncs pick up real changes.
 */

const STATE_KEY = "demo.erpState";
const EVOLVE_SLOT_MS = 3 * 60 * 1000; // one potential "class marked" slot every 3 minutes

interface DemoExam {
  externalId: string;
  type: ReminderType;
  title: string;
  description: string;
  dueAt: string;
}

interface DemoState {
  createdAt: string;
  lastEvolveAt: string;
  subjects: { code: string; name: string; present: number; total: number }[];
  exams: DemoExam[];
  examSeq: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function at(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function initialState(): DemoState {
  return {
    createdAt: new Date().toISOString(),
    lastEvolveAt: new Date().toISOString(),
    subjects: [
      { code: "DBMS-301", name: "Database Management Systems", present: 24, total: 34 },
      { code: "CS-302", name: "Java Programming", present: 28, total: 34 },
      { code: "CS-303", name: "Android Application Development", present: 26, total: 34 },
      { code: "CS-304", name: "Web Technology", present: 19, total: 25 },
      { code: "MA-305", name: "Discrete Mathematics", present: 20, total: 30 },
    ],
    exams: [
      {
        externalId: "demo:exam:DBMS-MID-2026",
        type: "EXAM",
        title: "DBMS Mid-Semester Examination",
        description: "Units 1–3. Hall A-204, 10:00 AM.",
        dueAt: at(9, 10, 0),
      },
      {
        externalId: "demo:exam:ANDROID-PRACT-2026",
        type: "PRACTICAL_EXAM",
        title: "Android Practical Exam",
        description: "Carry your lab journal. Lab 3.",
        dueAt: at(13, 14, 0),
      },
      {
        externalId: "demo:exam:JAVA-ASSIGN-2026",
        type: "ASSIGNMENT",
        title: "Java Assignment — Collections",
        description: "Submit PDF on the ERP portal.",
        dueAt: at(2, 17, 0),
      },
      {
        externalId: "demo:exam:WEB-SUBMISSION-2026",
        type: "SUBMISSION",
        title: "Web Technology Project Submission",
        description: "Zip file with source + report.",
        dueAt: at(5, 18, 0),
      },
    ],
    examSeq: 4,
  };
}

async function loadState(): Promise<DemoState> {
  const raw = await getRawSetting(STATE_KEY);
  if (!raw) {
    const s = initialState();
    await setRawSetting(STATE_KEY, JSON.stringify(s));
    return s;
  }
  try {
    return JSON.parse(raw) as DemoState;
  } catch {
    const s = initialState();
    await setRawSetting(STATE_KEY, JSON.stringify(s));
    return s;
  }
}

async function saveState(state: DemoState): Promise<void> {
  await setRawSetting(STATE_KEY, JSON.stringify(state));
}

/** Advance the simulated ERP: each elapsed 3-minute slot may mark a class. */
function evolve(state: DemoState, now: number): boolean {
  const last = new Date(state.lastEvolveAt).getTime();
  const slots = Math.min(4, Math.floor((now - last) / EVOLVE_SLOT_MS));
  if (slots <= 0) return false;

  const rng = mulberry32(hashSeed(state.lastEvolveAt));
  let changed = false;
  for (let i = 0; i < slots; i++) {
    for (const sub of state.subjects) {
      if (sub.total >= 60) continue; // realistic cap per semester
      const r = rng();
      if (r < 0.5) {
        sub.present += 1;
        sub.total += 1;
        changed = true;
      } else if (r < 0.72) {
        sub.total += 1;
        changed = true;
      }
    }
  }

  // Occasionally the ERP reschedules an exam (keeps the same externalId →
  // the sync engine must UPDATE the existing reminder, never duplicate it).
  if (rng() < 0.25) {
    const upcoming = state.exams
      .filter((e) => new Date(e.dueAt).getTime() > now)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    if (upcoming.length > 0) {
      const exam = upcoming[0];
      const d = new Date(exam.dueAt);
      d.setDate(d.getDate() + 2);
      exam.dueAt = d.toISOString();
      changed = true;
    }
  }

  // Sometimes a brand-new announcement appears on the ERP.
  if (rng() < 0.15 && state.exams.length < 6) {
    state.examSeq += 1;
    const kinds: { type: ReminderType; title: string; desc: string; hour: number }[] = [
      { type: "VIVA", title: "DBMS Viva Voce", desc: "Module 3 & 4 questions.", hour: 11 },
      { type: "ASSIGNMENT", title: "Android Assignment — Activities", desc: "Submit before deadline.", hour: 16 },
      { type: "SUBMISSION", title: "Mathematics Tutorial Sheet", desc: "Handwritten, in class.", hour: 9 },
    ];
    const k = kinds[Math.floor(rng() * kinds.length)];
    state.exams.push({
      externalId: `demo:exam:GEN-${state.examSeq}-${new Date().toISOString().slice(0, 10)}`,
      type: k.type,
      title: k.title,
      description: k.desc,
      dueAt: at(4 + Math.floor(rng() * 8), k.hour, 0),
    });
    changed = true;
  }

  state.lastEvolveAt = new Date(now).toISOString();
  return changed;
}

/**
 * Fetch a snapshot from the simulated ERP.
 * force=true guarantees at least one attendance change (used by the
 * "Simulate ERP change" button so the pipeline can be demonstrated on demand).
 */
export async function fetchDemoSnapshot(force = false): Promise<ErpSnapshot> {
  const state = await loadState();
  const now = Date.now();
  let changed = evolve(state, now);

  if (force && !changed) {
    // guarantee a visible change: mark one class attended on a random subject
    const sub = state.subjects[Math.floor(Math.random() * state.subjects.length)];
    if (sub.total < 60) {
      sub.present += 1;
      sub.total += 1;
    }
    changed = true;
    state.lastEvolveAt = new Date(now).toISOString();
  }

  await saveState(state);

  const reminders: ErpReminderSnapshot[] = state.exams
    .filter((e) => new Date(e.dueAt).getTime() > now - 24 * 3600 * 1000) // drop past events like a real ERP
    .map((e) => ({
      externalId: e.externalId,
      type: e.type,
      title: e.title,
      description: e.description,
      dueAt: e.dueAt,
    }));

  return {
    mode: "demo",
    fetchedAt: new Date(now).toISOString(),
    complete: true,
    subjects: state.subjects.map((s) => ({ ...s })),
    reminders,
    note: "Simulated ERP data (DEMO) — replace with real ERP credentials in Settings for live synchronization.",
  };
}
