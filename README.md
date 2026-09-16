# ViperPad for VS Code

ViperPad is a document editor and preview workspace for VS Code.

## Install from the Marketplace

1. Open VS Code.
2. Open **Extensions** from the Activity Bar, or press `Ctrl+Shift+X` on Windows/Linux or `Cmd+Shift+X` on macOS.
3. Search for **ViperPad**.
4. Select **ViperPad** by **BookMotives**.
5. Select **Install**.

After installation, ViperPad is available in your VS Code workspace.

## Install from a VSIX File

Use this option when you have been given a `.vsix` installation file:

1. Open VS Code.
2. Open the Extensions view.
3. Select the **...** menu in the Extensions view.
4. Select **Install from VSIX...**.
5. Choose the ViperPad `.vsix` file.
6. Select **Reload** if VS Code asks you to reload.

## Open ViperPad

1. Open the Command Palette with `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS.
2. Type **ViperPad: Open**.
3. Select **ViperPad: Open**.

You can open ViperPad from the Command Palette whenever you need it.

## Features

- Open a file through the VS Code file picker.
- Load and edit the active VS Code document.
- Save changes back to the loaded document.
- Preview Markdown and HTML documents.
- Preview PDF documents.
- Preview and edit DOCX documents.
- Open HTTP and HTTPS resources as read-only documents.
- Copy and clear the current document location.
- Jump to an editor line and column.
- Open a VS Code integrated terminal in the loaded file's directory.

## Developers

The standalone ViperPad app uses Rust, Axum, and a browser UI. This extension hosts the ViperPad UI inside a VS Code webview and bridges editor operations through the VS Code extension API.

```text
ViperPad webview
	-> postMessage
VS Code extension host
	-> vscode.workspace / vscode.window / commands / terminals
```

### Local Development

Install dependencies and compile the extension:

```bash
npm install
npm run compile
```

To test the extension in VS Code:

1. Open the project folder in VS Code.
2. Open **Run and Debug**.
3. Select **Run ViperPad Extension**.
4. Press `F5` or **Start Debugging**.
5. In the new Extension Development Host window, run **ViperPad: Open** from the Command Palette.

## Support

For questions or issues, visit the project's GitHub repository:

https://github.com/odioski/viperpad-vscode
