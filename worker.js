export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.clients = [];
    this.users = new Map();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      await this.handleSession(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response("OK");
  }

  async handleSession(ws) {
    ws.accept();
    this.clients.push(ws);

    ws.onmessage = async (e) => {
      let data;

      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }

      // JOIN
      if (data.type === "join") {
        this.users.set(ws, data.user);

        this.broadcast({
          type: "system",
          msg: `${data.user} joined`,
          users: this.users.size
        });

        return;
      }

      // TYPING
      if (data.type === "typing") {
        this.broadcast(data, ws);
        return;
      }

      // MESSAGE
      const msgData = {
        type: "message",
        user: data.user,
        msg: data.msg,
        time: new Date().toLocaleTimeString().slice(0,5),
        clientId: data.clientId
      };

      // simpan ke storage
      const history = (await this.state.storage.get("messages")) || [];
      history.push(msgData);
      await this.state.storage.put("messages", history);

      this.broadcast(msgData);
    };

    ws.onclose = () => {
      const user = this.users.get(ws);
      this.users.delete(ws);

      this.broadcast({
        type: "system",
        msg: `${user} left`,
        users: this.users.size
      });

      this.clients = this.clients.filter(c => c !== ws);
    };

    // kirim history saat connect
    const history = (await this.state.storage.get("messages")) || [];
    history.forEach(m => ws.send(JSON.stringify(m)));
  }

  broadcast(data, sender = null) {
    this.clients.forEach(c => {
      if (c !== sender) {
        c.send(JSON.stringify(data));
      }
    });
  }
}

export default {
  fetch(request, env) {
    const id = env.CHAT_ROOM.idFromName("global");
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};
