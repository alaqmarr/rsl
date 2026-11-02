import { migrateAllTenantsWithCanary } from "../index";

const result = migrateAllTenantsWithCanary();
console.log(
  `[rsl/tenancy] Tenant migration completed: ${result.migrated}/${result.total} succeeded, ${result.failed.length} failed.`
);
if (result.failed.length > 0) {
  process.exitCode = 1;
}
