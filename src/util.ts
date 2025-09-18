export function typeSafeObjectEntries<T extends Record<string, any>>(obj: T) {
    return Object.entries(obj) as [keyof T, T[keyof T]][];
}