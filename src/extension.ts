import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MyTreeDataProvider } from './MyTreeDataProvider';
import { MyTreeItem } from './MyTreeItem';
import { MyDnDController } from './MyDnDController';
import { convertToRelative } from './convertToRelative';
import { SideTreeDataManager } from './SideTreeDataManager';
import { localize } from './localize';
import { parseCsvImport } from './parseCsvImport';

export function getExplorerSelection(resource?: vscode.Uri, resources?: readonly vscode.Uri[]): vscode.Uri[] {
  const candidates = resources?.length ? resources : (resource ? [resource] : []);
  const uniqueResources = new Map<string, vscode.Uri>();

  for (const candidate of candidates) {
    if (candidate.scheme !== 'file') {
      continue;
    }
    uniqueResources.set(candidate.toString(), candidate);
  }

  return Array.from(uniqueResources.values());
}

// 拡張機能の初期化とコマンド登録を行う
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
  const getActiveSelection = (): readonly MyTreeItem[] => {
    return treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
  };
  const getActiveFolderId = (): number => {
    return getFolderId(getActiveSelection());
  };
  const getFolderChildren = async (folderId: number): Promise<MyTreeItem[]> => {
    if (folderId === 0) {
      return treeDataProvider.getChildren();
    }

    const folderItem = treeDataProvider.getItemByItemId(folderId);
    if (!folderItem) {
      return [];
    }

    return treeDataProvider.getChildren(folderItem);
  };
  const ensureVirtualFolderPath = async (baseFolderId: number, folderPath?: string): Promise<number> => {
    const segments = folderPath
      ?.split(/[\\/]/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0) ?? [];

    let currentFolderId = baseFolderId;
    for (const segment of segments) {
      const children = await getFolderChildren(currentFolderId);
      const existing = children.find((item) => item.itemType === 'virtualFolder' && item.label === segment);
      if (existing) {
        currentFolderId = existing.itemId;
        continue;
      }

      const created = await treeDataProvider.addItemWithFolderId(currentFolderId, segment, true);
      currentFolderId = created.itemId;
    }

    return currentFolderId;
  };

  // クリック時の処理
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.itemClicked', async (args: {
      label: string;
      collapsibleState: vscode.TreeItemCollapsibleState;
      filePath?: string;
      itemId?: number;
      isFolder?: boolean;
      line?: number;
      column?: number;
      symbolPath?: string;
    }) => {
      if (!args.filePath || args.isFolder === undefined) {
        return;
      }
      await ItemClicked(args.filePath, args.line, args.column);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.folderClicked', async () => {
      await vscode.commands.executeCommand('list.expand');
    })
  );

  // フォルダ追加コマンドの登録 エクスプローラ内のツリー
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addFolderInExplorer', async () => {
      const folderId = getActiveFolderId();
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
      const folderId = getActiveFolderId();
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
      quickPick.placeholder = localize('sideTree.quickPick.findItem.placeholder', 'Find Item in SideTree');
      quickPick.matchOnDetail = true;
      const searchItems = treeDataProvider.getSearchItems();
      quickPick.items = searchItems;
      quickPick.onDidChangeSelection(async (selection) => {
        if (selection.length) {
          quickPick.hide();
          const selectedItemId = (selection[0] as MyTreeQuickPickItem).itemId;
          const item = treeDataProvider.getItemByItemId(selectedItemId);
          if (!item) {
            return;
          }
          treeView.reveal(item, { focus: true, expand: true });

          if (item.filePath) {
            await ItemClicked(item.filePath, item.line, item.column);
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
        localize('sideTree.confirm.importFromClipboard', 'Do you want to import from clipboard?'),
        { modal: true },
        localize('sideTree.answer.yes', 'Yes'),
        localize('sideTree.answer.no', 'No')
      );

      if (answer !== localize('sideTree.answer.yes', 'Yes')) {
        return;
      }

      // フォルダIDの取得
      const folderId = getActiveFolderId();

      const lines = list.split('\n');
      for (const line of lines) {
        const filePath = line.trim();
        if (!filePath) {
          continue;
        }

        const fileName = path.basename(filePath);
        await treeDataProvider.addItemWithFolderId(folderId, fileName, false, filePath);
      }
    })
  );

  // クリップボードのJSONを選択位置へインポート
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.importJsonFromClipboard', async (menuItem?: MyTreeItem) => {
      const raw = await vscode.env.clipboard.readText();
      if (!raw.trim()) {
        return;
      }

      try {
        const parsed: unknown = JSON.parse(raw);
        const data = dataManager.parseSerializedTreeData(parsed);
        if (!data) {
          vscode.window.showErrorMessage(
            localize('sideTree.message.invalidJsonImport', 'The selected JSON file is not a valid SideTree export.')
          );
          return;
        }

        const targetItem = menuItem ?? getActiveSelection()[0];
        if (!targetItem) {
          await treeDataProvider.importItems(0, data);
        } else if (targetItem.isTransient) {
          vscode.window.showErrorMessage(
            localize('sideTree.message.cannotImportIntoLinkedFolderChildren', 'Cannot import JSON into linked folder children.')
          );
          return;
        } else if (targetItem.itemType === 'virtualFolder') {
          await treeDataProvider.importItems(targetItem.itemId, data);
        } else {
          await treeDataProvider.importItemsAfter(targetItem.itemId, data);
        }

        vscode.window.showInformationMessage(
          localize('sideTree.message.importedJsonFromClipboard', 'Imported SideTree JSON from clipboard')
        );
      } catch {
        vscode.window.showErrorMessage(
          localize('sideTree.message.invalidJsonImport', 'The selected JSON file is not a valid SideTree export.')
        );
      }
    })
  );

  // JSONファイルからデータをインポート
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.importJsonFile', async () => {
      const defaultUri = vscode.Uri.file(dataManager.getJsonFilename());
      const uri = await vscode.window.showOpenDialog({
        defaultUri,
        canSelectMany: false,
        openLabel: localize('sideTree.openDialog.importJson', 'Import JSON'),
        filters: {
          [localize('sideTree.filter.jsonFiles', 'JSON Files')]: ['json'],
          [localize('sideTree.filter.allFiles', 'All Files')]: ['*']
        }
      });

      if (!uri?.length) {
        return;
      }

      const answer = await vscode.window.showInformationMessage(
        localize('sideTree.confirm.importFromJsonFile', 'Import from JSON file into the selected folder?'),
        { modal: true },
        localize('sideTree.answer.yes', 'Yes'),
        localize('sideTree.answer.no', 'No')
      );

      if (answer !== localize('sideTree.answer.yes', 'Yes')) {
        return;
      }

      try {
        const raw = await fs.promises.readFile(uri[0].fsPath, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const data = dataManager.parseSerializedTreeData(parsed);
        if (!data) {
          vscode.window.showErrorMessage(
            localize('sideTree.message.invalidJsonImport', 'The selected JSON file is not a valid SideTree export.')
          );
          return;
        }

        const folderId = getActiveFolderId();
        await treeDataProvider.importItems(folderId, data);
        vscode.window.showInformationMessage(
          localize('sideTree.message.importedFromJsonFile', 'Imported SideTree data from {0}', uri[0].fsPath)
        );
      } catch {
        vscode.window.showErrorMessage(
          localize('sideTree.message.failedImportJsonFile', 'Failed to import JSON file: {0}', uri[0].fsPath)
        );
      }
    })
  );

  // CSVファイルから項目をインポート
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.importCsvFile', async () => {
      const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
      const uri = await vscode.window.showOpenDialog({
        defaultUri,
        canSelectMany: false,
        openLabel: localize('sideTree.openDialog.importCsv', 'Import CSV'),
        filters: {
          [localize('sideTree.filter.csvFiles', 'CSV Files')]: ['csv'],
          [localize('sideTree.filter.allFiles', 'All Files')]: ['*']
        }
      });

      if (!uri?.length) {
        return;
      }

      const answer = await vscode.window.showInformationMessage(
        localize('sideTree.confirm.importFromCsvFile', 'Import items from CSV file into the selected folder?'),
        { modal: true },
        localize('sideTree.answer.yes', 'Yes'),
        localize('sideTree.answer.no', 'No')
      );

      if (answer !== localize('sideTree.answer.yes', 'Yes')) {
        return;
      }

      try {
        const raw = await fs.promises.readFile(uri[0].fsPath, 'utf8');
        const rows = parseCsvImport(raw);
        if (!rows.length) {
          vscode.window.showErrorMessage(
            localize('sideTree.message.invalidCsvImport', 'The selected CSV file does not contain any importable items.')
          );
          return;
        }

        const folderId = getActiveFolderId();
        for (const row of rows) {
          const targetFolderId = await ensureVirtualFolderPath(folderId, row.folderPath);
          await treeDataProvider.addItemWithFolderId(targetFolderId, row.name, false, row.filePath, undefined, undefined, undefined, row.description);
        }

        vscode.window.showInformationMessage(
          localize('sideTree.message.importedFromCsvFile', 'Imported SideTree items from {0}', uri[0].fsPath)
        );
      } catch {
        vscode.window.showErrorMessage(
          localize('sideTree.message.failedImportCsvFile', 'Failed to import CSV file: {0}', uri[0].fsPath)
        );
      }
    })
  );

  // JSONファイルで現在データを置き換え
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.replaceWithJsonFile', async () => {
      const defaultUri = vscode.Uri.file(dataManager.getJsonFilename());
      const uri = await vscode.window.showOpenDialog({
        defaultUri,
        canSelectMany: false,
        openLabel: localize('sideTree.openDialog.replaceWithJson', 'Replace with JSON'),
        filters: {
          [localize('sideTree.filter.jsonFiles', 'JSON Files')]: ['json'],
          [localize('sideTree.filter.allFiles', 'All Files')]: ['*']
        }
      });

      if (!uri?.length) {
        return;
      }

      const answer = await vscode.window.showInformationMessage(
        localize('sideTree.confirm.replaceWithJsonFile', 'Replace current SideTree data with the selected JSON file?'),
        { modal: true },
        localize('sideTree.answer.yes', 'Yes'),
        localize('sideTree.answer.no', 'No')
      );

      if (answer !== localize('sideTree.answer.yes', 'Yes')) {
        return;
      }

      try {
        const raw = await fs.promises.readFile(uri[0].fsPath, 'utf8');
        const parsed: unknown = JSON.parse(raw);
        const data = dataManager.parseSerializedTreeData(parsed);
        if (!data) {
          vscode.window.showErrorMessage(
            localize('sideTree.message.invalidJsonImport', 'The selected JSON file is not a valid SideTree export.')
          );
          return;
        }

        await treeDataProvider.replaceAll(data);
        vscode.window.showInformationMessage(
          localize('sideTree.message.replacedFromJsonFile', 'Replaced SideTree data from {0}', uri[0].fsPath)
        );
      } catch {
        vscode.window.showErrorMessage(
          localize('sideTree.message.failedImportJsonFile', 'Failed to import JSON file: {0}', uri[0].fsPath)
        );
      }
    })
  );

  // 指定ファイルをサイドツリーに追加する
  async function appendFile(resource: vscode.Uri) {
    const filePath = resource.fsPath;
    const fileName = path.basename(filePath);
    // フォルダIDの取得
    const folderId = getActiveFolderId();
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      await treeDataProvider.addLinkedFolderWithFolderId(folderId, fileName, filePath);
    } else {
      await treeDataProvider.addItemWithFolderId(folderId, fileName, false, filePath);
    }
    const folderPath = treeDataProvider.getItemPath(folderId);
    vscode.window.showInformationMessage(
      localize('sideTree.message.addedToFolder', 'Added {0} to {1}', fileName, folderPath)
    );
  }

  async function appendFiles(resources: readonly vscode.Uri[]) {
    if (!resources.length) {
      return;
    }

    const folderId = getActiveFolderId();
    const addedNames: string[] = [];
    for (const resource of resources) {
      const filePath = resource.fsPath;
      const fileName = path.basename(filePath);
      const stat = await fs.promises.stat(filePath);
      if (stat.isDirectory()) {
        await treeDataProvider.addLinkedFolderWithFolderId(folderId, fileName, filePath);
      } else {
        await treeDataProvider.addItemWithFolderId(folderId, fileName, false, filePath);
      }
      addedNames.push(fileName);
    }

    const folderPath = treeDataProvider.getItemPath(folderId);
    vscode.window.showInformationMessage(
      localize('sideTree.message.addedToFolder', 'Added {0} to {1}', addedNames.join(', '), folderPath)
    );
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

  // 現在行のシンボル（クラス名+メソッド名）を追加
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addSymbolFromCurrentLine', async (resource?: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor;
      const targetUri = resource ?? editor?.document.uri;
      if (!targetUri || targetUri.scheme !== 'file') {
        return;
      }

      const position = editor?.selection.active ?? new vscode.Position(0, 0);
      const symbolData = await getSymbolLabelAtPosition(targetUri, position);
      if (!symbolData) {
        vscode.window.showInformationMessage(
          localize('sideTree.message.noSymbolFound', 'No class/method symbol found at the current line.')
        );
        return;
      }

      const displayLabel = formatSymbolLabel(symbolData.label, position.line);
      const menuLabel = formatSymbolMenuLabel(symbolData.label, position.line);
      const folderId = getActiveFolderId();
      await treeDataProvider.addItemWithFolderId(
        folderId,
        displayLabel,
        false,
        targetUri.fsPath,
        position.line,
        position.character,
        symbolData.label
      );
      const folderPath = treeDataProvider.getItemPath(folderId);
      vscode.window.showInformationMessage(
        localize('sideTree.message.addedToFolder', 'Added {0} to {1}', menuLabel, folderPath)
      );
    })
  );

  // 現在行のシンボル（クラス名+メソッド名）と行番号をコピー
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.copySymbolFromCurrentLine', async (resource?: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor;
      const targetUri = resource ?? editor?.document.uri;
      if (!targetUri || targetUri.scheme !== 'file') {
        return;
      }

      const position = editor?.selection.active ?? new vscode.Position(0, 0);
      const symbolData = await getSymbolLabelAtPosition(targetUri, position);
      if (!symbolData) {
        vscode.window.showInformationMessage(
          localize('sideTree.message.noSymbolFound', 'No class/method symbol found at the current line.')
        );
        return;
      }

      const menuLabel = formatSymbolMenuLabel(symbolData.label, position.line);
      await vscode.env.clipboard.writeText(menuLabel);
      vscode.window.showInformationMessage(
        localize('sideTree.message.copiedToClipboard', 'Copied {0} to clipboard', menuLabel)
      );
    })
  );

  // 現在行の相対ファイルパスと行番号をコピー
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.copyRelativePathWithLineFromCurrentLine', async (resource?: vscode.Uri) => {
      const editor = vscode.window.activeTextEditor;
      const targetUri = resource ?? editor?.document.uri;
      if (!targetUri || targetUri.scheme !== 'file') {
        return;
      }

      const position = editor?.selection.active ?? new vscode.Position(0, 0);
      const relativePath = convertToRelative(targetUri.fsPath);
      const pathWithLine = `${relativePath}:${position.line + 1}`;
      await vscode.env.clipboard.writeText(pathWithLine);
      vscode.window.showInformationMessage(
        localize('sideTree.message.copiedToClipboard', 'Copied {0} to clipboard', pathWithLine)
      );
    })
  );

  // エクスプローラーからアイテム追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addItemFromExplorer', async (resource?: vscode.Uri, resources?: readonly vscode.Uri[]) => {
      const selection = getExplorerSelection(resource, resources);
      if (!selection.length) {
        return;
      }
      if (selection.length === 1) {
        await appendFile(selection[0]);
        return;
      }
      await appendFiles(selection);
    })
  );

  // アイテム削除コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.removeItem', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection()).filter((item) => !item.isTransient);
      if (!list.length) {
        return;
      }
      const labels: { [key: string]: boolean } = {};
      const dirs: { [key: string]: boolean } = {};
      for (const item of list) {
        const folderPath = treeDataProvider.getItemPath(item.parentId);
        dirs[folderPath] = true;
        labels[getMenuLabel(item)] = true;
        treeDataProvider.removeItem(item.itemId);
      }

      const joinPaths = Object.keys(dirs).join(',');
      const joinLabels = Object.keys(labels).join(',');

      vscode.window.showInformationMessage(
        localize('sideTree.message.removedFromFolder', 'Removed {0} from {1}', joinLabels, joinPaths)
      );
    })
  );

  // パスのコピーコマンドの機能
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.copyPath', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection());
      const paths = list.filter(x => x.filePath).map(x => x.filePath);
      await vscode.env.clipboard.writeText(paths.join('\n'));
    })
  );

  // 相対パスのコピーコマンドの機能
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.copyRelativePath', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection());
      const paths = list
        .filter((item) => item.filePath)
        .map((item) => convertToRelative(item.filePath!));
      await vscode.env.clipboard.writeText(paths.join('\n'));
    })
  );

  // ツリー全体をJSONでクリップボードへコピー
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.copyJson', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection()).filter((item) => !item.isTransient);
      const data = treeDataProvider.prepareSerializableItems(list);
      await vscode.env.clipboard.writeText(JSON.stringify(data, null, 2));
      vscode.window.showInformationMessage(
        localize('sideTree.message.copiedJsonToClipboard', 'Copied selected SideTree items as JSON to clipboard')
      );
    })
  );

  // アイテムを開く
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.openItem', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection());
      for (const item of list) {
        if (!item.filePath || item.isFolder) {
          continue;
        }
        await openDocument(item.filePath, item.line, item.column);
      }
    })
  );

  // アイテムを右側で開く
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.openItemToSide', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection());
      for (const item of list) {
        if (!item.filePath || item.isFolder) {
          continue;
        }
        await openDocument(item.filePath, item.line, item.column, vscode.ViewColumn.Beside);
      }
    })
  );

  // アイテムをエクスプローラービューで開く
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.revealInExplorerView', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection());
      for (const item of list) {
        if (!item.filePath) {
          continue;
        }

        const uri = getUriFromPath(item.filePath);
        if (!uri) {
          continue;
        }

        await vscode.commands.executeCommand('revealInExplorer', uri);
      }
    })
  );

  // アイテムリネームコマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.renameItem', async (menuItem: MyTreeItem) => {
      const selectedItems = getActiveSelection().filter((item) => !item.isTransient);
      if (!selectedItems.length) {
        return;
      }

      const targetItem = selectedItems[0];
      const newLabel = await vscode.window.showInputBox({
        prompt: localize('sideTree.prompt.renameItem', 'Enter new name for "{0}"', targetItem.label),
        placeHolder: targetItem.label,
        value: targetItem.label,
        validateInput: (value) => {
          if (!value.trim()) {
            return localize('sideTree.validation.nameRequired', 'Name cannot be empty');
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

  // アイテム説明の編集
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.editDescription', async (menuItem: MyTreeItem) => {
      const selectedItems = getSelectedItems(menuItem, getActiveSelection()).filter((item) => !item.isTransient);
      if (!selectedItems.length) {
        return;
      }

      const targetItem = selectedItems[0];
      const description = await vscode.window.showInputBox({
        prompt: localize('sideTree.prompt.editDescription', 'Enter description for "{0}" (empty to clear)', targetItem.label),
        placeHolder: localize('sideTree.placeholder.description', 'Description'),
        value: targetItem.note ?? ''
      });

      if (description === undefined) {
        return;
      }

      treeDataProvider.changeDescription(targetItem.itemId, description.trim() ? description : undefined);
    })
  );

  // 上に移動
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemTop', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection()).filter((item) => !item.isTransient);
      treeDataProvider.moveItemsTop(list.map((item) => item.itemId));
    })
  );

  // 上に移動
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemUp', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection()).filter((item) => !item.isTransient);
      for (const item of list) {
        treeDataProvider.moveItemUp(item.itemId);
      }
    })
  );

  // 下に移動
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemDown', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection()).filter((item) => !item.isTransient);
      for (const item of list) {
        treeDataProvider.moveItemDown(item.itemId);
      }
    })
  );

  // 親フォルダの上に移動する
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemParent', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection()).filter((item) => !item.isTransient);
      for (const item of list) {
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
      const list = getSelectedItems(menuItem, getActiveSelection());

      for (const item of list) {
        if (item.itemType !== 'virtualFolder') {
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
        vscode.window.showInformationMessage(
          localize('sideTree.message.backupNotFound', 'Backup folder not found: {0}', backupFolder)
        );
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
          [localize('sideTree.filter.jsonFiles', 'JSON Files')]: ['json'],
          [localize('sideTree.filter.allFiles', 'All Files')]: ['*']
        }
      });

      if (uri) {
        const data = treeDataProvider.prepareSerializableNode(0);
        await fs.promises.writeFile(uri.fsPath, JSON.stringify(data, null, 2), 'utf8');
        vscode.window.showInformationMessage(
          localize('sideTree.message.savedToFile', 'SideTree data saved to {0}', uri.fsPath)
        );
      }
    })
  );
}

