import superjson from "superjson";
import type {
	ClientRequestData,
	ContractCallRoutes,
	ContractTree,
	ContractTreeFor,
	HTTPMethod,
} from "../contract/contract.js";
import type { MiddlewareSpec, MiddlewareTreeFor } from "../middleware/middleware.js";
import type { ErrorMode } from "../server/server.js";
import type { MapFetchRouteResponse } from "../shared/shared.internal.js";
import { toPathParamsRecord, toRequestParts } from "../shared/shared.internal.js";
import {
	type ApiShape,
	interpolatePathTemplate,
	parseSerializedResponse,
	type TypedFetch,
	ZONO_HEADER_DATA_HEADER,
	ZONO_QUERY_DATA_KEY,
} from "../shared/shared.js";

type ClientFetchRoutes<
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> = ContractCallRoutes<TContracts> extends infer TRoute
	? TRoute extends {
			path: infer _TPath extends string;
			method: infer _TMethod extends HTTPMethod;
			request: infer _TRequest;
			response: infer _TResponse;
		}
		? MapFetchRouteResponse<
				TRoute,
				| import("../middleware/middleware.js").InferAllMiddlewareResponseUnion<TMiddlewares>
				| import("../server/server.js").ErrorResponse<TErrorMode>
			>
		: never
	: never;

export type ClientFetchMethod<
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> = TypedFetch<ClientFetchRoutes<TContracts, TMiddlewares, TErrorMode>>;

export type Client<
	TContracts extends ContractTree,
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
	TErrorMode extends ErrorMode,
> = {
	fetch: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode>;
};

const buildRequest = (
	baseUrl: string,
	path: string,
	method: HTTPMethod,
	data?: ClientRequestData<import("../contract/contract.js").ContractMethod>,
): { url: URL; init: RequestInit } => {
	const requestParts = toRequestParts(data);
	const resolvedPath = interpolatePathTemplate(
		path,
		toPathParamsRecord(requestParts?.pathParams),
	);
	const url = new URL(resolvedPath, baseUrl);
	const headers = new Headers();

	if (requestParts?.query !== undefined) {
		const query = requestParts.query as { type: string; data: unknown };
		if (query.type === "Standard") {
			const queryData = query.data as Record<string, string | undefined>;
			for (const [key, value] of Object.entries(queryData)) {
				if (value === undefined) {
					continue;
				}
				url.searchParams.set(key, value);
			}
		} else if (query.data !== undefined) {
			url.searchParams.set(
				ZONO_QUERY_DATA_KEY,
				query.type === "SuperJSON"
					? superjson.stringify(query.data)
					: JSON.stringify(query.data),
			);
		}
	}

	if (requestParts?.headers !== undefined) {
		const requestHeaders = requestParts.headers as { type: string; data: unknown };
		if (requestHeaders.type === "Standard") {
			const headerData = requestHeaders.data as Record<string, string | undefined>;
			for (const [key, value] of Object.entries(headerData)) {
				if (value === undefined) {
					continue;
				}
				headers.set(key, value);
			}
		} else if (requestHeaders.data !== undefined) {
			headers.set(
				ZONO_HEADER_DATA_HEADER,
				requestHeaders.type === "SuperJSON"
					? superjson.stringify(requestHeaders.data)
					: JSON.stringify(requestHeaders.data),
			);
		}
	}

	const init: RequestInit = {
		method: method.toUpperCase(),
		headers,
	};

	if (requestParts?.body !== undefined) {
		const body = requestParts.body as { type: string; data: unknown };
		switch (body.type) {
			case "FormData":
			case "Blob":
			case "Text":
				init.body = body.data as FormData | Blob | string;
				break;
			case "URLSearchParams":
				headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
				init.body = (body.data as URLSearchParams).toString();
				break;
			case "SuperJSON":
				headers.set("content-type", "application/json");
				init.body = superjson.stringify(body.data);
				break;
			case "JSON":
				headers.set("content-type", "application/json");
				init.body = JSON.stringify(body.data);
				break;
		}
	}

	return { url, init };
};

export const createClient = <
	TShape extends ApiShape,
	TContracts extends ContractTreeFor<TShape> & ContractTree,
	TMiddlewares extends MiddlewareTreeFor<TShape>,
	TErrorMode extends ErrorMode,
>(
	baseUrl: string,
): Client<TContracts, TMiddlewares, TErrorMode> => {
	const fetchMethod: ClientFetchMethod<TContracts, TMiddlewares, TErrorMode> = async (
		path,
		method,
		data,
	) => {
		const request = buildRequest(baseUrl, path, method, data);
		const response = await fetch(request.url, request.init);
		const responseCopy = response.clone();
		const parsed = await parseSerializedResponse(response);
		return {
			status: response.status,
			response: responseCopy,
			data: parsed.data,
		} as Awaited<ReturnType<typeof fetchMethod>>;
	};

	return {
		fetch: fetchMethod,
	};
};
