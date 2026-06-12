import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import { DaemonClient } from './daemonClient';
import { MutlyStatusBar, MutlyDiagnostics, MutlyCodeLensProvider } from './reviewProviders';
import { MutlyReviewPanel } from './reviewPanel';

const DAEMON_HOST = 'localhost';
const DEFAULT_DAEMON_PORT = 3000;

function getDaemonPort(): number {
    const userConfig = vscode.workspace.getConfiguration('mutly');
    return userConfig.get<number>('daemonPort') ?? DEFAULT_DAEMON_PORT;
}

let daemonClient: DaemonClient;
let activated = false;

export function activate(context: vscode.ExtensionContext) {
    if (activated) return;
    activated = true;
    console.log('Mutly VS Code client extension initialized successfully.');

    daemonClient = new DaemonClient();

    function getApiKey(): string {
        const userConfig = vscode.workspace.getConfiguration('mutly');
        return userConfig.get<string>('apiKey') || '';
    }

    // ── Status Bar ──────────────────────────────────────────────────
    const statusBar = new MutlyStatusBar(daemonClient);
    context.subscriptions.push(statusBar);

    // ── Diagnostics ─────────────────────────────────────────────────
    const diagnostics = new MutlyDiagnostics(daemonClient);
    context.subscriptions.push(diagnostics);

    // ── CodeLens ────────────────────────────────────────────────────
    const codeLensProvider = new MutlyCodeLensProvider(daemonClient);
    const codeLensDisposable = vscode.languages.registerCodeLensProvider(
        { scheme: 'file' },
        codeLensProvider
    );
    context.subscriptions.push(codeLensDisposable);

    // ── Sidebar Webview ─────────────────────────────────────────────
    const reviewPanelProvider = new MutlyReviewPanel(context.extensionUri, daemonClient);
    const webviewDisposable = vscode.window.registerWebviewViewProvider(
        MutlyReviewPanel.viewType,
        reviewPanelProvider
    );
    context.subscriptions.push(webviewDisposable);
    context.subscriptions.push(reviewPanelProvider);

    // ── Start daemon connection polling ─────────────────────────────
    daemonClient.startPolling();

    // ── Commands ────────────────────────────────────────────────────
    // 1. Status check
    const statusCmd = vscode.commands.registerCommand('mutly.status', () => {
        checkDaemonStatus();
    });
    context.subscriptions.push(statusCmd);

    // 2. Set API Key
    const setApiKeyCmd = vscode.commands.registerCommand('mutly.setApiKey', async () => {
        const key = await vscode.window.showInputBox({
            prompt: 'Enter your Mutly Secure API Key to authorize VS Code client requests',
            password: true,
            placeHolder: 'Paste your x-mutly-api-key here...'
        });
        if (typeof key === 'string') {
            await vscode.workspace.getConfiguration('mutly').update('apiKey', key.trim(), vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Mutly: Secure API key successfully updated in settings.');
            daemonClient.checkConnection();
        }
    });
    context.subscriptions.push(setApiKeyCmd);

    // 3. Run Review
    const runReviewCmd = vscode.commands.registerCommand('mutly.runReview', async () => {
        vscode.window.showInformationMessage('Mutly: Running RepoRank review...');
        const result = await daemonClient.runReview();
        if (result) {
            vscode.window.showInformationMessage(`Mutly: Review complete. Score: ${result.score}/100 (${result.files} files analyzed)`);
        } else {
            vscode.window.showErrorMessage('Mutly: Review failed. Check daemon connection and API key.');
        }
    });
    context.subscriptions.push(runReviewCmd);

    // 4. Show Dashboard
    const showDashboardCmd = vscode.commands.registerCommand('mutly.showDashboard', () => {
        vscode.commands.executeCommand('workbench.view.extension.mutly-sidebar');
    });
    context.subscriptions.push(showDashboardCmd);

    // 5. Apply Workspace patch
    const applyDiffCmd = vscode.commands.registerCommand('mutly.applyDiff', async (args: any) => {
        let filePath = '';
        let findContent = '';
        let replaceContent = '';

        if (Array.isArray(args)) {
            [filePath, findContent, replaceContent] = args;
        } else if (args && typeof args === 'object') {
            filePath = args.filePath || '';
            findContent = args.findContent || '';
            replaceContent = args.replaceContent || '';
        }

        if (!filePath) {
            vscode.window.showErrorMessage('Mutly: No target file was specified for applying patch.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('Mutly: Open a workspace folder first to apply dynamic modifications.');
            return;
        }

        const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        if (!uri.fsPath.startsWith(workspaceRoot + path.sep) && uri.fsPath !== workspaceRoot) {
            vscode.window.showErrorMessage('Mutly: Path traversal blocked.');
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const text = document.getText();

            if (!text.includes(findContent)) {
                vscode.window.showErrorMessage(`Mutly: Original matching block not found in "${filePath}". Verification failed, patch was not applied.`);
                return;
            }

            const idx = text.indexOf(findContent);
            const updatedText = text.slice(0, idx) + replaceContent + text.slice(idx + findContent.length);
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(text.length)
            );
            edit.replace(uri, fullRange, updatedText);

            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                await document.save();
                vscode.window.showInformationMessage(`Mutly: Code draft applied beautifully to "${filePath}"!`);
            } else {
                vscode.window.showErrorMessage(`Mutly: VS Code workspace refused to apply edit.`);
            }
        } catch (err: unknown) {
            vscode.window.showErrorMessage('Mutly Failed to apply edit. Please try again.');
        }
    });
    context.subscriptions.push(applyDiffCmd);

    // 6. Chat Participant for @mutly
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        ctx: vscode.ChatContext,
        response: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) => {
        const apiKey = getApiKey();
        if (!apiKey) {
            response.markdown('\u26a0\ufe0f **Mutly API Key not configured.**\n\nTo talk to your background daemon, you must provide your secure API key.\n\n[Configure API Key](command:mutly.setApiKey)');
            return;
        }

        response.markdown('Connecting to local background Mutly daemon...');

        try {
            const reply = await queryDaemonSession(request.prompt, apiKey);
            response.markdown(reply.response || 'No reply computed by transport.');

            const diffInfo = parseDiffFromText(reply.response);
            if (diffInfo) {
                const pFilePath = diffInfo.filePath;
                const pFind = diffInfo.findContent;
                const pReplace = diffInfo.replaceContent;

                response.markdown(`\n\n\u2728 **Actionable Code Draft detected for \`${pFilePath}\`:**\n\n`);

                const argStr = encodeURIComponent(JSON.stringify({
                    filePath: pFilePath,
                    findContent: pFind,
                    replaceContent: pReplace
                }));
                const cmdUri = `command:mutly.applyDiff?${argStr}`;

                response.markdown(`\ud83d\udc49 **[Click here to Apply dynamic patch directly to Workspace](${cmdUri})**`);
            } else if (reply.hasDiff) {
                response.markdown('\n\n\u2728 **Actionable Code Draft available in changes workspace. Update your client to render direct quick actions.**');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[Mutly] Chat handler error:", message);
            response.markdown('\n\n\u274c **Cannot connect to daemon.** Make sure your local Mutly agent daemon service is started and running.');
        }
    };

    const mutlyParticipant = vscode.chat.createChatParticipant('mutly', handler);
    mutlyParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'mutly-logo.png');

    context.subscriptions.push(mutlyParticipant);
}

