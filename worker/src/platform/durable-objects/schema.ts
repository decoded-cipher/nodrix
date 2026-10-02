export type SchemaStep = (sql: SqlStorage) => void;

// Objects that predate versioning have the tables but no version row, so the
// baseline must stay CREATE ... IF NOT EXISTS — they replay it as a no-op.
export function migrateSchema(ctx: DurableObjectState, steps: SchemaStep[]): void {
  ctx.storage.transactionSync(() => {
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (v INTEGER PRIMARY KEY)`);
    const from = sql.exec<{ v: number }>(`SELECT v FROM schema_version`).toArray()[0]?.v ?? 0;
    if (from >= steps.length) return;
    for (let i = from; i < steps.length; i++) steps[i]!(sql);
    sql.exec(`DELETE FROM schema_version`);
    sql.exec(`INSERT INTO schema_version (v) VALUES (?)`, steps.length);
  });
}
