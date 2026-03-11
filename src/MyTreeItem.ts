import * as vscode from 'vscode';
import { localize } from './localize';

// ツリーアイテムのクラス
export type TreeItemType = 'virtualFolder' | 'linkedFolder' | 'file' | 'symbol';

export class MyTreeItem extends vscode.TreeItem {
  public parentId: number = 0;

  constructor(
    public readonly itemId: number,
    public label: string,
    public readonly isFolder: boolean,
    public readonly itemType: TreeItemType,
    fileCommandId?: string,
    folderCommandId?: string,
    public readonly filePath?: string,
    public readonly line?: number,
    public readonly column?: number,
    public readonly symbolPath?: string,
    public readonly isTransient: boolean = false
  ) {
    const collapsibleState: vscode.TreeItemCollapsibleState = isFolder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

    super(label, collapsibleState);
    const pathTooltip = filePath ? localize('sideTree.tooltip.path', 'Path: {0}', filePath) : '';
    const lineSuffix = typeof line === 'number' ? `:${line + 1}:${(column ?? 0) + 1}` : '';
    this.tooltip = `${pathTooltip}${lineSuffix}`;
    // this.description = `Description for ${label}`;
    // 仮想フォルダと実フォルダ参照でアイコンを分ける
    this.iconPath = this.getIconPath();

    this.contextValue = this.getContextValue();
    if (fileCommandId && !isFolder) {
      this.command = {
        command: fileCommandId,
        title: localize('sideTree.command.itemClicked.title', 'Item Clicked'),
        arguments: [{ label, collapsibleState, filePath, itemId, isFolder, line, column, symbolPath }]
      };
    } else if (folderCommandId && isFolder) {
      this.command = {
        command: folderCommandId,
        title: localize('sideTree.command.folderClicked.title', 'Folder Clicked')
      };
    }
  }

  private getContextValue(): string {
    if (this.isTransient) {
      return this.isFolder ? 'sideTreeLinkedFolderChildItem' : 'sideTreeLinkedFileItem';
    }

    if (this.itemType === 'linkedFolder') {
      return 'sideTreeLinkedFolderItem';
    }

    if (this.itemType === 'virtualFolder') {
      return 'sideTreeVirtualFolderItem';
    }

    return 'sideTreeFileItem';
  }

  private getIconPath(): vscode.ThemeIcon {
    if (!this.isFolder) {
      return new vscode.ThemeIcon('file');
    }

    if (this.itemType === 'linkedFolder') {
      return new vscode.ThemeIcon('references');
    }

    return new vscode.ThemeIcon('folder');
  }
}
