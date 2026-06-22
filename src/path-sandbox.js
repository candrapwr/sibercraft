import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export async function resolveWithin(root, requestedPath = ".") {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) {
    throw new Error("Path harus berupa string yang tidak kosong");
  }

  const target = isAbsolute(requestedPath) ? requestedPath : resolve(root, requestedPath);
  const [rootReal, targetReal] = await Promise.all([
    realpath(root),
    realpathAllowingMissing(target),
  ]);
  const rel = relative(rootReal, targetReal);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return targetReal;
  throw new Error(`Path berada di luar workspace sesi: ${requestedPath}`);
}

async function realpathAllowingMissing(path) {
  const trailing = [];
  let current = normalize(path);
  while (true) {
    try {
      const real = await realpath(current);
      return trailing.length ? join(real, ...trailing.reverse()) : real;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) return normalize(path);
      trailing.push(basename(current));
      current = parent;
    }
  }
}
