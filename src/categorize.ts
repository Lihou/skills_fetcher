/**
 * Rule-based skill categorization
 * Reads skills_index.json and builds skills_category_index.json
 */

import { readFileSync, writeFileSync } from "fs";

const DATA_DIR = new URL("../data", import.meta.url).pathname;

interface SkillIndexItem {
  id: string;
  source: string;
  skillId: string;
  title: string;
}

interface SkillsIndex {
  items: SkillIndexItem[];
}

interface CategoryIndex {
  updatedAt: string;
  version: number;
  primaryCategories: string[];
  skillToCategory: Record<string, string>;
}

// ── Category rules ───────────────────────────────────────────

const CATEGORIES: [string, RegExp][] = [
  ["development-tools", /\b(code|coding|dev|debug|lint|test|git|ci|cd|deploy|docker|k8s|kubernetes|terraform|aws|gcp|azure|api|sdk|cli|compiler|build|webpack|vite|npm|yarn|rust|python|java|typescript|javascript|react|vue|angular|svelte|node|deno|bun|go|swift|kotlin|flutter|android|ios|mobile|web|frontend|backend|fullstack|database|sql|postgres|mongo|redis|graphql|rest|grpc|microservice|devops|infra|cloud|server|lambda|function|endpoint|route|middleware|auth|oauth|jwt|session|cookie|cors|csrf|xss|injection|security|vuln|pentest|ctf|hack|exploit|patch|hotfix|refactor|migrate|upgrade|version|release|changelog|semver|monorepo|workspace)\b/i],
  ["data-analysis", /\b(data|analytics|analysis|dashboard|chart|graph|viz|visual|report|metric|kpi|bi|etl|pipeline|warehouse|lake|spark|hadoop|pandas|numpy|scipy|matplotlib|jupyter|notebook|statistics|stat|ml|machine.?learning|ai|model|train|predict|classify|cluster|neural|deep.?learn|llm|gpt|bert|transformer|embed|vector|rag|prompt|fine.?tun|dataset|feature|label|annotate|nlp|sentiment|token|parse|scrape|crawl|extract)\b/i],
  ["document-processing", /\b(document|doc|pdf|word|excel|csv|json|xml|yaml|markdown|md|html|latex|template|format|convert|transform|parse|extract|ocr|scan|image|photo|video|audio|media|file|upload|download|compress|archive|zip|encrypt|decrypt|sign|stamp|watermark|merge|split|batch|bulk|process|workflow|automat|pipe)\b/i],
  ["creative-media", /\b(design|figma|sketch|photoshop|illustrator|canva|ui|ux|css|style|theme|color|font|typography|layout|responsive|animate|motion|3d|render|game|unity|unreal|godot|pixel|sprite|asset|texture|material|shader|vfx|sfx|music|sound|voice|tts|stt|speech|video|stream|record|edit|cut|trim|subtitle|caption|transcri|podcast|youtube|tiktok|instagram|social|content|blog|post|article|story|creative|art|draw|paint|generate|diffusion|dall|midjourney|stable)\b/i],
  ["communication-writing", /\b(write|writing|writer|copywrite|copy|edit|proofread|grammar|spell|translate|translat|i18n|l10n|locale|language|english|chinese|spanish|french|german|japanese|korean|email|mail|letter|memo|proposal|pitch|present|slide|deck|speak|communicat|chat|message|sms|notify|notification|alert|webhook|slack|discord|teams|telegram|bot|assist|help|support|faq|knowledge.?base|wiki|documentation|readme|changelog|guide|tutorial|howto|explain|summariz|tldr|brief|abstract|outline)\b/i],
  ["business-marketing", /\b(business|market|marketing|seo|sem|ads|advertis|campaign|funnel|lead|crm|sales|revenue|price|cost|budget|forecast|finance|account|invoice|payment|stripe|paypal|billing|subscri|saas|startup|founder|ceo|cto|product|roadmap|strategy|plan|goal|okr|kpi|growth|retention|churn|conversion|ab.?test|experiment|survey|feedback|review|rating|nps|customer|client|user|persona|segment|cohort|outreach|cold|warm|network|linkedin|twitter)\b/i],
  ["productivity", /\b(productiv|todo|task|project|manage|organize|automate|workflow|schedule|calendar|time|track|pomodoro|focus|habit|routine|template|snippet|shortcut|hotkey|macro|script|shell|bash|zsh|terminal|command|alias|dotfile|config|setting|prefer|custom|personal|note|notion|obsidian|roam|logseq|bookmark|save|archive|backup|sync|cloud|storage|drive|dropbox|search|find|filter|sort|tag|label|folder|workspace|desktop|window|tab|split|arrange|clipboard|paste|history)\b/i],
  ["collaboration", /\b(collaborat|team|group|share|invite|permission|role|access|admin|member|contributor|reviewer|approve|merge|pull.?request|pr|issue|ticket|bug|feature.?request|board|kanban|agile|scrum|sprint|standup|retro|meeting|call|zoom|google.?meet|pair|mob|live|real.?time|concurrent|conflict|resolve|comment|thread|discuss|vote|poll|decide|consensus)\b/i],
  ["security", /\b(security|secure|encrypt|decrypt|hash|salt|password|credential|secret|vault|key|cert|ssl|tls|https|firewall|vpn|proxy|tor|privacy|anonym|gdpr|compliance|audit|log|monitor|alert|incident|response|forensic|malware|virus|phish|spam|block|allow|deny|rule|policy|rbac|iam|sso|mfa|2fa|otp|biometric|zero.?trust)\b/i],
];

function categorize(skill: SkillIndexItem): string {
  const text = `${skill.source} ${skill.skillId} ${skill.title}`;
  for (const [category, pattern] of CATEGORIES) {
    if (pattern.test(text)) return category;
  }
  return "other";
}

// ── Main ─────────────────────────────────────────────────────

function main() {
  console.log("Building category index...\n");

  const raw = readFileSync(`${DATA_DIR}/skills_index.json`, "utf-8");
  const index: SkillsIndex = JSON.parse(raw);

  const skillToCategory: Record<string, string> = {};
  const counts: Record<string, number> = {};

  for (const item of index.items) {
    const cat = categorize(item);
    skillToCategory[item.id] = cat;
    counts[cat] = (counts[cat] ?? 0) + 1;
  }

  const primaryCategories = CATEGORIES.map(([name]) => name);

  const output: CategoryIndex = {
    updatedAt: new Date().toISOString(),
    version: 1,
    primaryCategories,
    skillToCategory,
  };

  writeFileSync(
    `${DATA_DIR}/skills_category_index.json`,
    JSON.stringify(output, null, 2),
  );

  console.log("Category distribution:");
  for (const [cat, count] of Object.entries(counts).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`\nDone! ${index.items.length} skills categorized.`);
}

main();
