import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { MyTreeDataProvider, SerializedTreeNode } from '../MyTreeDataProvider';
import { SideTreeDataManager } from '../SideTreeDataManager';
import { convertToRelative } from '../convertToRelative';

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

    const folder = await provider.addItemWithFolderId(0, 'FolderA', true);
    const fileInFolder = await provider.addItemWithFolderId(folder.itemId, 'a.ts', false, 'a.ts');
    const rootFile = await provider.addItemWithFolderId(0, 'root.ts', false, 'root.ts');
    const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
    const savedBeforeRemove = mockManager.lastSavedJson;

    const beforeRemove = provider.prepareSerializableNode(0);
    assert.strictEqual(beforeRemove.length, 3);

    provider.removeItem(folder.itemId);

    const afterRemove = provider.prepareSerializableNode(0);
    assert.deepStrictEqual(afterRemove.map((x) => x.name), ['SideTree Folder', 'root.ts']);

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
    assert.deepStrictEqual(order, ['SideTree Folder', 'C.ts', 'A.ts', 'B.ts']);

    provider.sortItemInFolder(0);
    order = provider.prepareSerializableNode(0).map((x) => x.name);
    assert.deepStrictEqual(order, ['A.ts', 'B.ts', 'C.ts', 'SideTree Folder']);

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
});
