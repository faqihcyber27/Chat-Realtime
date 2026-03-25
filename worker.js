export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.clients = new Set();
    this.userMap = new Map(); // ws -> username
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.handleSession(server);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  handleSession(ws) {
    ws.accept();
    this.clients.add(ws);

    ws.addEventListener("message", (event) => {
      let data;

      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      // JOIN
      if (data.type === "join") {
        this.userMap.set(ws, data.user || "User");
        return;
      }

      // TYPING
      if (data.type === "typing") {
        this.broadcast(data, ws);
        return;
      }

      // MESSAGE / AUDIO
      if (data.type === "message" || data.type === "audio") {

        const msg = {
          ...data,
          time: new Date().toLocaleTimeString().slice(0,5),
          status: "sent"
        };

        // broadcast ke semua
        this.broadcast(msg);

        // ACK ke sender
        ws.send(JSON.stringify({
          type: "ack",
          id: data.id,
          status: "delivered"
        }));

        // simulate read
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: "ack",
            id: data.id,
            status: "read"
          }));
        }, 1000);
      }
    });

    ws.addEventListener("close", () => {
      this.clients.delete(ws);
      this.userMap.delete(ws);
    });
  }

  broadcast(data, sender = null) {
    for (const client of this.clients) {
      if (client !== sender) {
        try {
          client.send(JSON.stringify(data));
        } catch {}
      }
    }
  }
}

export default {
  fetch(request, env) {
    const id = env.CHAT_ROOM.idFromName("global");
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};
