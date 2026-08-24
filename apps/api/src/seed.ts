import { ulid } from "ulid";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "@chat/db";
import { workspace, workspaceMember, channel, channelMember, message, reaction } from "@chat/db/schema";
import { createAuth } from "./lib/auth.js";

const SEED_USERS = [
  { email: "alice@pulse.dev", name: "Alice", password: "password123" },
  { email: "bob@pulse.dev", name: "Bob", password: "password123" },
  { email: "carol@pulse.dev", name: "Carol", password: "password123" },
];

async function ensureUsers() {
  const auth = createAuth();
  const users: Record<string, string> = {};
  for (const u of SEED_USERS) {
    let created = false;
    try {
      const res = await auth.api.signUpEmail({ body: { email: u.email, password: u.password, name: u.name } });
      if (res?.user?.id) {
        users[u.email] = res.user.id;
        created = true;
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!msg.includes("USER_ALREADY_EXISTS") && !msg.includes("already")) throw e;
    }
    if (!created) {
      const db = getDb();
      const { user } = await import("@chat/db/schema");
      const [row] = await db.select().from(user).where(eq(user.email, u.email));
      if (!row) throw new Error(`seed: user ${u.email} missing and could not be created`);
      users[u.email] = row.id;
    }
    console.log(created ? `+ user ${u.email}` : `= user ${u.email}`);
  }
  return users;
}

export async function seed() {
  const db = getDb();

  const existing = await db.select().from(workspace).where(eq(workspace.slug, "acme"));
  if (existing.length) {
    console.log("seed: workspace 'acme' already present — skipping");
    return;
  }

  const users = await ensureUsers();
  const alice = users["alice@pulse.dev"];
  const bob = users["bob@pulse.dev"];
  const carol = users["carol@pulse.dev"];

  const wsId = ulid();
  await db.insert(workspace).values({ id: wsId, name: "Acme", slug: "acme", ownerId: alice });
  await db.insert(workspaceMember).values([
    { workspaceId: wsId, userId: alice, role: "owner" },
    { workspaceId: wsId, userId: bob, role: "member" },
    { workspaceId: wsId, userId: carol, role: "member" },
  ]);
  console.log("+ workspace acme");

  const generalId = ulid();
  const randomId = ulid();
  const designId = ulid();
  await db.insert(channel).values([
    { id: generalId, workspaceId: wsId, name: "general", type: "public" as const, createdBy: alice },
    { id: randomId, workspaceId: wsId, name: "random", type: "public" as const, createdBy: alice },
    { id: designId, workspaceId: wsId, name: "design", type: "private" as const, createdBy: alice },
  ]);
  await db.insert(channelMember).values([
    { channelId: generalId, userId: alice },
    { channelId: generalId, userId: bob },
    { channelId: generalId, userId: carol },
    { channelId: randomId, userId: alice },
    { channelId: randomId, userId: bob },
    { channelId: designId, userId: alice },
    { channelId: designId, userId: bob },
  ]);
  console.log("+ channels general/random/design");

  const hour = 3600 * 1000;
  const now = Date.now();
  let t = now - 24 * hour;

  function nextId(content: string) {
    t += Math.floor(hour / 6) + (content.length % 7) * 60 * 1000;
    return ulid(Math.min(t, now - 60 * 1000));
  }

  async function put(channelId: string, senderId: string, content: string, parentId?: string) {
    const id = nextId(content);
    await db.insert(message).values({
      id,
      channelId,
      senderId,
      content,
      parentId: parentId ?? null,
      createdAt: new Date(Math.min(t, now - 60 * 1000)),
    });
    return id;
  }

  const m1 = await put(generalId, alice, "Welcome to Pulse! This is our new team chat.");
  await put(generalId, bob, "Hey Alice — looks great. Golden theme is a nice touch.");
  await put(generalId, carol, "Can we use this for the launch checklist too?");
  const m4 = await put(generalId, alice, "@bob can you review the deployment failed issue from yesterday?");
  const m5 = await put(generalId, bob, "On it — the staging deploy was a config drift, fixing now.");
  await put(randomId, bob, "Friday ship-it energy 🚀");
  await put(designId, alice, "Dropping the new palette tokens in DESIGN.md today.");

  await put(generalId, carol, "reply: what time is standup?", m1);
  await put(generalId, alice, "reply: 9:30 sharp.", m1);

  await db.insert(reaction).values([
    { messageId: m1, userId: bob, emoji: "👍" },
    { messageId: m1, userId: carol, emoji: "🎉" },
    { messageId: m4, userId: bob, emoji: "👀" },
    { messageId: m5, userId: alice, emoji: "❤️" },
  ]);

  console.log(`+ ${8} messages, thread + reactions`);
  console.log("\nSeed complete. Log in with:");
  for (const u of SEED_USERS) console.log(`  ${u.email} / ${u.password}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("seed.ts")) {
  seed()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
