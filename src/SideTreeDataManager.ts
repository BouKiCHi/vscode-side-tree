import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import type { SerializedTreeNode } from './MyTreeDataProvider';
import { localize } from './localize';

// データマネージャー
export class SideTreeDataManager {
  private jsonFilename: string = 'sidetree.json';

  constructor(private context: vscode.ExtensionContext) {
    this.createBackupFolderIfNotExist();
  }

  // バックアップフォルダを作成
  createBackupFolderIfNotExist() {
    const backupFolder = this.getBackupFolder();
    if (!fs.existsSync(backupFolder)) {
      fs.mkdirSync(backupFolder, { recursive: true });
    }
  }

  // ワークスペースキー
  getWorkspaceKey(): string|undefined {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        return vscode.workspace.workspaceFolders[0].uri.toString();
    }
    return undefined;
  }

  // JSONデータ読み出し
  async loadData(): Promise<SerializedTreeNode[] | null> {
    if (!vscode.workspace.workspaceFolders) {
      return null;
    }

    const filePath = this.getJsonFilename();
    try {
      const data: unknown = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      if (!this.isSerializedTreeNodeArray(data)) {
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  // データを保存する
  async saveData(json: string) {
    const filePath = this.getJsonFilename();
    await fs.promises.writeFile(filePath, json, 'utf8');
    if (this.isStaleBackupData()) {
        const filePath = this.getBackupJsonFilename();
        await fs.promises.writeFile(filePath, json, 'utf8');
        this.updateBackupTimestamp();
    }
  }

  // バックアップのJSON名を取得、内容としてはworkspace名_yyyymmdd_hhmmss.jsonとなる
  getBackupJsonFilename(): string {
    if (!vscode.workspace.workspaceFolders) {
      return '';
    }
    const workspaceName = path.basename(vscode.workspace.workspaceFolders[0].uri.fsPath);
    const date = new Date();
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2);
    const day = ('0' + date.getDate()).slice(-2);
    const hours = ('0' + date.getHours()).slice(-2);
    const minutes = ('0' + date.getMinutes()).slice(-2);
    const seconds = ('0' + date.getSeconds()).slice(-2);
    const timestamp = `${year}${month}${day}_${hours}${minutes}${seconds}`;

    const fsPath = this.getBackupFolder();
    return path.join(fsPath, `${workspaceName}_${timestamp}.json`);
  }

  // バックアップフォルダ
  getBackupFolder(): string {
    const fsPath = this.context.globalStorageUri.fsPath;
    return fsPath;
  }

  // バックアップデータが古いか？
  isStaleBackupData(): boolean {
    const key = this.getWorkspaceKey();
    const lastmod = this.context.globalState.get(key + 'last-modified', 0);
    // 現在のタイムスタンプとlastmodを比較、2時間以上経過している場合はtrue
    const now = Date.now();
    const diff = now - lastmod;
    const twoHours = 2 * 60 * 60 * 1000; // 2時間（ミリ秒）
    if (diff < twoHours) {
      return false;
    }

    return true;
  }

  // バックアップデータを更新したことをglobalStateに書き込む
  updateBackupTimestamp() {
    const key = this.getWorkspaceKey();
    const now = Date.now();
    this.context.globalState.update(key + 'last-modified', now);
  }

  // 最初の書き込みを確認
  async checkFirstWrite(): Promise<boolean> {
    const filePath = this.getJsonFilename();
    const dirPath = path.dirname(filePath);
    await fs.promises.mkdir(dirPath, { recursive: true });

    // ファイルが存在しない
    if (!fs.existsSync(filePath)) {
      // ダイアログで確認する、No/Cancelの場合は保存しない
      const answer = await vscode.window.showInformationMessage(
        localize('sideTree.confirm.saveCurrentData', 'Do you want to save current data?'),
        { modal: true },
        localize('sideTree.answer.yes', 'Yes'),
        localize('sideTree.answer.no', 'No')
      );

      if (answer !== localize('sideTree.answer.yes', 'Yes')) {
        return false;
      }
    }
    return true;
  }

  // JSONファイル名
  getJsonFilename(): string {
    if (!vscode.workspace.workspaceFolders) {
      return '';
    }
    return path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, '.vscode', this.jsonFilename);
  }

  private isSerializedTreeNodeArray(value: unknown): value is SerializedTreeNode[] {
    if (!Array.isArray(value)) {
      return false;
    }

    return value.every((node) => this.isSerializedTreeNode(node));
  }

  private isSerializedTreeNode(value: unknown): value is SerializedTreeNode {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (typeof candidate.name !== 'string') {
      return false;
    }

    if (typeof candidate.isFolder !== 'boolean') {
      return false;
    }

    if (!(typeof candidate.filePath === 'undefined' || typeof candidate.filePath === 'string')) {
      return false;
    }

    if (!(typeof candidate.line === 'undefined' || typeof candidate.line === 'number')) {
      return false;
    }

    if (!(typeof candidate.column === 'undefined' || typeof candidate.column === 'number')) {
      return false;
    }

    if (!(typeof candidate.symbolPath === 'undefined' || typeof candidate.symbolPath === 'string')) {
      return false;
    }

    if (!Array.isArray(candidate.children)) {
      return false;
    }

    return candidate.children.every((child) => this.isSerializedTreeNode(child));
  }
}
