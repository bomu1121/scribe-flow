import Database from "better-sqlite3";
const db = new Database("data/scribe-flow.sqlite", { readonly: true });
console.log("integrity:", JSON.stringify(db.pragma("integrity_check")));
console.log("journal:", JSON.stringify(db.pragma("journal_mode")));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
console.log("tables:", tables.join(","));
for (const t of tables) {
  const n = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
  console.log(`  ${t}: ${n} rows`);
}
db.close();
