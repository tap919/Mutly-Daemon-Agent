"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaemonClient = void 0;
const vscode = require("vscode");
const http = require("http");
const DAEMON_HOST = 'localhost';
function getConfig() {
    const config = vscode.workspace.getConfiguration('mutly');
    return {
        port: config.get('daemonPort') ?? 3000,
        apiKey: config.get('apiKey') || process.env.MUTLY_API_KEY || '',
    };
}
class DaemonClient {
    state = 'disconnected';
    stateListeners = [];
    reviewListeners = [];
    connectListeners = [];
    disconnectListeners = [];
    errorListeners = [];
    lastReview = null;
    pollTimer = null;
    constructor() {
        this.state = 'disconnected';
    }
    setState(newState) {
        if (this.state !== newState) {
            this.state = newState;
            for (const l of this.stateListeners) {
                try {
                    l(newState);
                }
                catch { }
            }
        }
    }
    getState() { return this.state; }
    getLastReview() { return this.lastReview; }
    get isConnected() { return this.state !== 'disconnected' && this.state !== 'error'; }
    onStateChange(fn) {
        this.stateListeners.push(fn);
        return { dispose: () => {
                const idx = this.stateListeners.indexOf(fn);
                if (idx >= 0)
                    this.stateListeners.splice(idx, 1);
            } };
    }
    onReviewComplete(fn) {
        this.reviewListeners.push(fn);
        return { dispose: () => {
                const idx = this.reviewListeners.indexOf(fn);
                if (idx >= 0)
                    this.reviewListeners.splice(idx, 1);
            } };
    }
    onConnected(fn) {
        this.connectListeners.push(fn);
        return { dispose: () => {
                const idx = this.connectListeners.indexOf(fn);
                if (idx >= 0)
                    this.connectListeners.splice(idx, 1);
            } };
    }
    onDisconnected(fn) {
        this.disconnectListeners.push(fn);
        return { dispose: () => {
                const idx = this.disconnectListeners.indexOf(fn);
                if (idx >= 0)
                    this.disconnectListeners.splice(idx, 1);
            } };
    }
    onError(fn) {
        this.errorListeners.push(fn);
        return { dispose: () => {
                const idx = this.errorListeners.indexOf(fn);
                if (idx >= 0)
                    this.errorListeners.splice(idx, 1);
            } };
    }
    startPolling() {
        this.checkConnection();
        this.pollTimer = setInterval(() => this.checkConnection(), 15000);
    }
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    async checkConnection() {
        const cfg = getConfig();
        if (!cfg.apiKey) {
            this.setState('disconnected');
            return false;
        }
        return new Promise((resolve) => {
            const req = http.request({
                hostname: DAEMON_HOST,
                port: cfg.port,
                path: '/api/agent/status',
                method: 'GET',
                headers: { 'x-mutly-api-key': cfg.apiKey },
                timeout: 5000,
            }, (res) => {
                res.resume();
                if (res.statusCode === 200) {
                    if (this.state !== 'running' && this.state !== 'reviewing') {
                        this.setState('idle');
                    }
                    for (const l of this.connectListeners) {
                        try {
                            l();
                        }
                        catch { }
                    }
                    resolve(true);
                }
                else {
                    this.setState('disconnected');
                    for (const l of this.disconnectListeners) {
                        try {
                            l();
                        }
                        catch { }
                    }
                    resolve(false);
                }
            });
            req.on('error', () => {
                this.setState('disconnected');
                for (const l of this.disconnectListeners) {
                    try {
                        l();
                    }
                    catch { }
                }
                resolve(false);
            });
            req.end();
        });
    }
    async runReview() {
        this.setState('reviewing');
        const cfg = getConfig();
        if (!cfg.apiKey) {
            this.setState('error');
            const err = 'API key not configured. Run "Mutly: Set API Key" to configure.';
            for (const l of this.errorListeners) {
                try {
                    l(err);
                }
                catch { }
            }
            return null;
        }
        try {
            const data = await this.httpPost('/api/agent/audit/fix-sim', {});
            if (data && data.success && data.auditReport) {
                const report = data.auditReport;
                const result = {
                    score: report.score ?? 50,
                    vibe: {
                        namingScore: report.vibe?.namingScore ?? 0,
                        modernityScore: report.vibe?.modernityScore ?? 0,
                        hygieneScore: report.vibe?.hygieneScore ?? 0,
                        configCoherence: report.vibe?.configCoherence ?? 0,
                        dependencyFreshness: report.vibe?.dependencyFreshness ?? 0,
                        deepScore: report.vibe?.deepScore ?? 0,
                        recommendations: report.vibe?.recommendations ?? [],
                        deepFindings: report.vibe?.deepFindings ?? [],
                        securityIssues: report.vibe?.securityIssues ?? 0,
                        largeFileCount: report.vibe?.largeFileCount ?? 0,
                    },
                    secrets: {
                        secretsFound: report.secrets?.secretsFound ?? 0,
                        secrets: report.secrets?.secrets ?? [],
                        recommendation: report.secrets?.recommendation ?? '',
                    },
                    files: report.files ?? 0,
                    reporankApiResult: report.reporankApiResult,
                    timestamp: Date.now(),
                };
                this.lastReview = result;
                this.setState('completed');
                for (const l of this.reviewListeners) {
                    try {
                        l(result);
                    }
                    catch { }
                }
                return result;
            }
            this.setState('error');
            return null;
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.setState('error');
            for (const l of this.errorListeners) {
                try {
                    l(msg);
                }
                catch { }
            }
            return null;
        }
    }
    httpGet(path) {
        const cfg = getConfig();
        return new Promise((resolve, reject) => {
            const req = http.get({
                hostname: DAEMON_HOST,
                port: cfg.port,
                path,
                headers: { 'x-mutly-api-key': cfg.apiKey },
                timeout: 30000,
            }, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            resolve(JSON.parse(body));
                        }
                        else {
                            reject(new Error(`HTTP ${res.statusCode}`));
                        }
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (e) => reject(e));
        });
    }
    httpPost(path, data) {
        const cfg = getConfig();
        const postData = JSON.stringify(data);
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: DAEMON_HOST,
                port: cfg.port,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'x-mutly-api-key': cfg.apiKey,
                },
                timeout: 60000,
            }, (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            resolve(JSON.parse(body));
                        }
                        else {
                            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                        }
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (e) => reject(e));
            req.write(postData);
            req.end();
        });
    }
}
exports.DaemonClient = DaemonClient;
//# sourceMappingURL=daemonClient.js.map