// ファイルを開き指定位置へ移動する
async function openDocument(filePath: string, line?: number, column?: number, viewColumn?: vscode.ViewColumn) {
  try {
    const uri = getUriFromPath(filePath);
    if (uri) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, {
        preserveFocus: true,
        preview: false,
        viewColumn
      });
      if (typeof line === 'number') {
        const position = new vscode.Position(line, column ?? 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    } else {
      vscode.window.showInformationMessage(
        localize('sideTree.message.failedOpenFile', 'Failed to open file: {0}', filePath)
      );
    }
  } catch (error) {
    vscode.window.showInformationMessage(
      localize('sideTree.message.failedOpenFile', 'Failed to open file: {0}', filePath)
    );
  }
}

// 拡張機能の終了処理（現在は空）
export function deactivate() { }

// menuItemが選択リスト内に含まれている場合は、選択に対する操作とする
// 選択中アイテムの対象リストを決定する
function getSelectedItems(menuItem: MyTreeItem | undefined, itemList: readonly MyTreeItem[]): readonly MyTreeItem[] {
  if (!menuItem) {
    return itemList;
  }

  if (isItemInList(menuItem, itemList)) {
    return itemList;
  }

  return [menuItem];
}

// フォルダ名の入力を促す
async function inputFolderName(): Promise<string | undefined> {
  const name = localize('sideTree.default.folderName', 'New Folder');
  const newLabel = await vscode.window.showInputBox({
    prompt: localize('sideTree.prompt.folderName', 'Enter name for folder'),
    placeHolder: name,
    value: name,
    validateInput: (value) => {
      if (!value.trim()) {
        return localize('sideTree.validation.nameRequired', 'Name cannot be empty');
      }
      return null;
    }
  });
  return newLabel;
}

