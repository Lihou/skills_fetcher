/**
 * Fetch SKILL.md from GitHub repos and extract descriptions
 * Runs after crawl.ts to enrich skills_index.json with descriptions
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const DATA_DIR = new URL("../data", import.meta.url).pathname;
const MD_DIR = `${DATA_DIR}/skills-md`;
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY ?? 8);
const TOP_N = Number(process.env.FETCH_TOP_N ?? 2000);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const REQUEST_TIMEOUT = 15_000;

interface SkillIndexItem {
  id: string;
  providerId: string;
  source: string;
  skillId: string;
  title: string;
  link: string;
  installsAllTime: number;
  installsTrending: number;
  installsHot: number;
  firstSeenAt: string | null;
  description: string | null;
  skillMdPath: string | null;
}

interface SkillsIndex {
  updatedAt: string;
  sourceUpdatedAt: string;
  providerId: string;
  count: number;
  items: SkillIndexItem[];
}

// ── Common SKILL.md paths to try ─────────────────────────────

function candidatePaths(_source: string, skillId: string): string[] {
  return [
    `skills/${skillId}/SKILL.md`,
    `skills/${skillId}/skill.md`,
    `.claude/skills/${skillId}/SKILL.md`,
    `.claude/skills/${skillId}/skill.md`,
    `.cursor/skills/${skillId}/SKILL.md`,
    `SKILL.md`,
    `skill.md`,
  ];
}

// ── Fetch raw file from GitHub ───────────────────────────────

async function fetchGitHubRaw(source: string, path: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${source}/HEAD/${path}`;
  const headers: Record<string, string> = {};
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `token ${GITHUB_TOKEN}`;
  }

  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (resp.ok) return await resp.text();
    return null;
  } catch {
    return null;
  }
}

// ── Extract description from SKILL.md ────────────────────────

function extractDescription(md: string): string | null {
  // Strip YAML frontmatter
  let body = md;
  if (body.startsWith("---")) {
    const end = body.indexOf("---", 3);
    if (end !== -1) {
      body = body.slice(end + 3).trim();
    }
  }

  // Skip the first heading
  const lines = body.split("\n");
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("#")) {
      startIdx = i + 1;
      break;
    }
    // If no heading, start from the beginning
    if (lines[i].trim().length > 0 && !lines[i].trim().startsWith("#")) {
      startIdx = i;
      break;
    }
  }

  // Collect first paragraph (non-empty consecutive lines)
  const paragraphLines: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) {
      if (paragraphLines.length > 0) break;
      continue;
    }
    // Skip headings, code blocks, lists
    if (line.startsWith("#") || line.startsWith("```") || line.startsWith("- [")) continue;
    paragraphLines.push(line);
  }

  if (paragraphLines.length === 0) return null;

  let desc = paragraphLines.join(" ");
  // Clean up markdown formatting
  desc = desc.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // links
  desc = desc.replace(/[*_`]/g, ""); // bold/italic/code
  desc = desc.trim();

  // Truncate to ~200 chars
  if (desc.length > 200) {
    desc = desc.slice(0, 197) + "...";
  }

  return desc.length > 10 ? desc : null;
}

// ── Fetch description for a single skill ─────────────────────

async function fetchSkillDescription(
  item: SkillIndexItem,
): Promise<{ description: string | null; mdPath: string | null }> {
  // Check local cache first
  const cacheDir = `${MD_DIR}/${item.source}/${item.skillId}`;
  const cachePath = `${cacheDir}/SKILL.md`;

  if (existsSync(cachePath)) {
    const content = readFileSync(cachePath, "utf-8");
    const desc = extractDescription(content);
    if (desc) {
      return {
        description: desc,
        mdPath: `data/skills-md/${item.source}/${item.skillId}/SKILL.md`,
      };
    }
  }

  // Try candidate paths on GitHub
  const paths = candidatePaths(item.source, item.skillId);
  for (const path of paths) {
    const content = await fetchGitHubRaw(item.source, path);
    if (content) {
      // Cache locally
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(cachePath, content);

      const desc = extractDescription(content);
      return {
        description: desc,
        mdPath: `data/skills-md/${item.source}/${item.skillId}/SKILL.md`,
      };
    }
  }

  return { description: null, mdPath: null };
}

// ── Concurrent worker pool ───────────────────────────────────

async function processPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("Fetching SKILL.md descriptions...\n");

  const raw = readFileSync(`${DATA_DIR}/skills_index.json`, "utf-8");
  const index: SkillsIndex = JSON.parse(raw);

  // Only process top N skills (by all-time installs, already sorted)
  const toProcess = index.items.slice(0, TOP_N);
  // Skip ones that already have descriptions
  const needsFetch = toProcess.filter((item) => !item.description);

  console.log(`  Total skills: ${index.items.length}`);
  console.log(`  Processing top ${TOP_N}, ${needsFetch.length} need descriptions`);
  console.log(`  Concurrency: ${CONCURRENCY}\n`);

  let fetched = 0;
  let found = 0;

  const results = await processPool(needsFetch, CONCURRENCY, async (item) => {
    const result = await fetchSkillDescription(item);
    fetched++;
    if (result.description) found++;
    if (fetched % 100 === 0) {
      console.log(`  Progress: ${fetched}/${needsFetch.length} (${found} descriptions found)`);
    }
    return { id: item.id, ...result };
  });

  // Update index with descriptions
  const descMap = new Map(results.map((r) => [r.id, r]));
  for (const item of index.items) {
    const result = descMap.get(item.id);
    if (result?.description) {
      item.description = result.description;
      item.skillMdPath = result.mdPath;
    }
  }

  writeFileSync(`${DATA_DIR}/skills_index.json`, JSON.stringify(index, null, 2));

  console.log(`\nDone! ${found}/${fetched} skills got descriptions.`);
}

main().catch((err) => {
  console.error("Fetch descriptions failed:", err);
  process.exit(1);
});
