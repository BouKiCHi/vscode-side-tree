import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

  // 選択変更イベントの監視
  context.subscriptions.push(
    treeView.onDidChangeSelection((e) => {
      const selectedItem = e.selection[0];
      if (selectedItem) {
        treeDataProvider.selectItem(selectedItem);
        // vscode.window.showInformationMessage(`Selected: ${selectedItem.label}`);
      }
    }),
    treeViewInExplorer.onDidChangeSelection((e) => {
      const selectedItem = e.selection[0];
      if (selectedItem) {
        treeDataProvider.selectItem(selectedItem);
        // vscode.window.showInformationMessage(`Selected in Explorer: ${selectedItem.label}`);
      }
    })
  );

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

  // クリック時の処理
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.itemClicked', async (args: {
      label: string, collapsibleState: vscode.TreeItemCollapsibleState, filePath?: string, itemId?: number
    }) => {
      if (args.filePath) {
        try {
          const uri = getUriFromPath(args.filePath);
          if (uri) {
            if (await isFileOpen(uri.fsPath)) {
              return;
            }
            await vscode.commands.executeCommand('vscode.open', uri);
          } else {
            vscode.window.showInformationMessage(`Failed to open file: ${args.filePath}`);
          }
        } catch (error) {
          vscode.window.showInformationMessage(`Failed to open file: ${args.filePath}`);
        }
      }
    })
  );

  // フォルダ追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addFolder', async () => {
      const selectedItems = treeView.selection.length > 0 ? treeView.selection : treeViewInExplorer.selection;
      const folderId = getFolderId(selectedItems);
      await treeDataProvider.addItemWithFolderId(folderId, 'New Folder', true);
    })
  );

  // データのリロード
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.reloadData', async () => {
      await treeDataProvider.reloadData();
    })
  );

  // データのインポート
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.importData', async () => {
      const list = await vscode.env.clipboard.readText();
      if (!list) {
        return;
      }

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

  // タブからアイテム追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addItemFromTab', async (resource: vscode.Uri) => {
      if (resource && resource.scheme === 'file') {
        const filePath = resource.fsPath;
        const fileName = path.basename(filePath);
        await treeDataProvider.addItem(fileName, false, filePath);
        vscode.window.showInformationMessage(`Added ${fileName} to SideTree`);
      }
    })
  );

  // エクスプローラーからアイテム追加コマンドの登録
  context.subscriptions.push(
    vscode.commands.registerCommand('sideTreeView.addItemFromExplorer', async (resource: vscode.Uri) => {
      if (resource && resource.scheme === 'file') {
        const filePath = resource.fsPath;
        const fileName = path.basename(filePath);
        await treeDataProvider.addItem(fileName, false, filePath);
        vscode.window.showInformationMessage(`Added ${fileName} to SideTree`);
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
        const oldLabel = targetItem.label;
        treeDataProvider.changeLabel(targetItem.itemId, newLabel);
        vscode.window.showInformationMessage(`Change Label from "${oldLabel}" to "${newLabel}"`);
      }
    })
  );
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

// ファイルが開かれているか？
async function isFileOpen(filePath: string): Promise<boolean> {
  const documents = vscode.workspace.textDocuments;
  return documents.some(doc => doc.uri.fsPath === filePath);
}

export function deactivate() { }

class MyDnDController implements vscode.TreeDragAndDropController<MyTreeItem> {
  constructor(private treeDataProvider: MyTreeDataProvider) {
  }

  // 識別子
  readonly dropMimeTypes = ['application/vnd.code.tree.sideTreeView', 'text/uri-list'];
  readonly dragMimeTypes = ['application/vnd.code.tree.sideTreeView', 'text/uri-list'];


  async handleDrag(source: MyTreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken) {
    dataTransfer.set('application/vnd.code.tree.sideTreeView', new vscode.DataTransferItem(source.map(item => item.itemId)));
  }

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
      const uris = uriList.value.split('\n').filter((line: string) => line && !line.startsWith('#'));
      const fileUris = uris.map((uri: string) => vscode.Uri.parse(uri));

