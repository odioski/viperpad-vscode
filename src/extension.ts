import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import * as mammoth from 'mammoth';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openActiveDocument' }
  | { type: 'openFile' }
  | { type: 'openRemote'; url: unknown }
  | { type: 'saveDocument'; id?: unknown; kind?: unknown; text: unknown }
  | { type: 'openTerminal'; fileName?: unknown };

type ViperDocument = {
  id: string;
  name: string;
  fileName: string;
  languageId: string;
  kind: string;
  text: string;
  readonly: boolean;
  sourceUri?: string;
  previewHtml?: string;
  conversionMessages?: string[];
};

const textDecoder = new TextDecoder('utf-8');

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('viperpad.open', () => {
    try {
      openPanel(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`ViperPad could not open: ${message}`);
    }
  });

  context.subscriptions.push(disposable);
}

function openPanel(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    'viperpad',
    'ViperPad',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        context.extensionUri,
        ...vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? [],
        vscode.Uri.file('/')
      ],
      retainContextWhenHidden: true
    }
  );

  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      try {
        await handleMessage(panel, message);
      } catch (error) {
        await postStatus(panel, error instanceof Error ? error.message : String(error));
      }
    },
    undefined,
    context.subscriptions
  );
}

export function deactivate(): void {
  // VS Code owns registered disposables through context.subscriptions.
}

async function handleMessage(panel: vscode.WebviewPanel, message: WebviewMessage): Promise<void> {
  switch (message?.type) {
    case 'ready':
      await sendWorkspaceState(panel);
      await sendActiveDocument(panel);
      break;
    case 'openActiveDocument':
      await sendActiveDocument(panel);
      break;
    case 'openFile':
      await openFile(panel);
      break;
    case 'openRemote':
      await openRemote(panel, message.url);
      break;
    case 'saveDocument':
      await saveDocument(panel, message.id, message.kind, message.text);
      break;
    case 'openTerminal':
      openTerminal(message.fileName);
      break;
  }
}

async function sendWorkspaceState(panel: vscode.WebviewPanel): Promise<void> {
  const folders = vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [];
  await panel.webview.postMessage({
    type: 'workspaceState',
    folders,
    shell: defaultShell()
  });
}

async function sendActiveDocument(panel: vscode.WebviewPanel): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (editor) {
    await postDocument(panel, documentFromTextDocument(editor.document, false), 'Active document');
    return;
  }

  const uri = activeTabUri();
  if (uri) {
    const kind = fileKind(uri.fsPath || uri.toString());
    if (kind === 'pdf') {
      await postDocument(panel, documentFromUri(panel.webview, uri, kind), 'Active PDF');
      return;
    }
    if (kind === 'docx') {
      await postDocument(panel, await documentFromDocxUri(uri, false), 'Active DOCX');
      return;
    }
  }

  await panel.webview.postMessage({
    type: 'document',
    document: null,
    status: 'No active editor'
  });
}

async function openFile(panel: vscode.WebviewPanel): Promise<void> {
  const [uri] = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: 'Open in ViperPad'
  }) ?? [];

  if (!uri) {
    await postStatus(panel, 'Open cancelled');
    return;
  }

  const kind = fileKind(uri.fsPath);

  if (kind === 'pdf') {
    await postDocument(panel, documentFromUri(panel.webview, uri, kind), 'Opened PDF');
    return;
  }

  if (kind === 'docx') {
    await postDocument(panel, await documentFromDocxUri(uri, false), 'Opened DOCX');
    return;
  }

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
  await postDocument(panel, documentFromTextDocument(document, false), 'Opened file');
}

