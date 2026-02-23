import { Prettify } from "ts-essentials";
import z from "zod";
import { ZonoContractAny, ZonoRouter } from "~/contract/types.js";
import { FilterNever } from "~/shared.js";

export type ZonoClientConfig = {
	baseUrl: string;
	defaultHeaders?: ZonoClientConfigDefaultHeaders;
	/** @default false */
	ignoreInputValidation?: boolean;
	/** @default false */
	ignoreOutputValidation?: boolean;
};

export type ZonoClientConfigDefaultHeaders = Record<string, ZonoClientConfigDefaultHeaderValue>;

export type ZonoClientConfigDefaultHeaderValue = string | (() => string) | (() => Promise<string>);

export type ZonoClientContractCallOptions<T extends ZonoContractAny> = FilterNever<{
	pathParams: T["pathParams"] extends z.ZodType ? z.infer<T["pathParams"]> : never;
	query: T["query"] extends z.ZodType ? z.infer<T["query"]> : never;
	body: T["body"] extends z.ZodType ? z.infer<T["body"]> : never;
	headers: T["headers"] extends z.ZodType ? z.infer<T["headers"]> : never;
}>;

type ZonoClientContractCallArgs<T extends ZonoContractAny> = keyof ZonoClientContractCallOptions<T> extends never
	? []
	: [opts: ZonoClientContractCallOptions<T>];

export type ZonoClientEndpointResponse<TContract extends ZonoContractAny> = {
	[K in keyof TContract["responses"]]: {
		status: Extract<K, number>;
		data: TContract["responses"][K] extends { body: z.ZodType }
			? z.infer<TContract["responses"][K]["body"]>
			: undefined;
		headers: TContract["responses"][K] extends { headers: z.ZodType }
			? z.infer<TContract["responses"][K]["headers"]>
			: undefined;
	};
}[keyof TContract["responses"]];

export type ZonoClientEndpoint<T extends ZonoContractAny> = Prettify<(...args: ZonoClientContractCallArgs<T>) => Promise<ZonoClientEndpointResponse<T>>>;

export type ZonoClient<T extends ZonoRouter> = {
	[K in keyof T]: T[K] extends ZonoContractAny
		? ZonoClientEndpoint<T[K]>
		: T[K] extends ZonoRouter
			? ZonoClient<T[K]>
			: never;
};
