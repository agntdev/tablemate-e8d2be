import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { bookingForGuest, cancelBooking, removeGuestReminder } from "../reservation-domain.js";

const composer = new Composer<Ctx>();
composer.callbackQuery("booking:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await bookingForGuest(ctx);
  if (!booking) { await ctx.editMessageText("You don’t have a reservation to cancel.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); return; }
  await ctx.editMessageText(`Cancel your table on ${booking.datetime.slice(0, 10)} at ${booking.datetime.slice(11, 16)}?`, { reply_markup: inlineKeyboard([[inlineButton("Cancel reservation", `cancel:yes:${booking.id}`)], [inlineButton("Keep it", "booking:mine")]]) });
});
composer.callbackQuery(/^cancel:yes:b\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const booking = await cancelBooking(ctx, ctx.callbackQuery.data.slice("cancel:yes:".length)); if (booking) await removeGuestReminder(ctx, booking);
  await ctx.editMessageText(booking ? "Your reservation is cancelled. We hope to welcome you another time." : "That reservation is already closed.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) });
});
export default composer;
