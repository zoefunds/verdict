import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../lib/env.js";

/**
 * Evidence files are stored on the Fly.io persistent volume mounted at
 * EVIDENCE_STORAGE_PATH (see fly.toml [[mounts]]). Filenames are randomized
 * (never the user-supplied original name) to prevent path traversal and
 * collisions; the original filename is preserved only as metadata in the DB.
 */
export async function saveEvidenceFile(caseId: string, originalFilename: string, buffer: Buffer): Promise<string> {
  const safeExt = path.extname(originalFilename).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const generatedName = `${randomUUID()}${safeExt}`;
  const caseDir = path.join(env.EVIDENCE_STORAGE_PATH, caseId);
  await mkdir(caseDir, { recursive: true });
  const fullPath = path.join(caseDir, generatedName);
  await writeFile(fullPath, buffer);
  return fullPath;
}
