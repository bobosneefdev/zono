import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import z from "zod";
import { NestObjectConditional } from "../internal/types.js";
import { ZonoEndpoint, ZonoEndpointBodyOutput, ZonoEndpointHeaders } from "../shared/endpoint.js";

export class ZonoEndpointClient<
	T extends ZonoEndpoint = ZonoEndpoint,
	U extends ZonoEndpointClientOptions = ZonoEndpointClientOptions,
> {
	readonly endpoint: T;
	readonly opts: U;

	constructor(endpoint: T, options: U) {
		this.endpoint = endpoint;
		this.opts = options;
	}

	async parseCallOptsInput(
		callOpts: ZonoEndpointClientCallOptsInput<T, U>,
	): Promise<ZonoEndpointClientCallOptsOutput> {
		const url = await this.parseCallOptsInputUrl(callOpts);
		const body = await this.parseCallOptsInputBody(callOpts);
		const headers = await this.parseCallOptsInputHeaders(callOpts, body);
		return {
			url,
			body,
			headers,
		};
	}

	private async parseCallOptsInputUrl(
		callData: ZonoEndpointClientCallOptsInput<T, U>,
	): Promise<URL> {
		let urlStr = `${this.opts.baseUrl}${this.endpoint.path}`;
		if (this.endpoint.additionalPaths) {
			const parsed = await this.endpoint.additionalPaths.parseAsync(callData.additionalPaths);
			for (let i = 0; i < parsed.length; i++) {
				const path = parsed[i];
				urlStr += `/${path}`;
			}
		}

		const url = new URL(urlStr);
		if (this.endpoint.query) {
			const parsed = await this.endpoint.query.parseAsync(callData.query);
			for (const key in parsed) {
				const values = parsed[key];
				if (!values) continue;
				for (let i = 0; i < values.length; i++) {
					const value = values[i];
					url.searchParams.append(key, value);
				}
			}
		}

		// throw new Error(url.toString());

		return url;
	}

	private async parseCallOptsInputBody(callOpts: ZonoEndpointClientCallOptsInput<T, U>) {
		if (!this.endpoint.body) return undefined;
		return await this.endpoint.body.parseAsync(callOpts.body);
	}

	private async parseCallOptsInputHeaders(
		callOpts: ZonoEndpointClientCallOptsInput<T, U>,
		parsedBody: any,
	): Promise<Record<string, string>> {
		const result: Record<string, string> = parsedBody
			? { "Content-Type": "application/json" }
			: {};

		if (this.endpoint.headers) {
			const parsedHeaders = await this.endpoint.headers.parseAsync(callOpts.headers);
			for (const key in parsedHeaders) {
				const value = parsedHeaders[key as keyof typeof parsedHeaders];
				if (value === undefined) continue;
				result[key] = value;
			}
		}

		if (this.opts.middlewareHeaders) {
			const parsedMiddlewareHeaders = await this.opts.middlewareHeaders.parseAsync(
				callOpts.middlewareHeaders,
			);
			for (const key in parsedMiddlewareHeaders) {
				const value = parsedMiddlewareHeaders[key as keyof typeof parsedMiddlewareHeaders];
				if (value === undefined) continue;
				result[key] = value;
			}
		}

		return result;
	}

	async parseResponseData(data: any) {
		return await this.endpoint.response.safeParseAsync(data);
	}

	async fetch(
		callData: ZonoEndpointClientCallOptsInput<T, U>,
	): Promise<ZonoEndpointClientCallFetchOutput<T>> {
		const fetchConfig = await this.getFetchConfig(callData);
		const response = await fetch(...fetchConfig);
		if (!response.ok) {
			return {
				success: false,
				response,
			};
		}
		return await this.parseFetchResponse(response);
	}

	async getFetchConfig(
		callData: ZonoEndpointClientCallOptsInput<T, U>,
		opts?: ZonoEndpointClientFetchOpts,
	): Promise<[URL, RequestInit]> {
		const callOptsOutput = await this.parseCallOptsInput(callData);
		return [
			callOptsOutput.url,
			{
				...this.opts.defaultFetchConfig,
				...opts,
				method: this.endpoint.method,
				headers: callOptsOutput.headers,
				body: callOptsOutput.body ? JSON.stringify(callOptsOutput.body) : undefined,
			},
		];
	}

	async parseFetchResponse(response: Response): Promise<ZonoEndpointClientCallFetchOutput<T>> {
		const data = await response.json();
		const parsed = await this.parseResponseData(data);
		if (!parsed.success) {
			return {
				success: false,
				zodError: parsed.error,
				response,
			};
		}
		return {
			success: true,
			data: parsed.data as z.output<T["response"]>,
			response,
		};
	}

	async axios(
		callData: ZonoEndpointClientCallOptsInput<T, U>,
		additionalConfig?: ZonoEndpointClientAxiosOpts,
	): Promise<ZonoEndpointClientCallAxiosOutput<T>> {
		const config = await this.getAxiosConfig(callData, additionalConfig);
		const response = await axios(config);
		if (response.status < 200 || response.status >= 300) {
			return {
				success: false,
				response,
			};
		}
		return this.parseAxiosResponse(response);
	}

	async getAxiosConfig(
		callData: ZonoEndpointClientCallOptsInput<T, U>,
		opts?: ZonoEndpointClientAxiosOpts,
	): Promise<AxiosRequestConfig> {
		const callOptsOutput = await this.parseCallOptsInput(callData);
		return {
			...this.opts.defaultAxiosConfig,
			...opts,
			url: callOptsOutput.url.toString(),
			method: this.endpoint.method,
			data: callOptsOutput.body,
			headers: callOptsOutput.headers,
			validateStatus: () => true,
		};
	}

	async parseAxiosResponse(
		response: AxiosResponse<any>,
	): Promise<ZonoEndpointClientCallAxiosOutput<T>> {
		const parsed = await this.parseResponseData(response.data);
		if (!parsed.success) {
			return {
				success: false,
				response,
				zodError: parsed.error,
			};
		}
		return {
			success: true,
			response,
			data: parsed.data as z.output<T["response"]>,
		};
	}
}

