import * as vscode from 'vscode';
import * as path from 'path';
import { MyTreeDataProvider } from './MyTreeDataProvider';
import { MyTreeItem } from './MyTreeItem';
import { MyDnDController } from './MyDnDController';
import { convertToRelative } from './convertToRelative';

export function activate(context: vscode.ExtensionContext) {
  // TreeDataProviderの実装
  const treeDataProvider = new MyTreeDataProvider();
  const dndController = new MyDnDController(treeDataProvider);

  const options: vscode.TreeViewOptions<MyTreeItem> = {
    treeDataProvider: treeDataProvider,
    dragAndDropController: dndController,
    canSelectMany: true,
  };

  // ツリービューの作成
  const treeView = vscode.window.createTreeView('sideTreeView', options);
  const treeViewInExplorer = vscode.window.createTreeView('sideTreeViewInExplorer', options);

  // クリック時の処理
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.itemClicked', async (args: {
      label: string, collapsibleState: vscode.TreeItemCollapsibleState, filePath?: string, itemId?: number
    }) => {
      if (args.filePath) {
        await openDocument(args.filePath);
      }
    })
  );

  // フォルダ追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addFolderInExplorer', async () => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const folderId = getFolderId(selectedItems);
      const folder = await treeDataProvider.addItemWithFolderId(folderId, 'New Folder', true);
      treeViewInExplorer.reveal(folder, { focus: true, expand: true });
    })
  );

  // フォルダ追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addFolder', async () => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const folderId = getFolderId(selectedItems);
      const folder = await treeDataProvider.addItemWithFolderId(folderId, 'New Folder', true);
      treeView.reveal(folder, { focus: true, expand: true });
    })
  );

  // データのリロード
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.reloadData', async () => {
      await treeDataProvider.reloadData();
    })
  );

  // アイテム検索
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.findItem', async () => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = 'Find Item in SideTree';
      quickPick.matchOnDetail = true;
      const searchItems = treeDataProvider.getSearchItems();
      quickPick.items = searchItems;
      quickPick.onDidChangeSelection(selection => {
        if (selection.length) {
          quickPick.hide();
          const selectedItemId = (selection[0] as MyTreeQuickPickItem).itemId;
          const item = treeDataProvider.getItemByItemId(selectedItemId);
          treeView.reveal(item, { focus: true, expand: true });
          if (item.filePath) {
            openDocument(item.filePath);
          }
        }
      });
      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    })
  );

  // データのインポート
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.importData', async () => {
      const list = await vscode.env.clipboard.readText();
      if (!list) {
        return;
      }

      // インポートするかを聞く
      const answer = await vscode.window.showInformationMessage(
        'Do you want to import from clipboard?',
        { modal: true },
        'Yes', 'No'
      );

      if (answer !== 'Yes') {
        return;
      }

      // フォルダIDの取得
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const folderId = getFolderId(selectedItems);

      const lines = list.split('\n');
      for(const line of lines) {
        const filePath = line.trim();
        if (!filePath) {
          continue;
        }

        const fileName = path.basename(filePath);
        await treeDataProvider.addItemWithFolderId(folderId, fileName, false, filePath);
      }
    })
  );

  // ファイルを追加する
  async function appendFile(resource: vscode.Uri) {
      const filePath = resource.fsPath;
      const fileName = path.basename(filePath);
      // フォルダIDの取得
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const folderId = getFolderId(selectedItems);
      await treeDataProvider.addItemWithFolderId(folderId, fileName, false, filePath);
      vscode.window.showInformationMessage(`Added ${fileName} to SideTree`);
  }

  // タブのファイルを表示する
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.revealItem', async (resource: vscode.Uri) => {
      if (resource && resource.scheme === 'file') {
        const filePath = resource.fsPath;
        const relativePath = convertToRelative(filePath);
        
        const item = treeDataProvider.getItemByPath(relativePath);
        if (item) {
          treeView.reveal(item, { focus: true, expand: true });
        }
      }
    })
  );

  // タブからアイテム追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addItemFromTab', async (resource: vscode.Uri) => {
      if (resource && resource.scheme === 'file') {
        await appendFile(resource);
      }
    })
  );

  // エクスプローラーからアイテム追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addItemFromExplorer', async (resource: vscode.Uri) => {
      if (resource && resource.scheme === 'file') {
        await appendFile(resource);
      }
    })
  );

  // アイテム削除コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.removeItem', async (item: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      for(const selectedItem of selectedItems) {
        treeDataProvider.removeItem(selectedItem);
      }

      vscode.window.showInformationMessage(`Removed ${item.label} from SideTree`);
    })
  );

  // パスのコピーコマンドの機能
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.copyPath', async (item: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const paths = selectedItems.filter(x => x.filePath).map(x => x.filePath);
      await vscode.env.clipboard.writeText(paths.join('\n'));
    })
  );

  // アイテムリネームコマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.renameItem', async (item: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      if (!selectedItems.length) {
        return;
      }

      const targetItem = selectedItems[0];
      const newLabel = await vscode.window.showInputBox({
        prompt: `Enter new name for "${targetItem.label}"`,
        placeHolder: targetItem.label,
        value: targetItem.label,
        validateInput: (value) => {
          if (!value.trim()) {
            return 'Name cannot be empty';
          }
          return null;
        }
      });

      if (newLabel) {
        // const oldLabel = targetItem.label;
        treeDataProvider.changeLabel(targetItem.itemId, newLabel);
        // vscode.window.showInformationMessage(`Change Label from "${oldLabel}" to "${newLabel}"`);
      }
    })
  );

  // 上に移動
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemUp', async (item: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      if (!selectedItems.length) {
        return;
      }

      const targetItem = selectedItems[0];
      treeDataProvider.moveItemUp(targetItem.itemId);
    })  
  );

  // 下に移動
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemDown', async (item: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      if (!selectedItems.length) {
        return;
      }

      const targetItem = selectedItems[0];
      treeDataProvider.moveItemDown(targetItem.itemId);
    })
  );

}

