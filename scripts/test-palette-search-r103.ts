/**
 * r103 — rankedCap: the palette's shared search-aware cap (one helper, four
 * groups). Pinned here:
 *   • IDLE ORDER — empty/blank query keeps the caller's meaningful order
 *     (due date / next occurrence / priority) and caps at N (today's
 *     behavior, byte-for-byte)
 *   • SEARCH RANK — while typing, ALL items are scored with cmdk's own
 *     defaultFilter (imported, never re-implemented — one scorer for the
 *     list and the cap), positive ranks only, strongest FIRST
 *   • DEEP ROWS REACHABLE — an item beyond the idle cap is found by search
 *     (the r102 "network calendar" bug, generalized: cmdk only filters
 *     RENDERED rows, so the cap must be search-aware)
 *   • ZERO-MATCH → EMPTY — a query nothing matches yields [] (the group
 *     hides; CommandEmpty takes over)
 *   • CAP RESPECTED while searching — at most N matches survive
 *   • KEY CONTRACT — the key function is the same string the CommandItem
 *     renders (documented in the module; enforced by convention + the
 *     palette's single classRowValue source)
 */
import { rankedCap } from "../src/components/erp/palette-search";
import { defaultFilter as cmdkDefaultFilter } from "cmdk";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

interface Row {
  title: string;
  code: string;
}
const rows: Row[] = [
  { title: "ALA 1", code: "BETCE15315" }, // due first
  { title: "SE-Y1-ALA-3", code: "BETCE15322" },
  { title: "PDO Secure CRUD Challenge", code: "BETCE15316" }, // deep row, idle cap hides it
  { title: "Mini Project", code: "BETCE15316" },
];
const key = (r: Row) => `${r.title} ${r.code} ala assignment deadline`;

/* idle: order kept, cap applied */
{
  const out = rankedCap(rows, key, 2, "");
  check("idle: first two in caller order", out.map((r) => r.title).join(",") === "ALA 1,SE-Y1-ALA-3");
  check("idle: blank-query behaves like empty", rankedCap(rows, key, 2, "   ").length === 2);
  check("idle: cap respected", rankedCap(rows, key, 3, "").length === 3);
}

/* search: deep rows reachable, ranked strongest-first */
{
  const out = rankedCap(rows, key, 2, "pdo");
  check("search finds the deep row beyond the cap", out.length === 1 && out[0].title === "PDO Secure CRUD Challenge", JSON.stringify(out));

  const both = rankedCap(rows, key, 8, "betce15316");
  check(
    "two 15316 rows surface, strongest first",
    both.length >= 2 &&
      cmdkDefaultFilter(key(both[0]), "betce15316") >= cmdkDefaultFilter(key(both[1]), "betce15316"),
    JSON.stringify(both.map((r) => r.title))
  );
}

/* empty match + cap while searching */
{
  check("zero-match query → []", rankedCap(rows, key, 8, "zzzzqqqq").length === 0);
  const many: Row[] = Array.from({ length: 12 }, (_, i) => ({ title: `ALA ${i}`, code: "BETCE15315" }));
  check("search cap respected", rankedCap(many, key, 8, "ala").length === 8);
}

console.log(`r103 rankedCap: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