// メニューアイテムが選択リスト内か判定する
function isItemInList(menuItem: MyTreeItem, list: readonly MyTreeItem[]) {
  return list.some(x => x.itemId === menuItem.itemId);
};

// インターフェース
export interface MyTreeQuickPickItem extends vscode.QuickPickItem {
  itemId: number;
}

// 選択から対象フォルダIDを取得する
function getFolderId(selectedItems: readonly MyTreeItem[]): number {
  const folderItem = selectedItems.length > 0 ? selectedItems[0] : null;
  // 未選択はルート
  if (!folderItem) {
    return 0;
  }

  // 仮想フォルダのみ子を保持できる
  const folderId = folderItem.itemType === 'virtualFolder' ? folderItem.itemId : folderItem.parentId;
  return folderId;
}

// 対象アイテムから親フォルダIDを返す
export function getTargetFolderItemId(target: MyTreeItem | undefined) {
  if (!target) {
    return 0;
  }

  return target.itemType === 'virtualFolder' ? target.itemId : target.parentId;
}

// クラス相当のシンボル種別か判定する
function isClassLikeKind(kind: vscode.SymbolKind): boolean {
  return kind === vscode.SymbolKind.Class || kind === vscode.SymbolKind.Struct || kind === vscode.SymbolKind.Interface;
}

