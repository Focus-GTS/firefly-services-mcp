# Release checklist (internal)

The runbook for cutting a version of `@focusgts/firefly-services-mcp`. Follow top to bottom. Steps are ordered so that anything reversible happens before anything irreversible (npm publish and the private→public flip are the points of no return).

## 1. Pre-release verification

Run the full local gate. All must be green:

```bash
npm run lint                       # tsc --noEmit, strict
npm test                           # unit tests
npm run test:integration:mocked    # msw HTTP-layer integration
```

- [ ] Lint clean
- [ ] Unit tests pass
- [ ] Mocked integration tests pass
- [ ] CI is green on `main` (the same three jobs run there + the publish dry-run)
- [ ] `git status` is clean — no uncommitted changes
- [ ] You are on `main` and up to date with `origin/main`

## 2. Version bump

Semantic versioning, scoped to the tool surface:

| Change | Bump |
|---|---|
| Bug fix, doc change, internal refactor — no tool-schema change | **patch** (`0.1.0` → `0.1.1`) |
| New tool, new optional argument, or other backward-compatible surface change | **minor** (`0.1.0` → `0.2.0`) |
| Removed/renamed tool, removed/renamed argument, changed required-argument shape | **major** (`0.1.0` → `1.0.0`) |

```bash
npm version <patch|minor|major> --no-git-tag-version
```

- [ ] `package.json` version updated
- [ ] `SERVER_VERSION` is read from `package.json` at runtime (no second source of truth — verify it still is)

## 3. Changelog

`CHANGELOG.md` does not exist yet as of v0.1.x. The first release that adds one sets the format — use [Keep a Changelog](https://keepachangelog.com/) with sections grouped under the version + date.

- [ ] Changelog entry written for this version (added / changed / fixed / removed)
- [ ] Entry dated

## 4. Build verification

```bash
npm run build
test -f dist/server.js
head -n 1 dist/server.js | grep -q '^#!/usr/bin/env node'   # shebang present for the bin entry
```

Smoke-test the protocol over stdio (no credentials needed — it lists tools before any API call):

```bash
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"rel","version":"0"}}}'
LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
( printf '%s\n%s\n%s\n' "$INIT" '{"jsonrpc":"2.0","method":"notifications/initialized"}' "$LIST"; sleep 1 ) \
  | FIREFLY_SERVICES_CLIENT_ID=dummy FIREFLY_SERVICES_CLIENT_SECRET=dummy node dist/server.js 2>/dev/null
```

- [ ] `dist/server.js` produced, shebang present
- [ ] Smoke test lists all 18 tools

## 5. Package inspection

```bash
npm pack --dry-run
```

- [ ] Tarball includes: `dist/`, `README.md`, `NOTICE`, `LICENSE`
- [ ] Tarball EXCLUDES: `test/`, `examples/`, `src/`, `.github/`, `.env`, `live-test-tmp/`
- [ ] Packed size is sane (~60KB for v0.1.0; investigate large jumps)

## 6. Tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

- [ ] Annotated tag created and pushed

## 7. Publish to npm

Scoped package — `--access public` is required on the first publish and harmless thereafter.

```bash
npm whoami                         # confirm logged in as the publishing account
npm publish --access public
```

- [ ] Publish succeeded
- [ ] Logged in as the correct npm account/org before publishing

## 8. Verify on the registry

- [ ] Package visible at https://www.npmjs.com/package/@focusgts/firefly-services-mcp
- [ ] Version, README, and `bin` entry render correctly

## 9. GitHub release

- [ ] Create a GitHub release from tag `vX.Y.Z`
- [ ] Paste the changelog excerpt for this version
- [ ] Attach any relevant artifacts

## 10. Post-publish smoke test (from the registry, not local)

In a throwaway directory:

```bash
cd "$(mktemp -d)"
npx @focusgts/firefly-services-mcp@latest --help 2>/dev/null || true
# Or wire it into Claude Code and confirm it boots + lists 18 tools:
# claude mcp add firefly-services -- npx @focusgts/firefly-services-mcp@latest
```

- [ ] Installs and boots from the published package
- [ ] Lists 18 tools

## 11. Rollback plan

npm does **not** allow unpublish after 72 hours (and discourages it before). The safe rollback is deprecation, not removal:

```bash
npm deprecate @focusgts/firefly-services-mcp@X.Y.Z "Deprecated: <reason>. Use X.Y.(Z+1)."
```

- [ ] If a bad version ships: deprecate it, publish a fixed patch, point the deprecation message at the fix

---

## First public release (v0.1.0) — additional steps

The repo is private during development. The flip to public happens **after** a successful npm publish, never before:

- [ ] npm publish (steps 7–8) succeeded and verified
- [ ] README live-validation status table is accurate and not overclaiming
- [ ] No customer names, partner names, or internal references anywhere in the repo or its git history (history was scrubbed during the pre-release audit — re-verify with a fresh clone)
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `NOTICE` all present
- [ ] Flip the GitHub repo from **private → public** (Settings → Danger Zone → Change visibility)
- [ ] Announce through the FocusGTS channels
