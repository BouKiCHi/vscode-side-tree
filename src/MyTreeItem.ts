import * as vscode from 'vscode';

// ツリーアイテムのクラス

export class MyTreeItem extends vscode.TreeItem {
  public parentId: number = 0;

  constructor(
    public readonly itemId: number,
    public label: string,
    public readonly isFolder: boolean,
    commandId?: string,
    public readonly filePath?: string
  ) {
    const collapsibleState: vscode.TreeItemCollapsibleState = isFolder ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

    super(label, collapsibleState);
    this.tooltip = `${filePath ? `Path: ${filePath}` : ''}`;
    // this.description = `Description for ${label}`;
    this.contextValue = 'MyTreeItem';
    if (commandId) {
      this.command = {
        command: commandId,
        title: 'Item Clicked',
        arguments: [{ label, collapsibleState, filePath, itemId }]
      };
    }
  }
}
