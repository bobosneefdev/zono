import { Prettify } from "ts-essentials";
import z from "zod";
import { ZonoContractAny, ZonoRouter } from "~/contract.js";

export type PossiblePromise<T> = T | Promise<T>;

export type PossibleZodOptional<T extends z.ZodType> = T | z.ZodOptional<T>;

/**
 * If V is never, returns Partial<Record<K, undefined>>.
 * Otherwise, returns Record<K, V>
 */
export type ConditionalKeyInObject<K extends string | number | symbol, V> = [V] extends [never]
	? Partial<Record<K, undefined>>
	: Record<K, V>;

export type ZonoServerOptions = {
	port?: string | number;
	bind?: string;
};

export type ZonoServerHandlerInput<T extends ZonoContractAny> = {
	pathParams: T["pathParams"] extends z.ZodType ? z.infer<T["pathParams"]> : never;
	query: T["query"] extends z.ZodType ? z.infer<T["query"]> : never;
	body: T["body"] extends z.ZodType ? z.infer<T["body"]> : never;
	headers: T["headers"] extends z.ZodType ? z.infer<T["headers"]> : never;
};

export type ZonoServerHandlerOutput<TContract extends ZonoContractAny> = {
	[K in keyof TContract["responses"]]: Prettify<
		{
			status: K;
		} & (NonNullable<TContract["responses"][K]> extends { body?: infer TBody }
			? TBody extends z.ZodType
				? { data: z.infer<TBody> }
				: { data?: undefined }
			: { data?: undefined }) &
			(NonNullable<TContract["responses"][K]> extends { headers?: infer THeaders }
				? THeaders extends z.ZodType
					? { headers: z.infer<THeaders> }
					: { headers?: undefined }
				: { headers?: undefined })
	>;
}[keyof TContract["responses"]];

export type ZonoServerHandler<T extends ZonoContractAny, U extends [...Array<any>] = []> = (
	input: ZonoServerHandlerInput<T>,
	...args: U
) => PossiblePromise<ZonoServerHandlerOutput<T>>;

export type ZonoServerImplementation<T extends ZonoRouter, U extends [...Array<any>] = []> = {
	[K in keyof T]: T[K] extends ZonoContractAny
		? ZonoServerHandler<T[K], U>
		: T[K] extends ZonoRouter
			? ZonoServerImplementation<T[K], U>
			: never;
};
