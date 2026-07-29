import type { Ctx } from "./bot.js";
import { cancelReminder, remindAt, type WorkerEnv } from "./toolkit/session/durable.js";

export type BookingStatus = "confirmed" | "cancelled" | "no_show";
export interface Booking {
  id: string;
  guestChatId: number;
  guestName?: string;
  phone?: string;
  partySize: number;
  datetime: string;
  durationMinutes: number;
  assignedTables: string[];
  referenceCode: string;
  status: BookingStatus;
  reminderSent: boolean;
}
interface Table { id: string; seats: number; count: number }
interface Rules { durationMinutes: number; bufferMinutes: number; maxSimultaneousCovers: number }
interface State { tables: Table[]; rules: Rules; bookings: Record<string, Booking>; bookingIds: string[]; nextId: number; ownerChatId?: number }
interface D1Statement { bind(...values: unknown[]): D1Statement; first<T>(): Promise<T | null>; run(): Promise<unknown> }
interface D1 { prepare(query: string): D1Statement; exec(query: string): Promise<unknown> }
interface D1Env { DB?: D1; CHAT_DO?: { idFromName(name: string): unknown; get(id: unknown): { fetch(input: string, init?: { method: string; body?: string }): Promise<Response> } } }

const defaultState = (): State => ({
  tables: [{ id: "T2", seats: 2, count: 3 }, { id: "T4", seats: 4, count: 5 }, { id: "T6", seats: 6, count: 1 }],
  rules: { durationMinutes: 90, bufferMinutes: 10, maxSimultaneousCovers: 32 },
  bookings: {}, bookingIds: [], nextId: 1,
});

/** One injectable clock seam for all availability, reminders, and date decisions. */
let clock: () => Date = () => new Date();
export const now = (): Date => clock();
export const setClockForTests = (next?: () => Date): void => { clock = next ?? (() => new Date()); };

function dbFor(ctx: Ctx): D1 | undefined { return (ctx as unknown as { env?: D1Env }).env?.DB; }
async function readState(ctx: Ctx): Promise<State> {
  const db = dbFor(ctx);
  const domain = (ctx as unknown as { env?: D1Env }).env?.CHAT_DO;
  if (!db && domain) {
    const stub = domain.get(domain.idFromName("restaurant-domain"));
    const response = await stub.fetch("https://do/domain", { method: "GET" });
    if (response.status !== 204) return await response.json() as State;
    const initial = defaultState();
    await stub.fetch("https://do/domain", { method: "PUT", body: JSON.stringify(initial) });
    return initial;
  }
  if (!db) {
    const saved = ctx.session.reservationTestState as State | undefined;
    if (saved) return saved;
    const initial = defaultState(); ctx.session.reservationTestState = initial; return initial;
  }
  await db.exec("CREATE TABLE IF NOT EXISTS restaurant_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)");
  const row = await db.prepare("SELECT payload FROM restaurant_state WHERE id = 1").first<{ payload: string }>();
  if (row) return JSON.parse(row.payload) as State;
  const initial = defaultState();
  await db.prepare("INSERT INTO restaurant_state (id, payload) VALUES (1, ?)").bind(JSON.stringify(initial)).run();
  return initial;
}
async function writeState(ctx: Ctx, state: State): Promise<void> {
  const db = dbFor(ctx);
  const domain = (ctx as unknown as { env?: D1Env }).env?.CHAT_DO;
  if (!db && domain) { const stub = domain.get(domain.idFromName("restaurant-domain")); await stub.fetch("https://do/domain", { method: "PUT", body: JSON.stringify(state) }); return; }
  if (!db) { ctx.session.reservationTestState = state; return; }
  await db.prepare("UPDATE restaurant_state SET payload = ? WHERE id = 1").bind(JSON.stringify(state)).run();
}

