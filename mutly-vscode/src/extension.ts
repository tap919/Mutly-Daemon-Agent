import * as vscode from 'vscode';
import * as http from 'http';

const DAEMON_PORT = 7432;
const DAEMON_HOST = 'localhost';

export function activate(context: vscode.ExtensionContext) {
    console.log('Mutly VS Code client extension initialized successfully.');

    // 1. Register Status check command
    const statusCmd = vscode.commands.registerCommand('mutly.status', () => {
        checkDaemonStatus();
    });
    context.subscriptions.push(statusCmd);

    // 2. Register Chat Participant for @mutly inside the VS Code Copilot sidebar panel
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        response: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ) => {
        response.markdown('Connecting to local background Mutly daemon...');

        try {
            const reply = await queryDaemonSession(request.prompt);
            response.markdown(reply.response || 'No reply computed by transport.');

            if (reply.hasDiff) {
                // Return actionable elements in VS Code chat tree
                response.markdown('\n\n✨ **Actionable Code Draft available in changes workspace. Click "Apply draft" to integrate.**');
            }
        } catch (err: any) {
            response.markdown(`\n\n❌ **Daemon Connection Failed**: ${err.message}. Make sure your local Mutly agent daemon service is started.`);
        }
    };

    const mutlyParticipant = vscode.chat.createChatParticipant('mutly', handler);
    mutlyParticipant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'mutly-logo.png');

    context.subscriptions.push(mutlyParticipant);
}

function checkDaemonStatus() {
    const req = http.get(`http://${DAEMON_HOST}:${DAEMON_PORT}/api/agent/status`, (res) => {
        if (res.statusCode === 200) {
            vscode.window.showInformationMessage('🟢 Mutly Daemon is online on port 7432. Sandbox and reflective loops are fully functional.');
        } else {
            vscode.window.showErrorMessage(`🔴 Mutly Daemon returned inactive status code: ${res.statusCode}`);
        }
    });

    req.on('error', (err) => {
        vscode.window.showErrorMessage(`🔴 Could not reach local Mutly daemon: ${err.message}. Please restart the background service.`);
    });
}

function queryDaemonSession(prompt: string): Promise<{ response: string; hasDiff: boolean }> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ query: prompt });

        const options = {
            hostname: DAEMON_HOST,
            port: DAEMON_PORT,
            path: '/api/agent/integrations/session',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
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

export function deactivate() {}
