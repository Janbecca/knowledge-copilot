import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const repository = process.cwd();
const canonicalSkill = join(repository, "skills", "capture-conversation-knowledge");
const betaSkill = join(repository, "plugins", "knowledge-copilot-beta", "skills", "capture-conversation-knowledge");
const temporaryRoot = mkdtempSync(join(tmpdir(), "knowledge-copilot-plugin-"));

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function copy(source, destination) {
  if (!existsSync(source)) throw new Error(`Missing package input: ${relative(repository, source)}`);
  const entries = readdirSync(source, { withFileTypes: true });
  mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) copy(from, to);
    else copyFileSync(from, to);
  }
}

function copyFile(source, destination) {
  if (!existsSync(source)) throw new Error(`Missing package input: ${relative(repository, source)}`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function validateMarkdown(root) {
  for (const file of walk(root).filter((path) => path.endsWith(".md"))) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
      const target = decodeURIComponent(rawTarget.split("#", 1)[0]);
      if (!existsSync(resolve(dirname(file), target))) {
        throw new Error(`${relative(root, file)} has broken relative reference: ${rawTarget}`);
      }
    }
  }
}

function compareTrees(left, right) {
  const leftFiles = walk(left).map((path) => relative(left, path)).sort();
  const rightFiles = walk(right).map((path) => relative(right, path)).sort();
  if (JSON.stringify(leftFiles) !== JSON.stringify(rightFiles)) throw new Error("Final and Beta Skill file lists differ.");
  for (const file of leftFiles) {
    if (readFileSync(join(left, file)).compare(readFileSync(join(right, file))) !== 0) {
      throw new Error(`Final and Beta Skill copies differ: ${file}`);
    }
  }
}

try {
  compareTrees(canonicalSkill, betaSkill);

  const finalPackage = join(temporaryRoot, "final");
  copy(join(repository, ".codex-plugin"), join(finalPackage, ".codex-plugin"));
  copyFile(join(repository, ".mcp.json"), join(finalPackage, ".mcp.json"));
  copyFile(join(repository, ".app.json"), join(finalPackage, ".app.json"));
  copy(canonicalSkill, join(finalPackage, "skills", basename(canonicalSkill)));
  copy(join(repository, "dist"), join(finalPackage, "dist"));

  const manifest = JSON.parse(readFileSync(join(finalPackage, ".codex-plugin", "plugin.json"), "utf8"));
  for (const field of ["mcpServers", "apps"]) {
    if (!existsSync(resolve(finalPackage, manifest[field]))) throw new Error(`Manifest field ${field} does not resolve.`);
  }
  const mcp = JSON.parse(readFileSync(join(finalPackage, manifest.mcpServers), "utf8"));
  for (const server of Object.values(mcp.mcpServers ?? {})) {
    for (const argument of server.args ?? []) {
      if (typeof argument === "string" && argument.startsWith("./") && !existsSync(resolve(finalPackage, argument))) {
        throw new Error(`MCP argument does not resolve after standalone copy: ${argument}`);
      }
    }
  }
  validateMarkdown(finalPackage);

  const betaPackage = join(temporaryRoot, "beta");
  copy(join(repository, "plugins", "knowledge-copilot-beta"), betaPackage);
  validateMarkdown(betaPackage);
  console.log("Plugin package check passed (final + Beta standalone copies)." );
} finally {
  const resolvedTemporary = resolve(temporaryRoot);
  if (!resolvedTemporary.startsWith(resolve(tmpdir()))) throw new Error("Refusing to remove a non-temporary directory.");
  rmSync(resolvedTemporary, { recursive: true, force: true });
}
