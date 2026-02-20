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
  const getActiveSelection = (): readonly MyTreeItem[] => {
    return treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
  };
  const getActiveFolderId = (): number => {
    return getFolderId(getActiveSelection());
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
      quickPick.placeholder = 'Find Item in SideTree';
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
        'Do you want to import from clipboard?',
        { modal: true },
        'Yes', 'No'
      );

      if (answer !== 'Yes') {
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

  // ファイルを追加する
  async function appendFile(resource: vscode.Uri) {
    const filePath = resource.fsPath;
    const fileName = path.basename(filePath);
    // フォルダIDの取得
    const folderId = getActiveFolderId();
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
        vscode.window.showInformationMessage('No class/method symbol found at the current line.');
        return;
      }

      const folderId = getActiveFolderId();
      await treeDataProvider.addItemWithFolderId(
        folderId,
        symbolData.label,
        false,
        targetUri.fsPath,
        position.line,
        position.character,
        symbolData.label
      );
      const folderPath = treeDataProvider.getItemPath(folderId);
      vscode.window.showInformationMessage(`Added ${symbolData.label} to ${folderPath}`);
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
      const list = getSelectedItems(menuItem, getActiveSelection());
      const labels: { [key: string]: boolean } = {};
      const dirs: { [key: string]: boolean } = {};
      for (const item of list) {
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
      const list = getSelectedItems(menuItem, getActiveSelection());
      const paths = list.filter(x => x.filePath).map(x => x.filePath);
      await vscode.env.clipboard.writeText(paths.join('\n'));
    })
  );

  // アイテムリネームコマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.renameItem', async (menuItem: MyTreeItem) => {
      const selectedItems = getActiveSelection();
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
      const list = getSelectedItems(menuItem, getActiveSelection());
      for (const item of list) {
        treeDataProvider.moveItemUp(item.itemId);
      }
    })
  );

  // 下に移動
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemDown', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection());
      for (const item of list) {
        treeDataProvider.moveItemDown(item.itemId);
      }
    })
  );

  // 親フォルダの上に移動する
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.moveItemParent', async (menuItem: MyTreeItem) => {
      const list = getSelectedItems(menuItem, getActiveSelection());
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
async function openDocument(filePath: string, line?: number, column?: number) {
  try {
    const uri = getUriFromPath(filePath);
    if (uri) {
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc, { preserveFocus: true });
      if (typeof line === 'number') {
        const position = new vscode.Position(line, column ?? 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
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
function getSelectedItems(menuItem: MyTreeItem | undefined, itemList: readonly MyTreeItem[]): readonly MyTreeItem[] {
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
    prompt: 'Enter name for folder',
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

function isClassLikeKind(kind: vscode.SymbolKind): boolean {
  return kind === vscode.SymbolKind.Class || kind === vscode.SymbolKind.Struct || kind === vscode.SymbolKind.Interface;
}

function isMemberLikeKind(kind: vscode.SymbolKind): boolean {
  return kind === vscode.SymbolKind.Method || kind === vscode.SymbolKind.Function || kind === vscode.SymbolKind.Constructor;
}

function getRangeWeight(range: vscode.Range): number {
  const lineSpan = range.end.line - range.start.line;
  const charSpan = range.end.character - range.start.character;
  return lineSpan * 100000 + Math.max(charSpan, 0);
}

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
  if ('location' in symbolResult[0]) {
    const infos = symbolResult as vscode.SymbolInformation[];
    const scoped = infos
      .filter((x) => x.location.range.contains(position))
      .sort((a, b) => getRangeWeight(a.location.range) - getRangeWeight(b.location.range));
    if (scoped.length === 0) {
      return undefined;
    }

    const member = scoped.find((x) => isMemberLikeKind(x.kind) && !!x.containerName);
    if (member) {
      return { label: `${member.containerName}.${member.name}` };
    }

    const classSymbol = scoped.find((x) => isClassLikeKind(x.kind));
    if (classSymbol) {
      return textFallback ?? { label: classSymbol.name };
    }

    return textFallback ?? { label: scoped[0].name };
  }

  const symbols = symbolResult as vscode.DocumentSymbol[];
  const symbolPath = findDeepestSymbolPath(symbols, position);
  if (!symbolPath || symbolPath.length === 0) {
    return undefined;
  }

  const memberSymbol = [...symbolPath].reverse().find((x) => isMemberLikeKind(x.kind));
  if (memberSymbol) {
    const classSymbol = [...symbolPath]
      .reverse()
      .find((x) => isClassLikeKind(x.kind));
    if (classSymbol) {
      return { label: `${classSymbol.name}.${memberSymbol.name}` };
    }
    return { label: memberSymbol.name };
  }

  const classOnly = [...symbolPath].reverse().find((x) => isClassLikeKind(x.kind));
  if (classOnly) {
    return textFallback ?? { label: classOnly.name };
  }

  return textFallback ?? { label: symbolPath[symbolPath.length - 1].name };
}

function findDeepestSymbolPath(symbols: vscode.DocumentSymbol[], position: vscode.Position, chain: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol[] | undefined {
  for (const symbol of symbols) {
    if (!symbol.range.contains(position)) {
      continue;
    }

    const nextChain = [...chain, symbol];
    const childPath = findDeepestSymbolPath(symbol.children, position, nextChain);
    if (childPath) {
      return childPath;
    }
    return nextChain;
  }

  return undefined;
}

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

// アイテム表示
async function ItemClicked(filePath: string, line?: number, column?: number) {
  const uri = getUriFromPath(filePath);
  if (!uri) {
    vscode.window.showInformationMessage(`Path does not exist: ${filePath}`);
    return;
  }

  const { isFile, isDirectory } = await isFileOrFolder(uri);
  if (!isFile && !isDirectory) {
    vscode.window.showInformationMessage(`Path does not exist: ${filePath}`);
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

// vscode.Uri がファイルまたはフォルダか判定する関数
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
