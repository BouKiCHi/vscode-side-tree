import * as path from 'path';
import * as vscode from 'vscode';

// 相対パス変換


export function convertToRelative(filePath: string): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    return filePath;
  }

  const workspacePath = workspaceFolder.uri.fsPath;

  // パスの先頭が一致する場合
  if (filePath.startsWith(workspacePath)) {
    // 相対パスに変換
    let relativePath = path.relative(workspacePath, filePath);
    // パス区切りを変換
    relativePath = relativePath.replace(/\\/g, '/');
    return relativePath;
  }
  return filePath;
}