// メソッド/関数相当のシンボル種別か判定する
function isMemberLikeKind(kind: vscode.SymbolKind): boolean {
  return kind === vscode.SymbolKind.Method || kind === vscode.SymbolKind.Function || kind === vscode.SymbolKind.Constructor;
}

// 文字列相当のシンボル種別か判定する
function isStringLikeKind(kind: vscode.SymbolKind): boolean {
  return kind === vscode.SymbolKind.String;
}

// 表示用のシンボルラベルを整形する
function formatSymbolLabel(label: string, line: number): string {
  const lineNumber = line + 1;
  return `${label}:${lineNumber}`;
}

// 通知/メニュー用のシンボルラベルを整形する
function formatSymbolMenuLabel(label: string, line?: number): string {
  const lineNumber = typeof line === 'number' ? line + 1 : undefined;
  return `${label}${lineNumber ? `:${lineNumber}` : ''}`;
}

// メニュー表示用のラベルを取得する
function getMenuLabel(item: MyTreeItem): string {
  if (item.symbolPath) {
    return formatSymbolMenuLabel(item.symbolPath, item.line);
  }
  return item.label;
}

// 範囲の大きさを比較用の重みに変換する
function getRangeWeight(range: vscode.Range): number {
  const lineSpan = range.end.line - range.start.line;
  const charSpan = range.end.character - range.start.character;
  return lineSpan * 100000 + Math.max(charSpan, 0);
}