function checkDaemonStatus() {
    const userConfig = vscode.workspace.getConfiguration('mutly');
    const apiKey = userConfig.get<string>('apiKey') || '';
    const port = getDaemonPort();

    const options = {
        hostname: DAEMON_HOST,
        port,
        path: '/api/agent/status',
        method: 'GET',
        headers: {
            'x-mutly-api-key': apiKey
        }
    };

    const req = http.request(options, (res) => {
        res.resume();
        if (res.statusCode === 200) {
            vscode.window.showInformationMessage(`Mutly Daemon is online on port ${port}. Sandbox and reflective loops are fully functional.`);
        } else if (res.statusCode === 401) {
            vscode.window.showErrorMessage('Mutly Daemon returned 401 Unauthorized. Access denied or config key invalid. Use "Mutly: Set API Key" command.');
        } else {
            vscode.window.showErrorMessage(`Mutly Daemon returned unexpected status code: ${res.statusCode}`);
        }
    });

    req.on('error', (err) => {
        vscode.window.showErrorMessage(`Could not reach local Mutly daemon: ${err.message}. Please restart the background service.`);
    });
    req.end();
}

function queryDaemonSession(prompt: string, apiKey: string): Promise<{ response: string; hasDiff: boolean }> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ query: prompt });

        const port = getDaemonPort();
        const options = {
            hostname: DAEMON_HOST,
            port,
            path: '/api/agent/integrations/session',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'x-mutly-api-key': apiKey
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        resolve(JSON.parse(body));
                    } else if (res.statusCode === 401) {
                        reject(new Error('Unauthorized: 401 check failed. Mutly keys do not match.'));
                    } else {
                        reject(new Error(`Daemon responded with error code ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

function parseDiffFromText(text: string) {
    // Try parsing as JSON first (modern format)
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.filePath === "string" && typeof parsed.findContent === "string" && typeof parsed.replaceContent === "string") {
            return {
                filePath: parsed.filePath,
                findContent: parsed.findContent,
                replaceContent: parsed.replaceContent,
            };
        }
    } catch {
        // Fall through to legacy heuristic parsing
    }

    // Legacy heuristic: find <<<<<< / ======= / >>>>>>> conflict markers
    const startIdx = text.indexOf("<<<<<<<");
    const midIdx = text.indexOf("=======");
    const endIdx = text.indexOf(">>>>>>>");

    if (startIdx !== -1 && midIdx !== -1 && endIdx !== -1 && startIdx < midIdx && midIdx < endIdx) {
        const beforeBlock = text.slice(Math.max(0, startIdx - 300), startIdx);
        const fileRegex = /(?:File|Target|Path):\s*([a-zA-Z0-9_\-\.\/]+)/i;
        const fileMatch = beforeBlock.match(fileRegex) || text.match(fileRegex);
        let filePath = "";
        if (fileMatch) {
            filePath = fileMatch[1].trim();
        } else {
            if (text.toLowerCase().includes("app.tsx")) {
                filePath = "src/App.tsx";
            } else if (text.toLowerCase().includes("server.ts")) {
                filePath = "server.ts";
            } else {
                return null;
            }
        }

        const findContent = text.slice(startIdx + 7, midIdx).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
        const replaceContent = text.slice(midIdx + 7, endIdx).replace(/^\r?\n/, "").replace(/\r?\n$/, "");

        return {
            filePath,
            findContent,
            replaceContent
        };
    }
    return null;
}

export function deactivate() {
    if (daemonClient) {
        daemonClient.stopPolling();
    }
}
