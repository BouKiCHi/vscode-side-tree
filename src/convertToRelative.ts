import * as path from 'path';
import * as vscode from 'vscode';

// 相対パス変換


export function convertToRelative(filePath: string): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return filePath;
  }

  const workspacePath = workspaceFolder.uri.fsPath;
  const relativePath = path.relative(workspacePath, filePath);

  // ワークスペース外のパス（.. で始まる）や別ドライブは相対化しない
  if (
    !relativePath ||
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    return filePath;
  }

  // パス区切りを POSIX 形式に統一
  return relativePath.replace(/\\/g, '/');
}
