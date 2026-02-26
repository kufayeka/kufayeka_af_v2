import type { NextApiRequest, NextApiResponse } from "next";
import { promises as fs } from "node:fs";
import path from "node:path";

type DocItem = {
  id: string;
  name: string;
  relativePath: string;
  content: string;
  size: number;
  updatedAt: string;
};

type DocsApiResponse =
  | { docs: DocItem[]; root: string }
  | { error: string };

function setOpenCors(res: NextApiResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS,PATCH");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

async function walkMarkdownFiles(rootDir: string, currentDir: string): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkMarkdownFiles(rootDir, fullPath);
      files.push(...nested);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    files.push(fullPath);
  }

  return files;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DocsApiResponse>
): Promise<void> {
  setOpenCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const docsRoot = path.resolve(process.cwd(), "..", "docs");

  try {
    const stat = await fs.stat(docsRoot);
    if (!stat.isDirectory()) {
      res.status(404).json({ error: "Docs folder not found" });
      return;
    }

    const markdownFiles = await walkMarkdownFiles(docsRoot, docsRoot);
    markdownFiles.sort((a, b) => a.localeCompare(b));

    const docs: DocItem[] = await Promise.all(
      markdownFiles.map(async (absolutePath) => {
        const [content, fileStat] = await Promise.all([
          fs.readFile(absolutePath, "utf8"),
          fs.stat(absolutePath)
        ]);
        const relativePath = toPosixPath(path.relative(docsRoot, absolutePath));
        return {
          id: relativePath,
          name: path.basename(absolutePath),
          relativePath,
          content,
          size: fileStat.size,
          updatedAt: fileStat.mtime.toISOString()
        };
      })
    );

    res.status(200).json({
      docs,
      root: docsRoot
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
}
