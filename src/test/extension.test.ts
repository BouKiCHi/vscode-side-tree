import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import * as path from 'path';
import { MyTreeDataProvider, SerializedTreeNode } from '../MyTreeDataProvider';
import { SideTreeDataManager } from '../SideTreeDataManager';
import { convertToRelative } from '../convertToRelative';
import { getExplorerSelection } from '../extension';
import { localize } from '../localize';
import { parseCsvImport } from '../parseCsvImport';

class MockSideTreeDataManager {
  public lastSavedJson: string | null = null;

  async loadData(): Promise<SerializedTreeNode[] | null> {
    return null;
  }

  async saveData(json: string): Promise<void> {
    this.lastSavedJson = json;
  }

  async checkFirstWrite(): Promise<boolean> {
    return true;
  }
}

suite('Extension Test Suite', () => {
  test('add/remove keeps tree and search index consistent', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);
    const rootLabel = localize('sideTree.rootFolder.label', 'SideTree Folder');

    const folder = await provider.addItemWithFolderId(0, 'FolderA', true);
    const fileInFolder = await provider.addItemWithFolderId(folder.itemId, 'a.ts', false, 'a.ts');
    const rootFile = await provider.addItemWithFolderId(0, 'root.ts', false, 'root.ts');
    const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
    const savedBeforeRemove = mockManager.lastSavedJson;

    const beforeRemove = provider.prepareSerializableNode(0);
    assert.strictEqual(beforeRemove.length, 3);

    provider.removeItem(folder.itemId);

    const afterRemove = provider.prepareSerializableNode(0);
    assert.deepStrictEqual(afterRemove.map((x) => x.name), [rootLabel, 'root.ts']);

    const searchItems = provider.getSearchItems();
    const remainingIds = new Set(searchItems.map((x) => x.itemId));
    assert.ok(!remainingIds.has(folder.itemId));
    assert.ok(!remainingIds.has(fileInFolder.itemId));
    assert.ok(remainingIds.has(rootFile.itemId));

    if (hasWorkspace) {
      // removeItem は内部で update() を fire-and-forget するため、保存完了を1tick待つ
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.ok(typeof mockManager.lastSavedJson === 'string');
      assert.notStrictEqual(mockManager.lastSavedJson, savedBeforeRemove);
    }
  });

  test('move and sort operations update order as expected', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);
    const rootLabel = localize('sideTree.rootFolder.label', 'SideTree Folder');

    const itemA = await provider.addItemWithFolderId(0, 'A.ts', false, 'A.ts');
    const itemB = await provider.addItemWithFolderId(0, 'B.ts', false, 'B.ts');
    const itemC = await provider.addItemWithFolderId(0, 'C.ts', false, 'C.ts');

    provider.moveItemUp(itemC.itemId);
    provider.moveItemDown(itemA.itemId);

    let order = provider.prepareSerializableNode(0).map((x) => x.name);
    assert.deepStrictEqual(order, [rootLabel, 'C.ts', 'A.ts', 'B.ts']);

    provider.sortItemInFolder(0);
    order = provider.prepareSerializableNode(0).map((x) => x.name);
    assert.deepStrictEqual(order, ['A.ts', 'B.ts', 'C.ts', rootLabel]);

    const folder = await provider.addItemWithFolderId(0, 'Parent', true);
    const child = await provider.addItemWithFolderId(folder.itemId, 'Child.ts', false, 'Child.ts');
    provider.moveItemParent(child.itemId);

    const rootRows = provider.prepareSerializableNode(0);
    const parentIndex = rootRows.findIndex((x) => x.name === 'Parent');
    const childIndex = rootRows.findIndex((x) => x.name === 'Child.ts');
    assert.ok(parentIndex >= 0);
    assert.ok(childIndex >= 0);
    assert.ok(childIndex < parentIndex);
  });

  test('moveItemsTop preserves relative order of multiple selected items', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);
    const rootLabel = localize('sideTree.rootFolder.label', 'SideTree Folder');

    await provider.addItemWithFolderId(0, 'A.ts', false, 'A.ts');
    const itemB = await provider.addItemWithFolderId(0, 'B.ts', false, 'B.ts');
    const itemC = await provider.addItemWithFolderId(0, 'C.ts', false, 'C.ts');
    await provider.addItemWithFolderId(0, 'D.ts', false, 'D.ts');

    provider.moveItemsTop([itemB.itemId, itemC.itemId]);

    const order = provider.prepareSerializableNode(0).map((x) => x.name);
    assert.deepStrictEqual(order, [rootLabel, 'B.ts', 'C.ts', 'A.ts', 'D.ts']);
  });

  test('convertToRelative converts only workspace-contained paths', () => {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
      return;
    }

    const inside = path.join(workspacePath, 'src', 'index.ts');
    const outside = path.join(path.dirname(workspacePath), 'outside.ts');

    const insideRelative = convertToRelative(inside);
    const outsideUnchanged = convertToRelative(outside);

    assert.strictEqual(insideRelative, 'src/index.ts');
    assert.strictEqual(outsideUnchanged, outside);
  });

  test('linked folder nodes are serialized without children and load filesystem entries recursively', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sidetree-linked-'));
    const nestedDir = path.join(tempRoot, 'nested');
    const nestedFile = path.join(nestedDir, 'child.txt');
    await fs.promises.mkdir(nestedDir, { recursive: true });
    await fs.promises.writeFile(nestedFile, 'ok', 'utf8');

    try {
      const mockManager = new MockSideTreeDataManager();
      const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

      const linked = await provider.addLinkedFolderWithFolderId(0, path.basename(tempRoot), tempRoot);
      const serialized = provider.prepareSerializableNode(0);
      const linkedRow = serialized.find((x) => x.name === path.basename(tempRoot));

      assert.ok(linkedRow);
      assert.strictEqual(linkedRow?.itemType, 'linkedFolder');
      assert.deepStrictEqual(linkedRow?.children, []);

      const firstLevel = await provider.getChildren(linked);
      const nestedFolderItem = firstLevel.find((x) => x.label === 'nested');
      assert.ok(nestedFolderItem);
      assert.strictEqual(nestedFolderItem?.itemType, 'linkedFolder');

      const secondLevel = await provider.getChildren(nestedFolderItem);
      assert.deepStrictEqual(secondLevel.map((x) => x.label), ['child.txt']);
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('replaceAll swaps tree contents with imported serialized data', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    await provider.addItemWithFolderId(0, 'before.ts', false, 'before.ts');
    await provider.replaceAll([
      {
        name: 'Imported Folder',
        isFolder: true,
        itemType: 'virtualFolder',
        children: [
          {
            name: 'inside.ts',
            isFolder: false,
            itemType: 'file',
            filePath: 'inside.ts',
            children: []
          }
        ]
      }
    ]);

    const rootRows = provider.prepareSerializableNode(0);
    assert.deepStrictEqual(rootRows.map((x) => x.name), ['Imported Folder']);
    assert.deepStrictEqual(rootRows[0].children.map((x) => x.name), ['inside.ts']);
  });

  test('importItems appends imported serialized data under the target folder', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const folder = await provider.addItemWithFolderId(0, 'Target', true);
    await provider.importItems(folder.itemId, [
      {
        name: 'Imported File.ts',
        isFolder: false,
        itemType: 'file',
        filePath: 'Imported File.ts',
        children: []
      }
    ]);

    const rootRows = provider.prepareSerializableNode(0);
    const target = rootRows.find((x) => x.name === 'Target');
    assert.ok(target);
    assert.deepStrictEqual(target?.children.map((x) => x.name), ['Imported File.ts']);
  });

  test('importItemsAfter inserts imported data after the target item', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);
    const rootLabel = localize('sideTree.rootFolder.label', 'SideTree Folder');

    await provider.addItemWithFolderId(0, 'before.ts', false, 'before.ts');
    const target = await provider.addItemWithFolderId(0, 'target.ts', false, 'target.ts');
    await provider.addItemWithFolderId(0, 'after.ts', false, 'after.ts');

    await provider.importItemsAfter(target.itemId, [
      {
        name: 'imported.ts',
        isFolder: false,
        itemType: 'file',
        filePath: 'imported.ts',
        children: []
      }
    ]);

    const rootRows = provider.prepareSerializableNode(0);
    assert.deepStrictEqual(rootRows.map((x) => x.name), [rootLabel, 'before.ts', 'target.ts', 'imported.ts', 'after.ts']);
  });

  test('item description is shown on tree items and preserved in serialization', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const item = await provider.addItemWithFolderId(0, 'memo.ts', false, 'memo.ts', undefined, undefined, undefined, 'important note');
    assert.strictEqual(item.description, 'important note');

    provider.changeDescription(item.itemId, 'updated note');
    assert.strictEqual(item.description, 'updated note');

    const serialized = provider.prepareSerializableNode(0);
    const row = serialized.find((x) => x.name === 'memo.ts');
    assert.strictEqual(row?.description, 'updated note');

    await provider.replaceAll(serialized);
    const reloaded = provider.prepareSerializableNode(0).find((x) => x.name === 'memo.ts');
    assert.strictEqual(reloaded?.description, 'updated note');
  });

  test('getExplorerSelection prefers multi-select resources and filters duplicates', () => {
    const first = vscode.Uri.file(path.join('/tmp', 'first.ts'));
    const second = vscode.Uri.file(path.join('/tmp', 'second.ts'));

    const selected = getExplorerSelection(first, [first, second, first]);

    assert.deepStrictEqual(selected.map((uri) => uri.fsPath), [first.fsPath, second.fsPath]);
  });

  test('getExplorerSelection falls back to single resource and ignores non-file uris', () => {
    const single = vscode.Uri.file(path.join('/tmp', 'single.ts'));
    const ignored = vscode.Uri.parse('untitled:note');

    assert.deepStrictEqual(getExplorerSelection(single).map((uri) => uri.fsPath), [single.fsPath]);
    assert.deepStrictEqual(getExplorerSelection(single, [ignored]).map((uri) => uri.fsPath), []);
  });

  test('parseCsvImport reads folder path, relative file path, label, and description', () => {
    const rows = parseCsvImport([
      'フォルダ,ファイルパス,名前,説明',
      'A/B,src/app.ts,App entry,main module',
      ',src/lib/util.ts,,helper'
    ].join('\n'));

    assert.deepStrictEqual(rows, [
      {
        folderPath: 'A/B',
        filePath: 'src/app.ts',
        name: 'App entry',
        description: 'main module'
      },
      {
        folderPath: undefined,
        filePath: 'src/lib/util.ts',
        name: 'util.ts',
        description: 'helper'
      }
    ]);
  });

  test('parseCsvImport supports quoted commas and escaped quotes', () => {
    const rows = parseCsvImport('"A/B","src/data.ts","label,with,comma","note ""quoted"""');

    assert.deepStrictEqual(rows, [
      {
        folderPath: 'A/B',
        filePath: 'src/data.ts',
        name: 'label,with,comma',
        description: 'note "quoted"'
      }
    ]);
  });
});
