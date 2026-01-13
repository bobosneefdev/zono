export type PathString = `/${string}`;

export type OptionalPromise<T> = T | Promise<T>;

export type IsKeylessObject<T extends Record<string, any>> = keyof T extends never ? true : false;

export type NestObjectOptionalIfKeyless<
	T extends Record<string, any>,
	K extends string,
> = IsKeylessObject<T> extends true ? { [P in K]?: T } : { [P in K]: T };

export type AllKeysAreOptional<T extends Record<string, any>> = {
	[K in keyof T]?: T[K];
} extends T
	? true
	: false;

export type ExtractTypeFromArray<T extends Array<any>> = T extends Array<infer U> ? U : never;

export type NestObjectConditional<T, U, K extends string, V> = [T] extends [never]
	? { [P in K]?: undefined }
	: T extends U
		? { [P in K]: V }
		: { [P in K]?: undefined };

export type AreTypesEqual<A, B> = A extends B ? (B extends A ? true : false) : false;

export type LowercaseRecord<V> = Record<Lowercase<`${string}`>, V>;
