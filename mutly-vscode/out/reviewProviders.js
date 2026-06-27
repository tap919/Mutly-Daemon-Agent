"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MutlyCodeLensProvider = exports.MutlyDiagnostics = exports.MutlyStatusBar = void 0;
const vscode = require("vscode");
class MutlyStatusBar {
    client;
    item;
    disposables = [];
    constructor(client) {
        this.client = client;
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.name = 'Mutly';
        this.item.tooltip = 'Mutly Daemon Status';
        this.item.command = 'mutly.showDashboard';
        this.updateFromState('disconnected');
        this.item.show();
        this.disposables.push(this.client.onStateChange((state) => this.updateFromState(state)));
        this.disposables.push(this.client.onConnected(() => this.updateFromState(this.client.getState())));
        this.disposables.push(this.client.onDisconnected(() => this.updateFromState('disconnected')));
    }
    updateFromState(state) {
        switch (state) {
            case 'disconnected':
                this.item.text = '$(circle-slash) Mutly: Offline';
                this.item.backgroundColor = undefined;
                break;
            case 'idle':
                this.item.text = '$(pass) Mutly: Idle';
                this.item.backgroundColor = undefined;
                break;
            case 'running':
                this.item.text = '$(sync~spin) Mutly: Running';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'reviewing':
                this.item.text = '$(search) Mutly: Reviewing';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;
            case 'completed':
                this.item.text = '$(check) Mutly: Done';
                this.item.backgroundColor = undefined;
                break;
            case 'error':
                this.item.text = '$(error) Mutly: Error';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }
    }
    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.item.dispose();
    }
}
exports.MutlyStatusBar = MutlyStatusBar;
class MutlyDiagnostics {
    client;
    collection;
    disposables = [];
    constructor(client) {
        this.client = client;
        this.collection = vscode.languages.createDiagnosticCollection('mutly-reporank');
        this.disposables.push(this.client.onReviewComplete((result) => this.updateFromResult(result)));
    }
    async updateFromResult(result) {
        const diagMap = new Map();
        const sevToDiag = (severity) => {
            switch (severity) {
                case 'critical': return vscode.DiagnosticSeverity.Error;
                case 'high': return vscode.DiagnosticSeverity.Error;
                case 'medium': return vscode.DiagnosticSeverity.Warning;
                case 'low': return vscode.DiagnosticSeverity.Information;
                default: return vscode.DiagnosticSeverity.Information;
            }
        };
        // Map secret findings to file locations
        for (const secret of result.secrets.secrets) {
            const fp = secret.filePath || '';
            if (!fp)
                continue;
            const diags = diagMap.get(fp) || [];
            const range = new vscode.Range(Math.max(0, (secret.line || 1) - 1), 0, Math.max(0, (secret.line || 1) - 1), 200);
            diags.push({
                message: `[Mutly Security] ${secret.type} detected (${secret.confidence} confidence)`,
                range,
                severity: vscode.DiagnosticSeverity.Error,
                source: 'Mutly RepoRank',
                code: 'mutly-secret',
            });
            diagMap.set(fp, diags);
        }
        // Map deep findings to files (those with severity)
        for (const finding of result.vibe.deepFindings) {
            const filePath = extractFilePath(finding.title);
            if (!filePath)
                continue;
            const diags = diagMap.get(filePath) || [];
            const range = new vscode.Range(0, 0, 0, 200);
            diags.push({
                message: `[Mutly ${finding.category}] ${finding.title}`,
                range,
                severity: sevToDiag(finding.severity),
                source: 'Mutly RepoRank',
                code: `mutly-${finding.category}`,
            });
            diagMap.set(filePath, diags);
        }
        // Map API findings with filePath
        if (result.reporankApiResult?.findings) {
            for (const f of result.reporankApiResult.findings) {
                if (!f.filePath)
                    continue;
                const diags = diagMap.get(f.filePath) || [];
                const range = new vscode.Range(0, 0, 0, 200);
                diags.push({
                    message: `[Mutly ${f.category}] ${f.title}: ${f.message}`,
                    range,
                    severity: sevToDiag(f.severity),
                    source: 'Mutly RepoRank',
                    code: `mutly-${f.category}`,
                });
                diagMap.set(f.filePath, diags);
            }
        }
        this.collection.clear();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders)
            return;
        for (const [filePath, diags] of diagMap) {
            const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
            this.collection.set(uri, diags);
        }
    }
    clear() {
        this.collection.clear();
    }
    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.collection.dispose();
    }
}
exports.MutlyDiagnostics = MutlyDiagnostics;
function extractFilePath(title) {
    const m = title.match(/^([a-zA-Z0-9_\-\.\/\\]+\.(?:ts|tsx|js|jsx|py|go|rs|java|rb|php|vue|svelte))/);
    return m ? m[1] : null;
}
class MutlyCodeLensProvider {
    client;
    _onDidChangeCodeLenses = new vscode.EventEmitter();
    onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    score = null;
    disposables = [];
    constructor(client) {
        this.client = client;
        this.disposables.push(this.client.onReviewComplete((result) => {
            this.score = result.score;
            this._onDidChangeCodeLenses.fire();
        }));
    }
    provideCodeLenses(document, _token) {
        const config = vscode.workspace.getConfiguration('mutly');
        const enableCodeLens = config.get('enableCodeLens') ?? true;
        if (!enableCodeLens || this.score === null)
            return [];
        const topOfFile = new vscode.Range(0, 0, 0, 0);
        const cl = new vscode.CodeLens(topOfFile, {
            title: this.buildTitle(this.score),
            tooltip: 'Mutly RepoRank workspace review score. Click to re-run review.',
            command: 'mutly.runReview',
        });
        return [cl];
    }
    buildTitle(score) {
        if (score >= 80)
            return `$(pass) Review Score: ${score}/100`;
        if (score >= 60)
            return `$(warning) Review Score: ${score}/100`;
        return `$(error) Review Score: ${score}/100`;
    }
    refresh() {
        this._onDidChangeCodeLenses.fire();
    }
    dispose() {
        this.disposables.forEach(d => d.dispose());
        this._onDidChangeCodeLenses.dispose();
    }
}
exports.MutlyCodeLensProvider = MutlyCodeLensProvider;
//# sourceMappingURL=reviewProviders.js.map