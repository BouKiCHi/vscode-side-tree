# SideTree (English)

**SideTree** is a Visual Studio Code extension that displays files in your workspace in a dedicated tree view. It allows you to organize folders differently from the file system, enabling quick access to your files.

## Features

*   **Tree View**: Accessible from the Explorer or the sidebar. You can add project files via drag-and-drop or through the context menu.

## Usage

After installing the extension, the "SideTree" view will appear in the VS Code Activity Bar. Click its icon to open the tree view.

## Release Notes

Changes for this project are documented in the [CHANGELOG.md](CHANGELOG.md) file.

---

# SideTree (日本語)

# SideTree

**SideTree** は、ワークスペース内のファイルを専用のツリービューで表示し、ファイルシステムとは異なるフォルダ整理することで、素早く開くことができる Visual Studio Code 拡張機能です。

## 主な機能

*   **ツリービュー**: エクスプローラ、もしくはサイドバーからアクセスできます。プロジェクトのファイルをドラッグドロップ、またはコンテキストメニューにより追加できます。
*   **実フォルダ参照**: エクスプローラからディレクトリを追加すると、SideTree 内で再帰的に展開できる参照フォルダとして扱えます。
*   **JSON / CSV インポート・エクスポート**: SideTree の内容を JSON として保存し、追加インポートまたは置き換えインポートできます。CSV は `Folder,FilePath,Name,Description` 形式で入出力できます。
*   **CSV インポート**: ビュータイトルのアイコンから CSV を読み込み、選択中フォルダ配下に項目を一括追加できます。

## 使い方

拡張機能をインストールすると、VSCode のアクティビティバーに「SideTree」ビューが表示されます。そのアイコンをクリックしてツリービューを開いてください。

## 補足

*   実フォルダ参照 (`linkedFolder`) は展開時に内容を読み込み、セッション中はキャッシュされます。ディスク上の変更を反映したい場合は SideTree の再読み込みを行ってください。
*   `JSON ファイルを追加インポート` は選択中の仮想フォルダに追加します。ファイルや実フォルダ参照を選択している場合は、その親の仮想フォルダに追加されます。
*   `CSV ファイルを追加インポート` は `フォルダ,ファイルパス,名前,説明` の 4 列です。`フォルダ` は `A/B` のように `/` または `\` で階層指定でき、`名前` が空欄のときは `ファイルパス` のファイル名が使われます。

## リリースノート

このプロジェクトの変更点は [CHANGELOG.md](CHANGELOG.md) ファイルに記載されています。

---
