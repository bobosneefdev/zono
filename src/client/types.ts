import z from "zod";
import { ZonoContractAny, ZonoRouter } from "~/contract/types.js";

export type ZonoClientConfig = {
	baseUrl: string;
	defaultHeaders?: ZonoClientConfigDefaultHeaders;
	/** @default false */
	ignoreInputValidation?: true;
	/** @default false */
	ignoreOutputValidation?: true;
};

export type ZonoClientConfigDefaultHeaders = Record<string, ZonoClientConfigDefaultHeaderValue>;

export type ZonoClientConfigDefaultHeaderValue = string | (() => string) | (() => Promise<string>);

// Intermediate helper: maps each contract input field to its inferred type or `never`
type ContractInputFields<T extends ZonoContractAny> = {
	pathParams: T["pathParams"] extends z.ZodType ? z.infer<T["pathParams"]> : never;
	query: T["query"] extends z.ZodType ? z.infer<T["query"]> : never;
	body: T["body"] extends z.ZodType ? z.infer<T["body"]> : never;
	headers: T["headers"] extends z.ZodType ? z.infer<T["headers"]> : never;
};

// Drops keys whose value is `never`, leaving only the fields that actually exist on the contract
type FilterNever<T> = {
	[K in keyof T as [T[K]] extends [never] ? never : K]?: T[K];
};

/**
 * The args object for a client endpoint call.
 * Only includes keys that the contract actually defines (pathParams, query, body, headers).
 * When a contract has no inputs at all, this resolves to `{}` so the endpoint can be called
 * without any argument (see ZonoClientEndpoint below).
 */
export type ZonoClientEndpointArgs<T extends ZonoContractAny> = FilterNever<ContractInputFields<T>>;

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

export type ZonoClientEndpoint<T extends ZonoContractAny> = (
	args: keyof ZonoClientEndpointArgs<T> extends never ? void : ZonoClientEndpointArgs<T>,
) => Promise<ZonoClientEndpointResponse<T>>;

export type ZonoClient<T extends ZonoRouter> = {
	[K in keyof T]: T[K] extends ZonoContractAny
		? ZonoClientEndpoint<T[K]>
		: T[K] extends ZonoRouter
			? ZonoClient<T[K]>
			: never;
};
