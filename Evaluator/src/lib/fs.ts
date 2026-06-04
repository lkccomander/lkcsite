import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, extname, resolve } from "path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJsonLines(path: string): Promise<string[]> {
  const raw = await readFile(path, "utf8");
  return raw.split(/\r?\n/).filter(Boolean);
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  await ensureDir(dir);
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".json")
    .map((entry) => resolve(dir, entry.name));
}

export function fileStem(path: string): string {
  const name = basename(path);
  return name.endsWith(".jsonl") ? name.slice(0, -6) : name.replace(/\.[^.]+$/, "");
}
