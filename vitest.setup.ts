import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rsl-vitest-isolated-"));
process.env.NODE_ENV = "test";
process.env.DATA_DIR = path.join(tempRoot, "data");
process.env.LOG_DIR = path.join(tempRoot, "logs");
process.env.BACKUP_STAGING_DIR = path.join(tempRoot, "staging");
process.env.BETTER_AUTH_SECRET = "L2C3b03YfkNHR7psHD3hDOEKdiuPst4yaBbJ5srYMtU=";
process.env.ADMIN_AUTH_SECRET = "KfCFso4euF60NEfn/Ubjqk+sIEm40Rlhy4nvkR1gq/0=";
process.env.KMS_MASTER_KEY = "itkU+frolSlzKoVx5Xtt2JTzXbJZuG+jZfjWgoAQuFk=";
process.env.BACKUP_SIGNING_KEY = "AipZq/p5IBj8nSyHdLizTOD17GTPJh7fS4ImHrrZAu4=";
process.env.API_KEY_PEPPER = "2RNqOFfiU8IFKTs1SjzHdHoCxJU83d1IJHG9xZ5iqP4=";
process.env.RSL_TEST_TEMP_ROOT = tempRoot;
