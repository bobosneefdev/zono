import z from "zod";
import { ZonoSocketClient } from "../src/client/socket_client.js";
import { ZonoHttpServer } from "../src/server/http_server.js";
import { ZonoSocketServer } from "../src/server/socket_server.js";
import { ZonoEndpointRecord } from "../src/shared/endpoint.js";
import { ZonoSocket } from "../src/shared/socket.js";

const PORT = 3001;

const SOCKET_DEFINITION = {
	serverEvents: {
		message: z.object({
			content: z.string(),
			timestamp: z.number(),
		}),
		notification: z.object({
			type: z.enum(["info", "warning", "error"]),
			text: z.string(),
		}),
	},
	clientEvents: {
		sendMessage: z.object({
			content: z.string(),
		}),
		ping: z.object({
			id: z.string(),
		}),
	},
} as const satisfies ZonoSocket;

const ENDPOINTS = {} as const satisfies ZonoEndpointRecord;

const SOCKET_SERVER = new ZonoSocketServer(SOCKET_DEFINITION, {
	handlers: {
		sendMessage: (data) => {
			SOCKET_SERVER.emit("message", {
				content: data.content,
				timestamp: Date.now(),
			});
		},
		ping: (data) => {
			SOCKET_SERVER.emit("notification", {
				type: "info",
				text: `pong: ${data.id}`,
			});
		},
	},
});

const HTTP_SERVER = new ZonoHttpServer(
	ENDPOINTS,
	{
		bind: "0.0.0.0",
		port: PORT,
		handlers: {},
		converters: {},
		socket: SOCKET_SERVER,
	},
	{},
);

describe("Local Socket Server/Client", () => {
	let client: ZonoSocketClient<typeof SOCKET_DEFINITION>;
	beforeAll(async () => {
		// to ensure that starting and stopping doesn't break anything
		HTTP_SERVER.start();
		await HTTP_SERVER.stop();
		HTTP_SERVER.start();
		client = new ZonoSocketClient(SOCKET_DEFINITION, {
			url: `http://localhost:${PORT}`,
		});
	});

	afterAll(async () => {
		await HTTP_SERVER.stop(true);
	});

	it("client connects to server", async () => {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);
			client.socket.on("connect", () => {
				clearTimeout(timeout);
				resolve();
			});
			client.socket.on("connect_error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});

		expect(client.socket.connected).toBe(true);
	});

	it("client sends message and receives response", async () => {
		const receivedMessage = await new Promise<
			z.output<typeof SOCKET_DEFINITION.serverEvents.message>
		>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Message timeout")), 5000);
			client.listen("once", "message", (data) => {
				clearTimeout(timeout);
				resolve(data);
			});
			client.emit("sendMessage", { content: "Hello, server!" });
		});

		expect(receivedMessage.content).toBe("Hello, server!");
		expect(typeof receivedMessage.timestamp).toBe("number");
	});

	it("client sends ping and receives notification", async () => {
		const pingId = crypto.randomUUID();

		const receivedNotification = await new Promise<
			z.output<typeof SOCKET_DEFINITION.serverEvents.notification>
		>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("Notification timeout")), 5000);
			client.listen("once", "notification", (data) => {
				clearTimeout(timeout);
				resolve(data);
			});
			client.emit("ping", { id: pingId });
		});

		expect(receivedNotification.type).toBe("info");
		expect(receivedNotification.text).toBe(`pong: ${pingId}`);
	});

	it("listener can be added and removed", () => {
		const handlerId = client.listen("on", "message", () => {});
		expect(typeof handlerId).toBe("string");

		const removed = client.removeHandler("message", handlerId);
		expect(removed).toBe(true);

		const removedAgain = client.removeHandler("message", handlerId);
		expect(removedAgain).toBe(false);
	});
});
