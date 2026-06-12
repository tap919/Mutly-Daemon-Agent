import * as vscode from 'vscode';
import { DaemonClient, ReporankResult } from './daemonClient';

export class MutlyReviewPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'mutly.reviewPanel';
    private _view?: vscode.WebviewView;
    private lastReview: ReporankResult | null = null;
    private disposables: vscode.Disposable[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private client: DaemonClient
    ) {
        this.disposables.push(this.client.onReviewComplete((result) => this.updateWebview(result)));
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        this.lastReview = this.client.getLastReview();
        webviewView.webview.html = this.getHtmlContent(this.lastReview);

        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case 'runReview':
                    vscode.commands.executeCommand('mutly.runReview');
                    break;
                case 'refresh':
                    this.updateWebview(this.lastReview);
                    break;
            }
        });
    }

    updateWebview(result: ReporankResult | null) {
        this.lastReview = result;
        if (this._view) {
            this._view.webview.html = this.getHtmlContent(result);
        }
    }

    show() {
        if (this._view) {
            this._view.show(true);
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
    }

    private getHtmlContent(result: ReporankResult | null): string {
        const cspSource = this._view?.webview.cspSource ?? '';
        if (!result) {
            return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource};">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; margin: 0; }
  .empty { text-align: center; margin-top: 60px; opacity: 0.7; }
  .empty p { margin: 12px 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 18px; border-radius: 4px; cursor: pointer; font-size: 13px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>
  <div class="empty">
    <h3>Mutly Review Dashboard</h3>
    <p>No review data yet. Run a review to see your codebase score.</p>
    <button onclick="runReview()">$(search) Run Review</button>
  </div>
<script>
  const vscode = acquireVsCodeApi();
  function runReview() { vscode.postMessage({ command: 'runReview' }); }
</script>
</body></html>`;
        }

        const { score, vibe, secrets, files } = result;
        const colorFor = (s: number) => s >= 80 ? '#4caf50' : s >= 60 ? '#ff9800' : '#f44336';

        return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource};">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; margin: 0; }
  h2 { font-size: 15px; margin-bottom: 4px; }
  .score-badge { font-size: 36px; font-weight: 700; text-align: center; margin: 8px 0 4px; }
  .score-label { text-align: center; font-size: 11px; opacity: 0.6; margin-bottom: 16px; }
  .chart-container { display: flex; justify-content: center; margin: 8px 0 16px; }
  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 16px; }
  .stat { padding: 8px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); }
  .stat-label { font-size: 10px; opacity: 0.7; }
  .stat-value { font-size: 13px; font-weight: 600; }
  .recommendations { margin-bottom: 16px; }
  .rec-item { font-size: 11px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: flex-start; gap: 4px; }
  .rec-icon { color: #ff9800; font-weight: 700; flex-shrink: 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%; margin-top: 4px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 12px 0; }
  .section-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; opacity: 0.8; }
  .severity { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 9px; font-weight: 600; text-transform: uppercase; margin-right: 4px; }
  .sev-critical { background: #f4433630; color: #f44336; }
  .sev-high { background: #f4433630; color: #f44336; }
  .sev-medium { background: #ff980030; color: #ff9800; }
  .sev-low { background: #2196f330; color: #2196f3; }
  .sev-info { background: #4caf5030; color: #4caf50; }
</style></head>
<body>
  <h2>RepoRank Audit</h2>
  <div class="score-badge" style="color:${colorFor(score)}">${score}/100</div>
  <div class="score-label">${files} files analyzed</div>

  <div class="chart-container">
    ${this.renderRadarSvg(vibe)}
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-label">Naming</div><div class="stat-value">${vibe.namingScore}/100</div></div>
    <div class="stat"><div class="stat-label">Modernity</div><div class="stat-value">${vibe.modernityScore}/100</div></div>
    <div class="stat"><div class="stat-label">Hygiene</div><div class="stat-value">${vibe.hygieneScore}/100</div></div>
    <div class="stat"><div class="stat-label">Config</div><div class="stat-value">${vibe.configCoherence}/100</div></div>
    <div class="stat"><div class="stat-label">Dependencies</div><div class="stat-value">${vibe.dependencyFreshness}/100</div></div>
    <div class="stat"><div class="stat-label">Deep</div><div class="stat-value">${vibe.deepScore}/100</div></div>
  </div>

  ${secrets.secretsFound > 0 ? `
  <div class="section-title">$(shield) Secrets Found: ${secrets.secretsFound}</div>
  ${secrets.secrets.slice(0, 5).map(s => `<div class="rec-item"><span class="rec-icon">!</span><span><b>${escapeHtml(s.type)}</b> in ${escapeHtml(s.filePath || '?')}:${escapeHtml(String(s.line))}</span></div>`).join('')}
  <hr>
  ` : ''}

  ${vibe.recommendations.length > 0 ? `
  <div class="section-title">$(lightbulb) Recommendations</div>
  <div class="recommendations">
  ${vibe.recommendations.slice(0, 8).map(r => `<div class="rec-item"><span class="rec-icon">></span>${escapeHtml(r)}</div>`).join('')}
  </div>
  ` : ''}

  ${vibe.deepFindings.length > 0 ? `
  <div class="section-title">$(issues) Findings</div>
  ${vibe.deepFindings.slice(0, 5).map(f => `<div class="rec-item"><span class="${sevClass(f.severity)}">${(f.severity).toUpperCase()}</span>${escapeHtml(f.title)}</div>`).join('')}
  <hr>
  ` : ''}

  <button onclick="runReview()">$(refresh) Refresh Review</button>
  <div style="font-size:9px;opacity:0.5;text-align:center;margin-top:8px;">${new Date(result.timestamp).toLocaleTimeString()}</div>

<script>
  const vscode = acquireVsCodeApi();
  function runReview() { vscode.postMessage({ command: 'runReview' }); }
</script>
</body></html>`;
    }

    private renderRadarSvg(vibe: { namingScore: number; modernityScore: number; hygieneScore: number; configCoherence: number; dependencyFreshness: number; deepScore: number }): string {
        const dims = [
            { label: 'Naming', value: vibe.namingScore },
            { label: 'Modernity', value: vibe.modernityScore },
            { label: 'Hygiene', value: vibe.hygieneScore },
            { label: 'Config', value: vibe.configCoherence },
            { label: 'Deps', value: vibe.dependencyFreshness },
            { label: 'Deep', value: vibe.deepScore },
        ];

        const cx = 150, cy = 150, maxR = 130;
        const n = dims.length;
        const angleStep = (2 * Math.PI) / n;
        const startAngle = -Math.PI / 2;

        const point = (index: number, value: number): string => {
            const angle = startAngle + index * angleStep;
            const r = (value / 100) * maxR;
            const x = cx + r * Math.cos(angle);
            const y = cy + r * Math.sin(angle);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        };

        const gridLayers = [0.2, 0.4, 0.6, 0.8, 1.0];
        let gridPolygons = '';
        for (const layer of gridLayers) {
            const pts = dims.map((_, i) => point(i, layer * 100));
            gridPolygons += `<polygon points="${pts.join(' ')}" fill="none" stroke="var(--vscode-panel-border)" stroke-width="0.5" opacity="0.5"/>`;
        }

        let axisLines = '';
        for (let i = 0; i < n; i++) {
            const pt = point(i, 100);
            axisLines += `<line x1="${cx}" y1="${cy}" x2="${pt}" stroke="var(--vscode-panel-border)" stroke-width="0.5" opacity="0.7"/>`;
        }

        let labels = '';
        for (let i = 0; i < n; i++) {
            const angle = startAngle + i * angleStep;
            const lr = maxR + 18;
            const lx = cx + lr * Math.cos(angle);
            const ly = cy + lr * Math.sin(angle);
            let anchor = 'middle';
            if (lx < cx - 10) anchor = 'end';
            else if (lx > cx + 10) anchor = 'start';
            labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="11" fill="var(--vscode-foreground)" opacity="0.8">${dims[i].label}</text>`;
        }

        const dataPts = dims.map((d, i) => point(i, d.value));
        const dataPolygon = `<polygon points="${dataPts.join(' ')}" fill="rgba(96, 165, 250, 0.2)" stroke="#60a5fa" stroke-width="2"/>`;

        let dataDots = '';
        for (let i = 0; i < n; i++) {
            const pt = point(i, dims[i].value);
            dataDots += `<circle cx="${pt.split(',')[0]}" cy="${pt.split(',')[1]}" r="3" fill="#60a5fa"/>`;
        }

        return `<svg viewBox="0 0 300 300" width="260" height="260" style="max-width:100%;">
  ${gridPolygons}
  ${axisLines}
  ${dataPolygon}
  ${dataDots}
  ${labels}
</svg>`;
    }
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sevClass(severity: string): string {
    return `severity sev-${severity}`;
}
