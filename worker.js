export class ChatRoom {
  constructor(state, env) {
    this.clients = [];
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      this.clients.push(server);

      server.onmessage = (event) => {
        for (let c of this.clients) {
          c.send(event.data);
        }
      };

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("OK");
  }
}

export default {
  fetch(request, env) {
    const id = env.CHAT_ROOM.idFromName("global");
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};

export { ChatRoom };