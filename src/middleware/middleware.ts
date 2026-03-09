import type { Context } from "hono";
import type { ResponseSpec } from "../contract/contract.js";
import type {
	MiddlewareBindings,
	MiddlewareHandler,
	MiddlewareHandlerTree,
	RuntimeHandlerResponse,
} from "../server/server.js";
import {
	type ApiShape,
	type InferSchemaData,
	type StatusMapToResponseUnion,
	validateAndSerializeResponse,
} from "../shared/shared.internal.js";

declare const MIDDLEWARE_SHAPE_BRAND: unique symbol;

export type MiddlewareResponseSchema = ResponseSpec;

export type MiddlewareSpec = Record<number, MiddlewareResponseSchema>;

export type MiddlewareTree = {
	MIDDLEWARE?: Record<string, MiddlewareSpec>;
	SHAPE?: Record<string, MiddlewareTree>;
};

export type MiddlewareTreeFor<TShape extends ApiShape> = {
	MIDDLEWARE: Record<string, MiddlewareSpec>;
	readonly [MIDDLEWARE_SHAPE_BRAND]?: TShape;
} & MiddlewareTree;

export type MiddlewareName<TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> }> =
	keyof TMiddlewares["MIDDLEWARE"] & string;

export type MiddlewareStatusCodes<TDefinition extends MiddlewareSpec> = keyof TDefinition & number;

export type MiddlewareSchemaAtStatus<
	TDefinition extends MiddlewareSpec,
	TStatus extends MiddlewareStatusCodes<TDefinition>,
> = TDefinition[TStatus];

export type InferMiddlewareResponseData<TSchema extends MiddlewareResponseSchema> =
	InferSchemaData<TSchema>;

export type InferMiddlewareResponseUnion<TDefinition extends MiddlewareSpec> =
	StatusMapToResponseUnion<TDefinition>;

export type InferAllMiddlewareResponseUnion<
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareSpec> },
> = {
	[TName in keyof TMiddlewares["MIDDLEWARE"]]: InferMiddlewareResponseUnion<
		TMiddlewares["MIDDLEWARE"][TName]
	>;
}[keyof TMiddlewares["MIDDLEWARE"]];

export const createHonoMiddlewareHandlers = <
	const TMiddlewares extends MiddlewareTree,
	TContext = unknown,
>(
	middlewares: TMiddlewares,
	handlers: MiddlewareHandlerTree<TMiddlewares, TContext>,
): MiddlewareBindings<TMiddlewares, TContext> => {
	return {
		middlewares,
		handlers,
	};
};

type PreparedMiddlewareEntry<TContext> = {
	definition: MiddlewareSpec;
	handler: MiddlewareHandler<MiddlewareSpec, TContext>;
};

const middlewareEntryCache = new WeakMap<object, Array<PreparedMiddlewareEntry<unknown>>>();

const getPreparedMiddlewareEntries = <TMiddlewares extends MiddlewareTreeFor<ApiShape>, TContext>(
	boundMiddlewares: MiddlewareBindings<TMiddlewares, TContext>,
): Array<PreparedMiddlewareEntry<TContext>> => {
	const cachedEntries = middlewareEntryCache.get(boundMiddlewares as object);
	if (cachedEntries) {
		return cachedEntries as Array<PreparedMiddlewareEntry<TContext>>;
	}

	const entries: Array<PreparedMiddlewareEntry<TContext>> = [];
	for (const middlewareName of Object.keys(boundMiddlewares.middlewares.MIDDLEWARE)) {
		const definition = boundMiddlewares.middlewares.MIDDLEWARE[middlewareName];
		const handler = boundMiddlewares.handlers.MIDDLEWARE[middlewareName];
		entries.push({
			definition,
			handler: handler as MiddlewareHandler<MiddlewareSpec, TContext>,
		});
	}

	middlewareEntryCache.set(
		boundMiddlewares as object,
		entries as Array<PreparedMiddlewareEntry<unknown>>,
	);
	return entries;
};

export const runMiddlewareHandlers = async <
	TMiddlewares extends MiddlewareTreeFor<ApiShape>,
	TContext,
>(
	ctx: Context,
	ourContext: Awaited<TContext>,
	boundMiddlewares: MiddlewareBindings<TMiddlewares, TContext>,
	resolveTerminal: () => Promise<Response>,
): Promise<Response> => {
	const middlewareEntries = getPreparedMiddlewareEntries(boundMiddlewares);

	const dispatch = async (index: number): Promise<Response> => {
		if (index >= middlewareEntries.length) {
			return resolveTerminal();
		}

		const { definition, handler } = middlewareEntries[index];

		let nextResult: Response | undefined;
		const returned = await handler(
			ctx,
			async () => {
				nextResult = await dispatch(index + 1);
			},
			ourContext,
		);

		if (returned !== undefined) {
			const normalized: RuntimeHandlerResponse = {
				status: returned.status,
				type: returned.type,
				data: returned.data,
				headers: undefined,
			};
			return validateAndSerializeResponse(definition, normalized, "Middleware", "middleware");
		}

		if (nextResult) {
			return nextResult;
		}

		return resolveTerminal();
	};

	return dispatch(0);
};