// カーソル位置のシンボル名を取得する
async function getSymbolLabelAtPosition(uri: vscode.Uri, position: vscode.Position): Promise<{ label: string } | undefined> {
  const textFallback = await getSymbolLabelFromText(uri, position);
  const symbolResult = await vscode.commands.executeCommand<(vscode.DocumentSymbol[] | vscode.SymbolInformation[])>(
    'vscode.executeDocumentSymbolProvider',
    uri
  );

  if (!symbolResult || symbolResult.length === 0) {
    return textFallback;
  }

  // SymbolInformation 形式しか返らない言語へのフォールバック
  if (!('children' in symbolResult[0])) {
    const infos = symbolResult as vscode.SymbolInformation[];
    const scoped = getSymbolInfosAtPosition(infos, position);
    if (scoped.length === 0) {
      return textFallback;
    }

    const leafName = scoped[scoped.length - 1].name;
    return buildLabelFromSymbolList(scoped, textFallback, leafName);
  }

  const symbols = symbolResult as vscode.DocumentSymbol[];
  const symbolPath = findBestSymbolPath(symbols, position);
  if (!symbolPath || symbolPath.length === 0) {
    return textFallback;
  }

  return buildLabelFromDocumentSymbolPath(symbolPath, textFallback);
}

// DocumentSymbol のパスからラベルを生成する
function buildLabelFromDocumentSymbolPath(symbolPath: vscode.DocumentSymbol[], textFallback?: { label: string }): { label: string } {
  const leafName = symbolPath[symbolPath.length - 1].name;
  return buildLabelFromSymbolList(symbolPath, textFallback, leafName);
}

