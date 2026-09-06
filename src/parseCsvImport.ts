import * as path from 'path';

export interface CsvImportItem {
	folderPath?: string;
	filePath: string;
	name: string;
	description?: string;
	checked?: boolean;
}

export function parseCsvImport(text: string): CsvImportItem[] {
	const items: CsvImportItem[] = [];
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	let headerMap: CsvHeaderMap | undefined;

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		const columns = parseCsvLine(line);
		const detectedHeaderMap = !headerMap ? getHeaderMap(columns) : undefined;
		if (detectedHeaderMap) {
			headerMap = detectedHeaderMap;
			continue;
		}

		const folderPath = getColumnValue(columns, 0)?.trim();
		const filePath = getColumnValue(columns, 1)?.trim();
		if (!filePath) {
			continue;
		}

		const label = getColumnValue(columns, 2)?.trim();
		const description = getColumnValue(columns, 3)?.trim();
		const checked = parseCheckedValue(getColumnValue(columns, 4));
		items.push({
			folderPath: folderPath || undefined,
			filePath,
			name: label || path.basename(filePath),
			description: description || undefined,
			checked
		});
	}

	return items;

	function getColumnValue(columns: string[], fallbackIndex: number): string | undefined {
		if (!headerMap) {
			return columns[fallbackIndex];
		}

		const index = headerMap[getHeaderKeyByFallbackIndex(fallbackIndex)];
		return typeof index === 'number' ? columns[index] : undefined;
	}
}

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				current += '"';
				i++;
				continue;
			}
			inQuotes = !inQuotes;
			continue;
		}

		if (ch === ',' && !inQuotes) {
			fields.push(current);
			current = '';
			continue;
		}

		current += ch;
	}

	fields.push(current);
	return fields;
}

type CsvHeaderKey = 'folderPath' | 'filePath' | 'name' | 'description' | 'checked';
type CsvHeaderMap = Partial<Record<CsvHeaderKey, number>>;

function getHeaderMap(columns: string[]): CsvHeaderMap | undefined {
	const map: CsvHeaderMap = {};

	for (let index = 0; index < columns.length; index++) {
		const headerKey = getHeaderKey(columns[index]);
		if (headerKey && typeof map[headerKey] === 'undefined') {
			map[headerKey] = index;
		}
	}

	if (typeof map.filePath !== 'number') {
		return undefined;
	}

	return map;
}

function getHeaderKey(value?: string): CsvHeaderKey | undefined {
	const normalize = (candidate?: string) => (candidate ?? '').trim().toLowerCase();
	const name = normalize(value);

	const folderNames = new Set(['folder', 'folderpath', 'folder path', 'フォルダ']);
	const filePathNames = new Set(['filepath', 'file path', 'path', 'relativepath', 'relative path', 'ファイルパス', '相対ファイルパス']);
	const nameNames = new Set(['name', 'label', '名前', 'ラベル']);
	const descriptionNames = new Set(['description', 'desc', 'note', '説明']);
	const checkedNames = new Set(['check', 'checked', 'ischecked', 'is checked', 'checkedstate', 'checked state', 'チェック']);

	if (folderNames.has(name)) {
		return 'folderPath';
	}

	if (filePathNames.has(name)) {
		return 'filePath';
	}

	if (nameNames.has(name)) {
		return 'name';
	}

	if (descriptionNames.has(name)) {
		return 'description';
	}

	if (checkedNames.has(name)) {
		return 'checked';
	}

	return undefined;
}

function getHeaderKeyByFallbackIndex(index: number): CsvHeaderKey {
	switch (index) {
		case 0:
			return 'folderPath';
		case 1:
			return 'filePath';
		case 2:
			return 'name';
		case 3:
			return 'description';
		default:
			return 'checked';
	}
}

function parseCheckedValue(value?: string): boolean | undefined {
	const normalized = (value ?? '').trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}

	if (['true', '1', 'yes', 'y', 'on', 'checked', 'check', 'x'].includes(normalized)) {
		return true;
	}

	if (['false', '0', 'no', 'n', 'off', 'unchecked'].includes(normalized)) {
		return false;
	}

	return undefined;
}
