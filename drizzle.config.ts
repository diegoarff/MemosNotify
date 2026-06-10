import { defineConfig } from "drizzle-kit";

// drizzle-kit only GENERATES migrations here (SQLite/libSQL-compatible SQL).
// Migrations are applied at runtime in Storage.init() via the libSQL migrator.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/storage/drizzle/schema.ts",
  out: "./src/storage/drizzle/migrations",
});
