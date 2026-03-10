import type { ResponseSpec } from "../contract/contract.js";
import type {
	MiddlewareBindings,
	MiddlewareHandler,
	MiddlewareHandlerTree,
} from "../server/server.js";
import type {
	ApiShape,
	EmptyObject,
	Expand,
	InferSchemaData,
	StatusMapToResponseUnion,
} from "../shared/shared.js";
import { isRecordObject } from "../shared/shared.js";

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

type MiddlewareSpecUnionAtNode<TNode> =
	MiddlewareMapAtNode<TNode>[keyof MiddlewareMapAtNode<TNode>];

type CollectMiddlewareSpecUnionAlongPath<TNode, TSegments extends Array<string>, TAcc = never> = [
	TNode,
] extends [never]
	? TAcc
	: TNode extends { SHAPE?: infer TShape extends Record<string, MiddlewareTree> }
		? TSegments extends [infer THead extends string, ...infer TTail extends Array<string>]
			? THead extends keyof TShape
				? CollectMiddlewareSpecUnionAlongPath<
						TShape[THead],
						TTail,
						TAcc | MiddlewareSpecUnionAtNode<TNode>
					>
				: TAcc | MiddlewareSpecUnionAtNode<TNode>
			: TAcc | MiddlewareSpecUnionAtNode<TNode>
		: TAcc | MiddlewareSpecUnionAtNode<TNode>;

export type MiddlewareSpecUnionAtPath<
	TMiddlewares,
	TPath extends string,
	TBase = never,
> = CollectMiddlewareSpecUnionAlongPath<TMiddlewares, PathSegments<TPath>, TBase>;

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
	TDefinition extends MiddlewareSpec ? StatusMapToResponseUnion<TDefinition> : never;

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
	TBase = never,
> = MiddlewareSpecUnionAtPath<TMiddlewares, TPath, TBase> extends infer TDefinition
	? TDefinition extends MiddlewareSpec
		? InferMiddlewareResponseUnion<TDefinition>
		: never
	: never;

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

export type MiddlewareLayer<TContext> = {
	name: string;
	definition: MiddlewareSpec;
	handler: MiddlewareHandler<MiddlewareSpec, TContext>;
};

export const collectMiddlewareLayers = <TContext>(
	middlewareNodes: Array<unknown>,
	handlerNodes: Array<unknown>,
): Array<MiddlewareLayer<TContext>> => {
	const layers: Array<MiddlewareLayer<TContext>> = [];

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
		for (const [middlewareName, candidateDefinition] of Object.entries(middlewareMap)) {
			const candidateHandler = handlerMap[middlewareName];
			if (!isRecordObject(candidateDefinition)) {
				throw new Error(`Missing middleware definition '${middlewareName}'`);
			}
			if (typeof candidateHandler !== "function") {
				throw new Error(`Missing middleware handler '${middlewareName}'`);
			}
			layers.push({
				name: middlewareName,
				definition: candidateDefinition as MiddlewareSpec,
				handler: candidateHandler as MiddlewareHandler<MiddlewareSpec, TContext>,
			});
		}
	}

	return layers;
};
