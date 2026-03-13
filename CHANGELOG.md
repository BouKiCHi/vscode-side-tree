# Change Log

## 0.2.2
- Added Explorer multi-select support so multiple selected files can be added to SideTree in one action.
- Added a view-title CSV import action for appending items into the selected location using `Folder,FilePath,Name,Description` rows.
- CSV import now creates nested virtual folders from the `Folder` column and falls back to the file name when `Name` is empty.
- Added a `Copy Relative Path` context-menu command under `Copy Path`.


## 0.2.1
- Added item description support with context-menu editing and inline display in the tree view.
- Added context-menu commands to open selected items, move selected items to the top while preserving order, and copy selected items as JSON.
- Added clipboard JSON import into the selected location in the tree, with safeguards against importing into linked-folder transient children.

## 0.2.0
- Added `linkedFolder` support so directories added from Explorer can be expanded recursively inside SideTree.
- Added context menu commands to open items to the side and reveal them in Explorer.
- Added JSON import commands for appending into the selected folder and replacing current SideTree data.
- Linked folders cache their children for the current session; changes on disk may require reloading SideTree to refresh.
- `Import JSON File` appends into the current target folder determined by the current selection. If a file or linked folder is selected, items are imported into its parent virtual folder.

## 0.1.8
- Added localization infrastructure using `package.nls.json` / `package.nls.ja.json` and a shared `localize(...)` helper for runtime messages.
- Localized extension contributions and UI messages for English/Japanese.
- Added editor context commands to copy `Name:Line` and `RelativePath:Line` from the current line to clipboard.
- Adjusted editor context menu ordering for symbol-related commands.
- Updated symbol item labels added to SideTree to use `Name:Line` format.
- Improved relative path conversion to resolve against the correct workspace folder in multi-root workspaces.

## 0.1.7
- Updated symbol label generation to resolve names from shallow-to-deep symbols and compose labels as `Class.Method.String` when available.
- Unified label-building behavior between `DocumentSymbol` and `SymbolInformation` providers.
- Fixed symbol provider type detection to prefer `DocumentSymbol` handling when `children` are present.
- Updated symbol item display and menu labels to include line information (e.g. `Name:42`, `Name (L42)`).
- Improved search list labels to show symbol path and line for symbol-based items.

## 0.1.6
- Added `Add Class.Method to SideTree` command in editor context menus.
- Added support for storing symbol metadata (`line`, `column`, `symbolPath`) in SideTree items.
- Updated item click behavior to open files at the stored line/column when available.
- Improved C# symbol extraction fallback so entries inside methods resolve to `Class.Method` (e.g. `Program.Main`) instead of call-site symbols.

## 0.1.5
- Improved type safety and data validation in tree/data management modules.
- Hardened remove/move behavior to reduce inconsistent states and runtime errors.
- Refactored duplicated selection/folder-resolution logic in extension commands.
- Stabilized drag-and-drop item addition by awaiting async operations.
- Improved relative path conversion to avoid incorrect workspace prefix matches.
- Added regression tests for add/remove consistency, move/sort behavior, and path conversion.

## 0.1.4
- Added a feature to open a folder in the VS Code explorer when clicked.


## 0.1.3
- Added sort functionality.
- Added backup functionality.
- Added move to parent folder functionality.
- Added "Save As" (export JSON) functionality.
- Added "Fold All" functionality.

## 0.1.2
- Improved path separator handling.
- Fixed an issue where a newline character was inserted during drop.
- Improved information display when adding or deleting items.

## 0.1.1
- Items selected from search results now also open in a new tab.
- Added the ability to move items up and down.
- Now prompts to save data on the first save.

## 0.1.0
- Added search functionality
- Refactored source code

## 0.0.5
- Fixed an issue where dropping a folder onto itself would cause it to disappear.
- Removed the display of rename information.
- Implemented a dialog to appear during import.
- Moved the import functionality from the navigation to the right-click context menu.
- Added functionality to create a folder when right-clicking on a tree item.
- Implemented the ability to copy the path via the right-click context menu.
- Changed the behavior when opening a document.

## 0.0.4
- Behavior adjustments

## 0.0.3
- Various fixes and improvements

## 0.0.2
- Ensured no spaces in the name "SideTree" (to avoid issues with searching, etc.).
- Implemented support for deleting multiple items.
- Fixed an issue causing errors during folder creation.
- In the menu items, changed "Remove Item" to "Remove" and "Rename" to "Change Label".
- Changed the saved data file from mydata.json to sidetree.json. (We apologize for the inconvenience, but please - change this manually.)
- Modified item addition to convert backslashes to forward slashes.
- Added a reload function.
- Implemented import functionality via pasteboard (imports from the clipboard to the current folder).

## 0.0.1
- Initial release
