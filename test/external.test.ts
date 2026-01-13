import z from "zod";
import { createZonoEndpointClientSuite } from "../src/client/endpoint_client_suite.js";
import { ZonoEndpointRecord } from "../src/shared/endpoint.js";

const BASE_URL = "https://api.chucknorris.io/jokes";

enum ChuckNorrisJokeCategory {
	ANIMAL = "animal",
	CAREER = "career",
	CELEBRITY = "celebrity",
	DEV = "dev",
	EXPLICIT = "explicit",
	FASHION = "fashion",
	FOOD = "food",
	HISTORY = "history",
	MONEY = "money",
	MOVIE = "movie",
	MUSIC = "music",
	POLITICAL = "political",
	RELIGION = "religion",
	SCIENCE = "science",
	SPORT = "sport",
	TRAVEL = "travel",
}

const zChuckNorrisJoke = z.object({
	id: z.string(),
	created_at: z.coerce.date(),
	updated_at: z.coerce.date(),
	icon_url: z.url(),
	url: z.url(),
	value: z.string(),
	categories: z.array(z.enum(ChuckNorrisJokeCategory)).optional(),
});

const CHUCK_NORRIS_API = {
	search: {
		method: "get",
		path: "/search",
		response: z.object({
			total: z.number(),
			result: z.array(zChuckNorrisJoke),
		}),
		query: z.object({
			query: z.tuple([z.string()]),
		}),
	},
	random: {
		method: "get",
		path: "/random",
		response: zChuckNorrisJoke,
		query: z.object({
			category: z.tuple([z.enum(ChuckNorrisJokeCategory)]).optional(),
		}),
	},
} as const satisfies ZonoEndpointRecord;

const CHUCK_NORRIS_CLIENT = createZonoEndpointClientSuite(CHUCK_NORRIS_API, { baseUrl: BASE_URL });

describe("External API Client", () => {
	it("search endpoint", async () => {
		const response = await CHUCK_NORRIS_CLIENT.search.fetch({
			query: {
				query: ["bung"],
			},
		});
		if (response.success) {
			expect(response.data.result.length).toBeGreaterThan(0);
		} else {
			console.error(response);
		}
		expect(response.success).toBe(true);
	});

	it("random endpoint", async () => {
		const response = await CHUCK_NORRIS_CLIENT.random.axios({
			query: {
				category: [ChuckNorrisJokeCategory.ANIMAL],
			},
		});
		if (response.success) {
			expect(response.data.categories).toContain(ChuckNorrisJokeCategory.ANIMAL);
		} else {
			console.error(response);
		}
		expect(response.success).toBe(true);
	});
});
