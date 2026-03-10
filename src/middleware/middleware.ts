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
	type EmptyObject,
	type Expand,
	type InferSchemaData,
	isRecordObject,
	type StatusMapToResponseUnion,
	validateAndSerializeResponse,
} from "../shared/shared.internal.js";

export type MiddlewareResponseSchema = ResponseSpec;

export type MiddlewareSpec = Record<number, MiddlewareResponseSchema>;

export type MiddlewareTree = {
	MIDDLEWARE?: Record<string, MiddlewareSpec>;
	SHAPE?: Record<string, MiddlewareTree>;
};

type MiddlewareTreeFromShape<TShape extends ApiShape> = {
	MIDDLEWARE?: Record<string, MiddlewareSpec>;
} & (TShape extends { SHAPE: infer TChildShape extends Record<string, ApiShape> }
	? {
			SHAPE?: {
				[TKey in keyof TChildShape]?: MiddlewareTreeFromShape<TChildShape[TKey]>;
			};
		}
	: EmptyObject);

export type MiddlewareTreeFor<TShape extends ApiShape> = Expand<MiddlewareTreeFromShape<TShape>>;

type SplitPath<TPath extends string> = TPath extends ""
	? []
	: TPath extends `${infer THead}/${infer TRest}`
		? [THead, ...SplitPath<TRest>]
		: [TPath];

type PathSegments<TPath extends string> = TPath extends `/${infer TTrimmed}`
	? SplitPath<TTrimmed>
	: SplitPath<TPath>;

export type MiddlewareMapAtNode<TNode> = TNode extends { MIDDLEWARE?: infer TDefinitions }
	? TDefinitions extends Record<string, MiddlewareSpec>
		? TDefinitions
		: EmptyObject
	: EmptyObject;

export type MergeMiddlewareMaps<
	TBase extends Record<string, MiddlewareSpec>,
	TNext extends Record<string, MiddlewareSpec>,
> = Omit<TBase, keyof TNext> & TNext;

export type MergeMiddlewareDefinitionsAlongPath<
	TNode,
	TSegments extends Array<string>,
	TAcc extends Record<string, MiddlewareSpec> = EmptyObject,
> = [TNode] extends [never]
	? TAcc
	: TNode extends { SHAPE?: infer TShape extends Record<string, MiddlewareTree> }
		? TSegments extends [infer THead extends string, ...infer TTail extends Array<string>]
			? THead extends keyof TShape
				? MergeMiddlewareDefinitionsAlongPath<
						TShape[THead],
						TTail,
						MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>
					>
				: MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>
			: MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>
		: MergeMiddlewareMaps<TAcc, MiddlewareMapAtNode<TNode>>;

export type MiddlewareDefinitionsAtPath<
	TMiddlewares,
	TPath extends string,
	TBase extends Record<string, MiddlewareSpec> = EmptyObject,
> = MergeMiddlewareDefinitionsAlongPath<TMiddlewares, PathSegments<TPath>, TBase>;

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

export type InferMiddlewareResponseUnionAtPath<
	TMiddlewares,
	TPath extends string,
	TBase extends Record<string, MiddlewareSpec> = EmptyObject,
> = InferAllMiddlewareResponseUnion<{
	MIDDLEWARE: MiddlewareDefinitionsAtPath<TMiddlewares, TPath, TBase>;
}>;

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

type ResolvedMiddlewareTree = {
	MIDDLEWARE: Record<string, MiddlewareSpec>;
};

export const resolveMiddlewareBindings = <TContext>(
	middlewareNodes: Array<unknown>,
	handlerNodes: Array<unknown>,
): MiddlewareBindings<ResolvedMiddlewareTree, TContext> | undefined => {
	if (middlewareNodes.length === 0) {
		return undefined;
	}

	const mergedDefinitions: Record<string, MiddlewareSpec> = {};
	const mergedHandlers: Record<string, MiddlewareHandler<MiddlewareSpec, TContext>> = {};

	for (let index = 0; index < middlewareNodes.length; index += 1) {
		const middlewareNode = middlewareNodes[index];
		const handlersNode = handlerNodes[index];
		if (!isRecordObject(middlewareNode) || !isRecordObject(middlewareNode.MIDDLEWARE)) {
			continue;
		}
		if (!isRecordObject(handlersNode) || !isRecordObject(handlersNode.MIDDLEWARE)) {
			throw new Error("Missing MIDDLEWARE handlers node for middleware layer");
		}

		const middlewareMap = middlewareNode.MIDDLEWARE as Record<string, unknown>;
		const handlerMap = handlersNode.MIDDLEWARE as Record<string, unknown>;
		for (const [middlewareName] of Object.entries(middlewareMap)) {
			const handler = handlerMap[middlewareName];
			if (typeof handler !== "function") {
				throw new Error(`Missing middleware handler '${middlewareName}'`);
			}

			Object.defineProperty(mergedDefinitions, middlewareName, {
				configurable: true,
				enumerable: true,
				get: () => {
					const currentDefinition = middlewareMap[middlewareName];
					if (!isRecordObject(currentDefinition)) {
						throw new Error(`Missing middleware definition '${middlewareName}'`);
					}
					return currentDefinition as MiddlewareSpec;
				},
			});
			Object.defineProperty(mergedHandlers, middlewareName, {
				configurable: true,
				enumerable: true,
				get: () => {
					const currentHandler = handlerMap[middlewareName];
					if (typeof currentHandler !== "function") {
						throw new Error(`Missing middleware handler '${middlewareName}'`);
					}
					return currentHandler as MiddlewareHandler<MiddlewareSpec, TContext>;
				},
			});
		}
	}

	if (Object.keys(mergedDefinitions).length === 0) {
		return undefined;
	}

	return {
		middlewares: { MIDDLEWARE: mergedDefinitions },
		handlers: {
			MIDDLEWARE: mergedHandlers,
		},
	};
};

type PreparedMiddlewareEntry<TContext> = {
	definition: MiddlewareSpec;
	handler: MiddlewareHandler<MiddlewareSpec, TContext>;
};

const middlewareEntryCache = new WeakMap<object, Array<PreparedMiddlewareEntry<unknown>>>();

const getPreparedMiddlewareEntries = <TMiddlewares extends ResolvedMiddlewareTree, TContext>(
	boundMiddlewares: MiddlewareBindings<TMiddlewares, TContext>,
): Array<PreparedMiddlewareEntry<TContext>> => {
	const cachedEntries = middlewareEntryCache.get(boundMiddlewares as object);
	if (cachedEntries) {
		return cachedEntries as Array<PreparedMiddlewareEntry<TContext>>;
	}

	const entries: Array<PreparedMiddlewareEntry<TContext>> = [];
	const handlers = boundMiddlewares.handlers as {
		MIDDLEWARE: Record<string, MiddlewareHandler<MiddlewareSpec, TContext>>;
	};
	for (const middlewareName of Object.keys(boundMiddlewares.middlewares.MIDDLEWARE)) {
		const definition = boundMiddlewares.middlewares.MIDDLEWARE[middlewareName];
		const handler = handlers.MIDDLEWARE[middlewareName];
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

export const runMiddlewareHandlers = async <TMiddlewares extends ResolvedMiddlewareTree, TContext>(
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
