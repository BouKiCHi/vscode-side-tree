import * as vscode from 'vscode';
import { MyTreeItem } from './MyTreeItem';
import { MyTreeQuickPickItem } from './extension';
import { convertToRelative } from './convertToRelative';
import { SideTreeDataManager } from './SideTreeDataManager';

export interface SerializedTreeNode {
  name: string;
  isFolder: boolean;
  filePath?: string;
  line?: number;
  column?: number;
  symbolPath?: string;
  children: SerializedTreeNode[];
}

// ツリーデータプロバイダ
export class MyTreeDataProvider implements vscode.TreeDataProvider<MyTreeItem> {

  private _onDidChangeTreeData: vscode.EventEmitter<MyTreeItem | undefined | null | void> = new vscode.EventEmitter<MyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<MyTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private commandId: string = 'sideTreeView.itemClicked';
  private itemIdCount: number = 1;

  // ツリーデータのストア
  private nodes: { [itemId: number]: MyTreeItem[]; } = {};

  // 一次元構造の配列
  private nodeTable: { [itemId: number]: MyTreeItem; } = {};

  // コンストラクタ
  constructor(private dataManager: SideTreeDataManager) {
    // ルートノード
    this.nodes[0] = [];
    const item = this.createItem('SideTree Folder', true);
    this.appendNode(item);
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
    if (itemId === 0) {
      return '/';
    }

    // 取得できない場合がある？
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return '';
    }

    let currentItem = item;
    const pathSegments = [currentItem.label];
    while (currentItem.parentId !== 0) {
      const parentItem = this.getItemByItemId(currentItem.parentId);
      if (!parentItem) {
        break;
      }

      currentItem = parentItem;
      pathSegments.unshift(currentItem.label);
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
  createItem(label: string, isFolder: boolean, filePath?: string, line?: number, column?: number, symbolPath?: string): MyTreeItem {
    if (filePath) {
      filePath = convertToRelative(filePath);
    }
    return new MyTreeItem(this.itemIdCount++, label, isFolder, this.commandId, filePath, line, column, symbolPath);
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
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return;
    }

    item.label = newLabel;
    this.update();
  }

  // 親を得る
  getParent(element: MyTreeItem): vscode.ProviderResult<MyTreeItem> {
    if (element.parentId === 0) {
      return undefined;
    }
    const parent = this.getItemByItemId(element.parentId);
    return parent;
  }

  // アイテム削除
  removeItem(itemId: number, notifyChanged: boolean = true) {
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return;
    }

    // 走査中に配列が書き換わらないようにコピーしてから再帰削除
    const children = this.nodes[itemId] ? [...this.nodes[itemId]] : [];
    for (const childItem of children) {
      this.removeItem(childItem.itemId, false);
    }

    this.removeItems([itemId]);
    delete this.nodes[itemId];
    delete this.nodeTable[itemId];
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

  // アイテムをターゲットのアイテムの上に移動する
  appendItemsTo(targetItemId: number, itemIds: number[]) {
    if (targetItemId === 0) {
      return;
    }

    const targetItem = this.getItemByItemId(targetItemId);
    if (!targetItem) {
      return;
    }

    const moveItems = this.removeItems(itemIds);

    // 位置を特定して以下する
    const targetParentId = targetItem.parentId;
    const targetNodeList = this.nodes[targetParentId];
    if (!targetNodeList) {
      return;
    }
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
    const items: MyTreeItem[] = [];

    // アイテムを削除する
    for (const itemId of itemIds) {
      const item = this.getItemByItemId(itemId);
      if (!item) {
        continue;
      }
      items.push(item);

      // フォルダから削除する
      const parentId = item.parentId;
      const nodeList = this.nodes[parentId];
      if (!nodeList) {
        continue;
      }
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
    if (!nodeList) {
      return;
    }
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
    if (!nodeList) {
      return;
    }
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

  // アイテムを親フォルダに移動する
  moveItemParent(itemId: number) {
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return;
    }

    this.appendItemsTo(item.parentId, [item.itemId]);
  }

  // フォルダ内の項目をソートする
  sortItemInFolder(folderId: number) {
    const nodeList = this.nodes[folderId];
    if (!nodeList) {
      return;
    }

    nodeList.sort((a, b) => {
      return a.label.localeCompare(b.label);
    });

    this.update();
  }

  // すべてのアイテムを閉じる
  async foldAllItems() {
    // 一次元配列ですべての項目を閉じる
    for (const itemId in this.nodeTable) {
      const item = this.nodeTable[itemId];
      if (item.isFolder) {
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
      }
    }
    await this.update();
  }

  // アイテム取得
  getItemByItemId(itemId: number): MyTreeItem | undefined {
    return this.nodeTable[itemId];
  }

  // 子ノードの存在を確認
  isFolder(itemId: number): boolean {
    return !!this.nodes[itemId] && this.nodes[itemId].length > 0;
  }

  // 新しいアイテムを追加
  async addItem(folderId: number, name: string, isFolder: boolean, filePath?: string, line?: number, column?: number, symbolPath?: string) {
    const newItem = this.createItem(name, isFolder, filePath, line, column, symbolPath);
    newItem.parentId = folderId;
    this.appendNode(newItem);
    await this.update();
  }

  // 新しい項目を追加
  async addItemWithFolderId(folderId: number, name: string, isFolder: boolean, filePath?: string, line?: number, column?: number, symbolPath?: string): Promise<MyTreeItem> {
    const newItem = this.createItem(name, isFolder, filePath, line, column, symbolPath);
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

  // 保存
  async save() {
    if (!vscode.workspace.workspaceFolders) {
      return;
    }

    if (!(await this.dataManager.checkFirstWrite())) {
      return;
    }

    const data = this.prepareSerializableNode(0);
    const json = JSON.stringify(data, null, 2);
    await this.dataManager.saveData(json);
  }

  // シリアライズ可能なノードを準備する
  prepareSerializableNode(itemId: number): SerializedTreeNode[] {
    const data: SerializedTreeNode[] = [];

    for (const item of this.nodes[itemId] ?? []) {
      let children: SerializedTreeNode[] = [];
      if (item.isFolder) {
        children = this.prepareSerializableNode(item.itemId);
      }
      data.push({
        name: item.label,
        isFolder: item.isFolder,
        filePath: item.filePath,
        line: item.line,
        column: item.column,
        symbolPath: item.symbolPath,
        children: children
      });
    }
    return data;
  }

  // データのリロード
  async reloadData() {
    await this.load();
  }

  // 読み出し
  async load() {
    const data = await this.dataManager.loadData();
    if (!data) {
      return;
    }

    this.clearTree();
    this.appendItems(0, data);
    this._onDidChangeTreeData.fire();
  }

  // ツリーをクリア
  clearTree() {
    this.nodes = {};
    this.nodeTable = {};
    this.itemIdCount = 1;
  }

  // 追加
  appendItems(parentId: number, data: SerializedTreeNode[]) {
    for (const row of data) {
      const item = this.createItem(row.name, row.isFolder, row.filePath, row.line, row.column, row.symbolPath);
      item.parentId = parentId;
      this.appendNode(item);
      if (row.children && row.children.length > 0) {
        this.appendItems(item.itemId, row.children);
      }
    }
  }
}
