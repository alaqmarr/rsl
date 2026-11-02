import { controlDb, ingressDb, platformLogsDb } from "../index";

controlDb();
ingressDb();
platformLogsDb();
console.log("[rsl/tenancy] Platform databases (control, ingress, platform-logs) migrated cleanly.");