      for (const uri of fileUris) {
        // console.log(`Dropped file: ${uri.fsPath}`);
        const fileName = path.basename(uri.fsPath);
        this.treeDataProvider.addItem(fileName, false, uri.fsPath);
      }
    }
  }
}

// ツリーデータプロバイダ
class MyTreeDataProvider implements vscode.TreeDataProvider<MyTreeItem> {

  private jsonFilename: string = 'sidetree.json';


  private _onDidChangeTreeData: vscode.EventEmitter<MyTreeItem | undefined | null | void> = new vscode.EventEmitter<MyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<MyTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private commandId: string = 'sideTreeView.itemClicked';
  private itemIdCount: number = 1;
  private currentFolderId: number = 0;

  // ツリーデータのストア
  private nodes: { [itemId: number]: MyTreeItem[] } = {};
  private nodeTable: { [itemId: number]: MyTreeItem } = {};

  // コンストラクタ
  constructor() {
    // ルートノード
    this.nodes[0] = [];
    const item = this.createItem('SideTree Folder', true);
    this.appendNode(item);
    this.checkOldJsonFile();
    this.load();
  }

  // 項目選択
  selectItem(selectedItem: MyTreeItem) {
    if (selectedItem.isFolder) {
      this.currentFolderId = selectedItem.itemId;
    }
  }

  // ノードに追加する
  appendNode(item: MyTreeItem) {
    if (!this.nodes[item.parentId]) {
      this.nodes[item.parentId] = [];
    }

    // フォルダ作成時に必要
    if (item.isFolder && !this.nodes[item.itemId]) {
      this.nodes[item.itemId] = [];
    }

    this.nodes[item.parentId].push(item);
    this.nodeTable[item.itemId] = item;
  }

  // アイテム作成
  createItem(label: string, isFolder: boolean, filePath?: string): MyTreeItem {
    if (filePath) {
      filePath = this.convertToRelative(filePath);
    }
    return new MyTreeItem(this.itemIdCount++, label, isFolder, this.commandId, filePath);
  }

