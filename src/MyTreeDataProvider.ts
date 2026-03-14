import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MyTreeItem, TreeItemType } from './MyTreeItem';
import { MyTreeQuickPickItem } from './extension';
import { convertToRelative } from './convertToRelative';
import { SideTreeDataManager } from './SideTreeDataManager';
import { localize } from './localize';

export interface SerializedTreeNode {
  name: string;
  description?: string;
  isFolder: boolean;
  itemType?: TreeItemType;
  filePath?: string;
  line?: number;
  column?: number;
  symbolPath?: string;
  children: SerializedTreeNode[];
}

export interface CsvExportRow {
  folderPath?: string;
  filePath: string;
  name: string;
  description?: string;
}

// ツリーデータプロバイダ
export class MyTreeDataProvider implements vscode.TreeDataProvider<MyTreeItem> {

  private _onDidChangeTreeData: vscode.EventEmitter<MyTreeItem | undefined | null | void> = new vscode.EventEmitter<MyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<MyTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private fileCommandId: string = 'sideTreeView.itemClicked';
  private folderCommandId: string = 'sideTreeView.folderClicked';
  private itemIdCount: number = 1;

  // ツリーデータのストア
  private nodes: { [itemId: number]: MyTreeItem[]; } = {};

  // 一次元構造の配列
  private nodeTable: { [itemId: number]: MyTreeItem; } = {};

  // コンストラクタ
  constructor(private dataManager: SideTreeDataManager) {
    // ルートノード
    this.nodes[0] = [];
    const item = this.createItem(localize('sideTree.rootFolder.label', 'SideTree Folder'), true, 'virtualFolder');
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
      items.push({ itemId: item.itemId, label: this.getMenuLabel(item), detail: itemPath });
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
    if (item.itemType === 'virtualFolder' && !this.nodes[item.itemId]) {
      this.nodes[item.itemId] = [];
    }

    this.nodes[item.parentId].push(item);
    this.nodeTable[item.itemId] = item;
  }

  // アイテム作成
  createItem(
    label: string,
    isFolder: boolean,
    itemType: TreeItemType,
    filePath?: string,
    line?: number,
    column?: number,
    symbolPath?: string,
    description?: string,
    isTransient: boolean = false
  ): MyTreeItem {
    if (filePath) {
      filePath = convertToRelative(filePath);
    }
    return new MyTreeItem(this.itemIdCount++, label, isFolder, itemType, this.fileCommandId, this.folderCommandId, filePath, line, column, symbolPath, description, isTransient);
  }


  // アイテム取得
  getTreeItem(element: MyTreeItem): vscode.TreeItem {
    return element;
  }

