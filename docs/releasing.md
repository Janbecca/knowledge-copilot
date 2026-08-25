# Release process

Knowledge Copilot uses Semantic Versioning. While the public contract is still in Beta, versions use `MAJOR.MINOR.PATCH-beta.N` and the package, plugin manifest, tag, and changelog must agree.

## Release gate

1. Start from a clean `main` branch and run `npm ci`.
2. Run `npm audit --audit-level=high` and `npm run verify`.
3. Confirm migrations and MCP contract changes include compatibility notes and tests.
4. Move relevant `Unreleased` entries into a dated version section.
5. Update the version in `package.json`, `package-lock.json`, and `.codex-plugin/plugin.json` together.
6. Open a pull request. Release only after required Node.js 22/24 checks pass.
7. Create an annotated `v<version>` tag and GitHub Release from the changelog entry.

Breaking card protocol, storage schema, MCP input/output, or plugin packaging changes require an explicit migration plan. Do not publish from an unclean working tree, bypass the CI gate, or include generated SQLite databases, `.env` files, credentials, or private conversation fixtures.

The repository is currently `UNLICENSED` and all rights are reserved. Selecting a public license is a product-owner decision and is required before public source distribution that permits reuse.
