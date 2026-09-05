import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export type UserRole = "customer" | "staff" | "manager" | "admin" | "owner";
export type PublicUser = { id: string; name: string; email: string; phone: string | null; emailVerified: boolean; role: UserRole };
type UserRecord = PublicUser & { passwordHash: string | null; sessionVersion: number };
type TokenKind = "verify" | "reset";

const users = new Map<string, UserRecord>();
const sessions = new Map<string, { userId: string; version: number; expiresAt: number }>();
const adminSessions = new Map<string, { userId: string; expiresAt: number }>();
const tokens = new Map<string, { userId: string; kind: TokenKind; expiresAt: number }>();
const oauthAccounts = new Map<string, string>();
let pool: Pool | null | undefined;
let schemaReady: Promise<void> | undefined;

function database() {
  if (pool !== undefined) return pool;
  if (!process.env.MYSQL_HOST) return (pool = null);
  return (pool = mysql.createPool({
    host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE, connectionLimit: 5, charset: "utf8mb4",
  }));
}

async function schema(db: Pool) {
  schemaReady ??= (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY, name VARCHAR(100) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE, phone VARCHAR(20) NULL UNIQUE,
      password_hash VARCHAR(255) NULL, email_verified_at DATETIME NULL,
      session_version INT UNSIGNED NOT NULL DEFAULT 1,
      role ENUM('customer','staff','manager','admin','owner') NOT NULL DEFAULT 'customer',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    try {
      await db.execute("ALTER TABLE users ADD COLUMN role ENUM('customer','staff','manager','admin','owner') NOT NULL DEFAULT 'customer' AFTER session_version");
    } catch (error) {
      if ((error as { code?: string }).code !== "ER_DUP_FIELDNAME") throw error;
    }
    await db.execute(`CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL,
      kind ENUM('verify','reset') NOT NULL, expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX auth_tokens_user_idx (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.execute(`CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL,
      session_version INT UNSIGNED NOT NULL, expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX sessions_user_idx (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.execute(`CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL,
      expires_at DATETIME NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX admin_sessions_user_idx (user_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.execute(`CREATE TABLE IF NOT EXISTS oauth_accounts (
      provider VARCHAR(30) NOT NULL, provider_account_id VARCHAR(191) NOT NULL,
      user_id CHAR(36) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider,provider_account_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  })();
  await schemaReady;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const adminEmail = () => (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const publicUser = (u: UserRecord): PublicUser => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, emailVerified: u.emailVerified, role: u.role });

async function find(identifier: string): Promise<UserRecord | null> {
  const value = identifier.trim().toLowerCase();
  const db = database();
  if (!db) return [...users.values()].find((u) => u.email === value || u.phone === value) || null;
  await schema(db);
  const [rows] = await db.query<(RowDataPacket & { id: string; name: string; email: string; phone: string | null; password_hash: string | null; email_verified_at: Date | null; session_version: number; role: UserRole })[]>(
    "SELECT id,name,email,phone,password_hash,email_verified_at,session_version,role FROM users WHERE email=? OR phone=? LIMIT 1", [value, value],
  );
  const u = rows[0];
  return u ? { id: u.id, name: u.name, email: u.email, phone: u.phone, passwordHash: u.password_hash, emailVerified: Boolean(u.email_verified_at), sessionVersion: u.session_version, role: u.role || "customer" } : null;
}

export async function registerUser(name: string, email: string, phone: string, password: string) {
  email = email.trim().toLowerCase(); phone = phone.trim(); name = name.trim();
  if (name.length < 2 || name.length > 100) throw new Error("請輸入正確姓名。");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email 格式不正確。");
  if (!/^09\d{8}$/.test(phone)) throw new Error("手機號碼必須是 09 開頭的 10 位數字。");
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error("密碼至少 8 碼，並須包含英文與數字。");
  const passwordHash = await hash(password, 12), id = randomUUID(), db = database();
  if (!db) {
    if ([...users.values()].some((u) => u.email === email)) throw new Error("此 Email 已經註冊。");
    if ([...users.values()].some((u) => u.phone === phone)) throw new Error("此手機號碼已經註冊。");
    users.set(id, { id, name, email, phone, passwordHash, emailVerified: false, sessionVersion: 1, role: "customer" });
  } else {
    await schema(db);
    try { await db.execute("INSERT INTO users (id,name,email,phone,password_hash) VALUES (?,?,?,?,?)", [id, name, email, phone, passwordHash]); }
    catch (error) { if ((error as { code?: string }).code === "ER_DUP_ENTRY") throw new Error("Email 或手機號碼已經註冊。"); throw error; }
  }
  return { user: { id, name, email, phone, emailVerified: false, role: "customer" as const }, token: await issueToken(id, "verify", 24 * 60 * 60) };
}

export async function loginUser(identifier: string, password: string) {
  const user = await find(identifier);
  if (!user || !user.passwordHash || !(await compare(password, user.passwordHash))) throw new Error("帳號或密碼不正確。");
  if (!user.emailVerified) throw new Error("請先完成 Email 驗證再登入。");
  return { user: publicUser(user), session: await issueSession(user) };
}

async function issueToken(userId: string, kind: TokenKind, ttlSeconds: number) {
  const raw = randomBytes(32).toString("base64url"), key = digest(raw), expiresAt = Date.now() + ttlSeconds * 1000, db = database();
  if (!db) tokens.set(key, { userId, kind, expiresAt });
  else { await schema(db); await db.execute("DELETE FROM auth_tokens WHERE user_id=? AND kind=?", [userId, kind]); await db.execute("INSERT INTO auth_tokens (token_hash,user_id,kind,expires_at) VALUES (?,?,?,?)", [key, userId, kind, new Date(expiresAt)]); }
  return raw;
}

async function consumeToken(raw: string, kind: TokenKind) {
  const key = digest(raw), db = database();
  if (!db) { const item = tokens.get(key); tokens.delete(key); return item?.kind === kind && item.expiresAt > Date.now() ? item.userId : null; }
  await schema(db);
  const [rows] = await db.query<(RowDataPacket & { user_id: string })[]>("SELECT user_id FROM auth_tokens WHERE token_hash=? AND kind=? AND expires_at>NOW()", [key, kind]);
  await db.execute("DELETE FROM auth_tokens WHERE token_hash=?", [key]);
  return rows[0]?.user_id || null;
}

async function issueSession(user: UserRecord) {
  const raw = randomBytes(32).toString("base64url"), key = digest(raw), expiresAt = Date.now() + 30 * 86400_000, db = database();
  if (!db) sessions.set(key, { userId: user.id, version: user.sessionVersion, expiresAt });
  else { await schema(db); await db.execute("INSERT INTO user_sessions (token_hash,user_id,session_version,expires_at) VALUES (?,?,?,?)", [key, user.id, user.sessionVersion, new Date(expiresAt)]); }
  return raw;
}

export async function currentUser(raw?: string): Promise<PublicUser | null> {
  if (!raw) return null;
  const key = digest(raw), db = database();
  if (!db) { const s = sessions.get(key), u = s && users.get(s.userId); return s && u && s.expiresAt > Date.now() && s.version === u.sessionVersion ? publicUser(u) : null; }
  await schema(db);
  const [rows] = await db.query<(RowDataPacket & { id: string; name: string; email: string; phone: string | null; email_verified_at: Date | null; role: UserRole })[]>(`SELECT u.id,u.name,u.email,u.phone,u.email_verified_at,u.role FROM user_sessions s JOIN users u ON u.id=s.user_id AND u.session_version=s.session_version WHERE s.token_hash=? AND s.expires_at>NOW() LIMIT 1`, [key]);
  const u = rows[0]; return u ? { id: u.id, name: u.name, email: u.email, phone: u.phone, emailVerified: Boolean(u.email_verified_at), role: u.role || "customer" } : null;
}

export async function adminPasswordLogin(email: string, password: string) {
  email = email.trim().toLowerCase();
  const expectedEmail = adminEmail(), passwordHash = process.env.ADMIN_PASSWORD_HASH_B64 ? Buffer.from(process.env.ADMIN_PASSWORD_HASH_B64,"base64").toString("utf8") : (process.env.ADMIN_PASSWORD_HASH || "");
  if (!expectedEmail || !passwordHash || email !== expectedEmail || !(await compare(password, passwordHash))) throw new Error("帳號或密碼不正確。");
  const db = database(); let user = await find(email);
  if (!db) {
    if (!user) { const id=randomUUID(); user={id,name:"管理員",email,phone:null,passwordHash,emailVerified:true,sessionVersion:1,role:"owner"}; users.set(id,user); }
    else { user.passwordHash=passwordHash; user.emailVerified=true; user.role="owner"; }
  } else {
    await schema(db);
    if (!user) { const id=randomUUID(); await db.execute("INSERT INTO users(id,name,email,password_hash,email_verified_at,role) VALUES(?,?,?,?,NOW(),'owner')",[id,"管理員",email,passwordHash]); user=await findUserById(id); }
    else { await db.execute("UPDATE users SET password_hash=?,email_verified_at=COALESCE(email_verified_at,NOW()),role='owner' WHERE id=?",[passwordHash,user.id]); user=await findUserById(user.id); }
  }
  if (!user) throw new Error("帳號或密碼不正確。");
  return { user: publicUser(user), session: await issueAdminSession(user.id) };
}

async function issueAdminSession(userId:string){const raw=randomBytes(32).toString("base64url"),key=digest(raw),expiresAt=Date.now()+8*60*60*1000,db=database();if(!db)adminSessions.set(key,{userId,expiresAt});else{await schema(db);await db.execute("INSERT INTO admin_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",[key,userId,new Date(expiresAt)]);}return raw;}
export async function currentAdmin(raw?:string):Promise<PublicUser|null>{if(!raw)return null;const key=digest(raw),db=database();if(!db){const s=adminSessions.get(key),u=s&&users.get(s.userId);return s&&u&&s.expiresAt>Date.now()&&isAdmin(publicUser(u))?publicUser(u):null;}await schema(db);const[rows]=await db.query<(RowDataPacket&{id:string;name:string;email:string;phone:string|null;email_verified_at:Date|null;role:UserRole})[]>(`SELECT u.id,u.name,u.email,u.phone,u.email_verified_at,u.role FROM admin_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.role IN ('staff','manager','admin','owner') LIMIT 1`,[key]);const u=rows[0];return u?{id:u.id,name:u.name,email:u.email,phone:u.phone,emailVerified:Boolean(u.email_verified_at),role:u.role}:null;}
export async function logoutAdmin(raw?:string){if(!raw)return;const key=digest(raw),db=database();if(!db)adminSessions.delete(key);else await db.execute("DELETE FROM admin_sessions WHERE token_hash=?",[key]);}

export async function verifyEmail(raw: string) {
  const id = await consumeToken(raw, "verify"); if (!id) return false;
  const db = database(); if (!db) { const u = users.get(id); if (u) u.emailVerified = true; }
  else await db.execute("UPDATE users SET email_verified_at=NOW() WHERE id=?", [id]); return true;
}

export async function requestReset(email: string) { const user = await find(email); return user ? issueToken(user.id, "reset", 60 * 60) : null; }
export async function resetPassword(raw: string, password: string) {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error("密碼至少 8 碼，並須包含英文與數字。");
  const id = await consumeToken(raw, "reset"); if (!id) throw new Error("重設連結無效或已過期。");
  const passwordHash = await hash(password, 12), db = database();
  if (!db) { const u = users.get(id); if (u) { u.passwordHash = passwordHash; u.sessionVersion++; } [...sessions].forEach(([k,s]) => s.userId === id && sessions.delete(k)); }
  else { await db.execute("UPDATE users SET password_hash=?,session_version=session_version+1 WHERE id=?", [passwordHash,id]); await db.execute("DELETE FROM user_sessions WHERE user_id=?", [id]); }
}
export async function logout(raw?: string) { if (!raw) return; const key=digest(raw),db=database(); if(!db)sessions.delete(key); else await db.execute("DELETE FROM user_sessions WHERE token_hash=?",[key]); }
export async function logoutAll(userId: string) { const db=database(); if(!db){const u=users.get(userId);if(u)u.sessionVersion++;[...sessions].forEach(([k,s])=>s.userId===userId&&sessions.delete(k));}else{await db.execute("UPDATE users SET session_version=session_version+1 WHERE id=?",[userId]);await db.execute("DELETE FROM user_sessions WHERE user_id=?",[userId]);} }

export async function oauthLogin(provider: string, providerAccountId: string, email: string, name: string) {
  email=email.trim().toLowerCase(); name=name.trim()||"會員"; const accountKey=`${provider}:${providerAccountId}`; const db=database(); let user:UserRecord|null=null;
  if(!db){ const userId=oauthAccounts.get(accountKey); user=userId?users.get(userId)||null:await find(email); if(!user){const id=randomUUID();user={id,name,email,phone:null,passwordHash:null,emailVerified:true,sessionVersion:1,role:"customer"};users.set(id,user);} oauthAccounts.set(accountKey,user.id); }
  else { await schema(db); const [linked]=await db.query<(RowDataPacket&{user_id:string})[]>("SELECT user_id FROM oauth_accounts WHERE provider=? AND provider_account_id=?",[provider,providerAccountId]); user=linked[0]?await findUserById(linked[0].user_id):await find(email); if(!user){const id=randomUUID();await db.execute("INSERT INTO users(id,name,email,email_verified_at) VALUES(?,?,?,NOW())",[id,name,email]);user=await findUserById(id);} if(!linked[0])await db.execute("INSERT INTO oauth_accounts(provider,provider_account_id,user_id) VALUES(?,?,?)",[provider,providerAccountId,user!.id]); }
  return {user:publicUser(user!),session:await issueSession(user!)};
}

async function findUserById(id:string):Promise<UserRecord|null>{const db=database();if(!db)return users.get(id)||null;const [rows]=await db.query<(RowDataPacket&{id:string;name:string;email:string;phone:string|null;password_hash:string|null;email_verified_at:Date|null;session_version:number;role:UserRole})[]>("SELECT id,name,email,phone,password_hash,email_verified_at,session_version,role FROM users WHERE id=?",[id]);const u=rows[0];return u?{id:u.id,name:u.name,email:u.email,phone:u.phone,passwordHash:u.password_hash,emailVerified:Boolean(u.email_verified_at),sessionVersion:u.session_version,role:u.role||"customer"}:null;}

export function isAdmin(user: PublicUser | null): user is PublicUser {
  return Boolean(user && ["staff", "manager", "admin", "owner"].includes(user.role));
}
export async function savePhone(userId:string,phone:string){phone=phone.trim();if(!/^09\d{8}$/.test(phone))throw new Error("手機號碼必須是 09 開頭的 10 位數字。");const db=database();if(!db){if([...users.values()].some(u=>u.phone===phone&&u.id!==userId))throw new Error("此手機號碼已被使用。");const u=users.get(userId);if(u)u.phone=phone;}else{try{await db.execute("UPDATE users SET phone=? WHERE id=?",[phone,userId]);}catch(e){if((e as {code?:string}).code==="ER_DUP_ENTRY")throw new Error("此手機號碼已被使用。");throw e;}}return findUserById(userId);}
