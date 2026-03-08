import type { Context } from "hono";
import { getRuntimeResponseSchemaParser } from "../contract/contract.js";
import type { BoundMiddlewareHandlers, RuntimeHandlerResponse } from "../server/server.types.js";
import { createSerializedResponse } from "../shared/shared.js";
import type {
	MiddlewareDefinition,
	MiddlewareResponseSchema,
	Middlewares,
} from "./middleware.types.js";

const getMiddlewareSchemaAtStatus = (
	definition: MiddlewareDefinition,
	status: number,
): MiddlewareResponseSchema | undefined => {
	return definition[status];
};

const validateMiddlewareResponse = (
	definition: MiddlewareDefinition,
	response: RuntimeHandlerResponse,
): void => {
	const schema = getMiddlewareSchemaAtStatus(definition, response.status);
	if (!schema) {
		throw new Error(`Middleware returned undeclared status: ${response.status}`);
	}
	if (schema.type !== response.type) {
		throw new Error(
			`Middleware returned mismatched response type. Expected ${schema.type}, received ${response.type}`,
		);
	}
	const parser = getRuntimeResponseSchemaParser(schema);
	if (!parser) {
		return;
	}
	const parseResult = parser.safeParse(response.data);
	if (!parseResult.success) {
		throw new Error("Middleware response data validation failed");
	}
};

export const createHonoMiddlewareHandlers = <
	TMiddlewares extends { MIDDLEWARE: Record<string, MiddlewareDefinition> },
	TContext = unknown,
>(
	middlewares: TMiddlewares,
	handlers: BoundMiddlewareHandlers<TMiddlewares, TContext>["handlers"],
): BoundMiddlewareHandlers<TMiddlewares, TContext> => {
	return {
		middlewares,
		handlers,
	};
};

export const runMiddlewareHandlers = async <
	TMiddlewares extends Middlewares<import("../shared/shared.types.js").Shape>,
	TContext,
>(
	ctx: Context,
	ourContext: Awaited<TContext>,
	boundMiddlewares: BoundMiddlewareHandlers<TMiddlewares, TContext>,
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
			validateMiddlewareResponse(definition, normalized);
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
