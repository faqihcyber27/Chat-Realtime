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

    return new Response("Chat Worker Running");
  }

  async handleSession(ws) {
    ws.accept();
    this.clients.push(ws);

    // 🔥 kirim history ke user baru
    const history = (await this.state.storage.get("messages")) || [];
    history.forEach(m => ws.send(JSON.stringify(m)));

    ws.onmessage = async (e) => {
      let data;

      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }

      // ✅ FIX: KEEP ALIVE (PING)
      if (data.type === "ping") {
        return;
      }

      // ✅ JOIN USER
      if (data.type === "join") {
        this.users.set(ws, data.user);

        this.broadcast({
          type: "system",
          msg: `${data.user} joined`,
          users: this.users.size
        });

        return;
      }

      // ✅ TYPING
      if (data.type === "typing") {
        this.broadcast(data, ws);
        return;
      }

      // ✅ MESSAGE & IMAGE
      if (data.type === "message" || data.type === "image") {

        const msgData = {
          type: data.type,
          user: data.user,
          msg: data.msg || null,
          img: data.img || null,
          time: new Date().toLocaleTimeString().slice(0,5),
          clientId: data.clientId
        };

        // 🔥 simpan ke storage (history)
        const history = (await this.state.storage.get("messages")) || [];
        history.push(msgData);

        // limit biar tidak berat
        if (history.length > 100) history.shift();

        await this.state.storage.put("messages", history);

        this.broadcast(msgData);
      }
    };

    ws.onclose = () => {
      const user = this.users.get(ws);

      this.users.delete(ws);
      this.clients = this.clients.filter(c => c !== ws);

      if (user) {
        this.broadcast({
          type: "system",
          msg: `${user} left`,
          users: this.users.size
        });
      }
    };
  }

  broadcast(data, sender = null) {
    this.clients.forEach(client => {
      if (client !== sender) {
        try {
          client.send(JSON.stringify(data));
        } catch {}
      }
    });
  }
}

// 🔥 ENTRY POINT
export default {
  fetch(request, env) {
    const id = env.CHAT_ROOM.idFromName("global");
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};
