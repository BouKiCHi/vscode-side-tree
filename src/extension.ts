import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MyTreeDataProvider } from './MyTreeDataProvider';
import { MyTreeItem } from './MyTreeItem';
import { MyDnDController } from './MyDnDController';
import { convertToRelative } from './convertToRelative';
import { SideTreeDataManager } from './SideTreeDataManager';

export function activate(context: vscode.ExtensionContext) {
  // データマネージャー
  const dataManager = new SideTreeDataManager(context);

  // TreeDataProviderのインスタンスを作成
  const treeDataProvider = new MyTreeDataProvider(dataManager);
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

  // フォルダ追加コマンドの登録 エクスプローラ内のツリー
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addFolderInExplorer', async () => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const folderId = getFolderId(selectedItems);
      const folderName = await inputFolderName();
      if (!folderName) {
        return;
      }
      const folder = await treeDataProvider.addItemWithFolderId(folderId, folderName, true);
      treeViewInExplorer.reveal(folder, { focus: true, expand: true });
    })
  );

  // フォルダ追加コマンドの登録 単独ツリー
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addFolder', async () => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const folderId = getFolderId(selectedItems);
      const folderName = await inputFolderName();
      if (!folderName) {
        return;
      }
      const folder = await treeDataProvider.addItemWithFolderId(folderId, folderName, true);
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
      const folderPath = treeDataProvider.getItemPath(folderId);
      vscode.window.showInformationMessage(`Added ${fileName} to ${folderPath}`);
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
    vscode.commands.registerCommand('sideTreeView.removeItem', async (menuItem: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const list = getSelectedItems(menuItem, selectedItems);
      const labels : { [key: string]: boolean } = {};
      const dirs : { [key: string]: boolean } = {};
      for(const item of list) {
        const folderPath = treeDataProvider.getItemPath(item.parentId);
        dirs[folderPath] = true;
        labels[item.label] = true;
        treeDataProvider.removeItem(item.itemId);
      }

      const joinPaths = Object.keys(dirs).join(',');
      const joinLabels = Object.keys(labels).join(',');

      vscode.window.showInformationMessage(`Removed ${joinLabels} from ${joinPaths}`);
    })
  );

  // パスのコピーコマンドの機能
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.copyPath', async (menuItem: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const list = getSelectedItems(menuItem, selectedItems);
      const paths = list.filter(x => x.filePath).map(x => x.filePath);
      await vscode.env.clipboard.writeText(paths.join('\n'));
    })
  );

  // アイテムリネームコマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.renameItem', async (menuItem: MyTreeItem) => {
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
    vscode.commands.registerCommand('sideTreeView.moveItemUp', async (menuItem: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const list = getSelectedItems(menuItem, selectedItems);
      for(const item of list) {
        treeDataProvider.moveItemUp(item.itemId);
      }
    })  
  );

  // 下に移動
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemDown', async (menuItem: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const list = getSelectedItems(menuItem, selectedItems);
      for(const item of list) {
        treeDataProvider.moveItemDown(item.itemId);
      }
    })
  );

  // 親フォルダの上に移動する
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemParent', async (menuItem: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const list = getSelectedItems(menuItem, selectedItems);
      for(const item of list) {
        treeDataProvider.moveItemParent(item.itemId);
      }
    })
  );

  // ツリー項目をを閉じる
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.foldAllItems', async () => {
      vscode.commands.executeCommand('workbench.actions.treeView.sideTreeView.collapseAll');
      vscode.commands.executeCommand('workbench.actions.treeView.sideTreeViewInExplorer.collapseAll');
    })
  );

  // ソートコマンド
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.sortItems', async (menuItem: MyTreeItem) => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const list = getSelectedItems(menuItem, selectedItems);

      for(const item of list) {
        if (!item.isFolder) {
          continue;
        }
        treeDataProvider.sortItemInFolder(item.itemId);
      }
    })
  );

  // ルートフォルダをソートする
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.sortRootFolder', async () => {
      treeDataProvider.sortItemInFolder(0);
    })
  );

  // バックアップフォルダを開く
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.openBackupFolder', async () => {
      if (!vscode.workspace.workspaceFolders) {
        return;
      }

      // バックアップフォルダをWindowsのエクスプローラで開きたい
      const backupFolder = dataManager.getBackupFolder();
      if (fs.existsSync(backupFolder)) {
        vscode.env.openExternal(vscode.Uri.file(backupFolder));
      } else {
        vscode.window.showInformationMessage(`Backup folder not found: ${backupFolder}`);
      }
    })
  );

  // JSONファイルを保存ダイアログで保存する
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.saveAs', async () => {
      if (!vscode.workspace.workspaceFolders) {
        return;
      }

      const defaultUri = vscode.Uri.file(dataManager.getJsonFilename());

      const uri = await vscode.window.showSaveDialog({
        defaultUri: defaultUri,
        filters: {
          'JSON Files': ['json'],
          'All Files': ['*']
        }
      });

      if (uri) {
        const data = treeDataProvider.prepareSerializableNode(0);
        await fs.promises.writeFile(uri.fsPath, JSON.stringify(data, null, 2), 'utf8');
        vscode.window.showInformationMessage(`SideTree data saved to ${uri.fsPath}`);
      }
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

// 選択用アイテムの取得
// menuItemが選択リスト内に含まれている場合は、選択に対する操作とする
// meniItemが選択リスト内に含まれていない場合は、menuItemに対する単独操作とする
function getSelectedItems(menuItem: MyTreeItem|undefined, itemList: readonly MyTreeItem[]): readonly MyTreeItem[] {
  if (!menuItem) {
    return itemList;
  }

  if (isItemInList(menuItem, itemList)) {
    return itemList;
  }

  return [menuItem];
}

// フォルダ名を入力
async function inputFolderName(): Promise<string | undefined> {
  const name = 'New Folder';
    const newLabel = await vscode.window.showInputBox({
    prompt: `Enter name for folder"`,
    placeHolder: name,
    value: name,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Name cannot be empty';
      }
      return null;
    }
  });
  return newLabel;
}

// アイテムがリストにあるか
function isItemInList(menuItem: MyTreeItem, list: readonly MyTreeItem[]) {
  return list.some(x => x.itemId === menuItem.itemId);
};

// インターフェース
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