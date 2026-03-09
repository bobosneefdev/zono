import type { Context } from "hono";
import type { ResponseSchema } from "../contract/contract.js";
import type {
	MiddlewareBindings,
	MiddlewareHandlerTree,
	RuntimeHandlerResponse,
} from "../server/server.js";
import { validateResponseAgainstStatusMap } from "../shared/shared.internal.js";
import type { ApiShape, InferSchemaData, StatusMapToResponseUnion } from "../shared/shared.js";
import { createSerializedResponse } from "../shared/shared.js";

declare const MIDDLEWARE_SHAPE_BRAND: unique symbol;

export type MiddlewareResponseSchema = ResponseSchema<"schema">;

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

export const runMiddlewareHandlers = async <
	TMiddlewares extends MiddlewareTreeFor<ApiShape>,
	TContext,
>(
	ctx: Context,
	ourContext: Awaited<TContext>,
	boundMiddlewares: MiddlewareBindings<TMiddlewares, TContext>,
	resolveTerminal: () => Promise<Response>,
): Promise<Response> => {
	const middlewareNames = Object.keys(boundMiddlewares.middlewares.MIDDLEWARE);

	const dispatch = async (index: number): Promise<Response> => {
		if (index >= middlewareNames.length) {
			return resolveTerminal();
		}

		const middlewareName = middlewareNames[index];
		const definition = boundMiddlewares.middlewares.MIDDLEWARE[middlewareName];
		const handler = boundMiddlewares.handlers.MIDDLEWARE[middlewareName];

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
			validateResponseAgainstStatusMap(definition, normalized, "Middleware");
			return createSerializedResponse({
				status: normalized.status,
				type: normalized.type,
				data: normalized.data,
				headers: normalized.headers,
				source: "middleware",
			});
		}

		if (nextResult) {
			return nextResult;
		}

		return resolveTerminal();
	};

	return dispatch(0);
};