async function openRemote(panel: vscode.WebviewPanel, value: unknown): Promise<void> {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) {
    throw new Error('Enter an HTTP or HTTPS URL');
  }

  const remoteUrl = value.trim();
  await postStatus(panel, 'Downloading...');

  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`Remote request failed: ${response.status} ${response.statusText}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error('Remote files are limited to 10 MB');
  }

  const name = decodeURIComponent(new URL(remoteUrl).pathname.split('/').filter(Boolean).at(-1) ?? 'remote.txt');
  const kind = fileKind(name);

  if (kind === 'pdf') {
    await postDocument(panel, {
      id: remoteUrl,
      name,
      fileName: remoteUrl,
      languageId: '',
      kind,
      text: '',
      readonly: true,
      sourceUri: remoteUrl
    }, 'Remote PDF');
    return;
  }

  if (kind === 'docx') {
    await postDocument(panel, await documentFromDocxBytes(remoteUrl, name, Buffer.from(bytes), true), 'Remote DOCX');
    return;
  }

  const text = textDecoder.decode(bytes);
  await postDocument(panel, {
    id: remoteUrl,
    name,
    fileName: remoteUrl,
    languageId: '',
    kind,
    text,
    readonly: true
  }, 'Remote file');
}

function activeTabUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText) return input.uri;
  if (input instanceof vscode.TabInputCustom) return input.uri;
  if (input instanceof vscode.TabInputNotebook) return input.uri;
  if (input instanceof vscode.TabInputTextDiff) return input.modified;
  return undefined;
}

async function saveDocument(panel: vscode.WebviewPanel, id: unknown, kind: unknown, value: unknown): Promise<void> {
  if (typeof value !== 'string') {
    throw new Error('No document content to save');
  }

  const uri = typeof id === 'string' ? vscode.Uri.parse(id) : undefined;
  if (kind === 'docx' && uri) {
    await saveDocx(panel, uri, value);
    return;
  }

  const document = uri
    ? vscode.workspace.textDocuments.find(candidate => candidate.uri.toString() === uri.toString()) ?? await vscode.workspace.openTextDocument(uri)
    : vscode.window.activeTextEditor?.document;
  if (!document) throw new Error('No VS Code document to save');

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, fullRange, value);
  const edited = await vscode.workspace.applyEdit(edit);

  if (!edited) {
    throw new Error('VS Code could not apply the edit');
  }

  await document.save();
  await postDocument(panel, documentFromTextDocument(document, false), 'Saved');
}

function openTerminal(fileName: unknown): void {
  const cwd = typeof fileName === 'string' && fileName && !/^https?:\/\//i.test(fileName)
    ? vscode.Uri.file(fileName.replace(/[/\\][^/\\]*$/, '')).fsPath
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const terminal = vscode.window.createTerminal({
    name: 'ViperPad',
    cwd
  });
  terminal.show();
}

function documentFromTextDocument(document: vscode.TextDocument, readonly: boolean): ViperDocument {
  return {
    id: document.uri.toString(),
    name: document.fileName.split(/[\\/]/).at(-1) ?? document.fileName,
    fileName: document.fileName,
    languageId: document.languageId,
    kind: fileKind(document.fileName),
    text: document.getText(),
    readonly
  };
}

function documentFromUri(webview: vscode.Webview, uri: vscode.Uri, kind: string): ViperDocument {
  return {
    id: uri.toString(),
    name: uri.fsPath.split(/[\\/]/).at(-1) ?? uri.fsPath,
    fileName: uri.fsPath,
    languageId: '',
    kind,
    text: '',
    readonly: true,
    sourceUri: webview.asWebviewUri(uri).toString()
  };
}

async function documentFromDocxUri(uri: vscode.Uri, readonly: boolean): Promise<ViperDocument> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return documentFromDocxBytes(uri.toString(), uri.fsPath, Buffer.from(bytes), readonly);
}

async function documentFromDocxBytes(id: string, fileName: string, buffer: Buffer, readonly: boolean): Promise<ViperDocument> {
  const [html, rawText] = await Promise.all([
    mammoth.convertToHtml({ buffer }),
    mammoth.extractRawText({ buffer })
  ]);
  return {
    id,
    name: fileName.split(/[\\/]/).at(-1) ?? fileName,
    fileName,
    languageId: 'plaintext',
    kind: 'docx',
    text: rawText.value,
    readonly,
    previewHtml: html.value,
    conversionMessages: html.messages.map(message => message.message)
  };
}

async function saveDocx(panel: vscode.WebviewPanel, uri: vscode.Uri, value: string): Promise<void> {
  const paragraphs = value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => new Paragraph({
      children: block.split('\n').flatMap((line, index) => [
        ...(index === 0 ? [] : [new TextRun({ text: '', break: 1 })]),
        new TextRun(line)
      ])
    }));

  const document = new Document({
    sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph('')] }]
  });
  const buffer = await Packer.toBuffer(document);
  await vscode.workspace.fs.writeFile(uri, buffer);
  await postDocument(panel, await documentFromDocxUri(uri, false), 'Saved DOCX');
}

async function postDocument(panel: vscode.WebviewPanel, document: ViperDocument, status: string): Promise<void> {
  await panel.webview.postMessage({
    type: 'document',
    document,
    status
  });
}

async function postStatus(panel: vscode.WebviewPanel, status: string): Promise<void> {
  await panel.webview.postMessage({
    type: 'status',
    status
  });
}

function fileKind(fileName: string): string {
  const name = fileName.toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown')) {
    return 'markdown';
  }
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    return 'html';
  }
  if (name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (name.endsWith('.docx')) {
    return 'docx';
  }
  if (name.endsWith('.txt')) {
    return 'text';
  }
  return 'code';
}

function defaultShell(): string {
  return process.env.SHELL?.split('/').at(-1) || (process.platform === 'win32' ? 'powershell' : 'sh');
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const editorUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.bundle.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));
  const pdfScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));
  const pdfWorkerUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'));
  const nonce = cryptoNonce();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; connect-src ${webview.cspSource} http: https:; frame-src ${webview.cspSource} http: https:; worker-src ${webview.cspSource} blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>ViperPad</title>
</head>
<body>
  <header>
    <div class="top-bar">
      <button id="open-file" type="button">Open file</button>
      <button id="open-active" class="secondary" type="button">Open active</button>
      <div class="address">
        <input id="position" aria-label="Editor line and column" value="-" disabled>
        <input id="url" aria-label="Remote URL or current file" placeholder="Paste an HTTP(S) URL or open a VS Code file">
        <button id="copy" type="button">Copy</button>
        <span class="address-separator" aria-hidden="true">|</span>
        <button id="clear" type="button">Clear</button>
      </div>
      <button id="go" class="secondary" type="button">Open URL</button>
      <button id="mode" class="secondary" type="button" disabled>Edit</button>
      <button id="save" type="button" disabled>Save</button>
      <span id="status">Starting ViperPad...</span>
    </div>
    <div class="tool-bar" aria-label="Tools">
      <button id="terminal-toggle" class="secondary icon-button" type="button" aria-label="Terminal" title="Terminal">
        <span class="terminal-icon" aria-hidden="true"></span>
      </button>
      <span id="shell-label" class="shell-label"></span>
      <span class="tool-spacer" aria-hidden="true"></span>
    </div>
  </header>
  <main>
    <div id="content" class="content-layer">
      <div class="empty">
        <div class="splash-label"><strong>ViperPad</strong><span>Open a VS Code file, active editor, or remote URL</span></div>
      </div>
    </div>
  </main>
  <script nonce="${nonce}" src="${editorUri}"></script>
  <script nonce="${nonce}" type="module">
    import * as pdfjsLib from '${pdfScriptUri}';
    pdfjsLib.GlobalWorkerOptions.workerSrc = '${pdfWorkerUri}';
    window.pdfjsLib = pdfjsLib;
    window.dispatchEvent(new Event('pdfjs-ready'));
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function cryptoNonce(): string {
  return randomBytes(16).toString('hex');
}
