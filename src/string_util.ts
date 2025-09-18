export class Util {
    static typeSafeLowerCase<T extends string>(str: T) {
        return str.toLowerCase() as Lowercase<typeof str>;
    }

    static typeSafeObjectKeys<T extends Record<string, any>>(obj: T) {
        return Object.keys(obj) as (keyof T)[];
    }

    static typeSafeObjectValues<T extends Record<string, any>>(obj: T) {
        return Object.values(obj) as T[keyof T][];
    }

    static typeSafeObjectEntries<T extends Record<string, any>>(obj: T) {
        return Object.entries(obj) as [keyof T, T[keyof T]][];
    }
}