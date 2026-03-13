import * as path from 'path';

export interface CsvImportItem {
	folderPath?: string;
	filePath: string;
	name: string;
	description?: string;
}

export function parseCsvImport(text: string): CsvImportItem[] {
	const items: CsvImportItem[] = [];
	const lines = text.replace(/\r\n/g, '\n').split('\n');

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		const columns = parseCsvLine(line);
		if (isHeaderRow(columns)) {
			continue;
		}

		const folderPath = columns[0]?.trim();
		const filePath = columns[1]?.trim();
		if (!filePath) {
			continue;
		}

		const label = columns[2]?.trim();
		const description = columns[3]?.trim();
		items.push({
			folderPath: folderPath || undefined,
			filePath,
			name: label || path.basename(filePath),
			description: description || undefined
		});
	}

	return items;
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

function isHeaderRow(columns: string[]): boolean {
	const normalize = (value?: string) => (value ?? '').trim().toLowerCase();
	const first = normalize(columns[0]);
	const second = normalize(columns[1]);
	const third = normalize(columns[2]);
	const fourth = normalize(columns[3]);

	const folderNames = new Set(['folder', 'folderpath', 'folder path', 'フォルダ']);
	const filePathNames = new Set(['filepath', 'file path', 'path', 'relativepath', 'relative path', 'ファイルパス', '相対ファイルパス']);
	const nameNames = new Set(['name', 'label', '名前', 'ラベル']);
	const descriptionNames = new Set(['description', 'desc', 'note', '説明']);

	return folderNames.has(first) && filePathNames.has(second) && nameNames.has(third) && descriptionNames.has(fourth);
}
