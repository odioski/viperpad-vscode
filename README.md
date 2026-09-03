# ViperPad VS Code

This is the VS Code extension host for ViperPad.

The standalone ViperPad app uses Rust, Axum, and a browser UI. This extension hosts the ViperPad UI inside a VS Code webview and bridges editor operations through the VS Code extension API.

## Architecture

```text
ViperPad webview
  -> postMessage
VS Code extension host
  -> vscode.workspace / vscode.window / commands / terminals
```

## Run

```bash
npm install
npm run compile
```

Then open this folder in VS Code and start the extension host:

```bash
code /home/mrod/CODE/viperpad-vscode
```

In VS Code, run the `Run ViperPad Extension` launch config. In the new Extension Development Host window, open the command palette and run `ViperPad: Open`.

Run the command in the new Extension Development Host window, not the original project window. If ViperPad cannot initialize, VS Code now displays the startup error instead of failing silently.

`Run ViperPad Extension` is a launch configuration, not a command palette command. Use the Run and Debug view in VS Code, select `Run ViperPad Extension`, and press Start Debugging.

## Ported Features

- Open a file through the VS Code file picker.
- Load the active VS Code document.
- View source files with the ViperPad editor bundle.
- Edit and save changes back to the loaded VS Code document.
- Preview Markdown and HTML documents.
- Preview PDFs with the built-in ViperPad PDF canvas renderer.
- Preview DOCX documents and edit/save their extracted text as a clean DOCX.
- Open HTTP and HTTPS resources as read-only documents.
- Copy and clear the current document location.
- Jump to an editor line and column.
- Open a VS Code integrated terminal using the loaded file's directory.

## Current Commands

- `ViperPad: Open` opens the ViperPad webview.

The terminal button uses VS Code's integrated terminal API. It does not require a terminal feature flag or a separate server.

## Build an Installable Extension

```bash
npm run package
```

This creates a `.vsix` file in the extension folder. Install it from VS Code with `Extensions: Install from VSIX...`.
