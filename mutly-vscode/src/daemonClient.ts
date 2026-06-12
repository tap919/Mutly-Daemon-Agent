import * as vscode from 'vscode';
import * as http from 'http';

const DAEMON_HOST = 'localhost';

function getConfig() {
    const config = vscode.workspace.getConfiguration('mutly');
    return {
        port: config.get<number>('daemonPort') ?? 3000,
        apiKey: config.get<string>('apiKey') || process.env.MUTLY_API_KEY || '',
    };
}

export type PipelineState = 'disconnected' | 'idle' | 'running' | 'reviewing' | 'completed' | 'error';

export interface VibeDimensions {
    namingScore: number;
    modernityScore: number;
    hygieneScore: number;
    configCoherence: number;
    dependencyFreshness: number;
    deepScore: number;
}

export interface ReporankFinding {
    severity: string;
    category: string;
    title: string;
    message: string;
    filePath?: string;
    line?: number;
}

export interface ReporankSecret {
    type: string;
    line: number;
    filePath: string;
    confidence: string;
}

export interface ReporankResult {
    score: number;
    vibe: VibeDimensions & {
        recommendations: string[];
        deepFindings: Array<{ severity: string; category: string; title: string }>;
        securityIssues: number;
        largeFileCount: number;
    };
    secrets: {
        secretsFound: number;
        secrets: ReporankSecret[];
        recommendation: string;
    };
    files: number;
    reporankApiResult?: {
        findings: ReporankFinding[];
    };
    timestamp: number;
}

export type StateListener = (state: PipelineState) => void;
export type ReviewListener = (result: ReporankResult) => void;
export type ConnectionListener = () => void;
export type ErrorListener = (error: string) => void;

export class DaemonClient {
    private state: PipelineState = 'disconnected';
    private stateListeners: StateListener[] = [];
    private reviewListeners: ReviewListener[] = [];
    private connectListeners: ConnectionListener[] = [];
    private disconnectListeners: ConnectionListener[] = [];
    private errorListeners: ErrorListener[] = [];
    private lastReview: ReporankResult | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        this.state = 'disconnected';
    }

    private setState(newState: PipelineState) {
        if (this.state !== newState) {
            this.state = newState;
            for (const l of this.stateListeners) {
                try { l(newState); } catch {}
            }
        }
    }

    getState(): PipelineState { return this.state; }
    getLastReview(): ReporankResult | null { return this.lastReview; }
    get isConnected(): boolean { return this.state !== 'disconnected' && this.state !== 'error'; }

    onStateChange(fn: StateListener): vscode.Disposable {
        this.stateListeners.push(fn);
        return { dispose: () => {
            const idx = this.stateListeners.indexOf(fn);
            if (idx >= 0) this.stateListeners.splice(idx, 1);
        }};
    }

    onReviewComplete(fn: ReviewListener): vscode.Disposable {
        this.reviewListeners.push(fn);
        return { dispose: () => {
            const idx = this.reviewListeners.indexOf(fn);
            if (idx >= 0) this.reviewListeners.splice(idx, 1);
        }};
    }

    onConnected(fn: ConnectionListener): vscode.Disposable {
        this.connectListeners.push(fn);
        return { dispose: () => {
            const idx = this.connectListeners.indexOf(fn);
            if (idx >= 0) this.connectListeners.splice(idx, 1);
        }};
    }

    onDisconnected(fn: ConnectionListener): vscode.Disposable {
        this.disconnectListeners.push(fn);
        return { dispose: () => {
            const idx = this.disconnectListeners.indexOf(fn);
            if (idx >= 0) this.disconnectListeners.splice(idx, 1);
        }};
    }

    onError(fn: ErrorListener): vscode.Disposable {
        this.errorListeners.push(fn);
        return { dispose: () => {
            const idx = this.errorListeners.indexOf(fn);
            if (idx >= 0) this.errorListeners.splice(idx, 1);
        }};
    }

    startPolling(): void {
        this.checkConnection();
        this.pollTimer = setInterval(() => this.checkConnection(), 15000);
    }

    stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    async checkConnection(): Promise<boolean> {
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
                        try { l(); } catch {}
                    }
                    resolve(true);
                } else {
                    this.setState('disconnected');
                    for (const l of this.disconnectListeners) {
                        try { l(); } catch {}
                    }
                    resolve(false);
                }
            });
            req.on('error', () => {
                this.setState('disconnected');
                for (const l of this.disconnectListeners) {
                    try { l(); } catch {}
                }
                resolve(false);
            });
            req.end();
        });
    }

    async runReview(): Promise<ReporankResult | null> {
        this.setState('reviewing');
        const cfg = getConfig();
        if (!cfg.apiKey) {
            this.setState('error');
            const err = 'API key not configured. Run "Mutly: Set API Key" to configure.';
            for (const l of this.errorListeners) {
                try { l(err); } catch {}
            }
            return null;
        }

        try {
            const data = await this.httpPost('/api/agent/audit/fix-sim', {});
            if (data && data.success && data.auditReport) {
                const report = data.auditReport;
                const result: ReporankResult = {
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
                    try { l(result); } catch {}
                }
                return result;
            }
            this.setState('error');
            return null;
        } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
            this.setState('error');
            for (const l of this.errorListeners) {
                try { l(msg); } catch {}
            }
            return null;
        }
    }

    private httpGet(path: string): Promise<any> {
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
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}`));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (e) => reject(e));
        });
    }

    private httpPost(path: string, data: any): Promise<any> {
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
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
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
}
