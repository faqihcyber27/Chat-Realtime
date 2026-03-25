import { MongoClient, ObjectId } from "mongodb";

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = [];
  }

  async initMongo() {
    if (!this.client) {
      const { MongoClient } = await import("mongodb");
      this.client = new MongoClient(this.env.MONGO_URI);
      await this.client.connect();
      this.db = this.client.db("chatApp");
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ---------------- WebSocket ----------------
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.handleWS(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    await this.initMongo();

    // ---------------- REGISTER ----------------
    if (path === "/register" && method === "POST") {
      const { userId, name, photoUrl } = await request.json();
      const exist = await this.db.collection("users").findOne({ userId });
      if (exist) return new Response("UserId sudah dipakai", { status: 400 });

      await this.db.collection("users").insertOne({
        userId,
        name,
        photoUrl,
        createdAt: new Date()
      });
      await this.db.collection("friends").insertOne({
        userId,
        friends: [],
        createdAt: new Date()
      });
      return new Response("User registered");
    }

    // ---------------- LOGIN ----------------
    if (path === "/login" && method === "POST") {
      const { userId } = await request.json();
      const user = await this.db.collection("users").findOne({ userId });
      if (!user) return new Response("User not found", { status: 404 });
      return new Response(JSON.stringify(user));
    }

    // ---------------- ADD FRIEND ----------------
    if (path === "/add-friend" && method === "POST") {
      const { userId, friendId } = await request.json();
      const friendExist = await this.db.collection("users").findOne({ userId: friendId });
      if (!friendExist) return new Response("Friend not found", { status: 404 });

      await this.db.collection("friends").updateOne(
        { userId },
        { $addToSet: { friends: friendId } }
      );
      return new Response("Friend added");
    }

    // ---------------- LIST FRIENDS ----------------
    if (path.startsWith("/friends/") && method === "GET") {
      const userId = path.split("/")[2];
      const friendsDoc = await this.db.collection("friends").findOne({ userId });
      return new Response(JSON.stringify(friendsDoc?.friends || []));
    }

    // ---------------- GET CHAT HISTORY ----------------
    if (path.startsWith("/chat/") && method === "GET") {
      const roomId = path.split("/")[2];
      const chat = await this.db.collection("chats").findOne({ roomId });
      return new Response(JSON.stringify(chat?.messages || []));
    }

    // ---------------- POST CHAT MESSAGE ----------------
    if (path.startsWith("/chat/") && method === "POST") {
      const roomId = path.split("/")[2];
      const { senderId, msg, type, to } = await request.json();

      const message = { senderId, msg, type, time: new Date() };

      const room = await this.db.collection("chats").findOne({ roomId });
      if (room) {
        await this.db.collection("chats").updateOne(
          { roomId },
          { $push: { messages: message }, $set: { updatedAt: new Date() } }
        );
      } else {
        const users = roomId.split("_");
        await this.db.collection("chats").insertOne({
          roomId,
          users,
          messages: [message],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      // ---------------- Broadcast WebSocket ----------------
      if (this.clients.length) {
        this.clients.forEach(c => {
          try { c.send(JSON.stringify(message)); } catch {}
        });
      }

      return new Response("Message sent");
    }

    // ---------------- CLEAR HISTORY ----------------
    if (path === "/clear-history" && method === "POST") {
      await this.db.collection("chats").deleteMany({});
      return new Response("All chat cleared");
    }

    return new Response("Not found", { status: 404 });
  }

  // ---------------- WebSocket Handler ----------------
  handleWS(ws) {
    ws.accept();
    this.clients.push(ws);

    ws.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      await this.initMongo();

      const { roomId, senderId, msg, type, to } = data;
      const message = { senderId, msg, type, time: new Date() };

      // simpan ke MongoDB
      const room = await this.db.collection("chats").findOne({ roomId });
      if (room) {
        await this.db.collection("chats").updateOne(
          { roomId },
          { $push: { messages: message }, $set: { updatedAt: new Date() } }
        );
      } else {
        await this.db.collection("chats").insertOne({
          roomId,
          users: [senderId, to],
          messages: [message],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      // broadcast ke semua client
      this.clients.forEach(c => {
        if (c !== ws) c.send(JSON.stringify(message));
      });
    };

    ws.onclose = () => {
      this.clients = this.clients.filter(c => c !== ws);
    };
  }
}

// ---------------- DEFAULT EXPORT ----------------
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    // roomId dinamis misal berdasarkan path /chat/:roomId
    if (url.pathname.startsWith("/chat/")) {
      const roomId = url.pathname.split("/")[2];
      const id = env.CHAT_ROOM.idFromName(roomId);
      return env.CHAT_ROOM.get(id).fetch(request);
    }
    // register/login/add-friend/friends/clear-history tetap pakai default instance global
    const id = env.CHAT_ROOM.idFromName("global");
    return env.CHAT_ROOM.get(id).fetch(request);
  }
};
