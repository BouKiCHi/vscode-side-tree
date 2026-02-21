import * as vscode from 'vscode';
import { localize } from './localize';

// ツリーアイテムのクラス

export class MyTreeItem extends vscode.TreeItem {
  public parentId: number = 0;

  constructor(
    public readonly itemId: number,
    public label: string,
    public readonly isFolder: boolean,
    commandId?: string,
    public readonly filePath?: string,
    public readonly line?: number,
    public readonly column?: number,
    public readonly symbolPath?: string
  ) {
    const collapsibleState: vscode.TreeItemCollapsibleState = isFolder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

    super(label, collapsibleState);
    const pathTooltip = filePath ? localize('sideTree.tooltip.path', 'Path: {0}', filePath) : '';
    const lineSuffix = typeof line === 'number' ? `:${line + 1}:${(column ?? 0) + 1}` : '';
    this.tooltip = `${pathTooltip}${lineSuffix}`;
    // this.description = `Description for ${label}`;
    // isFolderの値に基づいてアイコンを設定
    this.iconPath = new vscode.ThemeIcon(isFolder ? 'folder' : 'file');

    this.contextValue = 'MyTreeItem';
    if (commandId) {
      this.command = {
        command: commandId,
        title: localize('sideTree.command.itemClicked.title', 'Item Clicked'),
        arguments: [{ label, collapsibleState, filePath, itemId, isFolder, line, column, symbolPath }]
      };
    }
  }
}