// シンボル列から class/method/string を抽出して結合する
function buildLabelFromSymbolList(
  symbols: ReadonlyArray<{ kind: vscode.SymbolKind; name: string }>,
  textFallback: { label: string } | undefined,
  leafName: string
): { label: string } {
  let className = '';
  let methodName = '';
  let stringName = '';
  for (const symbol of symbols) {
    if (isClassLikeKind(symbol.kind)) {
      className = symbol.name;
    } else if (isMemberLikeKind(symbol.kind)) {
      methodName = symbol.name;
    } else if (isStringLikeKind(symbol.kind)) {
      stringName = symbol.name;
    }
  }
  return buildLabelFromParts(className, methodName, stringName, textFallback, leafName);
}

// class/method/string を結合してラベルを作る
function buildLabelFromParts(
  className: string | undefined,
  methodName: string | undefined,
  stringName: string | undefined,
  textFallback: { label: string } | undefined,
  leafName: string
): { label: string } {
  const parts = [className ?? '', methodName ?? '', stringName ?? ''].filter((x) => x.length > 0);
  if (parts.length > 0) {
    return { label: parts.join('.') };
  }
  return textFallback ?? { label: leafName };
}

// 位置に合う最適なシンボルパスを選ぶ
function findBestSymbolPath(symbols: vscode.DocumentSymbol[], position: vscode.Position): vscode.DocumentSymbol[] | undefined {
  const candidates = getSymbolPathsAtPosition(symbols, position);
  if (candidates.length === 0) {
    return undefined;
  }

  candidates.sort((a, b) => compareSymbolPathPriority(a, b));
  return candidates[0];
}

