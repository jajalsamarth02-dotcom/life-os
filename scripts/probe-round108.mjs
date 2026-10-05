import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const now = new Date();
const ist = new Date(now.getTime() + 5.5*3600*1000);
console.log('IST now:', ist.toISOString().replace('T',' ').slice(0,16));

const st = await db.syncState.findFirst();
console.log('SyncState:', JSON.stringify(st, null, 1).slice(0, 900));

const logs = await db.syncLog.findMany({ orderBy: { id: 'desc' }, take: 6 });
for (const l of logs) console.log('LOG', l.startedAt?.toISOString?.().replace('T',' ').slice(5,16), l.status, (l.message||'').slice(0,70));

// r107 follow-up: did the student sweep?
const sweeps = await db.changeEvent.findMany({ where: { detail: { contains: 'bulk cleanup' } }, orderBy: { id: 'desc' }, take: 10 });
console.log('\n=== BULK SWEEP EVENTS:', sweeps.length);
for (const s of sweeps) console.log('SWEEP', s.createdAt?.toISOString?.().replace('T',' ').slice(5,16), (s.detail||'').slice(0,120));

// reminder state counts
const rem = await db.reminder.groupBy({ by: ['status'], _count: true });
console.log('\nREMINDERS by status:', rem.map(r => `${r.status}=${r._count}`).join(' '));
const overdue = await db.reminder.count({ where: { status: 'ACTIVE', dueAt: { lt: new Date(Date.now() - 5.5*3600*1000) } } });
console.log('ACTIVE overdue:', overdue);

// WhatsApp channel state
const wa = await db.setting.findUnique({ where: { key: 'notify.wa.lastResult' } });
const waCfg = await db.setting.findUnique({ where: { key: 'notify.wa' } });
console.log('\nWA config:', waCfg?.value?.slice(0, 300));
console.log('WA lastResult:', wa?.value?.slice(0, 300));

// recent notification attempts
const notes = await db.notification.findMany({ orderBy: { id: 'desc' }, take: 5 });
for (const n of notes) console.log('NOTE', n.createdAt?.toISOString?.().replace('T',' ').slice(5,16), n.channel, n.status, (n.error||n.title||'').slice(0,60));

await db.$disconnect();