function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }
export function isBookableDate(date: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= dateOnly(now()); }
export function slotTimes(date: string): string[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const start = day === 0 || day === 6 ? 10 : 11;
  const end = day === 0 || day === 6 ? 23 : 22;
  return Array.from({ length: end - start - 1 }, (_, index) => `${String(start + index).padStart(2, "0")}:00`);
}
function bookingStart(booking: Booking): number { return new Date(booking.datetime).getTime(); }
function overlaps(a: number, duration: number, b: Booking, buffer: number): boolean {
  const from = bookingStart(b) - buffer * 60_000;
  const until = bookingStart(b) + (b.durationMinutes + buffer) * 60_000;
  return a < until && a + duration * 60_000 > from;
}
function chooseTables(state: State, partySize: number, at: number, ignoreId?: string): string[] | undefined {
  const busy = new Set<string>();
  for (const id of state.bookingIds) { const b = state.bookings[id]; if (b && b.status === "confirmed" && b.id !== ignoreId && overlaps(at, state.rules.durationMinutes, b, state.rules.bufferMinutes)) for (const table of b.assignedTables) busy.add(table); }
  const available: { id: string; seats: number }[] = [];
  for (const table of state.tables) for (let index = 1; index <= table.count; index++) { const id = `${table.id}-${index}`; if (!busy.has(id)) available.push({ id, seats: table.seats }); }
  let best: { ids: string[]; seats: number } | undefined;
  const walk = (start: number, ids: string[], seats: number): void => {
    if (seats >= partySize) { if (!best || seats < best.seats || (seats === best.seats && ids.length < best.ids.length)) best = { ids: [...ids], seats }; return; }
    for (let i = start; i < available.length; i++) walk(i + 1, [...ids, available[i].id], seats + available[i].seats);
  };
  walk(0, [], 0); return best?.ids;
}
export async function availability(ctx: Ctx, date: string, partySize: number): Promise<{ time: string; label: string }[]> {
  const state = await readState(ctx);
  return slotTimes(date).flatMap((time) => {
    const tables = chooseTables(state, partySize, new Date(`${date}T${time}:00Z`).getTime());
    return tables ? [{ time, label: tables.length === 1 ? "Exact fit" : "Combined tables" }] : [];
  });
}
export async function createBooking(ctx: Ctx, input: { date: string; time: string; partySize: number; name?: string; phone?: string }): Promise<Booking | undefined> {
  const state = await readState(ctx); const at = new Date(`${input.date}T${input.time}:00Z`).getTime();
  const tables = chooseTables(state, input.partySize, at);
  const covers = state.bookingIds.map((id) => state.bookings[id]).filter((b): b is Booking => Boolean(b) && b.status === "confirmed" && overlaps(at, state.rules.durationMinutes, b, state.rules.bufferMinutes)).reduce((sum, b) => sum + b.partySize, 0);
  if (!tables || covers + input.partySize > state.rules.maxSimultaneousCovers) return undefined;
  const id = `b${state.nextId}`; const referenceCode = `R-${String(state.nextId).padStart(4, "0")}`; state.nextId++;
  const booking: Booking = { id, guestChatId: ctx.chat!.id, partySize: input.partySize, datetime: new Date(`${input.date}T${input.time}:00Z`).toISOString(), durationMinutes: state.rules.durationMinutes, assignedTables: tables, referenceCode, status: "confirmed", reminderSent: false, ...(input.name ? { guestName: input.name } : {}), ...(input.phone ? { phone: input.phone } : {}) };
  state.bookings[id] = booking; state.bookingIds.push(id); await writeState(ctx, state); return booking;
}
export async function bookingForGuest(ctx: Ctx): Promise<Booking | undefined> { const state = await readState(ctx); return state.bookingIds.map((id) => state.bookings[id]).filter((b): b is Booking => Boolean(b)).filter((b) => b.guestChatId === ctx.chat!.id && b.status === "confirmed").sort((a, b) => bookingStart(a) - bookingStart(b))[0]; }
export async function cancelBooking(ctx: Ctx, id: string): Promise<Booking | undefined> { const state = await readState(ctx); const b = state.bookings[id]; if (!b || b.guestChatId !== ctx.chat!.id || b.status !== "confirmed") return undefined; b.status = "cancelled"; await writeState(ctx, state); return b; }
export async function cancelBookingAsOwner(ctx: Ctx, id: string): Promise<Booking | undefined> { const state = await readState(ctx); const b = state.bookings[id]; if (!b || b.status !== "confirmed") return undefined; b.status = "cancelled"; await writeState(ctx, state); return b; }
export async function rescheduleBooking(ctx: Ctx, id: string, date: string, time: string): Promise<Booking | undefined> { const state = await readState(ctx); const b = state.bookings[id]; if (!b || b.guestChatId !== ctx.chat!.id || b.status !== "confirmed") return undefined; const at = new Date(`${date}T${time}:00Z`).getTime(); const tables = chooseTables(state, b.partySize, at, id); if (!tables) return undefined; b.datetime = new Date(`${date}T${time}:00Z`).toISOString(); b.assignedTables = tables; b.referenceCode = `R-${String(state.nextId++).padStart(4, "0")}`; b.reminderSent = false; await writeState(ctx, state); return b; }
export async function claimOrCheckOwner(ctx: Ctx): Promise<boolean> { const state = await readState(ctx); if (state.ownerChatId === undefined) { state.ownerChatId = ctx.chat!.id; await writeState(ctx, state); return true; } return state.ownerChatId === ctx.chat!.id; }
export async function ownerChatId(ctx: Ctx): Promise<number | undefined> { return (await readState(ctx)).ownerChatId; }
export async function dashboard(ctx: Ctx): Promise<{ upcoming: Booking[]; todayCovers: number; remaining: number }> { const state = await readState(ctx); const today = dateOnly(now()); const end = new Date(now().getTime() + 7 * 86_400_000).toISOString(); const upcoming = state.bookingIds.map((id) => state.bookings[id]).filter((b): b is Booking => Boolean(b) && b.status === "confirmed" && b.datetime >= `${today}T00:00:00.000Z` && b.datetime < end).sort((a,b) => bookingStart(a)-bookingStart(b)); const todayCovers = upcoming.filter((b) => b.datetime.slice(0, 10) === today).reduce((sum,b) => sum+b.partySize,0); return { upcoming, todayCovers, remaining: Math.max(0, state.rules.maxSimultaneousCovers - todayCovers) }; }
export async function markNoShow(ctx: Ctx, id: string): Promise<Booking | undefined> { const state = await readState(ctx); const b = state.bookings[id]; if (!b || b.status !== "confirmed") return undefined; b.status = "no_show"; await writeState(ctx, state); return b; }
export async function dueReminders(ctx: Ctx): Promise<Booking[]> { const state = await readState(ctx); const target = now().getTime() + 2 * 60 * 60_000; const due = state.bookingIds.map((id) => state.bookings[id]).filter((b): b is Booking => Boolean(b) && b.status === "confirmed" && !b.reminderSent && Math.abs(bookingStart(b) - target) <= 60_000); for (const b of due) b.reminderSent = true; if (due.length) await writeState(ctx, state); return due; }
export const displayDateTime = (booking: Booking): string => `${booking.datetime.slice(0, 10)} at ${booking.datetime.slice(11, 16)}`;
export async function scheduleGuestReminder(ctx: Ctx, booking: Booking): Promise<void> {
  const env = (ctx as unknown as { env?: WorkerEnv }).env;
  const when = bookingStart(booking) - 2 * 60 * 60_000;
  if (env && when > now().getTime()) await remindAt(env, booking.guestChatId, when, `A reminder: your table is in two hours, at ${displayDateTime(booking)}.`, booking.id);
}
export async function removeGuestReminder(ctx: Ctx, booking: Booking): Promise<void> {
  const env = (ctx as unknown as { env?: WorkerEnv }).env;
  if (env) await cancelReminder(env, booking.guestChatId, booking.id);
}
