import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MyTreeItem } from './MyTreeItem';
import { MyTreeQuickPickItem } from './extension';
import { convertToRelative } from './convertToRelative';

// ツリーデータプロバイダ
export class MyTreeDataProvider implements vscode.TreeDataProvider<MyTreeItem> {

  private jsonFilename: string = 'sidetree.json';

  private _onDidChangeTreeData: vscode.EventEmitter<MyTreeItem | undefined | null | void> = new vscode.EventEmitter<MyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<MyTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private commandId: string = 'sideTreeView.itemClicked';
  private itemIdCount: number = 1;

  // ツリーデータのストア
  private nodes: { [itemId: number]: MyTreeItem[]; } = {};
  private nodeTable: { [itemId: number]: MyTreeItem; } = {};

  // コンストラクタ
  constructor() {
    // ルートノード
    this.nodes[0] = [];
    const item = this.createItem('SideTree Folder', true);
    this.appendNode(item);
    this.checkOldJsonFile();
    this.load();
  }

  // パスからアイテムを取得する
  getItemByPath(filePath: string): MyTreeItem | undefined {
    for (const key in this.nodeTable) {
      const item = this.nodeTable[key];
      if (item.filePath === filePath) {
        return item;
      }
    }
    return undefined;
  }

  // 検索用データを取得
  getSearchItems(): MyTreeQuickPickItem[] {
    const items: MyTreeQuickPickItem[] = [];
    for (const key in this.nodeTable) {
      const item = this.nodeTable[key];
      const itemPath = this.getItemPath(item.itemId);
      items.push({ itemId: item.itemId, label: item.label, detail: itemPath });
    }
    return items;
  }

  // アイテムのパスを取得
  getItemPath(itemId: number) {
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return '';
    }

    let currentItem = item;
    const pathSegments = [currentItem.label];
    while (currentItem.parentId !== 0) {
      currentItem = this.getItemByItemId(currentItem.parentId);
      if (currentItem) {
        pathSegments.unshift(currentItem.label);
      } else {
        break;
      }
    }

    return '/' + pathSegments.join('/');
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
      filePath = convertToRelative(filePath);
    }
    return new MyTreeItem(this.itemIdCount++, label, isFolder, this.commandId, filePath);
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

  // 親を得る
  getParent(element: MyTreeItem): vscode.ProviderResult<MyTreeItem> {
    if (element.parentId === 0) {
      return undefined;
    }
    return this.getItemByItemId(element.parentId);
  }

  // アイテム削除
  removeItem(item: MyTreeItem, notifyChanged: boolean = true) {
    this.removeItems([item.itemId]);

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
    for (const moveItem of moveItems) {
      if (moveItem.itemId !== targetItemId) {
        moveItem.parentId = targetItemId;
      }
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
    for (const moveItem of moveItems) {
      moveItem.parentId = targetParentId;
      targetNodeList.splice(targetIndex, 0, moveItem);
      targetIndex++;
    };

    this.update();
  }

  // 削除
  removeItems(itemIds: number[]): MyTreeItem[] {
    const items = [];

    // アイテムを削除する
    for (const itemId of itemIds) {
      const item = this.getItemByItemId(itemId);
      items.push(item);

      // フォルダから削除する
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

  // アイテムを現在のフォルダで一つ上に移動する
  moveItemUp(itemId: number) {
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return;
    }

    const parentId = item.parentId;
    const nodeList = this.nodes[parentId];
    const currentIndex = nodeList.findIndex(x => x.itemId === itemId);

    // 最上段の場合は何もしない
    if (currentIndex <= 0) {
      return;
    }

    // 要素を入れ替える
    const prevItem = nodeList[currentIndex - 1];
    nodeList[currentIndex - 1] = item;
    nodeList[currentIndex] = prevItem;

    this.update();
  }

  // アイテムを現在のフォルダで一つ下に移動する
  moveItemDown(itemId: number) {
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return;
    }

    const parentId = item.parentId;
    const nodeList = this.nodes[parentId];
    const currentIndex = nodeList.findIndex(x => x.itemId === itemId);

    // 最下段の場合は何もしない
    if (currentIndex >= nodeList.length - 1) {
      return;
    }

    // 要素を入れ替える
    const nextItem = nodeList[currentIndex + 1];
    nodeList[currentIndex + 1] = item;
    nodeList[currentIndex] = nextItem;

    this.update();
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
  async addItem(folderId: number, name: string, isFolder: boolean, filePath?: string) {
    const newItem = this.createItem(name, isFolder, filePath);
    newItem.parentId = folderId;
    this.appendNode(newItem);
    await this.update();
  }

  // 新しい項目を追加
  async addItemWithFolderId(folderId: number, name: string, isFolder: boolean, filePath?: string): Promise<MyTreeItem> {
    const newItem = this.createItem(name, isFolder, filePath);
    newItem.parentId = folderId;
    this.appendNode(newItem);
    await this.update();
    return newItem;
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

    if (!fs.existsSync(filePath)) {
      // ダイアログで確認する、No/Cancelの場合は保存しない
      const answer = await vscode.window.showInformationMessage(
        'Do you want to save current data?',
        { modal: true },
        'Yes', 'No'
      );

      if (answer !== 'Yes') {
        return;
      }
    }

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