  // 相対パス変換
  convertToRelative(filePath: string): string {
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

  // アイテム取得
  getTreeItem(element: MyTreeItem): vscode.TreeItem {
    return element;
  }

  // 子要素取得
  getChildren(element?: MyTreeItem): Thenable<MyTreeItem[]> {
    if (!element) {
      // ルートノードを返す
      return Promise.resolve(this.nodes[0]);
    } else if (this.nodes[element.itemId]) {
      // 子ノードを返す
      return Promise.resolve(this.nodes[element.itemId]);
    }
    return Promise.resolve([]);
  }

  // ラベル変更
  changeLabel(itemId: number, newLabel: string) {
    this.getItemByItemId(itemId).label = newLabel;
    this.update();
  }


  // アイテム削除
  removeItem(item: MyTreeItem, notifyChanged: boolean = true) {
    this.removeItems([item.itemId]);

    if (item.itemId === this.currentFolderId) {
      this.currentFolderId = 0;
    }

    // フォルダの場合
    if (this.nodes[item.itemId]) {
      for (const childItem of this.nodes[item.itemId]) {
        this.removeItem(childItem, false);
      }
      delete this.nodes[item.itemId];
    }
    if (notifyChanged) {
      this.update();
    }
  }

  // アイテムを移動する
  moveItemsTo(targetItemId: number, itemIds: number[]) {
    const moveItems = this.removeItems(itemIds);
    for(const moveItem of moveItems) {
      moveItem.parentId = targetItemId;
      this.appendNode(moveItem);
    }
    this.update();
  }

  // アイテムをターゲットの下に移動する
  appendItemsTo(targetItemId: number, itemIds: number[]) {
    const moveItems = this.removeItems(itemIds);

    // 位置を特定して以下する
    const targetItem = this.getItemByItemId(targetItemId);
    const targetParentId = targetItem.parentId;
    const targetNodeList = this.nodes[targetParentId];
    let targetIndex = targetNodeList.findIndex(x => x.itemId === targetItemId);
    if (targetIndex === -1) {
      return;
    }
    for(const moveItem of moveItems) {
      moveItem.parentId = targetParentId;
      targetNodeList.splice(targetIndex + 1, 0, moveItem);
      targetIndex++;
    };

    this.update();
  }

  removeItems(itemIds: number[]): MyTreeItem[] {
    const items = [];

    // アイテムを削除する
    for(const itemId of itemIds) {
        const item = this.getItemByItemId(itemId);
        items.push(item);
        const parentId = item.parentId;
        const nodeList = this.nodes[parentId];
        const index = nodeList.findIndex(x => x.itemId === itemId);
        if (index === -1) {
          continue;
        }

        nodeList.splice(index, 1);
    }
    return items;
  }

  // アイテム取得
  getItemByItemId(itemId: number): MyTreeItem {
    return this.nodeTable[itemId];
  }

  // 子ノードの存在を確認
  isFolder(itemId: number): boolean {
    return !!this.nodes[itemId] && this.nodes[itemId].length > 0;
  }

  // 新しいアイテムを追加
  async addItem(name: string, isFolder: boolean, filePath?: string) {
    const newItem = this.createItem(name, isFolder, filePath);
    const folderId = this.currentFolderId;
    newItem.parentId = folderId;
    this.appendNode(newItem);
    await this.update();
  }

  // 新しい項目を追加
  async addItemWithFolderId(folderId: number, name: string, isFolder: boolean, filePath?: string) {
    const newItem = this.createItem(name, isFolder, filePath);
    newItem.parentId = folderId;
    this.appendNode(newItem);
    await this.update();
  }


  // 更新
  async update() {
    this._onDidChangeTreeData.fire();
    await this.save();
  }

  // JSONファイル名
  getJsonFilename(): string {
    if (!vscode.workspace.workspaceFolders) {
      return '';
    }
    return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', this.jsonFilename);
  }

  // 保存
  async save() {
    if (!vscode.workspace.workspaceFolders) {
      return;
    }
    const filePath = this.getJsonFilename();
    const dirPath = path.dirname(filePath);
    await fs.promises.mkdir(dirPath, { recursive: true });

    const data = this.prepareSerializableNode(0);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  // シリアライズ可能なノードを準備する
  prepareSerializableNode(itemId: number): any[] {
    const data = [];

    for (const item of this.nodes[itemId]) {
      let children = [];
      if (item.isFolder) {
        children = this.prepareSerializableNode(item.itemId);
      }
      data.push({ name: item.label, isFolder: item.isFolder, filePath: item.filePath, children: children });
    }
    return data;
  }

  // 古いjsonファイルのチェック
  checkOldJsonFile() {
        if (!vscode.workspace.workspaceFolders) {
      return;
    }

    const filePath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', 'mydata.json');
    if (!fs.existsSync(filePath)) {
      return;
    }

    vscode.window.showInformationMessage('please rename .vscode/mydata.json to .vscode/sidetree.json');
  }

  // データのリロード
  async reloadData() {
    await this.load();
  }

  // 読み出し
  async load() {
    if (!vscode.workspace.workspaceFolders) {
      return;
    }

    const filePath = this.getJsonFilename();
    try {
      const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      this.clearTree();
      this.appendItems(0, data);
    } catch (e) {
    }
    this._onDidChangeTreeData.fire();
  }

  // ツリーをクリア
  clearTree() {
    this.nodes = {};
    this.nodeTable = {};
    this.itemIdCount = 1;
  }

  // 追加
  appendItems(parentId: number, data: any[]) {
    for (const row of data) {
        const item = this.createItem(row.name, row.isFolder, row.filePath);
        item.parentId = parentId;
        this.appendNode(item);
        if (row.children) {
          this.appendItems(item.itemId, row.children);
        }
    }
  } 
}

// ツリーアイテムのクラス
class MyTreeItem extends vscode.TreeItem {
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