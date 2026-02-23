import z from "zod";
import { ZonoContractAny } from "~/contract.js";
import { RequestEvent, RequestHandler } from "@sveltejs/kit";
import { ZonoServerHandler } from "~/shared.js";

export function createSvelteKitServerFn<T extends ZonoContractAny>(
	contract: T,
	handler: ZonoServerHandler<T, [RequestEvent]>,
): RequestHandler {
	return async (event) => {
		let pathParams: any;
		let query: any;
		let body: any;
		let headers: any;

		try {
			if (contract.pathParams) {
				pathParams = contract.pathParams.parse(event.params);
			}

			if (contract.query) {
				const queryData: Record<string, string | Array<string>> = {};
				for (const key of event.url.searchParams.keys()) {
					const values = event.url.searchParams.getAll(key);
					queryData[key] = values.length === 1 ? values[0] : values;
				}
				query = contract.query.parse(queryData);
			}

			if (contract.headers) {
				const headerData: Record<string, string> = {};
				for (const [key, value] of event.request.headers.entries()) {
					headerData[key] = value;
				}
				headers = contract.headers.parse(headerData);
			}

			if (contract.body) {
				const contentType = event.request.headers.get("content-type") || "";
				if (contentType.includes("application/json")) {
					body = contract.body.parse(await event.request.json());
				} else if (
					contentType.includes("multipart/form-data") ||
					contentType.includes("application/x-www-form-urlencoded")
				) {
					const formData = await event.request.formData();
					const obj: Record<string, any> = {};
					for (const [key, value] of formData.entries()) {
						obj[key] = value;
					}
					body = contract.body.parse(obj);
				} else {
					body = contract.body.parse(await event.request.text());
				}
			}

			const response = await handler({ pathParams, query, body, headers }, event);
			const status = response.status as keyof typeof contract.responses;

			const responseSpec = contract.responses[status];
			if (!responseSpec) {
				return new Response(JSON.stringify({ error: `Invalid response status: ${String(status)}` }), { status: 500, headers: { "Content-Type": "application/json" } });
			}

			let resBody: any = response.data;
			if (responseSpec.body) {
				resBody = responseSpec.body.parse(resBody);
			}

			const resHeaders = new Headers();
			if (response.headers) {
				let rawHeaders: Partial<Record<string, string>> = response.headers;
				if (responseSpec.headers) {
					rawHeaders = responseSpec.headers.parse(rawHeaders);
				}
				for (const [k, v] of Object.entries(rawHeaders)) {
					resHeaders.set(k, String(v));
				}
			}

			if (resBody !== null && typeof resBody === "object") {
				resHeaders.set("Content-Type", "application/json");
				return new Response(JSON.stringify(resBody), { status: Number(status), headers: resHeaders });
			}
			if (resBody !== undefined) {
				if (!resHeaders.has("Content-Type")) {
					resHeaders.set("Content-Type", "text/plain");
				}
				return new Response(String(resBody), { status: Number(status), headers: resHeaders });
			}

			return new Response(null, { status: Number(status), headers: resHeaders });
		} catch (err: any) {
			if (err instanceof z.ZodError) {
				return new Response(JSON.stringify({ error: err.issues }), { status: 400, headers: { "Content-Type": "application/json" } });
			}
			console.error("Zono Server Handler Error:", err);
			return new Response(null, { status: 500 });
		}
	}
}