export type ZonoEndpointClientOptions = {
	baseUrl: string;
	middlewareHeaders?: ZonoEndpointHeaders;
	defaultAxiosConfig?: ZonoEndpointClientAxiosOpts;
	defaultFetchConfig?: ZonoEndpointClientFetchOpts;
};

export type ZonoEndpointClientRecord = Record<string, ZonoEndpointClient>;

export type ZonoEndpointClientCallOptsInput<
	T extends ZonoEndpoint,
	U extends ZonoEndpointClientOptions,
> = NestObjectConditional<T["body"], z.ZodType, "body", z.input<T["body"]>> &
	NestObjectConditional<T["query"], z.ZodType, "query", z.input<T["query"]>> &
	NestObjectConditional<T["headers"], z.ZodType, "headers", z.input<T["headers"]>> &
	NestObjectConditional<
		T["additionalPaths"],
		z.ZodType,
		"additionalPaths",
		z.input<T["additionalPaths"]>
	> &
	NestObjectConditional<
		U["middlewareHeaders"],
		z.ZodType,
		"middlewareHeaders",
		z.input<U["middlewareHeaders"]>
	>;

export type ZonoEndpointClientCallOptsOutput = {
	url: URL;
	headers: Record<string, string>;
	body?: ZonoEndpointBodyOutput;
};

export type ZonoEndpointClientAxiosOpts = Omit<
	AxiosRequestConfig,
	"url" | "method" | "data" | "params" | "headers" | "transformRequest" | "transformResponse"
>;

export type ZonoEndpointClientFetchOpts = Omit<RequestInit, "method" | "headers" | "body">;

export type ZonoEndpointClientCallFetchOutput<T extends ZonoEndpoint> = (
	| {
			success: true;
			data: z.output<T["response"]>;
	  }
	| {
			success: false;
			zodError?: z.ZodError;
	  }
) & {
	response: Response;
};

export type ZonoEndpointClientCallAxiosOutput<T extends ZonoEndpoint> =
	| {
			success: true;
			response: AxiosResponse<z.input<T["response"]>>;
			data: z.output<T["response"]>;
	  }
	| {
			success: false;
			response: AxiosResponse<any>;
			zodError?: z.ZodError;
	  };
