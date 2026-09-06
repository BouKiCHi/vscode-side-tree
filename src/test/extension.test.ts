import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import * as path from 'path';
import { MyTreeDataProvider, SerializedTreeNode } from '../MyTreeDataProvider';
import { MyTreeItem } from '../MyTreeItem';
import { SideTreeDataManager } from '../SideTreeDataManager';
import { convertToRelative } from '../convertToRelative';
import { getExplorerSelection, getTargetFolderItemId } from '../extension';
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
  const ensureVirtualFolderPathForTest = async (provider: MyTreeDataProvider, baseFolderId: number, folderPath?: string): Promise<number> => {
    const segments = folderPath
      ?.split(/[\\/]/)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0) ?? [];

    let currentFolderId = baseFolderId;
    for (const segment of segments) {
      const parent = currentFolderId === 0 ? undefined : provider.getItemByItemId(currentFolderId);
      const children = await provider.getChildren(parent);
      const existing = children.find((item) => item.itemType === 'virtualFolder' && item.label === segment);
      if (existing) {
        currentFolderId = existing.itemId;
        continue;
      }

      const created = await provider.addItemWithFolderId(currentFolderId, segment, true);
      currentFolderId = created.itemId;
    }

    return currentFolderId;
  };

  test('add/remove keeps tree and search index consistent', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const folder = await provider.addItemWithFolderId(0, 'FolderA', true);
    const fileInFolder = await provider.addItemWithFolderId(folder.itemId, 'a.ts', false, 'a.ts');
    const rootFile = await provider.addItemWithFolderId(0, 'root.ts', false, 'root.ts');
    const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
    const savedBeforeRemove = mockManager.lastSavedJson;

    const beforeRemove = provider.prepareSerializableNode(0);
    assert.strictEqual(beforeRemove.length, 2);

    provider.removeItem(folder.itemId);

    const afterRemove = provider.prepareSerializableNode(0);
    assert.deepStrictEqual(afterRemove.map((x) => x.name), ['root.ts']);

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

    const itemA = await provider.addItemWithFolderId(0, 'A.ts', false, 'A.ts');
    const itemB = await provider.addItemWithFolderId(0, 'B.ts', false, 'B.ts');
    const itemC = await provider.addItemWithFolderId(0, 'C.ts', false, 'C.ts');

    provider.moveItemUp(itemC.itemId);
    provider.moveItemDown(itemA.itemId);

    let order = provider.prepareSerializableNode(0).map((x) => x.name);
    assert.deepStrictEqual(order, ['C.ts', 'A.ts', 'B.ts']);

    provider.sortItemInFolder(0);
    order = provider.prepareSerializableNode(0).map((x) => x.name);
    assert.deepStrictEqual(order, ['A.ts', 'B.ts', 'C.ts']);

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

    await provider.addItemWithFolderId(0, 'A.ts', false, 'A.ts');
    const itemB = await provider.addItemWithFolderId(0, 'B.ts', false, 'B.ts');
    const itemC = await provider.addItemWithFolderId(0, 'C.ts', false, 'C.ts');
    await provider.addItemWithFolderId(0, 'D.ts', false, 'D.ts');

    provider.moveItemsTop([itemB.itemId, itemC.itemId]);

    const order = provider.prepareSerializableNode(0).map((x) => x.name);
    assert.deepStrictEqual(order, ['B.ts', 'C.ts', 'A.ts', 'D.ts']);
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
    assert.deepStrictEqual(rootRows.map((x) => x.name), ['before.ts', 'target.ts', 'imported.ts', 'after.ts']);
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

  test('checked state is preserved in serialization', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const item = await provider.addItemWithFolderId(0, 'checked.ts', false, 'checked.ts');
    await provider.setItemChecked(item.itemId, true);

    const serialized = provider.prepareSerializableNode(0);
    const row = serialized.find((x) => x.name === 'checked.ts');
    assert.strictEqual(row?.checked, true);
  });

  test('hide checked mode hides checked items from visible children', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const visible = await provider.addItemWithFolderId(0, 'visible.ts', false, 'visible.ts');
    const hidden = await provider.addItemWithFolderId(0, 'hidden.ts', false, 'hidden.ts');
    await provider.setItemChecked(hidden.itemId, true);
    await provider.setHideCheckedMode(true);

    const rootChildren = await provider.getChildren();
    assert.ok(rootChildren.some((item) => item.itemId === visible.itemId));
    assert.ok(!rootChildren.some((item) => item.itemId === hidden.itemId));
  });

  test('checkbox visibility can be enabled without hiding items', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const visible = await provider.addItemWithFolderId(0, 'visible.ts', false, 'visible.ts');
    const checked = await provider.addItemWithFolderId(0, 'checked.ts', false, 'checked.ts');
    await provider.setItemChecked(checked.itemId, true);
    await provider.setShowCheckboxes(true);

    const rootChildren = await provider.getChildren();
    assert.ok(rootChildren.some((item) => item.itemId === visible.itemId));
    assert.ok(rootChildren.some((item) => item.itemId === checked.itemId));
    assert.strictEqual(visible.checkboxState, vscode.TreeItemCheckboxState.Unchecked);
    assert.strictEqual(checked.checkboxState, vscode.TreeItemCheckboxState.Checked);
  });

  test('folder checked state is recalculated from imported checked children', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    await provider.importItems(0, [
      {
        name: 'Docs',
        isFolder: true,
        children: [
          {
            name: 'a.ts',
            isFolder: false,
            filePath: 'src/a.ts',
            checked: true,
            children: []
          },
          {
            name: 'b.ts',
            isFolder: false,
            filePath: 'src/b.ts',
            checked: true,
            children: []
          }
        ]
      }
    ]);

    const folder = provider.prepareSerializableNode(0)[0];
    assert.strictEqual(folder.checked, true);
  });

  test('checking a folder updates its children and keeps folder checked', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const folder = await provider.addItemWithFolderId(0, 'Docs', true);
    const first = await provider.addItemWithFolderId(folder.itemId, 'a.ts', false, 'src/a.ts');
    const second = await provider.addItemWithFolderId(folder.itemId, 'b.ts', false, 'src/b.ts');

    await provider.setItemChecked(folder.itemId, true);

    assert.strictEqual(provider.getItemByItemId(folder.itemId)?.checked, true);
    assert.strictEqual(provider.getItemByItemId(first.itemId)?.checked, true);
    assert.strictEqual(provider.getItemByItemId(second.itemId)?.checked, true);
  });

  test('csv import marks parent folders checked when all imported children are checked', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);
    const rows = parseCsvImport([
      'Folder,FilePath,Name,Description,Check',
      'アドレス,some.txt,some.txt,,true',
      'アドレス,dir/test.txt,test.txt,,true',
      'アドレス,some2.txt,some2.txt,,true',
      'アドレス/テストデータ,dir/test.txt,test.txt,,true',
      'フォルダ,some.txt,some.txt,,true',
      'フォルダ,some2.txt,some2.txt,,true',
      'フォルダ,dir\\test.txt,test.txt,,true',
      'フォルダ,dir/test.txt,test.txt,,true',
      'フォルダ/テスト子フォルダ,dir/test.txt,test.txt,,true',
      'フォルダ/テスト子フォルダ,some.txt,some.txt,,true',
      'フォルダ/テスト子フォルダ,some2.txt,some2.txt,,true',
      'フォルダ/新規フォルダ,some.txt,some.txt,,true',
      'フォルダテスト,dir/test.txt,test.txt,,true'
    ].join('\n'));

    for (const row of rows) {
      const folderId = await ensureVirtualFolderPathForTest(provider, 0, row.folderPath);
      await provider.addItemWithFolderId(folderId, row.name, false, row.filePath, undefined, undefined, undefined, row.description, row.checked ?? false);
    }

    const rootItems = provider.prepareSerializableNode(0);
    const addresses = rootItems.find((item) => item.name === 'アドレス');
    const folder = rootItems.find((item) => item.name === 'フォルダ');
    const folderTest = rootItems.find((item) => item.name === 'フォルダテスト');
    const nestedFolder = folder?.children.find((item) => item.name === 'テスト子フォルダ');
    const newFolder = folder?.children.find((item) => item.name === '新規フォルダ');

    assert.strictEqual(addresses?.checked, true);
    assert.strictEqual(folder?.checked, true);
    assert.strictEqual(folderTest?.checked, true);
    assert.strictEqual(nestedFolder?.checked, true);
    assert.strictEqual(newFolder?.checked, true);
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

  test('getTargetFolderItemId returns the virtual folder id', () => {
    const folder = new MyTreeItem(10, 'Folder', true, 'virtualFolder');

    assert.strictEqual(getTargetFolderItemId(folder), 10);
  });

  test('getTargetFolderItemId falls back to parent id for files and root for undefined', () => {
    const file = new MyTreeItem(11, 'file.ts', false, 'file', undefined, undefined, 'src/file.ts');
    file.parentId = 7;

    assert.strictEqual(getTargetFolderItemId(file), 7);
    assert.strictEqual(getTargetFolderItemId(undefined), 0);
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
        description: 'main module',
        checked: undefined
      },
      {
        folderPath: undefined,
        filePath: 'src/lib/util.ts',
        name: 'util.ts',
        description: 'helper',
        checked: undefined
      }
    ]);
  });

  test('parseCsvImport reads optional check column from arbitrary header position', () => {
    const rows = parseCsvImport([
      'Name,Check,Description,FilePath,Folder',
      'App entry,true,main module,src/app.ts,A/B',
      'util.ts,false,helper,src/lib/util.ts,'
    ].join('\n'));

    assert.deepStrictEqual(rows, [
      {
        folderPath: 'A/B',
        filePath: 'src/app.ts',
        name: 'App entry',
        description: 'main module',
        checked: true
      },
      {
        folderPath: undefined,
        filePath: 'src/lib/util.ts',
        name: 'util.ts',
        description: 'helper',
        checked: false
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
        description: 'note "quoted"',
        checked: undefined
      }
    ]);
  });

  test('prepareCsvExport flattens virtual folders and skips linked folders', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sidetree-csv-'));

    try {
      const mockManager = new MockSideTreeDataManager();
      const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

      const nestedFolder = await provider.addItemWithFolderId(0, 'Docs', true);
      await provider.addItemWithFolderId(0, 'top.ts', false, 'src/top.ts', undefined, undefined, undefined, 'top note');
      await provider.addItemWithFolderId(nestedFolder.itemId, 'feature,name.ts', false, 'src/feature.ts', undefined, undefined, undefined, 'memo "quoted"', true);
      await provider.addLinkedFolderWithFolderId(0, 'linked', tempRoot);

      const csv = provider.prepareCsvExport();

      assert.strictEqual(csv, [
        'Folder,FilePath,Name,Description,Check',
        'Docs,src/feature.ts,"feature,name.ts","memo ""quoted""",true',
        ',src/top.ts,top.ts,top note,false'
      ].join('\n'));
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('prepareCsvExportForItems flattens selected folders and files', async () => {
    const mockManager = new MockSideTreeDataManager();
    const provider = new MyTreeDataProvider(mockManager as unknown as SideTreeDataManager);

    const docs = await provider.addItemWithFolderId(0, 'Docs', true);
    await provider.addItemWithFolderId(docs.itemId, 'guide.ts', false, 'src/guide.ts', undefined, undefined, undefined, 'memo');
    const top = await provider.addItemWithFolderId(0, 'top.ts', false, 'src/top.ts', undefined, undefined, undefined, undefined, true);

    const csv = provider.prepareCsvExportForItems([docs, top]);

    assert.strictEqual(csv, [
      'Folder,FilePath,Name,Description,Check',
      'Docs,src/guide.ts,guide.ts,memo,false',
      ',src/top.ts,top.ts,,true'
    ].join('\n'));
  });
});