  // 子要素取得
  async getChildren(element?: MyTreeItem): Promise<MyTreeItem[]> {
    if (!element) {
      // ルートノードを返す
      return this.nodes[0];
    }

    if (element.itemType === 'linkedFolder') {
      return this.loadLinkedFolderChildren(element);
    }

    if (this.nodes[element.itemId]) {
      // 子ノードを返す
      return this.nodes[element.itemId];
    }
    return [];
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

  changeDescription(itemId: number, newDescription?: string) {
    const item = this.getItemByItemId(itemId);
    if (!item) {
      return;
    }

    item.note = newDescription;
    item.description = newDescription;

    const pathTooltip = item.filePath ? localize('sideTree.tooltip.path', 'Path: {0}', item.filePath) : '';
    const lineSuffix = typeof item.line === 'number' ? `:${item.line + 1}:${(item.column ?? 0) + 1}` : '';
    const noteTooltip = newDescription ? `${pathTooltip || lineSuffix ? '\n' : ''}${newDescription}` : '';
    item.tooltip = `${pathTooltip}${lineSuffix}${noteTooltip}`;
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

  // アイテムを現在のフォルダの一番上に移動する
  moveItemsTop(itemIds: number[]) {
    const groupedItems = new Map<number, MyTreeItem[]>();

    for (const itemId of itemIds) {
      const item = this.getItemByItemId(itemId);
      if (!item) {
        continue;
      }

      const group = groupedItems.get(item.parentId);
      if (group) {
        group.push(item);
      } else {
        groupedItems.set(item.parentId, [item]);
      }
    }

    for (const [parentId, items] of groupedItems) {
      const nodeList = this.nodes[parentId];
      if (!nodeList || items.length === 0) {
        continue;
      }

      const itemIdSet = new Set(items.map((item) => item.itemId));
      const movingItems = nodeList.filter((item) => itemIdSet.has(item.itemId));
      if (movingItems.length === 0) {
        continue;
      }

      const remainingItems = nodeList.filter((item) => !itemIdSet.has(item.itemId));
      this.nodes[parentId] = [...movingItems, ...remainingItems];
    }

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

  private getMenuLabel(item: MyTreeItem): string {
    if (item.symbolPath) {
      const lineNumber = typeof item.line === 'number' ? item.line + 1 : undefined;
      return `${item.symbolPath}${lineNumber ? `:${lineNumber}` : ''}`;
    }
    return item.label;
  }

  // 子ノードの存在を確認
  isFolder(itemId: number): boolean {
    return !!this.nodes[itemId] && this.nodes[itemId].length > 0;
  }

  // 新しいアイテムを追加
  async addItem(folderId: number, name: string, isFolder: boolean, filePath?: string, line?: number, column?: number, symbolPath?: string, description?: string) {
    const itemType = this.resolveItemType(isFolder, symbolPath);
    const newItem = this.createItem(name, isFolder, itemType, filePath, line, column, symbolPath, description);
    newItem.parentId = folderId;
    this.appendNode(newItem);
    await this.update();
  }

  // 新しい項目を追加
  async addItemWithFolderId(folderId: number, name: string, isFolder: boolean, filePath?: string, line?: number, column?: number, symbolPath?: string, description?: string): Promise<MyTreeItem> {
    const itemType = this.resolveItemType(isFolder, symbolPath);
    const newItem = this.createItem(name, isFolder, itemType, filePath, line, column, symbolPath, description);
    newItem.parentId = folderId;
    this.appendNode(newItem);
    await this.update();
    return newItem;
  }

  // 実フォルダ参照を追加
  async addLinkedFolderWithFolderId(folderId: number, name: string, filePath: string): Promise<MyTreeItem> {
    const newItem = this.createItem(name, true, 'linkedFolder', filePath);
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
      if (item.isTransient) {
        continue;
      }

      data.push(this.serializeItem(item));
    }
    return data;
  }

  prepareSerializableItems(items: readonly MyTreeItem[]): SerializedTreeNode[] {
    const data: SerializedTreeNode[] = [];
    for (const item of items) {
      if (item.isTransient) {
        continue;
      }

      data.push(this.serializeItem(item));
    }
    return data;
  }

  prepareCsvExport(): string {
    const rows = this.prepareCsvRows(0);
    const lines = [
      ['Folder', 'FilePath', 'Name', 'Description'].map((value) => this.escapeCsvField(value)).join(',')
    ];

    for (const row of rows) {
      lines.push([
        row.folderPath ?? '',
        row.filePath,
        row.name,
        row.description ?? ''
      ].map((value) => this.escapeCsvField(value)).join(','));
    }

    return lines.join('\n');
  }

  // データのリロード
  async reloadData() {
    await this.load();
  }

  async replaceAll(data: SerializedTreeNode[]) {
    this.clearTree();
    this.appendItems(0, data);
    await this.update();
  }

  async importItems(parentId: number, data: SerializedTreeNode[]) {
    this.appendItems(parentId, data);
    await this.update();
  }

  async importItemsAfter(targetItemId: number, data: SerializedTreeNode[]) {
    const targetItem = this.getItemByItemId(targetItemId);
    if (!targetItem) {
      return;
    }

    const parentId = targetItem.parentId;
    const nodeList = this.nodes[parentId];
    if (!nodeList) {
      return;
    }

    const insertIndex = nodeList.findIndex((item) => item.itemId === targetItemId);
    if (insertIndex === -1) {
      return;
    }

    const importedItems = this.buildItems(parentId, data);
    nodeList.splice(insertIndex + 1, 0, ...importedItems);
    await this.update();
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
    const items = this.buildItems(parentId, data);
    if (!this.nodes[parentId]) {
      this.nodes[parentId] = [];
    }
    this.nodes[parentId].push(...items);
  }

  private buildItems(parentId: number, data: SerializedTreeNode[]): MyTreeItem[] {
    const items: MyTreeItem[] = [];
    for (const row of data) {
      const itemType = row.itemType ?? this.resolveItemType(row.isFolder, row.symbolPath);
      const item = this.createItem(row.name, row.isFolder, itemType, row.filePath, row.line, row.column, row.symbolPath, row.description);
      item.parentId = parentId;
      this.nodeTable[item.itemId] = item;
      if (item.itemType === 'virtualFolder' && !this.nodes[item.itemId]) {
        this.nodes[item.itemId] = [];
      }
      items.push(item);
      if (itemType === 'virtualFolder' && row.children && row.children.length > 0) {
        this.nodes[item.itemId] = this.buildItems(item.itemId, row.children);
      }
    }
    return items;
  }

  private resolveItemType(isFolder: boolean, symbolPath?: string): TreeItemType {
    if (isFolder) {
      return 'virtualFolder';
    }

    if (symbolPath) {
      return 'symbol';
    }

    return 'file';
  }

  private serializeItem(item: MyTreeItem): SerializedTreeNode {
    let children: SerializedTreeNode[] = [];
    if (item.itemType === 'virtualFolder') {
      children = this.prepareSerializableNode(item.itemId);
    }

    return {
      name: item.label,
      description: item.note,
      isFolder: item.isFolder,
      itemType: item.itemType,
      filePath: item.filePath,
      line: item.line,
      column: item.column,
      symbolPath: item.symbolPath,
      children
    };
  }

  private prepareCsvRows(itemId: number, folderSegments: string[] = []): CsvExportRow[] {
    const rows: CsvExportRow[] = [];
    const nodeList = this.nodes[itemId] ?? [];

    for (let index = 0; index < nodeList.length; index++) {
      const item = nodeList[index];
      if (item.isTransient || item.itemType === 'linkedFolder') {
        continue;
      }

      if (item.itemType === 'virtualFolder') {
        const nextSegments = this.isDefaultRootFolder(itemId, index, item)
          ? folderSegments
          : [...folderSegments, item.label];
        rows.push(...this.prepareCsvRows(item.itemId, nextSegments));
        continue;
      }

      if (!item.filePath) {
        continue;
      }

      rows.push({
        folderPath: folderSegments.length ? folderSegments.join('/') : undefined,
        filePath: item.filePath,
        name: item.label,
        description: item.note
      });
    }

    return rows;
  }

  private isDefaultRootFolder(parentId: number, index: number, item: MyTreeItem): boolean {
    return parentId === 0 && index === 0 && item.itemType === 'virtualFolder' && !item.filePath;
  }

  private escapeCsvField(value: string): string {
    if (!/[",\n\r]/.test(value)) {
      return value;
    }

    return `"${value.replace(/"/g, '""')}"`;
  }

  private async loadLinkedFolderChildren(item: MyTreeItem): Promise<MyTreeItem[]> {
    if (!item.filePath) {
      return [];
    }

    const cached = this.nodes[item.itemId];
    if (cached !== undefined) {
      return cached;
    }

    const uri = this.getUriFromPath(item.filePath);
    if (!uri) {
      this.nodes[item.itemId] = [];
      return [];
    }

    try {
      const dirents = await fs.promises.readdir(uri.fsPath, { withFileTypes: true });
      const children = dirents
        .filter((dirent) => dirent.name !== '.' && dirent.name !== '..')
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        })
        .map((dirent) => {
          const childPath = path.join(uri.fsPath, dirent.name);
          const child = this.createItem(
            dirent.name,
            dirent.isDirectory(),
            dirent.isDirectory() ? 'linkedFolder' : 'file',
            childPath,
            undefined,
            undefined,
            undefined,
            undefined,
            true
          );
          child.parentId = item.itemId;
          return child;
        });

      this.nodes[item.itemId] = children;
      for (const child of children) {
        this.nodeTable[child.itemId] = child;
      }
      return children;
    } catch {
      this.nodes[item.itemId] = [];
      return [];
    }
  }

  private getUriFromPath(filePath: string): vscode.Uri | null {
    if (path.isAbsolute(filePath)) {
      return vscode.Uri.file(filePath);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    const absolutePath = path.join(workspaceFolder.uri.fsPath, filePath);
    return vscode.Uri.file(absolutePath);
  }
}
