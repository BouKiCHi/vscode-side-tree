import * as path from 'path';
import * as vscode from 'vscode';
import { getTargetFolderItemId } from './extension';
import { MyTreeDataProvider } from './MyTreeDataProvider';
import { MyTreeItem } from './MyTreeItem';

export class MyDnDController implements vscode.TreeDragAndDropController<MyTreeItem> {
  constructor(private treeDataProvider: MyTreeDataProvider) {
  }

  // 識別子
  readonly dropMimeTypes = ['application/vnd.code.tree.sideTreeView', 'text/uri-list'];
  readonly dragMimeTypes = ['application/vnd.code.tree.sideTreeView', 'text/uri-list'];


  // ドラッグ操作
  async handleDrag(source: MyTreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    dataTransfer.set('application/vnd.code.tree.sideTreeView', new vscode.DataTransferItem(source.map(item => item.itemId)));
  }

  // ドロップ操作
  async handleDrop(target: MyTreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    const raw = dataTransfer.get('application/vnd.code.tree.sideTreeView')?.value;

    // フォルダかルート以外はドロップできない
    const isFolderDrop = (target && target.isFolder) || !target;

    // アイテム移動
    if (raw && raw.length) {
      const targetItemId = target?.itemId ?? 0;
      if (isFolderDrop) {
        this.treeDataProvider.moveItemsTo(targetItemId, raw);
      }
      else {
        this.treeDataProvider.appendItemsTo(targetItemId, raw);
      }
    }

    // ファイルドロップ
    const uriList = dataTransfer.get('text/uri-list');
    if (uriList) {
      const value = uriList.value.replaceAll('\r\n', '\n');

      const uris = value.split('\n').filter((line: string) => line && !line.startsWith('#'));
      const fileUris = uris.map((uri: string) => vscode.Uri.parse(uri));

      for (const uri of fileUris) {
        const targetFolderId = getTargetFolderItemId(target);
        // console.log(`Dropped file: ${uri.fsPath}`);
        const fileName = path.basename(uri.fsPath);
        this.treeDataProvider.addItemWithFolderId(targetFolderId, fileName, false, uri.fsPath);
      }
    }
  }
}
