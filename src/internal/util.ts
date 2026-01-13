export function typedObjectEntries<T extends Record<string, any>>(obj: T) {
	return Object.entries(obj) as Array<[keyof T & string, T[keyof T]]>;
}

export function typedPick<T extends Record<string, any>, K extends keyof T>(
	obj: T,
	keys: Array<K>,
) {
	const result = {} as Pick<T, K>;
	for (const key of keys) {
		result[key] = obj[key];
	}
	return result;
}