// タブを開く
async function openDocument(filePath: string) {
  try {
    const uri = getUriFromPath(filePath);
    if (uri) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preserveFocus: true });
    } else {
      vscode.window.showInformationMessage(`Failed to open file: ${filePath}`);
    }
  } catch (error) {
    vscode.window.showInformationMessage(`Failed to open file: ${filePath}`);
  }
}

export function deactivate() { }

export interface MyTreeQuickPickItem extends vscode.QuickPickItem {
  itemId: number;
}

// フォルダIDを取得
function getFolderId(selectedItems: readonly MyTreeItem[]): number {
  const folderItem = selectedItems.length > 0 ? selectedItems[0] : null;
  // 未選択はルート
  if (!folderItem) {
    return 0;
  }

  // フォルダの場合はそのもの、それ以外は親フォルダ
  const folderId = folderItem.isFolder ? folderItem.itemId : folderItem.parentId;
  return folderId;
}

// 対象となるフォルダIDの取得
export function getTargetFolderItemId(target: MyTreeItem | undefined) {
  if (!target) {
    return 0;
  }

  return target.isFolder ? target.itemId : target.parentId;
}

// ファイルが開かれているか？
async function isFileOpen(filePath: string): Promise<boolean> {
  const documents = vscode.workspace.textDocuments;
  return documents.some(doc => doc.uri.fsPath === filePath);
}

// パスからuriを取得する
function getUriFromPath(filePath: string): vscode.Uri | null {
  if (path.isAbsolute(filePath)) {
    // 絶対パスならそのまま使う
    return vscode.Uri.file(filePath);
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return null; // ワークスペースが開かれていない場合
  }

  const absolutePath = path.join(workspaceFolder.uri.fsPath, filePath);
  return vscode.Uri.file(absolutePath);
}