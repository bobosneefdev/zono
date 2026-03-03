import type { ErrorMode } from "~/contract/contract.types.js";
import type { AdditionalHandlerParamsFn, HonoContextParams } from "~/hono/hono.types.js";

/** Input for a single service in the gateway */
export type GatewayServiceInput = {
	contracts: unknown;
	middlewares?: unknown;
};

/** Map of service names to their route/middleware definitions */
export type GatewayInput = Record<string, GatewayServiceInput>;

/**
 * Generated route structure for the gateway from service inputs.
 * @template T - The gateway input type
 */
export type GeneratedGatewayContracts<T extends GatewayInput> = {
	ROUTER: {
		[K in keyof T & string]: T[K]["contracts"];
	};
};

/**
 * Generated middleware structure for the gateway from service inputs.
 * @template T - The gateway input type
 */
export type GeneratedGatewayMiddlewares<T extends GatewayInput> = {
	ROUTER: {
		[K in keyof T & string]: T[K] extends { middleware: infer M } ? M : Record<never, never>;
	};
};

/**
 * Complete gateway structure with routes and middleware.
 * @template T - The gateway input type
 */
export type GeneratedGateway<T extends GatewayInput> = {
	contracts: GeneratedGatewayContracts<T>;
	middlewares: GeneratedGatewayMiddlewares<T>;
};

/**
 * Configuration options for creating a Hono gateway.
 * @template TRoutes - The routes type
 * @template TContextParams - Additional parameters extracted from context
 */
export type GatewayOptions<TRoutes, TContextParams extends HonoContextParams = []> = {
	additionalHandlerParams?: AdditionalHandlerParamsFn<TContextParams>;
	services: TRoutes extends { ROUTER: infer R extends Record<string, unknown> }
		? { [K in keyof R & string]: string }
		: Record<string, string>;
	errorMode?: ErrorMode;
	basePath?: string;
};