// 位置に一致するシンボルパスを列挙する
function getSymbolPathsAtPosition(symbols: vscode.DocumentSymbol[], position: vscode.Position): vscode.DocumentSymbol[][] {
  const out: vscode.DocumentSymbol[][] = [];
  collectSymbolPathsShallowToDeep(symbols, position, [], out);
  return out;
}

// 位置に一致する SymbolInformation を範囲の広い順（浅い推定順）に並べる
function getSymbolInfosAtPosition(infos: vscode.SymbolInformation[], position: vscode.Position): vscode.SymbolInformation[] {
  return infos
    .filter((x) => x.location.range.contains(position))
    .sort((a, b) => getRangeWeight(b.location.range) - getRangeWeight(a.location.range));
}

// 浅い→深い順でパスを収集する
function collectSymbolPathsShallowToDeep(symbols: vscode.DocumentSymbol[], position: vscode.Position, chain: vscode.DocumentSymbol[], out: vscode.DocumentSymbol[][]): void {
  for (const symbol of symbols) {
    if (!symbol.range.contains(position)) {
      continue;
    }

    const nextChain = [...chain, symbol];
    out.push(nextChain);
    if (symbol.children.length > 0) {
      collectSymbolPathsShallowToDeep(symbol.children, position, nextChain, out);
    }
  }
}

