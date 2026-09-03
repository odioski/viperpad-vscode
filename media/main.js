const vscode = acquireVsCodeApi();

const openFileButton = document.querySelector('#open-file');
const openActiveButton = document.querySelector('#open-active');
const positionField = document.querySelector('#position');
const urlField = document.querySelector('#url');
const copyButton = document.querySelector('#copy');
const clearButton = document.querySelector('#clear');
const goButton = document.querySelector('#go');
const modeButton = document.querySelector('#mode');
const saveButton = document.querySelector('#save');
const terminalToggle = document.querySelector('#terminal-toggle');
const status = document.querySelector('#status');
const shellLabel = document.querySelector('#shell-label');
const content = document.querySelector('#content');

let currentDocument = null;
let editing = false;
let dirty = false;

function updateControls() {
  const previewOnly = currentDocument?.kind === 'pdf';
  modeButton.disabled = !currentDocument || previewOnly;
  modeButton.textContent = editing ? 'Preview' : 'Edit';
  saveButton.disabled = !editing || !dirty || currentDocument?.readonly;
  saveButton.title = previewOnly
    ? 'PDF previews are read-only'
    : currentDocument?.readonly ? 'Remote documents are read-only' : 'Save to active VS Code document';
}

function fileKind(fileName) {
  const name = fileName.toLowerCase();
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.txt')) return 'text';
  return 'code';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderMarkdown(value) {
  const inline = text => escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return value
    .split(/\n{2,}/)
    .map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
      }
      if (trimmed.startsWith('```')) {
        return `<pre><code>${escapeHtml(trimmed.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>`;
      }
      return `<p>${inline(trimmed).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

function previewHtml(document) {
  if (document.kind === 'markdown') {
    return `<!doctype html><html><head><style>${previewCss()}</style></head><body>${renderMarkdown(document.text)}</body></html>`;
  }

  if (document.kind === 'docx') {
    return `<!doctype html><html><head><style>${documentCss()}</style></head><body><article class="docx-document">${document.previewHtml || '<p>DOCX preview is empty.</p>'}</article></body></html>`;
  }

  if (document.kind === 'html') {
    return document.text;
  }

  return `<!doctype html><html><head><style>${previewCss()}</style></head><body><pre>${escapeHtml(document.text)}</pre></body></html>`;
}

function previewCss() {
  return 'body{margin:0;padding:24px;color:#dbeafe;background:#020617;font:15px/1.55 system-ui,sans-serif}pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap}a{color:#93c5fd}';
}

function documentCss() {
  return [
    'body{margin:0;padding:32px;color:#1f2937;background:#e5e7eb;font:15px/1.6 system-ui,sans-serif}',
    '.docx-document{max-width:840px;min-height:calc(100vh - 64px);margin:0 auto;padding:48px 56px;background:#fff;box-shadow:0 18px 60px #0002}',
    '.docx-document h1,.docx-document h2,.docx-document h3{line-height:1.2;color:#111827}',
    '.docx-document img{max-width:100%;height:auto}',
    '.docx-document table{border-collapse:collapse;width:100%;margin:1em 0}',
    '.docx-document td,.docx-document th{border:1px solid #d1d5db;padding:6px 8px;vertical-align:top}',
    '.docx-document a{color:#2563eb}'
  ].join('');
}

function showSplash(message = 'Open a VS Code file, active editor, or remote URL') {
  currentDocument = null;
  editing = false;
  dirty = false;
  window.LiveEditor?.destroy();
  resetCursorPosition();
  urlField.value = '';
  content.innerHTML = `
    <div class="empty">
      <div class="splash-label"><strong>ViperPad</strong><span>${escapeHtml(message)}</span></div>
    </div>`;
  status.textContent = 'No file';
  updateControls();
}

async function showViewer() {
  if (!currentDocument) return;
  editing = false;
  dirty = false;
  window.LiveEditor?.destroy();
  resetCursorPosition();
  content.innerHTML = '';

  if (currentDocument.kind === 'code') {
    content.innerHTML = '<div class="editor-host"></div>';
    await window.LiveEditor.mount(content.firstElementChild, currentDocument.text, currentDocument.name, false, () => {}, updateCursorPosition);
    status.textContent = `Viewing · ${currentDocument.name}`;
    updateControls();
    return;
  }

  if (currentDocument.kind === 'pdf') {
    await renderPdf(currentDocument);
    status.textContent = `PDF · ${currentDocument.name}`;
    updateControls();
    return;
  }

  const frame = document.createElement('iframe');
  frame.title = 'File preview';
  frame.sandbox = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads';
  frame.srcdoc = previewHtml(currentDocument);
  content.append(frame);
  status.textContent = `Preview · ${currentDocument.name}`;
  updateControls();
}

function whenPdfJsReady() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PDF renderer did not load')), 8000);
    window.addEventListener('pdfjs-ready', () => {
      clearTimeout(timer);
      resolve(window.pdfjsLib);
    }, { once: true });
  });
}

async function renderPdf(viperDocument) {
  const source = viperDocument.sourceUri || viperDocument.fileName;
  if (!source) {
    throw new Error('PDF has no readable source');
  }

  const shell = document.createElement('div');
  shell.className = 'pdf-viewer';
  shell.innerHTML = '<div class="pdf-status">Loading PDF...</div>';
  content.append(shell);

  const pdfjsLib = await whenPdfJsReady();
  const pdf = await pdfjsLib.getDocument(source).promise;
  shell.innerHTML = '';

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.min(shell.clientWidth || 900, 1100) - 32;
    const scale = Math.max(0.6, Math.min(2, availableWidth / baseViewport.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const context = canvas.getContext('2d');
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const pageShell = document.createElement('section');
    pageShell.className = 'pdf-page';
    pageShell.append(canvas);
    shell.append(pageShell);

    await page.render({ canvasContext: context, viewport }).promise;
  }
}

async function showEditor() {
  if (!currentDocument) return;
  editing = true;
  dirty = false;
  content.innerHTML = '<div class="editor-host"></div>';
  await window.LiveEditor.mount(content.firstElementChild, currentDocument.text, currentDocument.name, true, () => {
    dirty = true;
    status.textContent = `Modified · ${currentDocument.name}`;
    updateControls();
  }, updateCursorPosition);
  status.textContent = `Editing · ${currentDocument.name}`;
  updateControls();
}

function loadDocument(document, nextStatus) {
  if (!document) {
    showSplash('No active editor');
    return;
  }

  currentDocument = {
    ...document,
    kind: document.kind || fileKind(document.name || document.fileName || '')
  };
  editing = false;
  dirty = false;
  urlField.value = currentDocument.fileName;
  status.textContent = nextStatus || currentDocument.name;
  showViewer().catch(error => {
    status.textContent = error instanceof Error ? error.message : String(error);
    content.innerHTML = `
      <div class="empty">
        <div class="splash-label"><strong>Preview failed</strong><span>${escapeHtml(status.textContent)}</span></div>
      </div>`;
    updateControls();
  });
}

function updateCursorPosition(position) {
  positionField.disabled = false;
  positionField.value = `${position.line}:${position.column}`;
}

function resetCursorPosition() {
  positionField.value = '-';
  positionField.disabled = true;
}

function focusEditorPosition() {
  const match = positionField.value.trim().match(/^(\d+)(?::(\d+))?$/);
  if (!match) {
    positionField.select();
    return;
  }
  window.LiveEditor?.focusPosition(Number(match[1]), Number(match[2] ?? 1));
}

openFileButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'openFile' });
});

openActiveButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'openActiveDocument' });
});

goButton.addEventListener('click', () => {
  vscode.postMessage({ type: 'openRemote', url: urlField.value });
});

urlField.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    vscode.postMessage({ type: 'openRemote', url: urlField.value });
  }
});

positionField.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    focusEditorPosition();
  }
});

modeButton.addEventListener('click', () => {
  editing ? showViewer() : showEditor();
});

saveButton.addEventListener('click', () => {
  if (!currentDocument || currentDocument.readonly) return;
  const nextText = window.LiveEditor?.getValue() ?? currentDocument.text;
  vscode.postMessage({ type: 'saveDocument', id: currentDocument.id, kind: currentDocument.kind, text: nextText });
});

terminalToggle.addEventListener('click', () => {
  vscode.postMessage({ type: 'openTerminal', fileName: currentDocument?.fileName });
});

copyButton.addEventListener('click', async () => {
  const text = urlField.value.trim() || currentDocument?.fileName || '';
  if (!text) return;
  await navigator.clipboard.writeText(text);
  copyButton.textContent = 'Copied';
  setTimeout(() => copyButton.textContent = 'Copy', 1000);
});

clearButton.addEventListener('click', () => {
  showSplash();
});

addEventListener('keydown', event => {
  if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!saveButton.disabled) {
      saveButton.click();
    }
  }
});

window.addEventListener('message', event => {
  const message = event.data;

  if (message.type === 'workspaceState') {
    shellLabel.textContent = message.shell ? `Terminal · ${message.shell}` : '';
    if (message.folders?.length && !currentDocument) {
      status.textContent = `Workspace · ${message.folders[0]}`;
    }
  }

  if (message.type === 'document') {
    loadDocument(message.document, message.status);
  }

  if (message.type === 'status') {
    status.textContent = message.status;
  }
});

showSplash();
vscode.postMessage({ type: 'ready' });
