/**
 * Minimal skills.sh crawler
 * Fetches all skills from the public API and builds skills_index.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const API_BASE = "https://skills.sh/api/skills";
const BOARDS = ["all-time", "trending", "hot"] as const;
const DELAY_MS = Number(process.env.SKILLS_API_DELAY_MS ?? 50);
const REQUEST_TIMEOUT = 30_000;
const MAX_RETRIES = 4;
const DATA_DIR = new URL("../data", import.meta.url).pathname;

type Board = (typeof BOARDS)[number];

interface ApiSkill {
  source: string;
  skillId: string;
  name: string;
  installs: number;
}

interface ApiResponse {
  skills: ApiSkill[];
  total: number;
  hasMore: boolean;
  page: number;
}

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

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
      if (resp.ok) return resp;
      if (resp.status === 429 || resp.status >= 500) {
        console.warn(`  HTTP ${resp.status}, retry ${attempt + 1}/${MAX_RETRIES}...`);
        await sleep(200 * 2 ** attempt);
        continue;
      }
      throw new Error(`HTTP ${resp.status} for ${url}`);
    } catch (err: any) {
      if (attempt === MAX_RETRIES - 1) throw err;
      console.warn(`  Request failed (${err.message}), retry ${attempt + 1}/${MAX_RETRIES}...`);
      await sleep(200 * 2 ** attempt);
    }
  }
  throw new Error("unreachable");
}

// ── Fetch all pages for a board ──────────────────────────────

async function fetchBoard(board: Board): Promise<ApiSkill[]> {
  const all: ApiSkill[] = [];
  let page = 0;

  while (true) {
    const url = `${API_BASE}/${board}/${page}`;
    console.log(`  Fetching ${board} page ${page}...`);

    const resp = await fetchWithRetry(url);
    const data: ApiResponse = await resp.json();

    all.push(...data.skills);

    if (!data.hasMore) break;
    page++;
    await sleep(DELAY_MS);
  }

  console.log(`  ${board}: ${all.length} skills`);
  return all;
}

// ── First-seen timestamps ────────────────────────────────────

function loadFirstSeen(): Map<string, string> {
  const path = `${DATA_DIR}/skills_first_seen.json`;
  try {
    if (!existsSync(path)) return new Map();
    const obj = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveFirstSeen(map: Map<string, string>) {
  const obj = Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`${DATA_DIR}/skills_first_seen.json`, JSON.stringify(obj, null, 2));
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("Skills Feed Lite - Crawling skills.sh API\n");

  // Fetch all boards
  const boardData: Record<Board, ApiSkill[]> = {} as any;
  for (const board of BOARDS) {
    boardData[board] = await fetchBoard(board);
  }

  // Build install count maps
  const installsAllTime = new Map<string, number>();
  const installsTrending = new Map<string, number>();
  const installsHot = new Map<string, number>();

  for (const s of boardData["all-time"]) {
    const id = `${s.source}/${s.skillId}`;
    installsAllTime.set(id, Math.max(installsAllTime.get(id) ?? 0, s.installs));
  }
  for (const s of boardData["trending"]) {
    const id = `${s.source}/${s.skillId}`;
    installsTrending.set(id, Math.max(installsTrending.get(id) ?? 0, s.installs));
  }
  for (const s of boardData["hot"]) {
    const id = `${s.source}/${s.skillId}`;
    installsHot.set(id, Math.max(installsHot.get(id) ?? 0, s.installs));
  }

  // Collect all unique skills
  const skillMap = new Map<string, ApiSkill>();
  for (const board of BOARDS) {
    for (const s of boardData[board]) {
      const id = `${s.source}/${s.skillId}`;
      if (!skillMap.has(id)) {
        skillMap.set(id, s);
      }
    }
  }

  // Load and update first-seen timestamps
  const firstSeen = loadFirstSeen();
  const now = new Date().toISOString();
  for (const id of skillMap.keys()) {
    if (!firstSeen.has(id)) {
      firstSeen.set(id, now);
    }
  }
  saveFirstSeen(firstSeen);

  // Build index items
  const items: SkillIndexItem[] = [];
  for (const [id, skill] of skillMap) {
    items.push({
      id,
      providerId: "skills.sh",
      source: skill.source,
      skillId: skill.skillId,
      title: skill.name,
      link: `https://skills.sh/skills/${encodeURIComponent(skill.source)}/${encodeURIComponent(skill.skillId)}`,
      installsAllTime: installsAllTime.get(id) ?? 0,
      installsTrending: installsTrending.get(id) ?? 0,
      installsHot: installsHot.get(id) ?? 0,
      firstSeenAt: firstSeen.get(id) ?? null,
      description: null,
      skillMdPath: null,
    });
  }

  // Sort by all-time installs descending
  items.sort((a, b) => b.installsAllTime - a.installsAllTime);

  const index: SkillsIndex = {
    updatedAt: now,
    sourceUpdatedAt: now,
    providerId: "skills.sh",
    count: items.length,
    items,
  };

  // Write output
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}/skills_index.json`, JSON.stringify(index, null, 2));

  console.log(`\nDone! ${items.length} skills written to data/skills_index.json`);
}

main().catch((err) => {
  console.error("Crawl failed:", err);
  process.exit(1);
});