// シンボルパスの優先度を比較する
function compareSymbolPathPriority(a: vscode.DocumentSymbol[], b: vscode.DocumentSymbol[]): number {
  if (a.length !== b.length) {
    return b.length - a.length;
  }

  const aLeaf = a[a.length - 1];
  const bLeaf = b[b.length - 1];
  const selectionWeightDiff = getRangeWeight(aLeaf.selectionRange) - getRangeWeight(bLeaf.selectionRange);
  if (selectionWeightDiff !== 0) {
    return selectionWeightDiff;
  }

  const rangeWeightDiff = getRangeWeight(aLeaf.range) - getRangeWeight(bLeaf.range);
  if (rangeWeightDiff !== 0) {
    return rangeWeightDiff;
  }

  return aLeaf.name.localeCompare(bLeaf.name);
}

// テキスト解析でシンボル名を推定する
async function getSymbolLabelFromText(uri: vscode.Uri, position: vscode.Position): Promise<{ label: string } | undefined> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const line = position.line;
    const start = Math.max(0, line - 120);
    const classRegex = /\b(class|struct|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/;
    const methodName = findEnclosingMethodName(doc, line, start);

    let className: string | undefined;
    for (let i = line; i >= start; i--) {
      const text = doc.lineAt(i).text;
      const classMatch = text.match(classRegex);
      if (classMatch) {
        className = classMatch[2];
        break;
      }
    }

    if (className && methodName) {
      return { label: `${className}.${methodName}` };
    }

    if (methodName) {
      return { label: methodName };
    }

    if (className) {
      return { label: className };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

// 位置を含むメソッド名を探索する
function findEnclosingMethodName(doc: vscode.TextDocument, line: number, startLine: number): string | undefined {
  const methodDeclarationRegex =
    /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed|new|async|extern|unsafe|partial)\s+)*(?:[A-Za-z_][\w<>\[\],\?\.\s]*\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*(?:where\b.*)?(?:\{|=>)?\s*$/;
  const nonMethodNames = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'nameof']);

  for (let i = line; i >= startLine; i--) {
    const text = doc.lineAt(i).text.trim();
    const match = text.match(methodDeclarationRegex);
    if (!match) {
      continue;
    }

    const name = match[1];
    if (nonMethodNames.has(name)) {
      continue;
    }

    const endLine = findBlockEndLine(doc, i);
    if (endLine === undefined || line <= endLine) {
      return name;
    }
  }

  return undefined;
}

// ブロック終端行を推定する
function findBlockEndLine(doc: vscode.TextDocument, startLine: number): number | undefined {
  let depth = 0;
  let started = false;
  for (let i = startLine; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    for (const ch of text) {
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') {
        depth--;
        if (started && depth <= 0) {
          return i;
        }
      }
    }
  }

  return undefined;
}

// パス文字列を VS Code の URI に変換する
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

// アイテムクリック時の挙動を実行する
async function ItemClicked(filePath: string, line?: number, column?: number) {
  const uri = getUriFromPath(filePath);
  if (!uri) {
    vscode.window.showInformationMessage(
      localize('sideTree.message.pathDoesNotExist', 'Path does not exist: {0}', filePath)
    );
    return;
  }

  const { isFile, isDirectory } = await isFileOrFolder(uri);
  if (!isFile && !isDirectory) {
    vscode.window.showInformationMessage(
      localize('sideTree.message.pathDoesNotExist', 'Path does not exist: {0}', filePath)
    );
    return;
  }
  if (isDirectory) {
    // フォルダの場合はエクスプローラーで表示
    vscode.commands.executeCommand('revealInExplorer', uri);
  } else {
    // ファイルの場合はドキュメントとして開く
    await openDocument(filePath, line, column);
  }
}

// URI がファイルかフォルダか判定する
async function isFileOrFolder(uri: vscode.Uri): Promise<{ isFile: boolean, isDirectory: boolean }> {
  try {
    const stat = await fs.promises.stat(uri.fsPath);
    return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
  } catch (error) {
    // ファイルが存在しない等のエラー
    console.error(`Error getting file stats for ${uri.fsPath}: ${error}`);
    return { isFile: false, isDirectory: false };
  }
}
