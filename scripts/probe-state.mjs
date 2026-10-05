import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const settings = await p.setting.findMany({ where: { key: { in: ["notify.whatsapp.phone.enc","notify.whatsapp.apikey.enc","notify.whatsapp.enabled","notify.whatsapp.digestTime","notify.ntfy.enc","notify.ntfy.enabled","notify.ntfy.digestTime","calendar.ics.token","erp.courseNames"] } } });
for (const s of settings) console.log(s.key, "=", s.key.endsWith("enc") ? "<encrypted>" : s.value.slice(0,60));
const keys = await p.setting.findMany({ select: { key: true } });
console.log("ALL KEYS:", keys.map(k=>k.key).join(", "));
await p.$disconnect();
