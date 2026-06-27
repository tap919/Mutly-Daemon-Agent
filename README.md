# 🚀 Mutly: Developer-First Daemon & IDE Companion Agent

**Mutly** is a high-performance, developer-focused background coding assistant and companion daemon. It is designed to sit right beside your workspace—monitoring changes, index symbols, search codebase Semantics using vector embeddings, execute isolated sandbox testing, and stage precise block code modifications directly into your IDE context via chat.

With its double-loop transport architecture, Mutly acts as a persistent background engine while offering seamless, secure workflows in both a browser dashboard and major editors (VS Code, Zed, OpenCode).

---

## 🎨 Architecture & Major Capabilities

Mutly bridges the gap between raw background terminals and rich editor workflows by utilizing the following native core pillars:

1. **ReAct Tool Loop Execution**:
   - Executes multi-turn reasoning loops using `gemini-2.5-flash` to read code files, analyze structures, run terminal tests, and draft diff adjustments.
   - Built-in rigid **Path Guards** to ensure zero actions escape the localized workspace container scope.

2. **Semantic Vector Search (Cosine Similarity)**:
   - Encodes source material on-the-fly with `gemini-embedding-2-preview` embeddings and indexes them locally inside `embeddings.json`.
   - Fires ultra-fast local searches via custom Cosine similarity matching over normalized document chunk weights.

3. **TypeScript AST Symbol Extraction**:
   - Parses active TypeScript code checkouts natively via the dynamic `ts.createSourceFile` compiler API.
   - Instantly extracts namespaces, interfaces, enums, type definitions, and functional components, keeping a reactive memory map of all file structures.

4. **Isolated Sandboxed Execution**:
   - Seamlessly boots arbitrary scripts and unit tests inside a secure workspace replica under `/tmp/mutly-sandbox-workspace`.
   - Utilizes custom symmetric symlinking techniques so that node modules are instantly accessible without duplicate download penalties.

5. **Symmetric IDE Integrations**:
   - **VS Code Extension (`mutly-vscode/`)**: Fully functional Chat Participant endpoint connecting VS Code Chat directly to local daemon sessions. Capable of editing disk buffers dynamically on approval via `vscode.WorkspaceEdit`.
   - **Zed JSON-RPC Handler**: Unified MCP-compatible transport for communication with the rust-based Zed code sandbox.
   - **OpenCode Plugin**: Standard workspace compaction hooks tracking budget overhead sizes and tracking tokens seamlessly.

---

## 🛠️ Setup & Installation

### 🔴 Prerequisites
- **Node.js** (v18+ recommended)
- **VS Code** (Optional, to use the `.vsix` companion sidebar)
- **Gemini API Key**: Configured in your AI Studio secrets or `.env` configuration file.

### 1. Run the Mutly Daemon & Dashboard
Get the daemon backend and front-end interface up and running:

```bash
# 1. Install base project dependencies
npm install

# 2. Start the back-end daemon and Vite preview server concurrently on Port 4000
npm run dev
```

Your service will boot at `http://localhost:4000` (Daemon API routes live at `/api/agent/*`).

---

## 🔌 VS Code Web Extension Installation (`mutly-vscode`)

Mutly comes with a companion VS Code Extension inside the `/mutly-vscode` subdirectory. This allows you to chat with @mutly from your side panel and execute click-to-apply patches instantly.

### 1. Build & Compile Package
Compile the raw TypeScript files into VS Code executable extension scripts:

```bash
cd mutly-vscode
npm install
npm run compile
```

### 2. Package into a `.vsix` Archive
If you wish to distribute or install the extension offline inside your local VS Code instance:

```bash
# Pack into single direct file named mutly-0.1.0.vsix
npm run package
```

### 3. Install in VS Code
Run the following terminal command inside your environment to install the freshly built extension:

```bash
code --install-extension mutly-0.1.0.vsix
```

---

## 🔑 Configure API Authorization in VS Code

Mutly secures both its dashboard and editor channels using API key guards. Follow these simple steps inside VS Code:

1. Open your Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
2. Run **`Mutly: Show Daemon Status`** to test your connection.
3. If it prompts you with a `401 Unauthorized` check, run **`Mutly: Set Secure API Key`**.
4. Paste your secret master token (defaults to `dev_mutly_secure_master_key` in local dev).
5. Open your Copilot chat workspace and interact directly with **`@mutly`**!

---

## 📋 Security & Environment Variables

Create a secure `.env` file at your directory root by copying `.env.example`.

> ⚠️ **CRITICAL SECURITY NOTE:**
> - **Insecure Key Defaults:** The default placeholder key `dev_mutly_secure_master_key` is intended **only** for quick local development boots. You **must** generate a strong, unique cryptographically secure secret (e.g. `openssl rand -hex 32`) for `MUTLY_API_KEY` in live deployments.
> - **Client-side Bundling Hazard:** Do **not** use or bundle `VITE_MUTLY_API_KEY` in public client builds. Rely strictly on `Authorization: Bearer <key>` or `X-Mutly-API-Key` headers injected at runtime or securely stored user configurations.
> - **Sandbox Limits Notice:** The target sandbox located under `/tmp/mutly-sandbox-workspace` provides **process-level directory separation and symlink safety state guards**. It does **not** provide strong hardware virtualization or hypervisor-level isolation. For untrusted, hostile execution spaces, you **must** wrap the Mutly process inside a hardened runtime layer like gVisor or Docker.

```ini
# Gemini API Access Config
GEMINI_API_KEY="your-gemini-api-key-here"

# Secure Master Access Key for Daemon REST Endpoint protection (USE SECURE RANDOM STRING)
MUTLY_API_KEY="your_secure_randomly_generated_token"
```

## 🔒 Security Assurances
- **No Path Escape**: All files read or written by the daemon are bounded strict checkouts under `process.cwd()`. Any path escape attempt (`../../etc`) triggers an immediate `403 Access Denied`.
- **API Protection**: Standard sessions require the `x-mutly-api-key` header, ensuring other applications running locally on your client machine cannot interact with the daemon without authorization.
