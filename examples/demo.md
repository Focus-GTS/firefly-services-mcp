# Demo Script — Firefly Services MCP Server

A guided walkthrough for demonstrating the `@focusgts/firefly-services-mcp` server through Claude Code. Designed to be run live in front of an audience (e.g., an Adobe FDE leadership demo) or executed as a recorded walkthrough.

**Total time:** ~12-15 minutes including narration.
**Audience:** Adobe Firefly Services product / FDE leadership, partner-program contacts, prospective customer engineering teams.

---

## Pre-flight (do this once, not on stage)

### 1. Credentials

You need a valid Firefly Services OAuth Server-to-Server credential pair. For partner-dev use, this comes from your Silver-tier Firefly Services sandbox in the [Adobe Partner Benefits Center](https://partnerbenefitscenter.adobe.com/benefits-center.html).

Export to your shell environment:

```bash
export FIREFLY_SERVICES_CLIENT_ID="<your client id>"
export FIREFLY_SERVICES_CLIENT_SECRET="<your client secret>"
```

Verify the credentials work before the demo:

```bash
curl --silent --location "https://ims-na1.adobelogin.com/ims/token/v3" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$FIREFLY_SERVICES_CLIENT_ID" \
  --data-urlencode "client_secret=$FIREFLY_SERVICES_CLIENT_SECRET" \
  --data-urlencode "scope=openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis,firefly_enterprise,creative_sdk" \
  | jq -r '.access_token | "Token acquired: \(.[0:12])..."'
```

If this returns a token preview, you're ready. If it errors, re-check the credentials.

### 2. Install the MCP server in Claude Code

```bash
# Local-source install (during development):
claude mcp add firefly-services -- npx tsx /Users/davefox/Code/Firefly/firefly-services-mcp/src/server.ts

# Once published to npm:
claude mcp add firefly-services -- npx @focusgts/firefly-services-mcp
```

The credentials propagate from your shell environment automatically — Claude Code passes them through to the MCP subprocess.

### 3. Verify tools are loaded

In Claude Code, run:

```
/mcp
```

You should see `firefly-services` listed as a connected server with **18 tools** available. If you only see 1-3 tools or a connection error, the server isn't loading — check that:

- The credentials are exported in the shell that launched Claude Code (not just in `.bashrc` for a different shell)
- Node 20+ is on PATH
- `tsx` is installed globally or available via the npm script

### 4. Prepare a demo source image

For Demo 2 (image-to-image), have a small JPEG ready at a known path. Anything 1024x1024 or smaller works:

```bash
# Quick: download a small test image
curl -o /tmp/demo-source.jpg "https://picsum.photos/1024/1024"
```

For Demo 4 (PSD template), have a template PSD with at least one named smart-object layer ready in a customer-controlled bucket with a pre-signed GET URL.

---

## Demo flow — 5 prompts in 12 minutes

Each prompt below shows: (a) what you ask Claude, (b) what Claude does behind the scenes, (c) what the audience sees, (d) the narration line.

### Demo 1 — Hello, Firefly *(2 minutes)*

**Ask Claude:**

> Generate an image of a single red apple on a white background using Firefly.

**What Claude does behind the scenes:**

1. Calls `firefly_check_auth` to verify credentials (~200ms)
2. Calls `firefly_generate_image` with `prompt: "a single red apple on a white background"`, `numVariations: 1`, `size: square_1024`
3. The MCP server hits `POST https://firefly-api.adobe.io/v3/images/generate` via the Adobe SDK
4. Returns a JSON summary **plus the inline image bytes** in the MCP response

**What the audience sees:**

- The image renders directly in the Claude Code conversation — not a URL, the actual image
- Below it: a JSON block showing the `seed`, the Adobe-hosted URL, and the size

**Narration:**

> "This is a regular Claude Code session — no special UI, no Adobe-branded extension. The MCP server just shows up as 18 tools Claude can use. When I ask for an image, Claude picks the right tool, calls Firefly through the official Adobe SDK, fetches the result, and shows me the image inline. Round-trip: about 6 seconds. Same call you'd make from a customer's production environment."

---

### Demo 2 — Image-to-image (variations from a local file) *(3 minutes)*

**Ask Claude:**

> Make 3 variations of the image at /tmp/demo-source.jpg, all in the same style.

**What Claude does behind the scenes:**

1. Calls `firefly_generate_similar` with `image: { path: "/tmp/demo-source.jpg" }`, `num_variations: 3`
2. The server detects `path` mode, **auto-uploads the local file** to Firefly storage via `POST /v2/storage/image`, receives an `uploadId`
3. Submits the uploadId to `POST /v3/images/generate-similar`
4. Returns 3 inline images + URLs

**What the audience sees:**

- The original image (shown by Claude implicitly when it reads the path)
- Three variations rendered inline, side-by-side
- A JSON block showing the upload step and the variation generation

**Narration:**

> "Notice I didn't have to upload the image first — Claude passes the local path directly to the tool, and the MCP server handles the upload transparently. Three variations come back inline. This is the campaign-multiplication pattern: one approved hero turns into many derivatives without leaving your editor."

---

### Demo 3 — Canvas extension (generative expand) *(2 minutes)*

**Ask Claude:**

> Take that same source image and expand it to a 16:9 widescreen format. Fill the new area with a natural extension of the scene.

**What Claude does behind the scenes:**

1. Calls `firefly_expand_image` with `image: { uploadId: <from previous call> }`, `size: { width: 2688, height: 1536 }`, `placement: { alignment: { horizontal: center, vertical: center } }`
2. POSTs to `https://firefly-api.adobe.io/v3/images/expand`
3. Returns the expanded image inline

**What the audience sees:**

- The original square image
- A widescreen version with the new pixels filled in coherently
- Side-by-side comparison rendered in the conversation

**Narration:**

> "The MCP server keeps track of the `uploadId` from the previous call, so Claude reuses it instead of re-uploading. Aspect-ratio expansion is one of the highest-value real campaign workflows — content teams shoot square, then expand for landscape and portrait variants. This is that, automated."

---

### Demo 4 — PSD template composition *(3 minutes)*

**Ask Claude:**

> I have a Photoshop template at <pre-signed-url>. Get me its layer manifest so I can see what smart-object layers it has.

**What Claude does behind the scenes:**

1. Calls `photoshop_document_manifest` with `input_url: <signed URL>`
2. POSTs to `https://image.adobe.io/pie/psdService/documentManifest`
3. The Photoshop SDK auto-polls until the job completes
4. Returns the document tree as JSON

**Then ask Claude:**

> Replace the "hero-image" layer with the widescreen image we just generated. Render the result as a JPEG to <output-signed-url>.

**What Claude does:**

1. Calls `photoshop_smart_object_replace` with the template's input URL, layer name `hero-image`, the new image URL from Demo 3, and the output destination
2. Photoshop API replaces the smart-object content and renders to the output bucket
3. Returns confirmation + the output URL

**What the audience sees:**

- A JSON layer manifest
- A confirmation of the smart-object replacement
- The final rendered JPEG, fetched from the output URL and shown inline

**Narration:**

> "This is the template-driven campaign assembly pattern — generate the asset with Firefly, composite it into a brand-template PSD with Photoshop API. Same MCP server, two products, one conversation. This is the workflow a customer's marketing team actually runs in production."

---

### Demo 5 — Lightroom batch normalization *(2 minutes)*

**Ask Claude:**

> Apply the auto-tone preset to this image at <pre-signed-url> and save the result to <output-url>.

**What Claude does:**

1. Calls `lightroom_auto_tone` with the input/output URLs
2. POSTs to `https://image.adobe.io/lrService/autoTone`
3. Lightroom SDK auto-polls until processing completes
4. Returns the processed image inline

**Narration:**

> "Lightroom for tonality. Same MCP server, same pattern. When you stitch the three — Firefly for generation, Photoshop API for compositing, Lightroom for color — what you get is the full content-supply-chain inside a single Claude conversation. That's what enterprise customers are trying to build today."

---

## Closing — what to say at the end

> "Eighteen tools across Firefly, Photoshop, and Lightroom. Open-source, Apache-2.0. Installs in one command. Built off Adobe's official SDKs, validated against the OpenAPI specs they ship. This is the canonical MCP for Firefly Services — first-party-quality, partner-built. The skills repo has 17 companion playbooks covering the workflows. Both live under github.com/focusgts."

---

## Common questions and how to answer them

| Q | A |
|---|---|
| *Did Adobe build this?* | "No, we built it. FocusGTS is a Silver Solution Partner; this is community-contribution work under Apache-2.0. Not officially endorsed by Adobe." |
| *Why isn't it on adobe/skills?* | "We'd love it to be. The repo is open for adoption / upstream contribution if Adobe wants to take it on or co-brand." |
| *What's the rate limit?* | "Whatever your IMS org is provisioned for — the MCP server doesn't add its own limit. Partner-dev sandboxes get 3,000 ops/year; production tenants get whatever they've contracted for. The `firefly-services-rate-limits` skill in our companion repo documents the architecture for high-volume workloads." |
| *Does this work with Claude Desktop / Cursor / other MCP clients?* | "Yes — it implements the standard MCP protocol. Any MCP-compatible client works. We've tested Claude Code most extensively." |
| *Is the SDK call doing anything fancy?* | "No magic. The MCP server is a thin adapter — every tool wraps a single SDK method call. Adobe's SDK does the actual work. We add zod schema validation, structured error mapping, and the LLM-friendly inline-image response pattern." |
| *What happens if Adobe ships their own MCP?* | "Great outcome. We'd merge upstream or co-brand. The Apache-2.0 license makes that trivial." |

---

## Recovery — what to do if something fails on stage

| Failure | Recovery line |
|---|---|
| Auth 401 / 403 | "The sandbox just timed out a token — happens. Let me re-export the credentials." Restart Claude Code. |
| Content-safety 422 (prompt rejected) | "Firefly has built-in IP safety — this prompt tripped a guardrail. Let me rephrase." Use a more generic prompt (the apple example is safe). |
| 429 rate-limited | "Sandbox quota is light — partner-dev sandboxes are 3K ops/year. In production you'd negotiate higher. Let me try a different tool to keep moving." |
| Network / timeout | "Conference WiFi being conference WiFi. Let me switch to my hotspot." Have a pre-recorded fallback video ready. |
| Generated image looks bad | "Firefly's image quality varies prompt-by-prompt — this is the model, not the integration. Let me generate two more variations." Just call `firefly_generate_image` again with the same prompt. |

---

## Demo capture (when running for record, not live)

Use macOS QuickTime → New Screen Recording → record the full demo session in Claude Code. Settings:

- Microphone: enabled if narrating
- Show mouse clicks: enabled
- Window: the Claude Code terminal at a comfortable reading size (the audience won't see what you can't read)

Render at 1080p or higher. Trim to ~6-10 minutes for the social/exec-share version, ~15 minutes for the full version.

---

## Sequence summary (cheat-sheet for the presenter)

| # | Tool called | Purpose | Approx time |
|---|---|---|---|
| 1 | `firefly_generate_image` | Hello Firefly — text-to-image | 6s |
| 2 | `firefly_generate_similar` | Local-file auto-upload + variations | 12s |
| 3 | `firefly_expand_image` | Aspect-ratio change via uploadId reuse | 8s |
| 4 | `photoshop_document_manifest` + `photoshop_smart_object_replace` | Template composition | 20s |
| 5 | `lightroom_auto_tone` | Tonal normalization | 10s |

Total tool-call time: ~60 seconds. Total demo time with narration: ~12-15 minutes.
