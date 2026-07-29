import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { availability, bookingForGuest, displayDateTime, isBookableDate, now, removeGuestReminder, rescheduleBooking, scheduleGuestReminder } from "../reservation-domain.js";

const composer = new Composer<Ctx>();
composer.callbackQuery("booking:reschedule", async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await bookingForGuest(ctx);
  if (!booking) { await ctx.editMessageText("You don’t have an upcoming reservation to reschedule.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); return; }
  ctx.session.draft = { bookingId: booking.id }; ctx.session.step = "rescheduling";
  const dates = Array.from({ length: 7 }, (_, i) => new Date(now().getTime() + i * 86_400_000).toISOString().slice(0, 10));
  await ctx.editMessageText("Choose a new day for your table.", { reply_markup: inlineKeyboard([...dates.map((date) => [inlineButton(date, `move:date:${date}`)]), [inlineButton("Keep current time", "booking:mine")]]) });
});
composer.callbackQuery(/^move:date:\d{4}-\d{2}-\d{2}$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const date = ctx.callbackQuery.data.slice("move:date:".length); const id = ctx.session.draft?.bookingId;
  if (!id || !isBookableDate(date)) { await ctx.editMessageText("Choose a future date from your reservation menu.", { reply_markup: inlineKeyboard([[inlineButton("My reservation", "booking:mine")]]) }); return; }
  const booking = await bookingForGuest(ctx); if (!booking) return; ctx.session.draft = { bookingId: id, date };
  const slots = await availability(ctx, date, booking.partySize);
  await ctx.editMessageText(slots.length ? "Choose an available time." : "No tables are available that day. Choose another day.", { reply_markup: inlineKeyboard(slots.length ? [...slots.map((slot) => [inlineButton(`${slot.time} · ${slot.label}`, `move:time:${slot.time}`)]), [inlineButton("Choose another day", "booking:reschedule")]] : [[inlineButton("Choose another day", "booking:reschedule")]]) });
});
composer.callbackQuery(/^move:time:\d{2}:00$/, async (ctx) => {
  await ctx.answerCallbackQuery(); const draft = ctx.session.draft; if (!draft?.bookingId || !draft.date) return;
  const oldBooking = await bookingForGuest(ctx); const booking = await rescheduleBooking(ctx, draft.bookingId, draft.date, ctx.callbackQuery.data.slice("move:time:".length)); if (oldBooking) await removeGuestReminder(ctx, oldBooking); if (booking) await scheduleGuestReminder(ctx, booking); ctx.session.step = "idle"; ctx.session.draft = undefined;
  await ctx.editMessageText(booking ? `Your reservation is moved to ${displayDateTime(booking)}. Your new reference is ${booking.referenceCode}.` : "That time is no longer available. Choose another one.", { reply_markup: booking ? inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) : inlineKeyboard([[inlineButton("Choose another day", "booking:reschedule")]]) });
});
export default composer;
