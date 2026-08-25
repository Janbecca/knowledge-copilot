import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
});
const files = output.split("\0").filter(Boolean);
const failures = [];
const forbiddenNames = [
  /(^|\/)\.env(?:\.|$)/i,
  /\.(?:db|sqlite|sqlite3)(?:[-.].*)?$/i,
];
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx", ".yaml", ".yml"]);
const secretPatterns = [
  ["OpenAI-style API key", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["GitHub token", /\bgh[opsu]_[A-Za-z0-9]{30,}\b/g],
  ["AWS access key", /\bAKIA[A-Z0-9]{16}\b/g],
  ["private key block", new RegExp(["BEGIN", "(?:RSA |EC |OPENSSH )?PRIVATE", "KEY"].join("\\s+"), "g")],
];

for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized === ".env.example") continue;
  if (forbiddenNames.some((pattern) => pattern.test(normalized))) {
    failures.push(`${file}: forbidden environment/database artifact`);
    continue;
  }
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  const content = readFileSync(file, "utf8");
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) failures.push(`${file}: possible ${label}`);
  }
}

if (failures.length) {
  console.error(["Repository policy check failed:", ...failures.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}

console.log(`Repository policy check passed (${files.length} committable files scanned).`);
