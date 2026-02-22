import { ZonoContractOptions, ZonoContractPath, ZonoRouter } from "./types.js";

/**
 * Creates a Zono contract. This is effectively an identity function
 * that helps infer strictly typed definitions.
 */
export const createZonoContract = <
	TPath extends ZonoContractPath,
	TOptions extends ZonoContractOptions<TPath>,
>(
	path: TPath,
	options: TOptions,
): { path: TPath } & TOptions => {
	return Object.assign({ path }, options);
};

/**
 * Creates a Zono router from a nested map of routers and contracts.
 */
export const createZonoRouter = <T extends ZonoRouter>(router: T): T => {
	return router;
};
