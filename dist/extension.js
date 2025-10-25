"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const fs_extra_1 = __importDefault(require("fs-extra"));
class PackagerViewProvider {
    constructor(context) {
        this.context = context;
        this.entries = new Map();
        this.output = vscode.window.createOutputChannel('Zip Packager');
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'media')
            ]
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'add':
                    await this.handleAdd(message.uris);
                    break;
                case 'remove':
                    this.removeEntry(message.key);
                    break;
                case 'clear':
                    this.clearAll();
                    break;
                case 'pack':
                    await this.packEntries();
                    break;
                default:
                    break;
            }
        });
        this.notifyEntries();
    }
    refresh() {
        this.notifyEntries();
    }
    clearAll() {
        if (this.entries.size === 0) {
            void vscode.window.showInformationMessage('Zip Packager list is already empty.');
            return;
        }
        this.entries.clear();
        this.notifyEntries();
    }
    removeEntry(key) {
        if (!this.entries.delete(key)) {
            return;
        }
        this.notifyEntries();
    }
    async handleAdd(rawUris) {
        const incoming = Array.isArray(rawUris) ? rawUris : typeof rawUris === 'string' ? [rawUris] : [];
        if (incoming.length === 0) {
            return;
        }
        const seen = new Set();
        const resolved = [];
        let outsideWorkspace = false;
        let unsupported = false;
        for (const raw of incoming) {
            if (!raw || typeof raw !== 'string') {
                continue;
            }
            try {
                const uri = vscode.Uri.parse(raw);
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
                if (!workspaceFolder) {
                    outsideWorkspace = true;
                    continue;
                }
                const stat = await vscode.workspace.fs.stat(uri);
                let type;
                if (stat.type & vscode.FileType.File) {
                    type = 'file';
                }
                else if (stat.type & vscode.FileType.Directory) {
                    type = 'directory';
                }
                if (!type) {
                    unsupported = true;
                    continue;
                }
                const relativePath = vscode.workspace.asRelativePath(uri, false);
                const key = uri.toString();
                if (this.entries.has(key) || seen.has(key)) {
                    continue;
                }
                seen.add(key);
                resolved.push({ uri, key, relativePath, type });
            }
            catch (error) {
                this.logError('Failed to add item', error);
                void vscode.window.showErrorMessage('Unable to add one or more items. See Zip Packager output for details.');
            }
        }
        for (const entry of resolved) {
            this.entries.set(entry.key, entry);
        }
        if (outsideWorkspace) {
            void vscode.window.showWarningMessage('Only workspace files or folders can be added.');
        }
        if (unsupported) {
            void vscode.window.showWarningMessage('Only files and folders are supported.');
        }
        if (resolved.length > 0) {
            this.notifyEntries('Items added.');
        }
    }
    async packEntries() {
        if (this.entries.size === 0) {
            void vscode.window.showInformationMessage('Add files or folders before packaging.');
            return;
        }
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            void vscode.window.showErrorMessage('Open a workspace folder to use Zip Packager.');
            return;
        }
        const existing = [];
        const missing = [];
        for (const entry of this.entries.values()) {
            try {
                await vscode.workspace.fs.stat(entry.uri);
                existing.push(entry);
            }
            catch {
                missing.push(entry);
            }
        }
        for (const lost of missing) {
            this.entries.delete(lost.key);
        }
        if (missing.length > 0) {
            this.notifyEntries();
            void vscode.window.showWarningMessage(`Skipped ${missing.length} missing item(s).`);
        }
        if (existing.length === 0) {
            this.notifyEntries();
            void vscode.window.showErrorMessage('No valid items remain for packaging.');
            return;
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Creating markdown file...'
        }, async (progress) => {
            progress.report({ message: 'Preparing entries' });
            try {
                const outputPath = await this.createArchive(workspaceFolder, existing);
                this.notifyEntries();
                void vscode.window.showInformationMessage(`Created ${path.basename(outputPath)}.`, 'Open File').then(choice => {
                    if (choice === 'Open File') {
                        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
                    }
                });
            }
            catch (error) {
                this.logError('Packaging failed', error);
                void vscode.window.showErrorMessage('Failed to create markdown file. Check Zip Packager output for details.');
            }
        });
    }
    async createArchive(folder, entries) {
        const rootPath = folder.uri.fsPath;
        const targetDir = path.join(rootPath, 'search');
        await fs_extra_1.default.ensureDir(targetDir);
        const timestamp = this.formatTimestamp(new Date());
        const mdPath = path.join(targetDir, `bundle-${timestamp}.md`);
        let mdContent = `# 文件集合\n\n生成时间: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n`;
        for (const entry of entries) {
            const fsPath = entry.uri.fsPath;
            if (entry.type === 'directory') {
                // 递归读取目录下的所有文件
                const dirContent = await this.addDirectoryToMarkdown(fsPath, entry.relativePath);
                mdContent += dirContent;
            }
            else {
                // 读取单个文件
                const content = await fs_extra_1.default.readFile(fsPath, 'utf-8');
                const ext = path.extname(entry.relativePath).slice(1) || 'txt';
                mdContent += `## 文件: \`${entry.relativePath}\`\n\n`;
                mdContent += `\`\`\`${ext}\n${content}\n\`\`\`\n\n---\n\n`;
            }
        }
        await fs_extra_1.default.writeFile(mdPath, mdContent, 'utf-8');
        return mdPath;
    }
    async addDirectoryToMarkdown(dirPath, relativePath) {
        let content = '';
        const items = await fs_extra_1.default.readdir(dirPath);
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const itemRelativePath = path.join(relativePath, item);
            const stat = await fs_extra_1.default.stat(itemPath);
            if (stat.isDirectory()) {
                content += await this.addDirectoryToMarkdown(itemPath, itemRelativePath);
            }
            else if (stat.isFile()) {
                const fileContent = await fs_extra_1.default.readFile(itemPath, 'utf-8');
                const ext = path.extname(item).slice(1) || 'txt';
                content += `## 文件: \`${itemRelativePath}\`\n\n`;
                content += `\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n---\n\n`;
            }
        }
        return content;
    }
    notifyEntries(status) {
        if (!this.view) {
            return;
        }
        const entries = Array.from(this.entries.values()).map(entry => ({
            key: entry.key,
            relativePath: entry.relativePath,
            type: entry.type
        }));
        void this.view.webview.postMessage({ type: 'entries', entries, status });
    }
    formatTimestamp(date) {
        const pad = (value) => value.toString().padStart(2, '0');
        return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    }
    logError(message, error) {
        this.output.appendLine(`[Error] ${message}`);
        if (error instanceof Error) {
            this.output.appendLine(error.stack ?? error.message);
        }
        else {
            this.output.appendLine(String(error));
        }
        this.output.show(true);
    }
    logWarning(message, detail) {
        this.output.appendLine(`[Warning] ${message}`);
        this.output.appendLine(String(detail));
    }
    getHtml(webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'packagerView.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'packagerView.css'));
        const nonce = this.createNonce();
        const csp = [
            "default-src 'none'",
            "img-src " + webview.cspSource,
            "style-src " + webview.cspSource + " 'unsafe-inline'",
            "script-src 'nonce-" + nonce + "'"
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Zip Packager</title>
  </head>
  <body>
    <main class="container" data-js="container">
      <section class="drop-zone" data-js="drop-zone">
        <h2>Drag files or folders here</h2>
        <p>Drop items from the Explorer into this area to collect them.</p>
      </section>
      <section class="actions">
        <button class="primary" data-js="pack">Pack All</button>
        <button data-js="clear">Clear All</button>
      </section>
      <p class="status" data-js="status"></p>
      <ul class="entries" data-js="entries"></ul>
    </main>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
    }
    createNonce() {
        return Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    }
    dispose() {
        this.view = undefined;
        this.entries.clear();
        this.output.dispose();
    }
}
function activate(context) {
    const provider = new PackagerViewProvider(context);
    // Register the webview view provider immediately with retainContextWhenHidden
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('zipPackagerView', provider, {
        webviewOptions: {
            retainContextWhenHidden: true
        }
    }));
    context.subscriptions.push(provider, vscode.commands.registerCommand('zipPackager.refresh', () => provider.refresh()), vscode.commands.registerCommand('zipPackager.clearAll', () => provider.clearAll()), vscode.commands.registerCommand('zipPackager.pack', () => provider.packEntries()));
}
function deactivate() {
    // no-op
}
//# sourceMappingURL=extension.js.map